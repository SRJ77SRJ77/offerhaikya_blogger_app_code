import { useEffect, useMemo, useState } from 'react'
import './App.css'

const BLOG_URL = 'https://www.offerhaikya.com'
const FEED_URL = BLOG_URL + '/feeds/posts/default?alt=json&max-results=80'
const ACCENT = '#ff5b01'
const PAGE = '#f3f4f6'
const WHITE = '#ffffff'
const TEXT = '#202124'
const MUTED = '#77747a'
const NEARBY_RADIUS_KM = 300
const PAGE_SIZE = 20

const LOGO_URL = 'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_code/main/SS/Black_White_and_Red_Minimalist_Market_Shops_Discount_Black_Friday_Banner__2_-removebg-preview.png'
const HERO_URL = 'https://raw.githubusercontent.com/SRJ77SRJ77/offerhaikya_blogger_code/main/SS/5e10e76c-d5d4-40e6-9033-bf9720055ddf.jpg'

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
  const coordinateMatch = html.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
  if (coordinateMatch) {
    return { latitude: Number(coordinateMatch[1]), longitude: Number(coordinateMatch[2]) }
  }

  const queryMatch = html.match(/[?&](?:q|query)=(-?\d+(?:\.\d+)?)[,%20]+(-?\d+(?:\.\d+)?)/i)
  if (queryMatch) {
    return { latitude: Number(queryMatch[1]), longitude: Number(queryMatch[2]) }
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
      coordinates: extractCoordinates(rawContent),
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

  if (remainingDays > 0) return hours > 0 ? \`Expires in \${remainingDays}d \${hours}h\` : \`Expires in \${remainingDays}d\`
  if (totalHours > 0) return minutes > 0 ? \`Expires in \${totalHours}h \${minutes}m\` : \`Expires in \${totalHours}h\`
  return \`Expires in \${minutes}m\`
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
  }

  return (
    <svg className="ohk-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

function OfferCard({ post, saved, onSave, onOpen, dark, nearby }) {
  const expiry = getExpiryLabel(post)

  return (
    <article className={\`ohk-card \${dark ? 'ohk-card-dark' : ''}\`}>
      <button className="ohk-card-heart" onClick={() => onSave(post.id)} aria-label="Save offer">
        {saved ? '♥' : '♡'}
      </button>

      <button className="ohk-card-share" onClick={() => navigator.share ? navigator.share({ title: post.title, url: post.url }).catch(() => {}) : navigator.clipboard?.writeText(post.url)} aria-label="Share offer">
        <Icon name="share" size={18} />
      </button>

      {nearby ? (
        <div className="ohk-card-distance">
          <Icon name="location" size={12} />
          {Math.round(post.nearbyDistanceKm)} km
        </div>
      ) : null}

      {expiry ? <div className="ohk-card-expiry">{expiry}</div> : null}

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
  const [dark, setDark] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [saved, setSaved] = useState(() => JSON.parse(localStorage.getItem('offerhaikya_favorites') || '{}'))
  const [detail, setDetail] = useState(null)
  const [userLocation, setUserLocation] = useState(null)
  const [locationLabel, setLocationLabel] = useState('')
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')
  const [activeTab, setActiveTab] = useState('home')
  const [notifications, setNotifications] = useState([])
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)

  useEffect(() => {
    let active = true

    fetch(FEED_URL)
      .then((response) => {
        if (!response.ok) throw new Error('Feed request failed')
        return response.json()
      })
      .then((data) => {
        if (active) setPosts(parseFeed(data))
      })
      .catch((error) => console.error('Offerhaikya Blogger feed:', error))
      .finally(() => active && setLoading(false))

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('offerhaikya_favorites', JSON.stringify(saved))
  }, [saved])

  const bloggerTags = useMemo(() => {
    const all = posts.flatMap((post) => post.labels)
    return [...new Set(all)]
  }, [posts])

  const filteredPosts = useMemo(() => {
    const text = query.trim().toLowerCase()

    return posts.filter((post) => {
      const labelMatch = activeLabel === 'All' || post.labels.some((label) => label.toLowerCase() === activeLabel.toLowerCase())
      const textMatch = !text || \`\${post.title} \${post.labels.join(' ')} \${post.excerpt}\`.toLowerCase().includes(text)
      return labelMatch && textMatch
    })
  }, [posts, query, activeLabel])

  const displayedPosts = filteredPosts.slice(0, visible)

  const nearbyPosts = useMemo(() => {
    if (!userLocation) return []

    return posts
      .map((post) => {
        if (!post.coordinates) return null
        const distance = distanceKm(userLocation, post.coordinates)
        return distance <= NEARBY_RADIUS_KM ? { ...post, nearbyDistanceKm: distance } : null
      })
      .filter(Boolean)
      .sort((a, b) => a.nearbyDistanceKm - b.nearbyDistanceKm)
      .slice(0, 20)
  }, [posts, userLocation])

  const toggleSave = (id) => {
    setSaved((current) => ({ ...current, [id]: !current[id] }))
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
        setLocationLabel('Your location')
        setLocationLoading(false)
        setLocationMessage('Nearby offers updated.')
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
    setActiveTab('home')
    document.getElementById('deals')?.scrollIntoView({ behavior: 'smooth' })
  }

  const goHome = () => {
    setActiveTab('home')
    setActiveLabel('All')
    setQuery('')
    setVisible(PAGE_SIZE)
    setDetail(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openSearch = () => {
    setActiveTab('search')
    setSearchOpen(true)
    setTimeout(() => document.querySelector('.ohk-main-search-input')?.focus(), 50)
  }

  const handleBottomTab = (tab) => {
    if (tab === 'home') goHome()
    if (tab === 'local') {
      setActiveTab('local')
      document.getElementById('nearby')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      if (!userLocation) requestLocation()
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
    <div className={\`ohk-app \${dark ? 'ohk-dark' : ''}\`}>
      <header className="ohk-header">
        <div className="ohk-header-inner">
          <button className="ohk-header-button" onClick={() => setMenuOpen(true)} aria-label="Menu">
            <Icon name="menu" />
          </button>

          <button className="ohk-logo-button" onClick={goHome} aria-label="Offerhaikya home">
            <img src={LOGO_URL} alt="Offerhaikya" />
          </button>

          <div className="ohk-header-actions">
            <button className="ohk-header-button" onClick={() => setDark((value) => !value)} aria-label="Dark mode">
              {dark ? '☀' : <Icon name="moon" size={21} />}
            </button>

            <button className="ohk-header-button ohk-badge-button" onClick={() => setNotificationsOpen(true)} aria-label="Notifications">
              <Icon name="bell" size={21} />
              {notifications.length ? <span>{notifications.length}</span> : null}
            </button>

            <button className="ohk-header-button ohk-badge-button" onClick={() => document.getElementById('favorites')?.scrollIntoView({ behavior: 'smooth' })} aria-label="Favorites">
              <Icon name="heart" size={21} />
              {Object.values(saved).filter(Boolean).length ? <span>{Object.values(saved).filter(Boolean).length}</span> : null}
            </button>

            <button className="ohk-header-button" onClick={openSearch} aria-label="Search">
              <Icon name="search" size={21} />
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
              {(bloggerTags.length ? bloggerTags : CATEGORY_ITEMS).map((item) => (
                <button key={item} onClick={() => { selectTag(item); setMenuOpen(false) }}>{item}</button>
              ))}
            </div>

            <div className="ohk-side-group">
              <h3>Special Deal Categories</h3>
              {SPECIAL_DEAL_ITEMS.map((item) => (
                <button key={item} onClick={() => { selectTag(item); setMenuOpen(false) }}>{item}</button>
              ))}
            </div>
          </aside>
        </div>
      ) : null}

      <nav className="ohk-tag-strip">
        <div className="ohk-tag-scroll">
          {(bloggerTags.length ? bloggerTags : DIRECT_TAGS).map((tag) => (
            <button key={tag} className={activeLabel === tag ? 'active' : ''} onClick={() => selectTag(tag)}>
              {tag}
            </button>
          ))}
        </div>
      </nav>

      <main>
        <section className="ohk-hero" style={{ backgroundImage: \`url("\${HERO_URL}")\` }}>
          <div className="ohk-hero-content">
            <div className="ohk-hero-small">LATEST DEALS & OFFERS</div>
            <h1>Find the best offers</h1>
            <p>New offers from Offerhaikya, updated automatically.</p>

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
                <h2>Filtered Nearby Offers{locationLabel ? \` - \${locationLabel.split(/[\\s,]+/)[0]}\` : ''}</h2>
                <button onClick={requestLocation}>{locationLoading ? 'Updating...' : 'Update'}</button>
              </div>

              {nearbyPosts.length ? (
                <div className="ohk-grid">
                  {nearbyPosts.map((post) => (
                    <OfferCard key={post.id} post={post} saved={Boolean(saved[post.id])} onSave={toggleSave} onOpen={setDetail} dark={dark} nearby />
                  ))}
                </div>
              ) : (
                <div className="ohk-empty">No offer found nearby.</div>
              )}
            </section>
          ) : (
            <section id="nearby" className="ohk-nearby-prompt">
              <div>
                <strong>See offers near you</strong>
                <span>Allow location to find local offers within {NEARBY_RADIUS_KM} km.</span>
              </div>
              <button onClick={requestLocation} disabled={locationLoading}>
                <Icon name="location" size={18} />
                {locationLoading ? 'Checking...' : 'Find Nearby'}
              </button>
            </section>
          )}

          <section id="deals" className="ohk-section">
            <div className="ohk-section-title">
              <h2>{query ? \`Search: \${query}\` : activeLabel !== 'All' ? activeLabel : 'Latest Offers'}</h2>
              <span>{filteredPosts.length} offers</span>
            </div>

            {loading ? (
              <div className="ohk-state">Loading latest offers...</div>
            ) : displayedPosts.length ? (
              <>
                <div className="ohk-grid">
                  {displayedPosts.map((post) => (
                    <OfferCard key={post.id} post={post} saved={Boolean(saved[post.id])} onSave={toggleSave} onOpen={setDetail} dark={dark} />
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

          <section id="favorites" className="ohk-section ohk-favorites-section">
            <div className="ohk-section-title">
              <h2>Favorites</h2>
              <span>{Object.values(saved).filter(Boolean).length} saved</span>
            </div>
            {Object.values(saved).some(Boolean) ? (
              <div className="ohk-grid">
                {posts.filter((post) => saved[post.id]).map((post) => (
                  <OfferCard key={post.id} post={post} saved onSave={toggleSave} onOpen={setDetail} dark={dark} />
                ))}
              </div>
            ) : (
              <div className="ohk-empty">Tap the heart on an offer to add it here.</div>
            )}
          </section>
        </section>
      </main>

      <footer className="ohk-footer">
        <strong>Offerhaikya</strong>
        <span>Fresh offers. Simple browsing.</span>
        <div className="ohk-footer-links">
          <a href="/p/about-us.html">About Us</a>
          <a href="/p/contact-us.html">Contact Us</a>
          <a href="/p/privacy-policy.html">Privacy Policy</a>
          <a href="/p/terms-and-condition.html">Terms & Conditions</a>
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

      {detail ? (
        <div className="ohk-detail-overlay" onClick={() => setDetail(null)}>
          <article className="ohk-detail" onClick={(event) => event.stopPropagation()}>
            <header>
              <button onClick={() => setDetail(null)}><Icon name="close" /></button>
              <h2>{detail.title}</h2>
              <button onClick={() => setDark((value) => !value)}>{dark ? '☀' : '☾'}</button>
            </header>
            <div className="ohk-detail-body">
              <span className="ohk-card-label">{detail.label}</span>
              <h1>{detail.title}</h1>
              <div className="ohk-detail-meta">
                <span>{detail.date}</span>
                <button onClick={() => toggleSave(detail.id)}>{saved[detail.id] ? '♥' : '♡'}</button>
                <button onClick={() => navigator.clipboard?.writeText(detail.url)}><Icon name="share" size={19} /></button>
              </div>
              <div className="ohk-detail-html" dangerouslySetInnerHTML={{ __html: detail.rawContent || \`<p>\${detail.excerpt}</p>\` }} />
            </div>
          </article>
        </div>
      ) : null}

      {notificationsOpen ? (
        <div className="ohk-modal-backdrop" onClick={() => setNotificationsOpen(false)}>
          <div className="ohk-modal" onClick={(event) => event.stopPropagation()}>
            <div className="ohk-modal-head">
              <h2>Notifications</h2>
              <button onClick={() => setNotificationsOpen(false)}><Icon name="close" /></button>
            </div>
            <div className="ohk-empty">New offer notifications will appear here.</div>
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
