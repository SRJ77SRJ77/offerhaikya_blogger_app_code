import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const DEFAULT_CENTER = [15.8497, 74.4977]

function buildPopup(post, onOpen) {
  const box = document.createElement('div')
  box.className = 'ohk-map-popup'
  if (post.image) {
    const img = document.createElement('img')
    img.src = post.image.replace(/\/s\d+(-[a-z]+)*\//i, '/s320/')
    img.alt = post.title || 'Offer'
    img.loading = 'lazy'
    box.appendChild(img)
  }
  const title = document.createElement('strong')
  title.textContent = post.title || 'Offer'
  box.appendChild(title)
  const label = document.createElement('small')
  const visibleLabels = (Array.isArray(post.labels) ? post.labels : [post.label || 'Offer'])
    .map((item) => String(item || '').replace(/imp$/i, '').trim())
    .filter(Boolean)
  label.textContent = [...new Set(visibleLabels)].join(' · ') || 'Offer'
  box.appendChild(label)
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'View offer'
  button.addEventListener('click', () => onOpen(post))
  box.appendChild(button)
  return box
}

export default function OffersMap({ posts, userLocation, focusPostId, onRequestLocation, onOpenPost, onClose }) {
  const elementRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const userLayerRef = useRef(null)
  const markersRef = useRef({})
  const openRef = useRef(onOpenPost)

  useEffect(() => { openRef.current = onOpenPost })

  const postsKey = useMemo(() => posts.map((post) => [post.id, post.updatedAt, post.title, post.image, (post.labels || []).join(','), post.label, post.coordinates?.latitude, post.coordinates?.longitude].join('::')).join('|'), [posts])

  useEffect(() => {
    const map = L.map(elementRef.current).setView(DEFAULT_CENTER, 11)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    userLayerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    const timer = window.setTimeout(() => map.invalidateSize(), 150)
    return () => {
      window.clearTimeout(timer)
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return undefined
    layer.clearLayers()
    markersRef.current = {}
    const points = []
    posts.forEach((post) => {
      const { latitude, longitude } = post.coordinates
      const icon = L.divIcon({
        className: 'ohk-map-pin',
        html: '<span></span>',
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -28],
      })
      const marker = L.marker([latitude, longitude], { icon, title: post.title })
        .bindPopup(buildPopup(post, (item) => openRef.current(item)), { minWidth: 210 })
        .addTo(layer)
      markersRef.current[post.id] = marker
      points.push([latitude, longitude])
    })

    const focused = focusPostId ? markersRef.current[focusPostId] : null
    let timer = null
    if (focused) {
      map.setView(focused.getLatLng(), 15)
      timer = window.setTimeout(() => focused.openPopup(), 300)
    } else if (points.length === 1) {
      map.setView(points[0], 14)
    } else if (points.length > 1) {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 15 })
    } else if (userLocation) {
      map.setView([userLocation.latitude, userLocation.longitude], 12)
    }
    return () => { if (timer) window.clearTimeout(timer) }
  }, [postsKey, focusPostId])

  useEffect(() => {
    const layer = userLayerRef.current
    if (!layer) return
    layer.clearLayers()
    if (!userLocation) return
    L.circleMarker([userLocation.latitude, userLocation.longitude], {
      radius: 8, color: '#ffffff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1,
    }).bindTooltip('You are here').addTo(layer)
  }, [userLocation])

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const goToMe = () => {
    if (userLocation && mapRef.current) {
      mapRef.current.setView([userLocation.latitude, userLocation.longitude], 13)
    } else {
      onRequestLocation()
    }
  }

  return (
    <div className="ohk-map-overlay" role="dialog" aria-modal="true" aria-label="Offers map">
      <div className="ohk-map-bar">
        <h2>Offers on Map ({posts.length})</h2>
        <button type="button" onClick={goToMe}>Near me</button>
        <button type="button" className="ohk-map-close" onClick={onClose}>Close</button>
      </div>
      <div className="ohk-map-canvas">
        <div ref={elementRef} style={{ position: 'absolute', inset: 0 }} />
        {posts.length === 0 ? (
          <div className="ohk-map-empty">
            No offers with a map location yet. Offline offers with a location appear here.
          </div>
        ) : null}
      </div>
    </div>
  )
}
