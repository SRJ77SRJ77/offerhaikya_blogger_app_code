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
  const labels = [...(Array.isArray(post?.labels) ? post.labels : []), post?.label || '', post?.category || '', post?.categoryName || '', post?.type || '', post?.title || '']
    .map((label) => String(label || '')
      .replace(/\s*imp\s*$/i, '')
      .replace(/\b(?:expired|verified)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase())
    .filter((label) => label && !/^(offer|new|active)$/.test(label))
  const categories = [
    { keys: ['motorbike', 'motorcycle', 'motorcycles', 'motor bike', 'bike', 'bikes'], icon: '<path d="M5 16a3 3 0 1 0 0 .1M19 16a3 3 0 1 0 0 .1M5 16l4-7h4l3 7H5Zm4-7-2-3h4m1 3 3-2 4 6" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['bicycle', 'bicycles', 'cycle', 'cycles', 'cycling'], icon: '<circle cx="6" cy="16" r="3.2" fill="none" stroke="white" stroke-width="1.8"/><circle cx="18" cy="16" r="3.2" fill="none" stroke="white" stroke-width="1.8"/><path d="m6 16 4-7h3l5 7h-7l-3-7H5m8 0h3" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['factory', 'factories', 'manufacturing', 'industrial', 'industry'], icon: '<path d="M3 21V11l6 3V9l6 5V7l6 3v11H3Z" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 18h.1m4-.1h.1m4 0h.1m4 0h.1M7 6V3h4v5" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"/>' },
    { keys: ['firecracker', 'firecrackers', 'fire cracker', 'fire crackers', 'fireworks', 'crackers'], icon: '<path d="m8 15 7-7m-4 11 2-4m2-10 1-2m2 5 2-1M7 7 5 5m-1 7-2 1" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"/><path d="m4 16 4-4 4 4-4 4-4-4Z" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>' },
    { keys: ['vegetable', 'vegetables', 'fruit', 'fruits', 'produce', 'grocery produce'], icon: '<path d="M12 8c-5-1-8 2-7 7 1 4 5 5 7 2 2 3 6 2 7-2 1-5-2-8-7-7Z" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 8c0-3 2-5 5-5-1 3-2 5-5 5Zm0 2v7" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"/>' },
    { keys: ['furniture', 'furnitures', 'sofa', 'beds', 'bed', 'chair', 'chairs', 'table', 'tables'], icon: '<path d="M4 12V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4M3 12h18v5H3v-5Zm2 5v3m14-3v3M7 9h10" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['stationery', 'books', 'book', 'books and stationery', 'pen', 'pens', 'notebook', 'notebooks', 'school supplies'], icon: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21V4.5Zm0 0V21m4-15h8m-8 4h8" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['software', 'software services', 'app development', 'web development', 'saas'], icon: '<rect x="3" y="4" width="18" height="13" rx="2" fill="none" stroke="white" stroke-width="1.8"/><path d="M8 21h8m-4-4v4m-5-9 2-2-2-2m5 4h3" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['study course', 'studying course', 'courses', 'course', 'coaching', 'tuition', 'training', 'education', 'learning'], icon: '<path d="m2 9 10-5 10 5-10 5L2 9Z" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><path d="M6 11v5c4 3 8 3 12 0v-5m4-2v6" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['school', 'schools', 'college', 'colleges', 'university', 'universities', 'school college', 'school/college'], icon: '<path d="M3 21V8l9-5 9 5v13H3Z" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 21v-6h8v6M7 10h.1m4-.1h.1m4 0h.1" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"/>' },
    { keys: ['laptop', 'laptops', 'notebook computer'], icon: '<rect x="5" y="4" width="14" height="11" rx="1.5" fill="none" stroke="white" stroke-width="1.8"/><path d="M3 18h18l-2 2H5l-2-2Z" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>' },
    { keys: ['beauty products', 'beauty product', 'cosmetics', 'makeup', 'skin care', 'skincare', 'beauty', 'personal care'], icon: '<path d="M9 3h6m-5 0v5l-4 4v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-7l-4-4V3m-7 10h12" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['car', 'cars', 'automobile', 'automotive'], icon: '<path d="M5 11l1.5-4h11L19 11l1.5 1.5V18h-2v-2H5.5v2h-2v-5.5L5 11Z" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 11h10M6 13.5h2m8 0h2" stroke="white" stroke-width="1.8" stroke-linecap="round"/>' },
    { keys: ['dress', 'clothing', 'fashion', 'apparel'], icon: '<path d="M8 4 10 3h4l2 1 4 3-2 4-3-1v10H9V9l-3 2-2-4 4-3Z" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>' },
    { keys: ['hotel', 'hotels', 'stay', 'accommodation'], icon: '<path d="M4 20V5h10v15M14 10h6v10M7 8h2m2 0h.1M7 12h2m2 0h.1M7 16h2m2 0h.1M16 13h2m-2 3h2" stroke="white" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['gaming', 'game', 'games', 'video games'], icon: '<path d="M7 9h10a4 4 0 0 1 3.8 5.2l-.8 2.4a2 2 0 0 1-3.2.9L14 15h-4l-2.8 2.5a2 2 0 0 1-3.2-.9l-.8-2.4A4 4 0 0 1 7 9Z" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 11v4m-2-2h4m6-1h.1m2 2h.1" stroke="white" stroke-width="1.8" stroke-linecap="round"/>' },
    { keys: ['fast food', 'fast-food', 'fastfood', 'restaurant', 'restaurants', 'food', 'cafe', 'dining'], icon: '<path d="M6 3v7m-3-7v4a3 3 0 0 0 6 0V3M6 10v11M16 3v18m0-18c3 2 3 6 0 8" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['home', 'house', 'real estate', 'property'], icon: '<path d="m3 11 9-8 9 8M5 10v10h14V10M9 20v-6h6v6" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['home appliances', 'home appliance', 'appliance', 'appliances'], icon: '<rect x="6" y="3" width="12" height="18" rx="1.5" fill="none" stroke="white" stroke-width="1.8"/><path d="M6 8h12m-9 3v1m3-1v1" stroke="white" stroke-width="1.8" stroke-linecap="round"/>' },
    { keys: ['electronics', 'electronic', 'mobile', 'computer', 'laptop'], icon: '<rect x="7" y="3" width="10" height="18" rx="1.5" fill="none" stroke="white" stroke-width="1.8"/><path d="M10 6h4m-2 12h.1" stroke="white" stroke-width="1.8" stroke-linecap="round"/>' },
    { keys: ['shopping', 'shop', 'store'], icon: '<path d="M4 8h16l-1 12H5L4 8Zm4 0V6a4 4 0 0 1 8 0v2" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
    { keys: ['health', 'medical', 'pharmacy'], icon: '<path d="M12 4v16M4 12h16" stroke="white" stroke-width="2.4" stroke-linecap="round"/>' },
    { keys: ['travel', 'tourism', 'flight'], icon: '<path d="m3 14 7-2 2-8 2-1 1 9 6 3-1 2-6-1-2 4-2 1v-5l-6-1Z" fill="none" stroke="white" stroke-width="1.6" stroke-linejoin="round"/>' },
    { keys: ['services', 'service'], icon: '<path d="M14 6a4 4 0 0 0-5 5L4 16a2 2 0 0 0 3 3l5-5a4 4 0 0 0 5-5l-3 3-3-3 3-3Z" fill="none" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>' },
  ]
  const matched = categories
    .map((category) => ({ category, matchLength: Math.max(0, ...labels.flatMap((label) => category.keys.filter((key) => label === key || label.includes(key)).map((key) => key.length))) }))
    .filter((item) => item.matchLength > 0)
    .sort((a, b) => b.matchLength - a.matchLength)[0]?.category
  const bag = '<path d="M4 8h16l-1 12H5L4 8Zm4 0V6a4 4 0 0 1 8 0v2" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
  return '<svg class="ohk-map-pin-icon" viewBox="0 0 24 24" aria-hidden="true">' + (matched?.icon || bag) + '</svg>'
}

function buildPopup(post, onOpen, userLocation) {
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
  metadata.style.display = 'flex'
  metadata.style.alignItems = 'center'
  metadata.style.justifyContent = 'space-between'
  metadata.style.gap = '8px'
  const leftMeta = document.createElement('div')
  leftMeta.className = 'ohk-map-popup-meta-left'
  leftMeta.style.display = 'flex'
  leftMeta.style.alignItems = 'center'
  leftMeta.style.gap = '6px'
  leftMeta.style.minWidth = '0'
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
  label.style.setProperty('color', '#f97316', 'important')
  leftMeta.appendChild(label)

  if (isVerified) {
    const verified = document.createElement('div')
    verified.className = 'ohk-map-verified-badge'
    verified.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.5 12.3 3l2.8-.1 1 2.6 2.2 1.7-.8 2.7.8 2.7-2.2 1.7-1 2.6-2.8-.1L10 18.5l-2.3-1.7-2.8.1-1-2.6-2.2-1.7.8-2.7-.8-2.7 2.2-1.7 1-2.6 2.8.1Z" fill="currentColor"/><path d="m6.2 10.2 2.4 2.4 5.2-5.2" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Verified</span>'
    metadata.appendChild(verified)
  }
  metadata.prepend(leftMeta)
  box.appendChild(metadata)

  const title = document.createElement('strong')
  title.textContent = post.title || 'Offer'
  box.appendChild(title)

  if (userLocation && post.coordinates) {
    const toRadians = (degrees) => degrees * Math.PI / 180
    const lat1 = toRadians(userLocation.latitude)
    const lat2 = toRadians(post.coordinates.latitude)
    const deltaLat = lat2 - lat1
    const deltaLon = toRadians(post.coordinates.longitude - userLocation.longitude)
    const haversine = Math.sin(deltaLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2
    const distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
    const distance = document.createElement('small')
    distance.className = 'ohk-map-popup-distance'
    distance.style.color = '#000'
    distance.style.whiteSpace = 'nowrap'
    distance.textContent = distanceKm < 1 ? `${Math.round(distanceKm * 1000)} m` : `${Math.round(distanceKm)} km`
    leftMeta.appendChild(distance)
  }
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

  const postsKey = useMemo(() => posts.map((post) => [post.id, post.updatedAt, post.title, post.image, [...(post.labels || []), post.label || ''].join(','), post.isExpired, post.coordinates?.latitude, post.coordinates?.longitude].join('::')).join('|'), [posts])

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
        .bindPopup(buildPopup(post, (item) => openRef.current(item), userLocation), { minWidth: 210 })
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
  }, [postsKey, focusPostId, userLocation])

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
