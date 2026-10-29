import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

function coordinatesFrom(value = '') {
  const text = String(value || '').trim()
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?)[,%20]+(-?\d+(?:\.\d+)?)/i,
    /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const latitude = Number(match[1])
    const longitude = Number(match[2])
    if (Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      return [latitude, longitude]
    }
  }
  return null
}

async function resolveLocation(location) {
  const raw = String(location.value || '').trim()
  if (!raw) return null
  const direct = coordinatesFrom(raw)
  if (direct) return { ...location, coords: direct }

  let query = raw
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw)
      const q = url.searchParams.get('q') || url.searchParams.get('query') || url.searchParams.get('destination')
      if (q && !coordinatesFrom(q)) query = q
      else if (q && coordinatesFrom(q)) return { ...location, coords: coordinatesFrom(q) }
      else if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(raw)) {
        const response = await fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(raw))
        if (response.ok) {
          const html = await response.text()
          const coords = coordinatesFrom(html)
          if (coords) return { ...location, coords }
        }
        return null
      } else {
        const place = url.pathname.split('/').filter(Boolean).pop() || ''
        query = decodeURIComponent(place.replace(/\+/g, ' ')).replace(/,/g, ' ')
        if (!query || /^(maps|search|dir|place)$/i.test(query)) return null
      }
    } catch {
      return null
    }
  }

  try {
    const response = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(query))
    if (!response.ok) return null
    const results = await response.json()
    if (!results?.length) return null
    const latitude = Number(results[0].lat)
    const longitude = Number(results[0].lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
    return { ...location, coords: [latitude, longitude] }
  } catch {
    return null
  }
}

export default function OfferLocationsMap({ locations = [] }) {
  const mapElement = useRef(null)
  const mapRef = useRef(null)
  const [resolved, setResolved] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const validLocations = locations.filter((location) => String(location?.value || '').trim())
    setResolved(validLocations.map((location) => {
      const coords = coordinatesFrom(location.value)
      return coords ? { ...location, coords } : null
    }).filter(Boolean))
    const needsResolution = validLocations.filter((location) => !coordinatesFrom(location.value))
    if (!needsResolution.length) {
      setLoading(false)
      return () => { cancelled = true }
    }
    setLoading(true)
    Promise.all(needsResolution.map(resolveLocation)).then((results) => {
      if (cancelled) return
      const direct = validLocations.map((location) => {
        const coords = coordinatesFrom(location.value)
        return coords ? { ...location, coords } : null
      }).filter(Boolean)
      const byValue = new Map(direct.map((location) => [location.value, location]))
      results.filter(Boolean).forEach((location) => byValue.set(location.value, location))
      setResolved([...byValue.values()])
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [locations.map((location) => location.label + ':' + location.value).join('|')])

  useEffect(() => {
    if (!mapElement.current) return
    if (!mapRef.current) {
      mapRef.current = L.map(mapElement.current, { scrollWheelZoom: false })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(mapRef.current)
    }
    const map = mapRef.current
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker) map.removeLayer(layer)
    })
    const markers = resolved.map((location) => {
      const icon = L.divIcon({
        className: 'ohk-location-pin-wrap',
        html: '<span class="ohk-location-pin"></span>',
        iconSize: [22, 28],
        iconAnchor: [11, 27],
      })
      const marker = L.marker(location.coords, { icon }).addTo(map)
      marker.bindPopup(String(location.label || 'Business location').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char])))
      return marker
    })
    if (markers.length > 1) {
      map.fitBounds(L.featureGroup(markers).getBounds().pad(0.18), { maxZoom: 14 })
    } else if (markers.length === 1) {
      map.setView(markers[0].getLatLng(), 14)
    } else {
      map.setView([20.5937, 78.9629], 4)
    }
    const resizeTimer = window.setTimeout(() => map.invalidateSize(), 80)
    return () => window.clearTimeout(resizeTimer)
  }, [resolved])

  useEffect(() => () => {
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <div className="ohk-multi-location-map-wrap">
      <div className="ohk-multi-location-map" ref={mapElement} aria-label="Map showing business locations" />
      {loading ? <p className="ohk-location-map-status">Finding business locations…</p> : null}
      {!loading && !resolved.length ? <p className="ohk-location-map-status">We couldn’t locate these map links. Try adding coordinates or a full street address for each location.</p> : null}
      {resolved.length ? <p className="ohk-location-map-status">{resolved.length} location{resolved.length === 1 ? '' : 's'} shown on the map</p> : null}
    </div>
  )
}
