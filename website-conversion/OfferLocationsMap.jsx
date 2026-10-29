import { useEffect, useRef, useState } from 'react'

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
    const lat = Number(match[1])
    const lng = Number(match[2])
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng }
  }
  return null
}

function loadGoogleMaps(apiKey) {
  if (window.google?.maps) return Promise.resolve(window.google.maps)
  if (window.__ohkGoogleMapsPromise) return window.__ohkGoogleMapsPromise
  if (!apiKey) return Promise.reject(new Error('Google Maps API key is missing. Set VITE_GOOGLE_MAPS_API_KEY.'))
  window.__ohkGoogleMapsPromise = new Promise((resolve, reject) => {
    const callbackName = '__ohkGoogleMapsReady'
    window[callbackName] = () => resolve(window.google.maps)
    const script = document.createElement('script')
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey) + '&callback=' + callbackName
    script.async = true
    script.onerror = () => reject(new Error('Google Maps JavaScript API could not be loaded.'))
    document.head.appendChild(script)
  })
  return window.__ohkGoogleMapsPromise
}

export default function OfferLocationsMap({ locations = [] }) {
  const mapElement = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const [status, setStatus] = useState('Loading map…')

  useEffect(() => {
    let cancelled = false
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    loadGoogleMaps(apiKey).then((maps) => {
      if (cancelled || !mapElement.current) return
      const map = new maps.Map(mapElement.current, {
        center: { lat: 20.5937, lng: 78.9629 },
        zoom: 5,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      })
      mapRef.current = map
      const geocoder = new maps.Geocoder()
      const validLocations = locations.filter((item) => String(item?.value || '').trim()).slice(0, 5)
      Promise.all(validLocations.map(async (location) => {
        const direct = coordinatesFrom(location.value)
        if (direct) return { ...location, position: direct }
        try {
          const result = await geocoder.geocode({ address: String(location.value) })
          const position = result.results?.[0]?.geometry?.location
          if (!position) return null
          return { ...location, position: { lat: position.lat(), lng: position.lng() } }
        } catch {
          return null
        }
      })).then((resolved) => {
        if (cancelled) return
        const points = resolved.filter(Boolean)
        markersRef.current.forEach((marker) => marker.setMap(null))
        markersRef.current = points.map((location) => {
          const marker = new maps.Marker({ map, position: location.position, title: location.label || 'Business location' })
          const info = new maps.InfoWindow({ content: document.createTextNode(String(location.label || 'Business location')) })
          marker.addListener('click', () => info.open({ map, anchor: marker }))
          return marker
        })
        if (points.length > 1) {
          const bounds = new maps.LatLngBounds()
          points.forEach((point) => bounds.extend(point.position))
          map.fitBounds(bounds, 48)
        } else if (points.length === 1) {
          map.setCenter(points[0].position)
          map.setZoom(14)
        }
        setStatus(points.length ? points.length + ' location' + (points.length === 1 ? '' : 's') + ' shown on one map' : 'No locations could be placed. Add coordinates or full addresses.')
      })
    }).catch((error) => {
      if (!cancelled) setStatus(error.message || 'Google Maps could not be loaded.')
    })
    return () => {
      cancelled = true
      markersRef.current.forEach((marker) => marker.setMap(null))
      markersRef.current = []
      mapRef.current = null
    }
  }, [locations.map((item) => item.label + ':' + item.value).join('|')])

  return <div className="ohk-multi-location-map-wrap">
    <div className="ohk-multi-location-map" ref={mapElement} aria-label="Google Map showing multiple business locations" />
    <p className="ohk-location-map-status">{status}</p>
  </div>
}
