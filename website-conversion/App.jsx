import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import logoImage from './assets/logo.png'
import preloaderGif from './assets/Offer.gif'
import faviconImage from './assets/favicon.png'
import bgImage from './assets/bg.jpg'

const BLOG_URL = 'https://www.offerhaikya.com'
const FEED_URL = BLOG_URL + '/feeds/posts/default?alt=json&max-results=500'
const ACCENT = '#ff5b01'
const PAGE = '#f3f4f6'
const WHITE = '#ffffff'
const TEXT = '#202124'
const MUTED = '#77747a'
const NEARBY_RADIUS_KM = 303
const PAGE_SIZE = 20

const LOGO_URL = logoImage

const DIRECT_TAGS = ['All', 'News', 'Amazon', 'Flipkart', 'Myntra', 'Meesho', 'Instamart', 'Blinkit', 'Zepto', 'BigBasket Now', 'Snapdeal', 'Shopsy', 'Offline Offers', 'Online Offers']
const CATEGORY_ITEMS = ['Fashion', 'Electronics', 'Home & Kitchen', 'Beauty & Personal Care', 'Grocery & Food', 'Baby & Kids', 'Sports & Fitness', 'Automotive', 'Pet Supplies', 'Books & Education', 'Gaming', 'Travel & Luggage', 'Jewellery & Accessories', 'Tools & Industrial']
const SPECIAL_DEAL_ITEMS = ['₹1 Deals', 'Loot Deals', 'Flash Sales', "Today's Deals", 'Clearance Sale', 'Buy 1 Get 1', 'Under ₹99', 'Under ₹499', '50%+ Off', 'Coupon Codes', 'Bank Offers', 'Freebies']

function stripHtml(value = '') {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function highResImage(url = '') {
  return url
    .replace(/\/s\d+(-c)?\//i, '/s800/')
    .replace(/=w\d+(-h\d+)?(-p)?/i, '=s800')
    .replace(/\/w\d+(-h\d+)?\//i, '/s800/')
}

function firstImage(html = '') {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return match?.[1] || ''
}

function extractCoordinates(html = '') {
  const patterns = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?)[,%20]+(-?\d+(?:\.\d+)?)/i,
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (!match) continue
    const latitude = Number(match[1])
    const longitude = Number(match[2])
    if (Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) return { latitude, longitude }
  }
  return null
}

function parseFeed(data) {
  const entries = data?.feed?.entry || []

  return entries.map((entry) => {
    const rawContent = entry?.content?.$t || ''
    const labels = (entry?.category || []).map((item) => item.term).filter(Boolean)
    const alternate = entry?.link?.find((item) => item.rel === 'alternate')?.href || BLOG_URL
    const image = highResImage(firstImage(rawContent))

    return {
      id: entry?.id?.$t || alternate,
      title: entry?.title?.$t || 'Offer',
      url: alternate,
      date: entry?.published?.$t
        ? new Date(entry.published.$t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : '',
      publishedAt: entry?.published?.$t || '',
      labels,
      label: labels[0] || 'Offer',
      image,
      excerpt: stripHtml(rawContent).slice(0, 180),
      rawContent,
      bloggerLocation: entry?.['georss$featurename']?.$t || '',
      coordinates: (() => {
        const point = entry?.['georss$point']?.$t || ''
        const parts = point.trim().split(/\s+/).map(Number)
        if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1]) &&
            Math.abs(parts[0]) <= 90 && Math.abs(parts[1]) <= 180) {
          return { latitude: parts[0], longitude: parts[1] }
        }
        return extractCoordinates(rawContent + ' ' + alternate)
      })(),
    }
  })
}

function distanceKm(first, second) {
  const earthRadiusKm = 6371
  const toRadians = (degrees) => degrees * Math.PI / 180
  const dLat = toRadians(second.latitude - first.latitude)
  const dLon = toRadians(second.longitude - first.longitude)
  const lat1 = toRadians(first.latitude)
  const lat2 = toRadians(second.latitude)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function isOfflinePost(post) {
  const labels = (post.labels || []).map((label) => label.toLowerCase().trim())
  return labels.some((label) => /^(offline offer|offline offers|local offer|local offers|nearby offer|nearby offers)$/.test(label))
}

function getExpiryLabel(post) {
  const expiryTag = post.labels.find((label) => /^E\d+$/i.test(label.trim()))
  if (!expiryTag || !post.publishedAt) return ''

  const days = Number(expiryTag.trim().slice(1))
  if (!Number.isFinite(days) || days <= 0) return ''

  const expiryTime = new Date(post.publishedAt).getTime() + days * 24 * 60 * 60 * 1000
  const remainingMs = expiryTime - Date.now()

  if (remainingMs <= 0) return 'Expired'

  const totalMinutes = Math.ceil(remainingMs / 60000)
  const totalHours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const remainingDays = Math.floor(totalHours / 24)
  const hours = totalHours % 24

  if (remainingDays > 0) return hours > 0 ? `Expires in ${remainingDays}d ${hours}h` : `Expires in ${remainingDays}d`
  if (totalHours > 0) return minutes > 0 ? `Expires in ${totalHours}h ${minutes}m` : `Expires in ${totalHours}h`
  return `Expires in ${minutes}m`
}

function Icon({ name, size = 22 }) {
  const paths = {
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4.5 4.5" /></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-2.5 7-2.5 9h17c0-2-2.5-2-2.5-9Z" /><path d="M10 21h4" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
    heart: <path d="M20.8 8.9c0 5.2-8.8 10.1-8.8 10.1S3.2 14.1 3.2 8.9A4.9 4.9 0 0 1 12 6.3a4.9 4.9 0 0 1 8.8 2.6Z" />,
    share: <><path d="M4 12 20 4l-6 16-4-6-6-2Z" /><path d="m10 14 10-10" /></>,
    home: <path d="M3 10.5 12 3l9 7.5V21h-6.5v-7h-5v7H3v-10.5Z" />,
    location: <><path d="M20 10.5C20 15.5 12 21 12 21S4 15.5 4 10.5a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10.5" r="2.75" /></>,
    mail: <><rect x="4" y="5.5" width="16" height="13" rx="1" /><path d="m4.5 6 7.5 6 7.5-6" /></>,
    close: <><path d="M5 5l14 14M19 5 5 19" /></>,
    moon: <path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />,
    tag: <><path d="M20 13 13 20 4 11V4h7l9 9Z" /><circle cx="8" cy="8" r="1.2" /></>,
    percent: <><circle cx="7" cy="7" r="1.5" /><circle cx="17" cy="17" r="1.5" /><path d="m18 6-12 12" /></>,
  }

  return (
    <svg className="ohk-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

function OfferCard({ post, saved, onSave, onOpen, onShare, dark, nearby }) {
  const expiry = getExpiryLabel(post)

  return (
    <article className={`ohk-card ${dark ? 'ohk-card-dark' : ''}`}>
      <button className="ohk-card-heart" onClick={() => onSave(post.id)} aria-label="Save offer">
        {saved ? '♥' : '♡'}
      </button>

      <button className="ohk-card-share" onClick={() => onShare(post)} aria-label="Share offer">
        <Icon name="share" size={18} />
      </button>

      {nearby ? (
        <div className="ohk-card-distance">
          <Icon name="location" size={12} />
          {Math.round(post.nearbyDistanceKm)} km
        </div>
      ) : null}

      {expiry ? <div className={`ohk-card-expiry ${expiry === 'Expired' ? 'ohk-card-expired' : ''}`}>{expiry}</div> : null}

      <button className="ohk-card-click" onClick={() => onOpen(post)}>
        {post.image ? (
          <img src={post.image} alt="" className="ohk-card-image" />
        ) : (
          <div className="ohk-card-image ohk-image-fallback">Offerhaikya</div>
        )}

        <div className="ohk-card-body">
          <span className="ohk-card-label">{post.label}</span>
          <h2>{post.title}</h2>
          <div className="ohk-card-date">{post.date}</div>
          <p>{post.excerpt}</p>
          <span className="ohk-read-more">Read more ›</span>
        </div>
      </button>
    </article>
  )
}

function App() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [activeLabel, setActiveLabel] = useState('All')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [nearbyVisible, setNearbyVisible] = useState(PAGE_SIZE)
  const [dark, setDark] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [specialDealsOpen, setSpecialDealsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [registrationOpen, setRegistrationOpen] = useState(false)
  const [locationPromptOpen, setLocationPromptOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [authMode, setAuthMode] = useState('choice')
  const [preloaderVisible, setPreloaderVisible] = useState(true)
  const [sitePage, setSitePage] = useState(null)
  const [bloggerPages, setBloggerPages] = useState([])
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [registrationName, setRegistrationName] = useState('')
  const [registrationPhone, setRegistrationPhone] = useState('')
  const [registrationEmail, setRegistrationEmail] = useState('')
  const [saved, setSaved] = useState(() => JSON.parse(localStorage.getItem('offerhaikya_favorites') || '{}'))
  const [detail, setDetail] = useState(null)
  const [detailTagFilter, setDetailTagFilter] = useState('')
  const [shareTarget, setShareTarget] = useState(null)
  const [shareMessage, setShareMessage] = useState('')
  const [userLocation, setUserLocation] = useState(null)
  const [locationLabel, setLocationLabel] = useState('')
  const [locationQuery, setLocationQuery] = useState('')
  const [locationPickerOpen, setLocationPickerOpen] = useState(false)
  const [locationSuggestions, setLocationSuggestions] = useState([])
  const [locationSuggestionsOpen, setLocationSuggestionsOpen] = useState(false)
  const tagDragRef = useRef(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')
  const [activeTab, setActiveTab] = useState('home')
  const [notifications, setNotifications] = useState(() => JSON.parse(localStorage.getItem('offerhaikya_notifications') || '[]'))
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [wishlistOpen, setWishlistOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)

  useEffect(() => {
    let active = true
    let inFlight = false

    const loadFeed = () => new Promise((resolve, reject) => {
      const callbackName = `offerhaikyaFeedCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`
      let script = null
      const cleanup = () => {
        if (script) script.remove()
        try { delete window[callbackName] } catch { window[callbackName] = undefined }
      }
      const timeout = window.setTimeout(() => {
        cleanup()
        reject(new Error('Blogger feed timed out'))
      }, 12000)
      window[callbackName] = (data) => {
        window.clearTimeout(timeout)
        cleanup()
        resolve(data)
      }
      script = document.createElement('script')
      script.src = `${BLOG_URL}/feeds/posts/default?alt=json-in-script&max-results=500&callback=${callbackName}&_=${Date.now()}`
      script.async = true
      script.onerror = () => {
        window.clearTimeout(timeout)
        cleanup()
        reject(new Error('Blogger feed could not be loaded'))
      }
      document.head.appendChild(script)
    })

    try {
      const cached = JSON.parse(localStorage.getItem('offerhaikya_posts_cache') || '[]')
      if (Array.isArray(cached) && cached.length) {
        setPosts(cached)
        setLoading(false)
      }
    } catch {}

    const syncPosts = async () => {
      if (!active || inFlight) return
      inFlight = true
      try {
        const data = await loadFeed()
        if (!active) return
        const parsed = parseFeed(data)
        const previousKnown = JSON.parse(localStorage.getItem('offerhaikya_known_post_ids') || 'null')
        const seen = new Set(JSON.parse(localStorage.getItem('offerhaikya_notification_seen') || '[]'))
        const existingNotifications = JSON.parse(localStorage.getItem('offerhaikya_notifications') || '[]')
        let additions = []
        if (!Array.isArray(previousKnown)) {
          additions = parsed.slice(0, 10)
        } else {
          const known = new Set(previousKnown)
          additions = parsed.filter((post) => !known.has(post.id) && !seen.has(post.id))
        }
        const mergedNotifications = [...additions, ...existingNotifications.filter((post) => !seen.has(post.id))]
          .filter((post, index, all) => all.findIndex((item) => item.id === post.id) === index)
          .slice(0, 10)
        setPosts(parsed)
        setNotifications(mergedNotifications)
        try { localStorage.setItem('offerhaikya_known_post_ids', JSON.stringify(parsed.map((post) => post.id))) } catch {}
        try { localStorage.setItem('offerhaikya_posts_cache', JSON.stringify(parsed)) } catch (cacheError) {
          try { localStorage.setItem('offerhaikya_posts_cache', JSON.stringify(parsed.slice(0, 50))) } catch {}
          console.warn('Offerhaikya cache stored a smaller recent-post snapshot.', cacheError)
        }
        try { localStorage.setItem('offerhaikya_notifications', JSON.stringify(mergedNotifications)) } catch {}
        console.log(`Offerhaikya Blogger: synced ${parsed.length} posts`)
      } catch (error) {
        console.error('Offerhaikya Blogger feed sync:', error)
      } finally {
        if (active) {
          setLoading(false)
        }
        inFlight = false
      }
    }

    syncPosts()
    const interval = window.setInterval(syncPosts, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    document.title = 'Offerhaikya'
  }, [])

  useEffect(() => {
    let favicon = document.querySelector('link[rel="icon"]')
    if (!favicon) {
      favicon = document.createElement('link')
      favicon.rel = 'icon'
      document.head.appendChild(favicon)
    }
    favicon.href = faviconImage
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setPreloaderVisible(false), 2000)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    let active = true
    let script = null
    const callbackName = "offerhaikyaPagesCallback_" + Date.now()
    const cleanup = () => {
      if (script) script.remove()
      try { delete window[callbackName] } catch { window[callbackName] = undefined }
    }
    window[callbackName] = (data) => {
      if (!active) return
      setBloggerPages((data?.feed?.entry || []).map((entry) => ({
        title: entry?.title?.$t || '',
        content: entry?.content?.$t || '',
        url: entry?.link?.find((item) => item.rel === 'alternate')?.href || '',
      })))
      cleanup()
    }
    script = document.createElement('script')
    script.src = BLOG_URL + '/feeds/pages/default?alt=json-in-script&max-results=50&callback=' + callbackName
    script.async = true
    script.onerror = cleanup
    document.head.appendChild(script)
    return () => { active = false; cleanup() }
  }, [])

  useEffect(() => {
    const syncRoute = () => {
      const path = window.location.pathname.toLowerCase()
      const postUrl = new URLSearchParams(window.location.search).get('url')
      if (postUrl) {
        const found = posts.find((post) => post.url === postUrl)
        if (found) setDetail(found)
        return
      }
      if (['/about-us', '/contact-us', '/privacy-policy', '/terms-and-condition'].includes(path)) {
        setDetail(null)
        setSitePage(path.slice(1))
      } else if (path === '/' || path === '') {
        setSitePage(null)
        setDetail(null)
      }
    }
    syncRoute()
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [posts])

  useEffect(() => {
    localStorage.setItem('offerhaikya_favorites', JSON.stringify(saved))
  }, [saved])

  const bloggerTags = useMemo(() => {
    const all = posts.flatMap((post) => post.labels)
    return [...new Set(all)]
  }, [posts])

  const bloggerSpecialTags = useMemo(() => bloggerTags.filter((tag) => {
    const value = tag.toLowerCase().trim()
    if (value === 'offline offer' || value === 'online offer' || value === 'offline offers' || value === 'online offers') return false
    return SPECIAL_DEAL_ITEMS.some((special) => special.toLowerCase() === value) ||
      /deal|discount|sale|coupon|cashback|freebie|freebies|buy\s*1\s*get\s*1|under\s*[₹rs]/i.test(value)
  }), [bloggerTags])

  const bloggerCategoryTags = useMemo(() => bloggerTags.filter((tag) => !bloggerSpecialTags.includes(tag)), [bloggerTags, bloggerSpecialTags])

  const filteredPosts = useMemo(() => {
    const text = query.trim().toLowerCase()

    return posts.filter((post) => {
      const labelMatch = activeLabel === 'All' || post.labels.some((label) => label.toLowerCase() === activeLabel.toLowerCase())
      const textMatch = !text || `${post.title} ${post.labels.join(' ')} ${post.excerpt} ${post.bloggerLocation || ''} ${post.rawContent ? stripHtml(post.rawContent) : ''}`.toLowerCase().includes(text)
      return labelMatch && textMatch
    })
  }, [posts, query, activeLabel])

  const displayedPosts = filteredPosts.slice(0, visible)

  const detailSuggestedPosts = useMemo(() => {
    if (!detail) return []
    const text = detailTagFilter.trim().toLowerCase()
    const matches = posts.filter((post) => {
      if (post.id === detail.id) return false
      if (!text) return true
      const searchable = `${post.title} ${(post.labels || []).join(' ')} ${post.excerpt || ''} ${post.rawContent ? stripHtml(post.rawContent) : ''}`.toLowerCase()
      return searchable.includes(text)
    })
    return [detail, ...matches].slice(0, 8)
  }, [detail, detailTagFilter, posts])

  const detailLatestPosts = useMemo(() => posts.slice(0, 8), [posts])

  const searchSuggestions = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return []
    const score = (post) => {
      const title = (post.title || '').toLowerCase()
      const tags = (post.labels || []).join(' ').toLowerCase()
      const description = `${post.excerpt || ''} ${post.rawContent ? stripHtml(post.rawContent) : ''}`.toLowerCase()
      const location = (post.bloggerLocation || '').toLowerCase()
      if (title.includes(text)) return 0
      if (tags.includes(text)) return 1
      if (description.includes(text)) return 2
      if (location.includes(text)) return 3
      return -1
    }
    return posts
      .map((post, index) => ({ post, index, rank: score(post) }))
      .filter((item) => item.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((item) => item.post)
  }, [posts, query])

  useEffect(() => {
    const text = locationQuery.trim()
    if (text.length < 2) {
      setLocationSuggestions([])
      return undefined
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(text)}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() : [])
        .then((results) => {
          setLocationSuggestions(Array.isArray(results) ? results : [])
          setLocationSuggestionsOpen(true)
        })
        .catch(() => {})
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [locationQuery])

  const chooseSuggestedLocation = (place) => {
    const latitude = Number(place.lat)
    const longitude = Number(place.lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    const address = place.address || {}
    const label = address.city || address.town || address.city_district || address.county || address.state_district || address.village || place.name || place.display_name?.split(',')[0] || locationQuery
    setUserLocation({ latitude, longitude })
    setLocationLabel(String(label).trim())
    setLocationQuery('')
    setLocationSuggestions([])
    setLocationSuggestionsOpen(false)
    setLocationPickerOpen(false)
    setLocationMessage('Nearby offers updated for ' + String(label).trim() + '.')
    setActiveTab('local')
  }

  const handleTagPointerDown = (event) => {
    const element = event.currentTarget
    tagDragRef.current = { startX: event.clientX, scrollLeft: element.scrollLeft, dragged: false, element }
    element.setPointerCapture?.(event.pointerId)
  }
  const handleTagPointerMove = (event) => {
    const drag = tagDragRef.current
    if (!drag) return
    const delta = event.clientX - drag.startX
    if (Math.abs(delta) > 5) drag.dragged = true
    if (drag.dragged) drag.element.scrollLeft = drag.scrollLeft - delta
  }
  const handleTagPointerUp = () => {
    const drag = tagDragRef.current
    if (drag?.dragged) {
      drag.element.dataset.dragged = 'true'
      window.setTimeout(() => { drag.element.dataset.dragged = 'false' }, 80)
    }
    tagDragRef.current = null
  }

  useEffect(() => { setNearbyVisible(PAGE_SIZE) }, [userLocation])

  const nearbyPosts = useMemo(() => {
    if (!userLocation) return []

    return posts
      .filter(isOfflinePost)
      .map((post) => {
        if (!post.coordinates) return null
        const distance = distanceKm(userLocation, post.coordinates)
        return distance <= NEARBY_RADIUS_KM ? { ...post, nearbyDistanceKm: distance } : null
      })
      .filter(Boolean)
      .sort((a, b) => a.nearbyDistanceKm - b.nearbyDistanceKm)
  }, [posts, userLocation])

  const toggleSave = (id) => {
    setSaved((current) => ({ ...current, [id]: !current[id] }))
  }

  const sharePost = (post) => {
    setShareMessage('')
    setShareTarget(post || { title: 'Offerhaikya', url: window.location.href })
  }

  const copyShareLink = async () => {
    const shareUrl = shareTarget?.url || window.location.href
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareMessage('Link copied!')
    } catch {
      window.prompt('Copy this offer link:', shareUrl)
      setShareMessage('Copy the link from the box above.')
    }
  }

  const shareViaApps = async () => {
    const shareUrl = shareTarget?.url || window.location.href
    const title = shareTarget?.title || 'Offerhaikya'
    if (navigator.share) {
      try {
        await navigator.share({ title, text: title, url: shareUrl })
        setShareTarget(null)
        return
      } catch (error) {
        if (error?.name === 'AbortError') return
      }
    }
    const text = encodeURIComponent(`${title} - ${shareUrl}`)
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank', 'noopener,noreferrer')
  }

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocationMessage('Location is not available in this browser.')
      return
    }

    setLocationLoading(true)
    setLocationMessage('')

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
        setLocationLabel('')
        setLocationLoading(false)
        setLocationMessage('Nearby offers updated.')
        const { latitude, longitude } = position.coords
        fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=10`)
          .then((response) => response.ok ? response.json() : null)
          .then((data) => {
            const address = data?.address || {}
            const place = address.city || address.town || address.city_district || address.county || address.state_district || address.village || ''
            if (place) setLocationLabel(place.trim())
          })
          .catch(() => {})
      },
      () => {
        setLocationLoading(false)
        setLocationMessage('Location permission was not granted.')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 },
    )
  }

  const selectTag = (tag) => {
    setActiveLabel(tag)
    setQuery('')
    setVisible(PAGE_SIZE)
    setDetail(null)
    setSitePage(null)
    setActiveTab('home')
    if (window.location.pathname !== '/' || window.location.search) window.history.pushState({}, '', '/')
    window.setTimeout(() => document.getElementById('deals')?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  const goHome = () => {
    setActiveTab('home')
    setActiveLabel('All')
    setQuery('')
    setVisible(PAGE_SIZE)
    setNearbyVisible(PAGE_SIZE)
    setDetail(null)
    setSitePage(null)
    setSearchOpen(false)
    if (window.location.pathname !== '/' || window.location.search) window.history.pushState({}, '', '/')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openSearch = () => {
    setDetail(null)
    setSitePage(null)
    if (window.location.pathname !== '/' || window.location.search) window.history.pushState({}, '', '/')
    setActiveTab('search')
    setSearchOpen(false)
    window.setTimeout(() => {
      const input = document.querySelector('.ohk-search-box .ohk-main-search-input')
      if (input) {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' })
        input.focus({ preventScroll: true })
      }
    }, 80)
  }

  const openPost = (post) => {
    setDetail(post)
    setSitePage(null)
    setSearchOpen(false)
    window.history.pushState({}, '', '/offer?url=' + encodeURIComponent(post.url))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const getSitePage = (type) => bloggerPages.find((item) => {
    const title = item.title.toLowerCase()
    if (type === 'about-us') return title.includes('about')
    if (type === 'contact-us') return title.includes('contact')
    if (type === 'privacy-policy') return title.includes('privacy')
    if (type === 'terms-and-condition') return title.includes('term')
    return false
  })

  const openSitePage = (type) => {
    setDetail(null)
    setSitePage(type)
    window.history.pushState({}, '', '/' + type)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleBottomTab = (tab) => {
    if (tab === 'home') goHome()
    if (tab === 'local') {
      setActiveTab('local')
      document.getElementById('nearby')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      if (!userLocation) setLocationPromptOpen(true)
    }
    if (tab === 'hot') {
      setActiveTab('hot')
      setActiveLabel('50%+ Off')
      setQuery('')
      setVisible(PAGE_SIZE)
      document.getElementById('deals')?.scrollIntoView({ behavior: 'smooth' })
    }
    if (tab === 'request') {
      setActiveTab('request')
      setRequestOpen(true)
    }
    if (tab === 'search') openSearch()
  }

  return (
    <div className={`ohk-app ${dark ? 'ohk-dark' : ''}`}>
      {preloaderVisible ? (
        <div className="ohk-preloader" role="status" aria-label="Loading Offerhaikya">
          <div className="ohk-preloader-card">
            <img src={preloaderGif} alt="Loading Offerhaikya" />
          </div>
        </div>
      ) : null}
      <header className="ohk-header">
        <div className="ohk-header-inner">
          <button className="ohk-header-button ohk-menu-button" onClick={() => setMenuOpen(true)} aria-label="Menu">
            <Icon name="menu" />
          </button>

          <button className="ohk-logo-button" onClick={goHome} aria-label="Offerhaikya home">
            <img src={LOGO_URL} alt="Offerhaikya" />
          </button>

          <div className="ohk-header-dropdowns">
            <div className="ohk-header-dropdown">
              <button className="ohk-header-dropdown-button">
                <Icon name="tag" size={16} /> Categories
              </button>
              <div className="ohk-header-dropdown-menu">
                <button onClick={() => selectTag('All')}>All</button>
                {bloggerCategoryTags.length ? bloggerCategoryTags.map((item) => (
                  <button key={item} onClick={() => selectTag(item)}>{item}</button>
                )) : <p className="ohk-menu-loading">Loading categories from Blogger…</p>}
              </div>
            </div>

            <div className="ohk-header-dropdown">
              <button className="ohk-header-dropdown-button">
                <Icon name="percent" size={16} /> Special Discounts
              </button>
              <div className="ohk-header-dropdown-menu">
                  <button onClick={() => selectTag('All')}>All</button>
                  {bloggerSpecialTags.length ? bloggerSpecialTags.map((item) => (
                    <button key={item} onClick={() => selectTag(item)}>{item}</button>
                  )) : <p className="ohk-menu-loading">Loading offers from Blogger…</p>}
                </div>
            </div>
          </div>

          <div className="ohk-header-page-links">
            <span className="ohk-header-separator" aria-hidden="true" />
            <button onClick={() => openSitePage('about-us')}>About Us</button>
            <button onClick={() => openSitePage('contact-us')}>Contact Us</button>
          </div>

          <div className="ohk-header-actions">
            <button className="ohk-header-button" onClick={() => setDark((value) => !value)} aria-label="Dark mode">
              {dark ? '☀' : <Icon name="moon" size={21} />}
            </button>

            <button className="ohk-header-button ohk-badge-button" onClick={() => setNotificationsOpen(true)} aria-label="Notifications">
              <Icon name="bell" size={21} />
              {notifications.length ? <span>{notifications.length}</span> : null}
            </button>

            <button className="ohk-header-button ohk-badge-button" onClick={() => setWishlistOpen(true)} aria-label="Favorites">
              <Icon name="heart" size={21} />
              {Object.values(saved).filter(Boolean).length ? <span>{Object.values(saved).filter(Boolean).length}</span> : null}
            </button>

            <button className="ohk-header-button" onClick={openSearch} aria-label="Search">
              <Icon name="search" size={21} />
            </button>

            <button className="ohk-header-button" onClick={() => setProfileOpen(true)} aria-label="Profile">
              <Icon name="user" size={21} />
            </button>

          </div>
        </div>
      </header>

      {menuOpen ? (
        <div className="ohk-overlay" onClick={() => setMenuOpen(false)}>
          <aside className="ohk-side-menu" onClick={(event) => event.stopPropagation()}>
            <div className="ohk-side-header">
              <strong>Menu</strong>
              <button onClick={() => setMenuOpen(false)} aria-label="Close menu"><Icon name="close" /></button>
            </div>

            <div className="ohk-side-group">
              <h3>Categories</h3>
              {bloggerCategoryTags.length ? bloggerCategoryTags.map((item) => (
                <button key={item} onClick={() => { selectTag(item); setMenuOpen(false) }}>{item}</button>
              )) : <p className="ohk-menu-loading">Loading categories from Blogger…</p>}
            </div>

            <div className="ohk-side-group">
              <h3>Special Deal Categories</h3>
              {bloggerSpecialTags.length ? bloggerSpecialTags.map((item) => (
                <button key={item} onClick={() => { selectTag(item); setMenuOpen(false) }}>{item}</button>
              )) : <p className="ohk-menu-loading">Loading offers from Blogger…</p>}
            </div>
          </aside>
        </div>
      ) : null}

      <main>
        {detail ? (
          <section className="ohk-detail-page">
            <div className="ohk-detail-page-inner">
              <button className="ohk-page-back" onClick={goHome}>← Back to offers</button>
              <div className="ohk-detail-meta ohk-detail-content-actions">
                <button onClick={() => toggleSave(detail.id)} aria-label="Save offer">{saved[detail.id] ? '♥' : '♡'}</button>
                <button onClick={() => sharePost(detail)} aria-label="Share offer"><Icon name="share" size={19} /></button>
              </div>
              <div
                className="ohk-detail-html"
                dangerouslySetInnerHTML={{
                  __html: (detail.rawContent || '<p>' + detail.excerpt + '</p>')
                    .replace(/<img[^>]*>/i, '')
                    .replace(/<\/?(?:h1|h2|h4|h5|h6)\b([^>]*)>/gi, (tag) => tag.startsWith('</') ? '</h3>' : '<h3>')
                }}
              />
            </div>

            <section id="detail-related" className="ohk-detail-related">
              <div className="ohk-detail-related-inner">
                <h2>Search offers by tag</h2>
                <input
                  className="ohk-detail-related-search"
                  value={detailTagFilter}
                  onChange={(event) => setDetailTagFilter(event.target.value)}
                  placeholder="Search offers or select a tag above..."
                  aria-label="Search related offers"
                />
                <h3>Suggested Offers</h3>
                <div className="ohk-grid">
                  {detailSuggestedPosts.map((post) => (
                    <OfferCard key={post.id} post={post} saved={Boolean(saved[post.id])} onSave={toggleSave} onOpen={openPost} onShare={sharePost} dark={dark} />
                  ))}
                </div>
                <h3 className="ohk-detail-latest-heading">Latest Offers</h3>
                <div className="ohk-grid">
                  {detailLatestPosts.map((post) => (
                    <OfferCard key={post.id} post={post} saved={Boolean(saved[post.id])} onSave={toggleSave} onOpen={openPost} onShare={sharePost} dark={dark} />
                  ))}
                </div>
              </div>
            </section>
          </section>
        ) : sitePage ? (
          <section className="ohk-detail-page">
            <div className="ohk-info-page">
              <button className="ohk-page-back" onClick={goHome}>← Back to offers</button>
              <h1>{getSitePage(sitePage)?.title || sitePage.replaceAll('-', ' ')}</h1>
              <div className="ohk-detail-html" dangerouslySetInnerHTML={{ __html: getSitePage(sitePage)?.content || '<p>Page content is not available yet in Blogger.</p>' }} />
            </div>
          </section>
        ) : (
          <div className="ohk-home-content">
        <section className="ohk-hero" style={{ backgroundImage: `url("${bgImage}")` }}>
          <div className="ohk-hero-content">
            <div className="ohk-hero-small">LATEST DEALS & OFFERS</div>
            <h1>Find the best offers</h1>

            <form className="ohk-search-box" onSubmit={(event) => { event.preventDefault(); setVisible(PAGE_SIZE); setSearchOpen(false) }}>
              <Icon name="search" size={22} />
              <input
                className="ohk-main-search-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search offers..."
                aria-label="Search offers"
              />
              <button type="submit">GO</button>
              {query.trim() ? (
                <div className="ohk-search-suggestions">
                  {searchSuggestions.length ? searchSuggestions.map((post) => (
                    <button type="button" className="ohk-search-suggestion" key={post.id} onClick={() => openPost(post)}>
                      {post.image ? <img src={post.image} alt="" /> : <span className="ohk-search-suggestion-image">Offer</span>}
                      <span className="ohk-search-suggestion-copy"><strong>{post.title}</strong><small>{post.excerpt || stripHtml(post.rawContent || '').slice(0, 180)}</small></span>
                    </button>
                  )) : <div className="ohk-search-no-results">No matching offers</div>}
                </div>
              ) : null}
            </form>
          </div>
        </section>

        {searchOpen ? (
          <div className="ohk-search-mobile-row">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search offers..."
              className="ohk-main-search-input"
            />
            <button onClick={() => setSearchOpen(false)}><Icon name="close" size={20} /></button>
          </div>
        ) : null}

        <section className="ohk-content">
          {userLocation ? (
            <section id="nearby" className="ohk-section">
              <div className="ohk-section-title">
                <h2>Nearby Offer{locationLabel ? ` - ${locationLabel}` : ''} (Total {nearbyPosts.length})</h2>
                <div className="ohk-nearby-actions">
                  {locationPickerOpen ? (
                    <div className="ohk-location-autocomplete">
                      <input
                        autoFocus
                        value={locationQuery}
                        onChange={(event) => { setLocationQuery(event.target.value); setLocationSuggestionsOpen(true) }}
                        onFocus={() => locationSuggestions.length && setLocationSuggestionsOpen(true)}
                        placeholder="Type Goa, Kolhapur, etc."
                        aria-label="Search location"
                      />
                      {locationSuggestionsOpen && locationSuggestions.length ? (
                        <div className="ohk-location-suggestions">
                          {locationSuggestions.map((place) => (
                            <button key={place.place_id} onClick={() => chooseSuggestedLocation(place)} type="button">
                              <Icon name="location" size={16} />
                              <span>{place.display_name}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <button className="ohk-add-location-button" onClick={() => setLocationPickerOpen((value) => !value)}>{locationPickerOpen ? 'Close' : 'Enter Location'}</button>
                  <button onClick={requestLocation} disabled={locationLoading}>{locationLoading ? 'Getting Location...' : 'Get Current Location'}</button>
                </div>
              </div>

              {nearbyPosts.length ? (
                <>
                  <div className="ohk-grid">
                    {nearbyPosts.slice(0, nearbyVisible).map((post) => (
                      <OfferCard key={post.id} post={post} saved={Boolean(saved[post.id])} onSave={toggleSave} onOpen={openPost} onShare={sharePost} dark={dark} nearby />
                    ))}
                  </div>
                  {nearbyVisible < nearbyPosts.length ? (
                    <div className="ohk-load-more"><button onClick={() => setNearbyVisible((value) => value + PAGE_SIZE)}>Load More Nearby Offers</button></div>
                  ) : null}
                </>
              ) : (
                <div className="ohk-empty">No offer found nearby.</div>
              )}
            </section>
          ) : (
            <section id="nearby" className="ohk-nearby-prompt">
              <div className="ohk-nearby-prompt-copy">
                <strong>See offers near you</strong>
                <span>Allow location to find local offers within {NEARBY_RADIUS_KM} km, or add a place manually.</span>
                {locationPickerOpen ? (
                  <div className="ohk-location-autocomplete">
                    <input
                      autoFocus
                      value={locationQuery}
                      onChange={(event) => { setLocationQuery(event.target.value); setLocationSuggestionsOpen(true) }}
                      onFocus={() => locationSuggestions.length && setLocationSuggestionsOpen(true)}
                      placeholder="Type Goa, Kolhapur, etc."
                      aria-label="Search location"
                    />
                    {locationSuggestionsOpen && locationSuggestions.length ? (
                      <div className="ohk-location-suggestions">
                        {locationSuggestions.map((place) => (
                          <button key={place.place_id} onClick={() => chooseSuggestedLocation(place)} type="button">
                            <Icon name="location" size={16} />
                            <span>{place.display_name}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="ohk-nearby-prompt-actions">
                <button className="ohk-add-location-button" type="button" onClick={() => setLocationPickerOpen((value) => !value)}>{locationPickerOpen ? 'Close' : 'Enter Location'}</button>
                <button type="button" onClick={requestLocation} disabled={locationLoading}>
                  <Icon name="location" size={18} />
                  {locationLoading ? 'Checking...' : 'Find Nearby'}
                </button>
              </div>
            </section>
          )}

          <section id="deals" className="ohk-section">
            <div className="ohk-section-title ohk-section-banner" style={{ backgroundImage: "linear-gradient(90deg, rgba(0,0,0,.72), rgba(0,0,0,.18)), url(" + bgImage + ")" }}>
              <h2>{query ? `Search: ${query}` : activeLabel !== 'All' ? activeLabel : 'Latest Offers'}</h2>
              <span>{filteredPosts.length} offers</span>
            </div>

            {loading ? (
              <div className="ohk-state">Loading latest offers...</div>
            ) : displayedPosts.length ? (
              <>
                <div className="ohk-grid">
                  {displayedPosts.map((post) => (
                    <OfferCard key={post.id} post={post} saved={Boolean(saved[post.id])} onSave={toggleSave} onOpen={openPost} onShare={sharePost} dark={dark} />
                  ))}
                </div>

                {visible < filteredPosts.length ? (
                  <div className="ohk-load-more">
                    <button onClick={() => setVisible((value) => value + PAGE_SIZE)}>Load More Offers</button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="ohk-state">No offers found. Try another search or category.</div>
            )}
          </section>

        </section>
        </div>
        )}
      </main>

      <footer className="ohk-footer">
        <strong>Offerhaikya</strong>
        <span>Fresh offers. Simple browsing.</span>
        <div className="ohk-footer-links">
          <button onClick={() => openSitePage('about-us')}>About Us</button>
          <button onClick={() => openSitePage('contact-us')}>Contact Us</button>
          <button onClick={() => openSitePage('privacy-policy')}>Privacy Policy</button>
          <button onClick={() => openSitePage('terms-and-condition')}>Terms & Conditions</button>
        </div>
      </footer>

      <nav className="ohk-bottom-nav">
        {[
          ['home', 'home', 'Home'],
          ['local', 'location', 'Local Offers'],
          ['hot', null, 'Hot Offers'],
          ['request', 'mail', 'Request Offer'],
          ['search', 'search', 'Search'],
        ].map(([tab, icon, label]) => (
          <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => handleBottomTab(tab)}>
            {icon ? <Icon name={icon} size={23} /> : <span className="ohk-percent">%</span>}
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {notificationsOpen ? (
        <div className="ohk-favorite-overlay" onClick={() => setNotificationsOpen(false)}>
          <div className="ohk-favorite-popup" onClick={(event) => event.stopPropagation()}>
            <div className="ohk-favorite-popup-header">
              <h2>Notifications</h2>
              <button onClick={() => setNotificationsOpen(false)}>×</button>
            </div>
            {notifications.length === 0 ? (
              <div className="ohk-favorite-empty">
                <strong>No notifications yet</strong>
                <span>New offer notifications will appear here.</span>
              </div>
            ) : (
              <div className="ohk-favorite-list">
                {notifications.map((item) => (
                  <div className="ohk-favorite-item" key={item.id}>
                    <button className="ohk-favorite-item-main" onClick={() => { const seen = new Set(JSON.parse(localStorage.getItem('offerhaikya_notification_seen') || '[]')); seen.add(item.id); localStorage.setItem('offerhaikya_notification_seen', JSON.stringify([...seen])); setNotifications(current => current.filter(post => post.id !== item.id)); setNotificationsOpen(false); openPost(item) }}>
                      {item.image ? <img src={item.image} alt="" /> : <div className="ohk-favorite-item-image">Offer</div>}
                      <span>{item.title}</span>
                    </button>
                    <button className="ohk-favorite-remove" onClick={() => { const seen = new Set(JSON.parse(localStorage.getItem('offerhaikya_notification_seen') || '[]')); seen.add(item.id); localStorage.setItem('offerhaikya_notification_seen', JSON.stringify([...seen])); setNotifications(current => current.filter(post => post.id !== item.id)) }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {wishlistOpen ? (
        <div className="ohk-favorite-overlay" onClick={() => setWishlistOpen(false)}>
          <div className="ohk-favorite-popup" onClick={(event) => event.stopPropagation()}>
            <div className="ohk-favorite-popup-header">
              <h2>Favorites</h2>
              <button onClick={() => setWishlistOpen(false)}>×</button>
            </div>
            {posts.filter((post) => saved[post.id]).length === 0 ? (
              <div className="ohk-favorite-empty">
                <strong>No favorites yet</strong>
                <span>Tap the heart on an offer to add it here.</span>
              </div>
            ) : (
              <div className="ohk-favorite-list">
                {posts.filter((post) => saved[post.id]).map((item) => (
                  <div className="ohk-favorite-item" key={item.id}>
                    <button className="ohk-favorite-item-main" onClick={() => { setWishlistOpen(false); openPost(item) }}>
                      {item.image ? <img src={item.image} alt="" /> : <div className="ohk-favorite-item-image">Offer</div>}
                      <span>{item.title}</span>
                    </button>
                    <button className="ohk-favorite-remove" onClick={() => toggleSave(item.id)}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {locationPromptOpen ? (
        <div className="ohk-modal-backdrop" onClick={() => setLocationPromptOpen(false)}>
          <div className="ohk-modal ohk-location-modal" onClick={(event) => event.stopPropagation()}>
            <div className="ohk-modal-head">
              <h2>Find Nearby Offers</h2>
              <button onClick={() => setLocationPromptOpen(false)}><Icon name="close" /></button>
            </div>
            <p className="ohk-registration-intro">Allow location access to see offers near you. You can choose this later.</p>
            <button className="ohk-primary-button" onClick={() => { setLocationPromptOpen(false); requestLocation() }}><Icon name="location" size={18} /> Allow Location</button>
            <button className="ohk-secondary-button" onClick={() => setLocationPromptOpen(false)}>Maybe Later</button>
            {locationMessage ? <span className="ohk-location-message">{locationMessage}</span> : null}
          </div>
        </div>
      ) : null}

      {profileOpen ? (
        <div className="ohk-modal-backdrop" onClick={() => setProfileOpen(false)}>
          <div className="ohk-modal" onClick={(event) => event.stopPropagation()}>
            <div className="ohk-modal-head">
              <h2>Profile</h2>
              <button onClick={() => setProfileOpen(false)} aria-label="Close profile"><Icon name="close" /></button>
            </div>
            <p className="ohk-registration-intro">Profile features are currently paused while Offerhaikya launches its offers and search experience.</p>
            <button className="ohk-primary-button" onClick={() => setProfileOpen(false)}>Continue browsing</button>
          </div>
        </div>
      ) : null}

      {shareTarget ? (
        <div className="ohk-modal-backdrop" onClick={() => setShareTarget(null)}>
          <div className="ohk-modal ohk-share-modal" onClick={(event) => event.stopPropagation()}>
            <div className="ohk-modal-head">
              <h2>Share Offer</h2>
              <button onClick={() => setShareTarget(null)} aria-label="Close share options"><Icon name="close" /></button>
            </div>
            <p className="ohk-share-title">{shareTarget.title}</p>
            <button className="ohk-share-option" onClick={copyShareLink}><span>🔗</span><span><strong>Copy link</strong><small>Copy this offer link</small></span></button>
            <button className="ohk-share-option" onClick={shareViaApps}><span>↗</span><span><strong>Share via apps</strong><small>WhatsApp, email, and other available apps</small></span></button>
            {shareMessage ? <p className="ohk-share-message">{shareMessage}</p> : null}
          </div>
        </div>
      ) : null}

      {requestOpen ? (
        <div className="ohk-modal-backdrop" onClick={() => setRequestOpen(false)}>
          <div className="ohk-modal ohk-request-modal" onClick={(event) => event.stopPropagation()}>
            <div className="ohk-modal-head">
              <h2>User Offers Requests</h2>
              <button onClick={() => setRequestOpen(false)}><Icon name="close" /></button>
            </div>
            <input placeholder="Name *" />
            <input placeholder="10-digit phone number *" />
            <textarea placeholder="Offer request *" maxLength={50} />
            <button className="ohk-primary-button" onClick={() => setRequestOpen(false)}>Send Request</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App
