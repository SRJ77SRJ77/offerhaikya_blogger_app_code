import { useEffect, useMemo, useState } from 'react'
import './App.css'

const FEED_URL = 'https://www.offerhaikya.com/feeds/posts/default?alt=json&max-results=80'
const LOGO_URL = 'https://blogger.googleusercontent.com/img/a/AVvXsEjssPRASG2wSd_1-u3_BVk8NTl6q7KmlfLyZGm46mclNU2jIvEfrQKrPnROuknuizl9_ePAshBYitzK8Wt2m4q77r7yMpIaMI7gBwu5RrdeP7iIDy0tlJv_yU60tdTJroLgpzrZHOco2sOZFxdeFzAtNvMfjq-uWWa_N1kaYt3HaWF2IdgAkckQwE0qujI=s500'
const HERO_URL = 'https://blogger.googleusercontent.com/img/a/AVvXsEgC30Rl_pU9A1X0vncm7yhCB_bGx2PV8k0xx3l286jfxzD7BereBCtXGnAHz7gYJ7UyP6I9OXLr7hPUSu6DUcYYJhvlArkhw2KiyQfK2gxoAGO4u-rmu68bJ5JT8spgpikfUOwqIdbl-PkzCV9nhInmWLOdvcgBipAQ9ZX0o7m8Q1Uv-jMNfS4o2r2-o6w=s1600'

const categories = ['Fashion','Electronics','Home & Kitchen','Grocery & Food','Beauty & Personal Care','Sports & Fitness','Baby & Kids','Automotive','Pet Supplies','Books & Education','Gaming','Travel & Luggage','Jewellery & Accessories','Tools & Industrial']
const specialDeals = ['₹1 Deals','Loot Deals','Flash Sales',"Today's Deals",'Clearance Sale','Buy 1 Get 1','Under ₹99','Under ₹499','50%+ Off','Coupon Codes','Bank Offers','Freebies']
const headerBar = ['Offline Offers','Online Offers','Amazon','Flipkart','Messho','Computers','New Releases']

function getImage(entry) {
  const html = entry && entry.content && entry.content.$t ? entry.content.$t : ''
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return match ? match[1] : ''
}

function getLabels(entry) {
  return (entry && entry.category ? entry.category : []).map((item) => item.term).filter(Boolean)
}

function OfferCard({ post, saved, onSave }) {
  const image = getImage(post)
  const labels = getLabels(post)
  const label = labels[0] || 'Offer'
  const title = post && post.title ? post.title.$t : 'Offer'
  const published = post && post.published ? new Date(post.published.$t).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : ''
  return (
    <article className='index-post hentry product'>
      <div className='entry-image-wrap ohk-react-card-image'>
        <button className={saved ? 'tfy-love unlike ohk-react-save saved' : 'tfy-love like ohk-react-save'} type='button' aria-label={saved ? 'Remove from saved' : 'Save offer'} onClick={() => onSave(post.id && post.id.$t)} />
        <a className='entry-image-link' href={(post.link && post.link.find((x) => x.rel === 'alternate')?.href) || '#'} target='_blank' rel='noreferrer' title={title}>
          <span className='entry-image tfy-lazy' style={{backgroundImage:image ? 'url("'+image+'")' : 'none'}} />
        </a>
      </div>
      <div className='entry-header'>
        <span className='ohk-react-card-label'>{label}</span>
        <h2 className='entry-title'><a href={(post.link && post.link.find((x) => x.rel === 'alternate')?.href) || '#'} target='_blank' rel='noreferrer' title={title}>{title}</a></h2>
        <div className='entry-meta'><span className='entry-time mi'>{published}</span></div>
      </div>
    </article>
  )
}

function App() {
  const [posts,setPosts] = useState([])
  const [visible,setVisible] = useState(20)
  const [search,setSearch] = useState('')
  const [headerSearch,setHeaderSearch] = useState(false)
  const [dark,setDark] = useState(false)
  const [mobileMenu,setMobileMenu] = useState(false)
  const [saved,setSaved] = useState({})
  const [loading,setLoading] = useState(true)

  useEffect(() => {
    let active = true
    fetch(FEED_URL).then((response) => { if (!response.ok) throw new Error('Feed request failed'); return response.json() }).then((data) => { if (active) setPosts(data && data.feed && data.feed.entry ? data.feed.entry : []) }).catch((error) => console.error('Offerhaikya Blogger feed:',error)).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const filteredPosts = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return posts
    return posts.filter((post) => ((post.title && post.title.$t) || '') .concat(' ',getLabels(post).join(' ')).toLowerCase().includes(query))
  }, [posts,search])

  const displayedPosts = filteredPosts.slice(0,visible)
  const toggleSave = (id) => { if (id) setSaved((current) => ({...current,[id]:!current[id]})) }
  const handleSearch = (event) => { event.preventDefault(); setVisible(20) }

  return (
    <div className={dark ? 'ohk-react-app is-dark' : 'ohk-react-app'}>
      <header id='header-wrapper'>
        <div className='main-header'><div className='header-inner'><div className='header-header flex-c'><div className='container row-x1'><div className='header-items'>
          <div className='flex-left'>
            <button className='mobile-menu-toggle ohk-react-mobile-menu' aria-label='Mobile Menu' type='button' onClick={() => setMobileMenu(true)} />
            <div className='main-logo'><a href='/' aria-label='Offerhaikya'><img src={LOGO_URL} alt='Offerhaikya' className='ohk-react-logo-img' /></a></div>
            <nav id='marketify-pro-main-menu'><ul className='main-nav ohk-react-menu-list'>
              <li className='has-sub'><a href='#categories'>Categories</a><ul className='sub-menu ohk-react-submenu'>{categories.map((item) => <li key={item}><a href='#deals'>{item}</a></li>)}</ul></li>
              <li className='has-sub'><a href='#special-deals'>Special Deal Categories</a><ul className='sub-menu ohk-react-submenu'>{specialDeals.map((item) => <li key={item}><a href='#deals'>{item}</a></li>)}</ul></li>
              <li><a href='/p/about-us.html'>About Us</a></li><li><a href='/p/contact-us.html'>Contact Us</a></li>
            </ul></nav>
          </div>
          <div className='flex-right'><div className='toggle-wrap h-li'>
            <button aria-label='Dark Mode' className='darkmode-toggle' type='button' onClick={() => setDark((value) => !value)} />
            <button className='loveit-toggle' type='button' aria-label='Bookmarks' onClick={() => setSaved({})}><span className='loveit-count'>{Object.values(saved).filter(Boolean).length}</span></button>
            <button className='search-toggle show-search' type='button' aria-label='Search' onClick={() => setHeaderSearch(true)} />
          </div></div>
          {headerSearch && <div id='main-search-wrap' className='ohk-react-header-search'><div className='main-search'><form className='search-form' onSubmit={(event) => {handleSearch(event);setHeaderSearch(false)}}><input autoFocus className='search-input' aria-label='Search' placeholder='Search Offers, Deals, Coupons & Discounts...' value={search} onChange={(event) => setSearch(event.target.value)} /><button className='search-toggle search-close' type='button' aria-label='Close Search' onClick={() => setHeaderSearch(false)} /></form></div></div>}
        </div></div></div></div></div>
        <nav className='headerbar-wrap flex-c'><div className='container row-x1'><div className='headerbar-items flex-sb'><div className='headerbar'><div className='link-list ohk-react-headerbar-menu'>{headerBar.map((item) => <a key={item} href='#deals'>{item}</a>)}</div></div><div className='ohk-react-socials'><a href='https://www.instagram.com/offerhaikya/' target='_blank' rel='noreferrer'>Instagram</a><a href='https://www.instagram.com/offerhaikya/' target='_blank' rel='noreferrer'>Facebook</a><a href='https://www.instagram.com/offerhaikya/' target='_blank' rel='noreferrer'>YouTube</a></div></div></div></nav>
      </header>
      <div id='hero-wrapper' className='ohk-hero-real' style={{'--ohk-hero-image':'url("'+HERO_URL+'")'}}><section className='hero-section container row-x1'><div className='widget'><h2 className='hero-title'>Discover Your Deal</h2><p className='hero-description excerpt'>Find trending products, deals, coupons and discounts</p></div><div className='widget'><form className='search-form' role='search' onSubmit={handleSearch}><input autoComplete='off' className='search-input' aria-label='Search Offers, Deals, Coupons & Discounts...' placeholder='Search Offers, Deals, Coupons & Discounts...' value={search} onChange={(event) => setSearch(event.target.value)} /><button className='search-action' type='submit' aria-label='Search' /></form></div></section></div>
      <div className='flex-c' id='content-wrapper'><div className='container row-x1 flex-sb'><main id='main-wrapper' className='is-home'><section id='main'><div className='main-title big-title-wrap' id='deals'><h3 className='title'>{search ? 'Search: '+search : 'Latest Offers'}</h3><a className='title-link' href='#deals'>View All</a></div>
        {loading ? <div className='queryEmpty'>Loading offers...</div> : displayedPosts.length ? <><div className='blog-posts index-posts-wrap products'>{displayedPosts.map((post) => <OfferCard key={post.id?.$t || post.title?.$t} post={post} saved={Boolean(saved[post.id?.$t])} onSave={toggleSave} />)}</div>{visible < filteredPosts.length && <div className='ohk-react-load-more'><button type='button' className='load-more btn' onClick={() => setVisible((value) => value+20)}>Load More</button></div>}</> : <div className='queryEmpty'>No results found.</div>}
      </section></main></div></div>
      <footer className='flex-col' id='footer-wrapper'><div className='footer-bar flex-c'><div className='container row-x1 flex-sb'><div className='footer-copyright' id='footer-copyright'><span className='copyright-text'>© {new Date().getFullYear()} Offerhaikya</span></div><nav id='footer-menu'><div className='footer-menu'><ul className='ohk-react-footer-menu'><li><a href='/p/about-us.html'>About Us</a></li><li><a href='/p/contact-us.html'>Contact Us</a></li><li><a href='/p/privacy-policy.html'>Privacy Policy</a></li><li><a href='/p/terms-and-condition.html'>Terms and Condition</a></li></ul></div></nav></div></div></footer>
      <div id='slide-menu' className={mobileMenu ? 'nav-active' : ''}><div className='sm-header'><div className='mobile-logo'><a className='homepage' href='/'>Offerhaikya</a></div><div className='sm-toggle-wrap'><button aria-label='Hide Mobile Menu' className='hide-mobile-menu' type='button' onClick={() => setMobileMenu(false)} /></div></div><div className='sm-flex'><nav className='mobile-menu' id='mobile-menu'><ul><li><a href='#deals' onClick={() => setMobileMenu(false)}>Offers</a></li><li><a href='#categories' onClick={() => setMobileMenu(false)}>Categories</a></li><li><a href='#special-deals' onClick={() => setMobileMenu(false)}>Special Deal Categories</a></li><li><a href='/p/about-us.html'>About Us</a></li><li><a href='/p/contact-us.html'>Contact Us</a></li></ul></nav></div></div>
      <div className={mobileMenu ? 'overlay nav-active' : 'overlay'} onClick={() => setMobileMenu(false)} /><button className='btn' id='back-top' aria-label='Back To Top' type='button' onClick={() => window.scrollTo({top:0,behavior:'smooth'})} />
    </div>
  )
}

export default App