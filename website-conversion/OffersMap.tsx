import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet'
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'leaflet/dist/leaflet.css'
import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl(workerUrl)

const DEFAULT_CENTER = [15.8497, 74.4977]


function categoryMarkerIcon(post) {
  const labels = (Array.isArray(post?.labels) ? post.labels : [post?.label || ''])
    .map((label) => String(label || '').replace(/\s*imp\s*$/i, '').trim().toLowerCase())
  const categories = [
    { keys: ['car', 'cars', 'automobile', 'automotive'], icon: '<path d="M5 11l1.5-4h11L19 11l1.5 1.5V18h-2v-2H5.5v2h-2v-5.5L5 11Z" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 11h10M6 13.5h2m8 0h2" stroke="white" stroke-width="1.8" stroke-linecap="round"/>' },
    { keys: ['dress', 'clothing', 'fashion', 'apparel'], icon: '<path d="M8 4 10 3h4l2 1 4 3-2 4-3-1v10H9V9l-3 2-2-4 4-3Z" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>' },
    { keys: ['hotel', 'hotels', 'stay', 'accommodation'], icon: '<path d="M4 20V5h10v15M14 10h6v10M7 8h2m2 0h.1M7 12h2m2 0h.1M7 16h2m2 0h.1M16 13h2m-2 3h2" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['gaming', 'game', 'games', 'video games'], icon: '<path d="M7 9h10a4 4 0 0 1 3.8 5.2l-.8 2.4a2 2 0 0 1-3.2.9L14 15h-4l-2.8 2.5a2 2 0 0 1-3.2-.9l-.8-2.4A4 4 0 0 1 7 9Z" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 11v4m-2-2h4m6-1h.1m2 2h.1" stroke="white" stroke-width="1.8" stroke-linecap="round"/>' },
    { keys: ['restaurant', 'restaurants', 'food', 'cafe', 'dining'], icon: '<path d="M6 3v7m-3-7v4a3 3 0 0 0 6 0V3M6 10v11M16 3v18m0-18c3 2 3 6 0 8" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['home', 'house', 'real estate', 'property'], icon: '<path d="m3 11 9-8 9 8M5 10v10h14V10M9 20v-6h6v6" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['home appliances', 'home appliance', 'appliance', 'appliances'], icon: '<rect x="6" y="3" width="12" height="18" rx="1.5" fill="none" stroke="white" stroke-width="1.8"/><path d="M6 8h12m-9 3v1m3-1v1" stroke="white" stroke-width="1.8" stroke-linecap="round"/>' },
    { keys: ['electronics', 'electronic', 'mobile', 'computer', 'laptop'], icon: '<rect x="7" y="3" width="10" height="18" rx="1.5" fill="none" stroke="white" stroke-width="1.8"/><path d="M10 6h4m-2 12h.1" stroke="white" stroke-width="1.8" stroke-linecap="round"/>' },
    { keys: ['shopping', 'shop', 'store', 'offer'], icon: '<path d="M4 8h16l-1 12H5L4 8Zm4 0V6a4 4 0 0 1 8 0v2" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['health', 'medical', 'pharmacy'], icon: '<path d="M12 4v16M4 12h16" stroke="white" stroke-width="2.4" stroke-linecap="round"/>' },
    { keys: ['travel', 'tourism', 'flight'], icon: '<path d="m3 14 7-2 2-8 2-1 1 9 6 3-1 2-6-1-2 4-2 1v-5l-6-1Z" fill="none" stroke="white" stroke-width="1.6" stroke-linejoin="round"/>' },
    { keys: ['services', 'service'], icon: '<path d="M14 6a4 4 0 0 0-5 5L4 16a2 2 0 0 0 3 3l5-5a4 4 0 0 0 5-5l-3 3-3-3 3-3Z" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>' },
  ]
  const matched = categories.find((category) => labels.some((label) => category.keys.some((key) => label === key || label.includes(key))))
  const bag = '<path d="M4 8h16l-1 12H5L4 8Zm4 0V6a4 4 0 0 1 8 0v2" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
  return '<svg class="ohk-map-pin-icon" viewBox="0 0 24 24" aria-hidden="true">' + (matched?.icon || bag) + '</svg>'
}

function buildPopup(post, onOpen) {
  const box = document.createElement('div')
  box.className = 'ohk-map-popup' + (post.isExpired ? ' ohk-map-popup-expired' : '')
  const allLabels = [...new Set((Array.isArray(post.labels) ? post.labels : [post.label || 'Offer'])
    .map((item) => String(item || '').trim())
    .filter(Boolean))]
  const isVerified = allLabels.some((item) => /^verified$/i.test(item))

  if (post.image) {
    const img = document.createElement('img')
    img.src = post.image.replace(/\/s\d+(-[a-z]+)?\//i, '/s320/')
    img.alt = post.title || 'Offer'
    img.loading = 'lazy'
    box.appendChild(img)
  }

  const metadata = document.createElement('div')
  metadata.className = 'ohk-map-popup-meta'
  const label = document.createElement('small')
  const displayLabels = allLabels.filter((item) => !/^verified$/i.test(item))
    const impLabels = displayLabels
    .filter((item) => /.imp$/i.test(item))
    .map((item) => item.replace(/\s*imp$/i, '').trim())
    .filter(Boolean)
  // Prefer tags marked with "imp", removing that marker. Otherwise show only
  // the first tag alphabetically.
  const visibleLabels = impLabels.length
    ? impLabels
    : [...displayLabels].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).slice(0, 1)
  label.textContent = visibleLabels.join(' · ') || 'Offer'
  metadata.appendChild(label)

  if (isVerified) {
    const verified = document.createElement('div')
    verified.className = 'ohk-map-verified-badge'
    verified.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5 12.3 3l2.8-.1 1 2.6 2.2 1.7-.8 2.7.8 2.7-2.2 1.7-1 2.6-2.8-.1L10 18.5l-2.3-1.7-2.8.1-1-2.6-2.2-1.7.8-2.7-.8-2.7 2.2-1.7 1-2.6 2.8.1Z" fill="currentColor"/><path d="m6.2 10.2 2.4 2.4 5.2-5.2" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Verified</span>'
    metadata.appendChild(verified)
  }
  box.appendChild(metadata)

  const title = document.createElement('strong')
  title.textContent = post.title || 'Offer'
  box.appendChild(title)
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = post.isExpired ? 'Expired' : 'View Offer Details'
  if (post.isExpired) {
    button.disabled = true
    button.setAttribute('aria-label', 'This offer has expired')
  } else {
    button.addEventListener('click', () => onOpen(post))
  }
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

  const postsKey = useMemo(() => posts.map((post) => [post.id, post.updatedAt, post.title, post.image, (post.labels || []).join(','), post.isExpired, post.coordinates?.latitude, post.coordinates?.longitude].join('::')).join('|'), [posts])

  useEffect(() => {
    const map = L.map(elementRef.current).setView(DEFAULT_CENTER, 11)
    maplibreGL({
      style: 'https://tiles.openfreemap.org/styles/liberty',
      attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
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
        className: 'ohk-map-pin' + (post.isExpired ? ' ohk-map-pin-expired' : ''),
        html: '<span>' + categoryMarkerIcon(post) + '</span>',
        iconSize: [30, 30],
        iconAnchor: [15, 30],
        popupAnchor: [0, -28],
      })
      const marker = L.marker([latitude, longitude], { icon, title: post.title })
        .bindPopup(buildPopup(post, (item) => openRef.current(item)), { minWidth: 210 })
      marker.on('popupopen', (event) => {
        const wrapper = event.popup.getElement()?.querySelector('.leaflet-popup-content-wrapper')
        wrapper?.classList.toggle('ohk-leaflet-expired-popup-wrapper', Boolean(post.isExpired))
      })
      marker.on('popupclose', (event) => {
        event.popup.getElement()?.querySelector('.leaflet-popup-content-wrapper')
          ?.classList.remove('ohk-leaflet-expired-popup-wrapper')
      })
      marker.addTo(layer)
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
