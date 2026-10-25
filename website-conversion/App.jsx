import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, browserPopupRedirectResolver, signOut } from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { auth, db } from './firebase.js'
import './App.css'
import logoImage from './assets/logo.webp'
import darkLogoImage from './assets/logo_dm.webp'
import preloaderGif from './assets/Offer.gif'
import bgImage from './assets/bg.webp'
const OffersMap = lazy(() => import('./OffersMap.jsx'))
import { parseOhk, extractOhkBlocks, ohkPlainText } from './ohkBlocks.js'

const BLOG_URL = 'https://offerhaikya.blogspot.com'
const NEARBY_RADIUS_KM = 300
const PAGE_SIZE = 20
const LOGO_URL = logoImage

const HOME_FAQS = [
  {
    question: 'Aaj koi Offer Hai Kya? / Are there any new offers today?',
    answer: 'Check the Latest Offers section on Offer Hai Kya (Offerhaikya) for recently published deals. Offers, stock, coupon validity and terms can change, so confirm the details on the retailer’s page before buying.',
    links: [{ label: 'Click to check current offers', href: 'https://www.offerhaikya.com/offer/aaj-ke-offers-offer-hai-kya' }],
  },
  {
    question: 'Amazon aur Flipkart par aaj ke offers kahan milenge? / Where can I find Amazon and Flipkart offers?',
    answer: 'Browse the latest offer posts on Offer Hai Kya (Offerhaikya) and open the deal you are interested in. Check the retailer’s page for the current price, bank offers, availability and terms before placing an order.',
    links: [{ label: 'Click to check Amazon offer', href: 'https://www.offerhaikya.com/offer/amazon-great-indian-festival-2026-sbi-offer' }],
  },
  {
    question: 'Meesho ke trending products aur offers kaise dekhein? / How can I find Meesho product offers?',
    answer: 'Look through Offer Hai Kya (Offerhaikya)’s latest posts and shopping guides for Meesho products and offers. Product prices, coupons and availability can change, so verify them on Meesho before buying.',
    links: [{ label: 'Click to check Meesho offers', href: 'https://www.offerhaikya.com/offer/meesho-block-buster-sale' }],
  },
  {
    question: 'Mere paas/city/area ke offers kaise milenge? / How do I find offers near me?',
    answer: 'You can find nearby offers on Offer Hai Kya (Offerhaikya) in three ways: (1) Use your current location by allowing location access on your device. (2) Enter a city or town in the Nearby Offers search. (3) Click “View Offer Map” on an offer to check its store location on the map. Nearby offers can be shown within a search range of up to 300 km when matching offers and location details are available. Map availability depends on the location information provided with the offer.',
  },
  {
    question: 'Kya Offerhaikya par offline aur local shop offers bhi hain? / Does Offerhaikya list offline store offers?',
    answer: 'Yes, Offer Hai Kya (Offerhaikya) publishes online deals as well as offline and local-store offers when those offers are available. Check each post for the store location, validity and conditions.',
  },
  {
    question: 'Offerhaikya par offers kitni baar update hote hain? / How often are offers updated?',
    answer: 'We try to add new offers and update existing ones daily on Offer Hai Kya (Offerhaikya), including online deals, offline and local store offers, and coupons. Sometimes, updates may take a gap of 1–2 days. Please check Offerhaikya regularly for new deals and confirm an offer’s availability and validity with the retailer or store before purchasing.',
  },
  {
    question: 'Offer Hai Kya par apna offer kaise post karein? / How can I post an offer on Offerhaikya?',
    answer: 'Have a great online deal, discount, coupon, or local store offer to share? Submit your offer using the Offer Hai Kya (Offerhaikya) submission form and include the product or store name, discount details, offer link or shop location, and validity information. Any applicable charges for publishing an offer will be discussed with you beforehand. Offers may be published after verification and approval.',
    links: [{ label: 'Click here to submit your offer', href: 'https://docs.google.com/forms/d/e/1FAIpQLSf1bActE5s-pO1Ieedj4PsmbLaSQ_CgqPMnr8gRXyEj1y9q2Q/viewform?usp=header' }],
  },
]


function normalizeLabelForMatch(label = '') {
  return String(label || '').trim().replace(/imp$/i, '').trim().toLowerCase()
}

function searchableLabels(labels = []) {
  return (Array.isArray(labels) ? labels : [])
    .flatMap((label) => [String(label || ''), normalizeLabelForMatch(label)])
    .join(' ')
}

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

function sizedImage(url = '', size = 800) {
  if (!url) return ''
  const target = '/s' + size + '/'
  return url
        .replace(/\/s\d+(-[a-z]+)*\//i, target)
    .replace(/=w\d+(-h\d+)?(-p)?/i, '=s' + size)
    .replace(/\/w\d+(-h\d+)?\//i, target)
}

function highResImage(url = '') {
  return sizedImage(url, 800)
}

function firstImage(html = '') {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return match?.[1] || ''
}

function extractPostImages(primaryImage = '', html = '') {
  const images = []
  const addImage = (value) => {
    let url = String(value || '').trim()
    if (!url) return
    if (url.startsWith('//')) url = 'https:' + url
    if (!/^https?:\/\//i.test(url)) return
    const highResolutionUrl = highResImage(url)
    if (highResolutionUrl && !images.includes(highResolutionUrl)) images.push(highResolutionUrl)
  }

  addImage(primaryImage)
  String(html || '').replace(/<img\b[^>]*>/gi, (tag) => {
    const source = tag.match(/\b(?:src|data-src)\s*=\s*["']([^"']+)["']/i)
    if (source) addImage(source[1])
    return tag
  })
  return images
}

function extractPostVideos(html = '') {
  const videos = []
  const seen = new Set()
  const addVideo = (url, type = 'video') => {
    let value = String(url || '').trim().replace(/&amp;/g, '&')
    if (value.startsWith('//')) value = 'https:' + value
    if (!/^https?:\/\//i.test(value) || seen.has(value)) return
    seen.add(value)
    videos.push({ url: value, type })
  }
  const container = document.createElement('div')
  container.innerHTML = String(html || '')
  container.querySelectorAll('video').forEach((video) => {
    const source = video.getAttribute('src') || video.querySelector('source[src]')?.getAttribute('src')
    if (source) addVideo(source, 'video')
    video.querySelectorAll('source[src]').forEach((node) => addVideo(node.getAttribute('src'), 'video'))
  })
  container.querySelectorAll('iframe[src]').forEach((frame) => {
    const url = frame.getAttribute('src') || ''
    if (/youtube\.com\/(?:embed|shorts)\/|youtu\.be\/|youtube-nocookie\.com\/embed\//i.test(url)) {
      addVideo(url, 'embed')
    } else if (/blogger\.com\/video\.g|googleusercontent\.com|drive\.google\.com\/file\/d\//i.test(url)) {
      addVideo(url, 'embed')
    }
  })
  container.querySelectorAll('a[href]').forEach((link) => {
    const url = link.getAttribute('href') || ''
    if (/\.(?:mp4|webm|ogg|m4v)(?:[?#]|$)/i.test(url)) addVideo(url, 'video')
    else if (/youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\//i.test(url)) {
      try {
        const parsed = new URL(url, window.location.href)
        const id = parsed.hostname.includes('youtu.be')
          ? parsed.pathname.slice(1)
          : parsed.searchParams.get('v') || parsed.pathname.split('/').filter(Boolean).pop()
        if (id) addVideo('https://www.youtube.com/embed/' + id, 'embed')
      } catch {}
    }
  })
  return videos
}

function extractPostAddress(html = '') {
  const lines = String(html || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, '\n')
    .split('\n')
    .map((line) => stripHtml(line).trim())
    .filter(Boolean)
  const addressLine = lines.find((line) => /^address\s*[-:：]\s*/i.test(line))
  return addressLine ? addressLine.replace(/^address\s*[-:：]\s*/i, '').trim() : ''
}
function extractMapLinks(html = '') {
  const links = []
  const seen = new Set()
  const source = String(html || '')
  const addMap = (value, label = 'View map') => {
    const url = String(value || '').replace(/&amp;/g, '&').replace(/[),.;]+$/, '').trim()
    if (!/^https?:\/\//i.test(url)) return
    if (!/(google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps|openstreetmap\.org)/i.test(url)) return
    if (seen.has(url)) return
    seen.add(url)
    links.push({ url, label: label || 'View map' })
  }

  const anchorPattern = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = anchorPattern.exec(source))) {
    addMap(match[2], stripHtml(match[3]).trim() || 'View map')
  }

  // Also support Blogger text such as: Location - https://maps.app.goo.gl/...
  const plainUrlPattern = /https?:\/\/[^\s<>"']+/gi
  while ((match = plainUrlPattern.exec(source))) {
    const beforeUrl = stripHtml(source.slice(Math.max(0, source.lastIndexOf('\n', match.index) + 1), match.index)).trim()
    const label = /^location\s*[-:：]\s*$/i.test(beforeUrl) ? 'Location' : 'View map'
    addMap(match[0], label)
  }
  return links
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

function offerSlugFromTitle(title = '') {
  // Use only the title prefix before the first colon for clean offer URLs.
  const prefix = String(title || '').split(':', 1)[0]
  return prefix.toLowerCase().replace(/₹/g, '').replace(/(\d),(?=\d)/g, '$1').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function legacyOfferSlugFromTitle(title = '') {
  return String(title || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function ensureMeta(selector, attribute, value, content) {
  let element = document.head.querySelector(selector)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, value)
    document.head.appendChild(element)
  }
  element.setAttribute('content', content || '')
}

function ensureCanonical(url) {
  let element = document.head.querySelector('link[rel="canonical"]')
  if (!element) {
    element = document.createElement('link')
    element.rel = 'canonical'
    document.head.appendChild(element)
  }
  element.href = url
}

function seoTitle(value, isHome = false) {
  const base = String(value || '').replace(/\s+/g, ' ').trim()
  if (isHome) return base
  const suffix = ' | Offerhaikya'
  let title = base.toLowerCase().includes('offerhaikya') ? base : base + suffix
  if (title.length < 50 && title.length + ' | Deals & Offers'.length <= 70) {
    title += ' | Deals & Offers'
  }
  if (title.length > 70) {
    title = title.slice(0, 70).replace(/\s+\S*$/, '').trim()
  }
  return title
}

function seoDescription(value) {
  const base = String(value || '').replace(/\s+/g, ' ').trim()
  const extra = ' Explore online deals, local offers and shopping discounts on Offerhaikya.'
  let description = base
  if (description.length < 110) description = (description + extra).trim()
  if (description.length > 160) {
    description = description.slice(0, 157).replace(/\s+\S*$/, '').trim() + '…'
  }
  return description
}

function setPageMetadata(post = null) {
  const rawTitle = post?.title || 'Offer Hai Kya – Aaj Ke Local & Online Offers | Offerhaikya'
  const title = seoTitle(rawTitle, !post)
  const rawDescription = post?.searchDescription || post?.excerpt || 'Offer Hai Kya – Aaj ke local offers, discounts aur deals. Find nearby local & offline stores plus Amazon, Flipkart and Meesho offers.'
  const description = seoDescription(rawDescription)
  const url = post?.title
    ? window.location.origin + '/offer/' + encodeURIComponent(offerSlugFromTitle(post.title))
    : window.location.origin + '/'
  const image = new URL(post?.image || '/og-image.png', window.location.origin).href
  document.title = title
  ensureMeta('meta[name="description"]', 'name', 'description', description)
  ensureMeta('meta[property="og:type"]', 'property', 'og:type', post ? 'article' : 'website')
  ensureMeta('meta[property="og:title"]', 'property', 'og:title', title)
  ensureMeta('meta[property="og:description"]', 'property', 'og:description', description)
  ensureMeta('meta[property="og:image"]', 'property', 'og:image', image)
  ensureMeta('meta[property="og:url"]', 'property', 'og:url', url)
  document.head.querySelectorAll('meta[name^="twitter:"]').forEach((element) => element.remove())
  ensureMeta('meta[name="robots"]', 'name', 'robots', 'index,follow')
  ensureCanonical(url)

  let structuredData = document.head.querySelector('script[data-offerhaikya-structured-data]')
  if (!structuredData) {
    structuredData = document.createElement('script')
    structuredData.type = 'application/ld+json'
    structuredData.setAttribute('data-offerhaikya-structured-data', 'true')
    document.head.appendChild(structuredData)
  }
  const schema = post ? {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description,
    image: [image],
    datePublished: post.publishedAt || undefined,
    dateModified: post.updatedAt || post.publishedAt || undefined,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    publisher: { '@type': 'Organization', name: 'Offerhaikya', url: window.location.origin }
  } : {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: 'Offerhaikya',
        alternateName: ['Offer Hai Kya', 'Offer Hai Kya?', 'OHK'],
        url: window.location.origin + '/'
      },
      {
        '@type': 'FAQPage',
        mainEntity: HOME_FAQS.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: [faq.answer, ...(faq.links || []).map((link) => link.label)].join(' ')
          }
        }))
      }
    ]
  }
  structuredData.textContent = JSON.stringify(schema)
}

function addTitleAltToImages(html = '', title = 'Offerhaikya offer') {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    if (/\balt\s*=\s*["'][^"']*["']/i.test(tag)) {
      return tag.replace(/\balt\s*=\s*(["'])[^"']*\1/i, 'alt="' + String(title).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"')
    }
    return tag.replace(/<img\b/i, '<img alt="' + String(title).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"')
  })
}

function cleanBloggerDetailHtml(html = '', title = 'Offer') {
  // Work with Blogger's real markup tree so empty image/layout wrappers do not
  // leave a large blank area before the first visible article text.
  const container = document.createElement('div')
  container.innerHTML = addTitleAltToImages(html, title)

  // Hide only the unwanted standalone "Offer Text" label; keep the post body
  // and its Location/Google Maps links intact.
  container.querySelectorAll('p, div, span, strong, b, h1, h2, h3, h4, label').forEach((node) => {
    if (node.children.length === 0 && /^offer\s+text\s*:?$/i.test((node.textContent || '').trim())) {
      node.remove()
    }
  })

  // Turn Blogger links labelled "Click to Buy" into orange CTA buttons,
  // keeping each anchor's original destination and visible wording.
  container.querySelectorAll('a[href]').forEach((link) => {
    if (/^click\s+to\s+buy$/i.test((link.textContent || '').replace(/\s+/g, ' ').trim())) {
      link.textContent = 'Buy Now'
      link.classList.add('ohk-click-to-buy-button')
      link.style.removeProperty('color')
      link.style.removeProperty('background')
      link.setAttribute('target', '_blank')
      link.setAttribute('rel', 'noopener noreferrer')
    }
  })

  container.querySelectorAll('img').forEach((image) => image.remove())
  container.querySelectorAll('script, style, iframe, noscript').forEach((node) => node.remove())

  // Repeatedly remove empty wrapper nodes, including nested Blogger gallery wrappers.
  let changed = true
  while (changed) {
    changed = false
    container.querySelectorAll('a, p, div, span, figure, section, article').forEach((node) => {
      const hasVisibleText = Boolean((node.textContent || '').replace(/\u00a0|\s/g, ''))
      const hasUsefulContent = node.querySelector('img, video, audio, iframe, table, ul, ol, blockquote')
      if (!hasVisibleText && !hasUsefulContent) {
        node.remove()
        changed = true
      }
    })
  }

  // Remove blank blocks at the beginning only; preserve the article's real content/order.
  while (container.firstElementChild) {
    const first = container.firstElementChild
    const hasVisibleText = Boolean((first.textContent || '').replace(/\u00a0|\s/g, ''))
    const hasUsefulContent = first.querySelector('img, video, audio, table, ul, ol, blockquote') ||
      /^(IMG|VIDEO|AUDIO|TABLE|UL|OL|BLOCKQUOTE)$/i.test(first.tagName)
    if (hasVisibleText || hasUsefulContent) break
    first.remove()
  }

  // Inline top margins/padding/heights on Blogger wrappers can cause a visual gap.
  container.querySelectorAll('*').forEach((node) => {
    node.style.removeProperty('margin-top')
    node.style.removeProperty('padding-top')
    node.style.removeProperty('min-height')
    node.style.removeProperty('height')
  })
  container.querySelectorAll('h1').forEach((heading) => {
    const replacement = document.createElement('h2')
    Array.from(heading.attributes).forEach((attr) => replacement.setAttribute(attr.name, attr.value))
    replacement.innerHTML = heading.innerHTML
    heading.replaceWith(replacement)
  })
  return container.innerHTML
}

function isLockedPost(post) {
  return (post?.labels || []).some((label) => String(label).trim().toLowerCase() === 'lock')
}

function isHiddenPost(post) {
  return isLockedPost(post) || String(post?.title || '').trim().toLowerCase() === 'coupons'
}

function parseFeed(data) {
  const entries = data?.feed?.entry || []

  return entries.map((entry) => {
    const rawContent = entry?.content?.$t || ''
    const labels = (entry?.category || []).map((item) => item.term).filter(Boolean)
    if (isHiddenPost({ labels, title: entry?.title?.$t })) return null
    const alternate = entry?.link?.find((item) => item.rel === 'alternate')?.href || BLOG_URL
    const ohk = parseOhk(rawContent)
    const image = ohk.has
      ? highResImage(ohk.banner[0] || (ohk.products[0] && ohk.products[0].image) || '')
      : highResImage(firstImage(rawContent))
    return {
      id: entry?.id?.$t || alternate,
      title: entry?.title?.$t || 'Offer',
      searchDescription: stripHtml(entry?.summary?.$t || '').slice(0, 300),
      url: alternate,
      date: entry?.published?.$t
        ? new Date(entry.published.$t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : '',
      publishedAt: entry?.published?.$t || '',
      updatedAt: entry?.updated?.$t || entry?.published?.$t || '',
      labels,
      label: labels.find((label) => !isExpiryControlLabel(label) && !/^(?:verified|expired)$/i.test(String(label || '').trim())) || 'Offer',
      image,
      excerpt: ohk.has ? ohkPlainText(rawContent, 180) : stripHtml(rawContent).slice(0, 180),
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
  }).filter(Boolean)
}


function notificationVersionKey(post) {
  return String(post?.id || '') + '::' + String(post?.updatedAt || post?.publishedAt || 'unknown')
}

function isUpdatedBloggerPost(post) {
  const publishedAt = Date.parse(String(post?.publishedAt || ''))
  const updatedAt = Date.parse(String(post?.updatedAt || post?.publishedAt || ''))
  return Number.isFinite(publishedAt) && Number.isFinite(updatedAt) && updatedAt > publishedAt + 60000
}

function limitNotificationSections(items) {
  // Keep exactly one visible notification per Blogger post, even if older
  // localStorage data contains multiple versions or duplicate feed entries.
  const uniqueByPost = new Map()
  items.forEach((item) => {
    // Blogger normally supplies a stable ID, but old/cached entries can differ.
    // Use canonical post URL, then normalized title, to catch the same post
    // stored under different IDs as well.
    const postId = String(item?.id || '')
    const identity = String(item?.url || '').split('?')[0].replace(/\/$/, '').toLowerCase()
      || String(item?.title || '').replace(/\s+/g, ' ').trim().toLowerCase()
      || postId
    if (!identity) return
    const current = uniqueByPost.get(identity)
    if (!current) {
      uniqueByPost.set(identity, item)
      return
    }
    // Prefer an UPDATED notification over a NEW notification for the same post.
    if (item.notificationType === 'updated' && current.notificationType !== 'updated') {
      uniqueByPost.set(postId, item)
      return
    }
    // If both entries have the same type, keep the most recent version.
    const itemTime = Date.parse(item.updatedAt || item.publishedAt || '') || 0
    const currentTime = Date.parse(current.updatedAt || current.publishedAt || '') || 0
    if (item.notificationType === current.notificationType && itemTime > currentTime) {
      uniqueByPost.set(postId, item)
    }
  })
  const values = [...uniqueByPost.values()]
  const newest = values
    .filter((item) => item.notificationType !== 'updated')
    .sort((a, b) => (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0))
    .slice(0, 10)
  const updated = values
    .filter((item) => item.notificationType === 'updated')
    .sort((a, b) => (Date.parse(b.updatedAt || '') || 0) - (Date.parse(a.updatedAt || '') || 0)
    )
    .slice(0, 10)
  return [...newest, ...updated]
}


function menuKeyFromTitle(title = '') {
  const normalized = title.replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
  if (normalized.includes('special') && (normalized.includes('deal') || normalized.includes('categor'))) return 'specialDeals'
  if (normalized === 'categories' || normalized.includes('category')) return 'categories'
  if (normalized.includes('store')) return 'stores'
  return ''
}

function cleanMenuItems(items) {
  return items
    .map((item) => ({ title: (item.title || '').trim(), url: (item.url || '').trim() }))
    .filter((item) => item.title && item.url && !item.url.startsWith('javascript:') && item.url !== '#')
    .filter((item, index, all) => all.findIndex((other) => other.title.toLowerCase() === item.title.toLowerCase()) === index)
}

function parseBloggerLinkLists(source = '') {
  const result = { categories: [], specialDeals: [], stores: [] }
  if (!source) return result

  const doc = new DOMParser().parseFromString(source, 'text/html')
  const widgets = [...doc.querySelectorAll(
    '.widget.LinkList, .widget.Linklist, .widget-type-LinkList, [data-widget-type="LinkList"], [id^="LinkList"], [id*="LinkList"]'
  )]
  for (const widget of widgets) {
    const titleNode = widget.querySelector('.title, .widget-title, .widget-title-link, h2, h3, [class*="title"]')
    const title = titleNode?.textContent || widget.getAttribute('title') || widget.id || ''
    const key = menuKeyFromTitle(title)
    if (!key || key === 'categories') continue
    const items = [...widget.querySelectorAll('.widget-content a, .widget-content li a, ul a, a')]
      .map((anchor) => ({ title: anchor.textContent || '', url: anchor.href || anchor.getAttribute('href') || '' }))
    const cleaned = cleanMenuItems(items)
    if (cleaned.length) result[key] = cleaned
  }

  if (!result.categories.length || !result.specialDeals.length || !result.stores.length) {
    const headings = [...doc.querySelectorAll('h1, h2, h3, h4, .title, .widget-title')]
    for (const heading of headings) {
      const key = menuKeyFromTitle(heading.textContent || '')
      if (!key || key === 'categories' || result[key].length) continue
      const parent = heading.closest('.widget, section, nav, aside, .widget-content') || heading.parentElement
      if (!parent) continue
      const cleaned = cleanMenuItems([...parent.querySelectorAll('a')].map((anchor) => ({
        title: anchor.textContent || '',
        url: anchor.href || anchor.getAttribute('href') || '',
      })))
      if (cleaned.length) result[key] = cleaned
    }
  }

  if (!result.categories.length && !result.specialDeals.length && !result.stores.length) {
    let activeKey = ''
    const markdownItems = { categories: [], specialDeals: [], stores: [] }
    for (const line of source.split(/\r?\n/)) {
      const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)
      if (heading) {
        activeKey = menuKeyFromTitle(heading[1])
        continue
      }
      if (!activeKey) continue
      const match = line.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)(?:\s+[^)]*)?\)/i)
      if (match) markdownItems[activeKey].push({ title: match[1], url: match[2] })
    }
    for (const key of Object.keys(result)) result[key] = cleanMenuItems(markdownItems[key])
  }

  return result
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

function formatDistance(km) {
  if (!Number.isFinite(km) || km < 0) return ''

  if (km < 1) {
    return `${Math.round(km * 1000)} m`
  }

  if (km < 10) {
    return `${Number(km.toFixed(1))} km`
  }

  return `${Math.round(km)} km`
}

function isOfflinePost(post) {
  const labels = (post.labels || []).map((label) => label.toLowerCase().trim())
  return labels.some((label) => /^(offline offer|offline offers|local offer|local offers|nearby offer|nearby offers)$/.test(label))
}

function getOfferPercent(post) {
  const labels = Array.isArray(post?.labels) ? post.labels : []
  for (const label of labels) {
    const match = String(label).match(/(?:^|\D)(\d{1,3})\s*%(?:\s*off)?/i)
    if (match) {
      const percent = Number(match[1])
      if (percent > 0 && percent <= 100) return percent
    }
  }
  return null
}

function isExpiryControlLabel(label) {
  return /^(?:E_\d{2}_\d{2}_\d{4}_\d{2}_\d{2}_(?:AM|PM)|E\d+|EY\d+)$/i.test(String(label || '').trim())
}

function getExpiryTimestamp(post) {
  const labels = Array.isArray(post?.labels) ? post.labels : []
  // An explicit Blogger "Expired" label always marks the offer as expired.
  if (labels.some((label) => /^expired$/i.test(String(label).trim()))) return 0

  // New fixed expiry format: E_DD_MM_YYYY_HH_MM_AM/PM (India Standard Time).
  const fixedExpiryTag = labels.map((label) => String(label).trim()).find((label) =>
    /^E_\d{2}_\d{2}_\d{4}_\d{2}_\d{2}_(?:AM|PM)$/i.test(label)
  )
  if (fixedExpiryTag) {
    const match = fixedExpiryTag.match(/^E_(\d{2})_(\d{2})_(\d{4})_(\d{2})_(\d{2})_(AM|PM)$/i)
    if (!match) return null
    const [, dayText, monthText, yearText, hourText, minuteText, periodText] = match
    const day = Number(dayText)
    const month = Number(monthText)
    const year = Number(yearText)
    let hour = Number(hourText)
    const minute = Number(minuteText)
    if (hour < 1 || hour > 12 || minute > 59 || day < 1 || day > 31 || month < 1 || month > 12) return null
    if (periodText.toUpperCase() === 'AM') hour = hour === 12 ? 0 : hour
    else hour = hour === 12 ? 12 : hour + 12
    // Convert the supplied IST wall-clock time to a UTC timestamp.
    const utc = Date.UTC(year, month - 1, day, hour, minute) - 330 * 60 * 1000
    const check = new Date(utc + 330 * 60 * 1000)
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
    // Keep the Blogger tag unchanged for display, but expire internally 15 seconds early
    // to account for the site's 15-second feed sync interval.
    return utc - 15 * 1000
  }

  // Legacy E<number> day tags and EY<number> year tags remain supported.
  const expiryTag = labels.find((label) => /^(?:E\d+|EY\d+)$/i.test(String(label).trim()))
  const expiryBase = post.updatedAt || post.publishedAt
  if (!expiryTag || !expiryBase) return null
  const tag = String(expiryTag).trim().toUpperCase()
  const isYearTag = /^EY\d+$/.test(tag)
  const duration = Number(tag.slice(isYearTag ? 2 : 1))
  if (!Number.isFinite(duration) || duration <= 0) return null
  const durationDays = isYearTag ? duration * 365 : duration
  return new Date(expiryBase).getTime() + durationDays * 24 * 60 * 60 * 1000
}

function getExpiryLabel(post) {
  const labels = Array.isArray(post?.labels) ? post.labels : []
  if (labels.some((label) => /^expired$/i.test(String(label).trim()))) return 'Expired'
  const expiryTime = getExpiryTimestamp(post)
  if (expiryTime === 0 || (expiryTime !== null && expiryTime <= Date.now())) return 'Expired'
  if (expiryTime === null || !Number.isFinite(expiryTime)) return ''
  // Add the internal buffer back for display so visitors see the exact Blogger time.
  const hasFixedExpiryTag = labels.some((label) => /^E_\d{2}_\d{2}_\d{4}_\d{2}_\d{2}_(?:AM|PM)$/i.test(String(label).trim()))
  const expiryDate = new Date(expiryTime + (hasFixedExpiryTag ? 15 * 1000 : 0))
  const expiryDateTimeLabel = expiryDate.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).replace(/\b(am|pm)\b/i, (period) => period.toUpperCase())
  return `Expires on ${expiryDateTimeLabel}`
}

function sortPostsExpiredLast(posts) {
  return [...posts].sort((a, b) => {
    const aExpired = getExpiryLabel(a) === 'Expired' ? 1 : 0
    const bExpired = getExpiryLabel(b) === 'Expired' ? 1 : 0
    if (aExpired !== bExpired) return aExpired - bExpired
    const aOrderTime = Date.parse(a.updatedAt || a.publishedAt || '') || 0
    const bOrderTime = Date.parse(b.updatedAt || b.publishedAt || '') || 0
    return bOrderTime - aOrderTime
  })
}

function buildDetailFacts(post, distance) {
  const facts = []
  const offline = isOfflinePost(post)
  facts.push({ label: 'Offer type', value: offline ? 'In-store offer' : 'Online offer' })
  const store = getPostCardLabel(post)
  if (store) facts.push({ label: offline ? 'Area' : 'Store', value: store })
  const percent = getOfferPercent(post)
  if (percent !== null) facts.push({ label: 'Discount', value: 'Upto ' + percent + '% off', strong: true })
  const expiry = getExpiryLabel(post)
  if (expiry) facts.push({ label: 'Valid till', value: expiry === 'Expired' ? 'Expired' : expiry.replace(/^Expires on\s*/i, '') })
  if ((post.labels || []).some((label) => /^verified$/i.test(String(label).trim()))) facts.push({ label: 'Status', value: 'Verified' })
  if (Number.isFinite(distance)) facts.push({ label: 'Distance', value: formatDistance(distance) + ' away' })
  return facts
}

const CONTACT_ICONS = { email: 'mail', phone: 'phone', whatsapp: 'whatsapp', instagram: 'instagram', facebook: 'facebook', youtube: 'youtube', x: 'x', twitter: 'x', linkedin: 'linkedin', website: 'globe', web: 'globe' }
const TILE_ICONS = { online: 'tag', offline: 'location', discount: 'percent', time: 'clock', verified: 'check', store: 'store', gaming: 'gamepad', price: 'rupee', platform: 'monitor', availability: 'calendar', bonus: 'gift', info: 'tag' }

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
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <><path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6l-8-3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
    phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
    whatsapp: <><path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3L3 21Z" /><path d="M9 9.5c.5 2 2.5 4 4.5 4.5l1.2-1.2-1.8-1-.8.6a3 3 0 0 1-1.7-1.7l.6-.8-1-1.8L9 9.5Z" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    store: <><path d="M4 9h16l-1-5H5L4 9Z" /><path d="M5 9v11h14V9" /><path d="M10 20v-6h4v6" /></>,
    gamepad: <><path d="M6 9h12a4 4 0 0 1 3.8 5.2l-1 3A2.5 2.5 0 0 1 16.5 18L14 15h-4l-2.5 3a2.5 2.5 0 0 1-4.3-.8l-1-3A4 4 0 0 1 6 9Z" /><path d="M7 12v4M5 14h4M16.5 13.5h.01M18.5 15.5h.01" /></>,
    rupee: <><path d="M5 4h14M5 8h14M7 4c5 0 7 2 7 5s-2 5-7 5h-2l9 6" /><path d="M5 4h14" /></>,
    monitor: <><rect x="3" y="4" width="18" height="13" rx="1.5" /><path d="M8 21h8M12 17v4" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    gift: <><rect x="3" y="9" width="18" height="12" rx="1" /><path d="M2 6h20v4H2zM12 6v15M12 6C8 6 6 4 7 2c3-1 5 2 5 4ZM12 6c4 0 6-2 5-4-3-1-5 2-5 4Z" /></>,
    map: <><path d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z" /><path d="M9 4v13.5M15 6.5V20" /></>,
    edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" /></>,
    youtube: <><path d="M22 8.2a2.8 2.8 0 0 0-2-2C18.3 5.7 12 5.7 12 5.7s-6.3 0-8 .5a2.8 2.8 0 0 0-2 2A29 29 0 0 0 1.5 12a29 29 0 0 0 .5 3.8 2.8 2.8 0 0 0 2 2c1.7.5 8 .5 8 .5s6.3 0 8-.5a2.8 2.8 0 0 0 2-2A29 29 0 0 0 22.5 12a29 29 0 0 0-.5-3.8Z" /><path d="m10 9 5 3-5 3Z" /></>,
    instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".7" /></>,
    facebook: <path d="M14 21v-8h3l.5-4H14V7c0-1.2.4-2 2-2h2V1.5C17.2 1.3 16.2 1.2 15 1.2c-3.2 0-5 1.9-5 5.3V9H7v4h3v8Z" />,
    x: <><path d="M4 3h4.5L20 21h-4.5Z" /><path d="m20 3-7 8M4 21l7-8" /></>,
    linkedin: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 10v7M7 7v.1M11 17v-7h3v1a3 3 0 0 1 3-1c2 0 3 1.4 3 4v3" /></>,
  }

  return (
    <svg className="ohk-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

function AdSenseUnit({ slot, kind = 'in-feed' }) {
  const adRef = useRef(null)

  useEffect(() => {
    const ad = adRef.current
    if (!ad) return undefined

    // Defer off-screen ads until they are close to entering the viewport.
    // This keeps the existing ad placements and slots while reducing early page work.
    const initializeAd = () => {
      if (!ad.isConnected || ad.offsetParent === null || ad.dataset.ohkAdInitialized === 'true') return

      if (!document.querySelector('script[src*="pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2974987879547173"]')) {
        const script = document.createElement('script')
        script.async = true
        script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2974987879547173'
        script.crossOrigin = 'anonymous'
        document.head.appendChild(script)
      }

      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({})
        ad.dataset.ohkAdInitialized = 'true'
      } catch (error) {
        console.warn('Offerhaikya AdSense ad could not initialize.', error)
      }
    }

    if (typeof IntersectionObserver === 'undefined') {
      initializeAd()
      return undefined
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        initializeAd()
        observer.disconnect()
      }
    }, { rootMargin: '300px 0px' })

    observer.observe(ad)
    return () => observer.disconnect()
  }, [])

  if (kind === 'display') {
    return (
      <ins
        ref={adRef}
        className="adsbygoogle"
        style={{ display: 'block', width: '100%', height: '600px' }}
        data-ad-client="ca-pub-2974987879547173"
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    )
  }

  if (kind === 'in-article') {
    return (
      <ins
        ref={adRef}
        className="adsbygoogle"
        style={{ display: 'block', textAlign: 'center' }}
        data-ad-layout="in-article"
        data-ad-format="fluid"
        data-ad-client="ca-pub-2974987879547173"
        data-ad-slot={slot}
      />
    )
  }

  return (
    <ins
      ref={adRef}
      className="adsbygoogle"
      style={{ display: 'block' }}
      data-ad-format="fluid"
      data-ad-layout-key="-7d+et-x-1e+6a"
      data-ad-client="ca-pub-2974987879547173"
      data-ad-slot={slot}
    />
  )
}

function getPostCardLabel(post) {
  const labels = (Array.isArray(post?.labels) ? post.labels : []).filter((label) =>
    !isExpiryControlLabel(label) && !/^(?:verified|expired)$/i.test(String(label || '').trim())
  )
  const importantLabel = labels.find((label) => /imp$/i.test(String(label || '').trim()))
  const selectedLabel = importantLabel ?? labels[0] ?? ''
  return String(selectedLabel).trim().replace(/imp$/i, '').trim()
}
function OfferCard({ post, saved, onSave, onOpen, onOpenDistance, onShare, onMap, dark, nearby, imagePriority = false }) {
  const expiry = getExpiryLabel(post)
  const offerPercent = getOfferPercent(post)
  const cardLabel = getPostCardLabel(post)

  return (
    <article className={`ohk-card ${dark ? 'ohk-card-dark' : ''} ${expiry === 'Expired' ? 'ohk-card-expired-locked' : ''}`} title={expiry === 'Expired' ? 'Expired' : undefined}>
      <button
        type="button"
        className={`ohk-card-heart ${saved ? 'ohk-card-heart-saved' : 'ohk-card-heart-unsaved'}`}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onSave(post.id)
        }}
        aria-label={saved ? 'Unsave offer' : 'Save offer'}
        aria-pressed={Boolean(saved)}
        title={saved ? 'Unsave offer' : 'Save offer'}
      >
        <svg className="ohk-heart-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
          <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"
            fill={saved ? '#e53935' : 'none'}
            stroke={saved ? '#e53935' : 'currentColor'}
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <button className="ohk-card-share" onClick={() => onShare(post)} aria-label="Share offer">
        <Icon name="share" size={18} />
      </button>

      {post.coordinates && onMap ? (
        <button
          type="button"
          className="ohk-card-share ohk-card-map"
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); onMap(post) }}
          aria-label="View offer on map"
          title="View on map"
        >
          <Icon name="map" size={18} />
        </button>
      ) : null}


      <a
        className="ohk-card-click"
        href={'/offer/' + encodeURIComponent(offerSlugFromTitle(post.title))}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
          event.preventDefault()
          onOpen(post)
        }}
      >
        {post.image ? (
          <img
            src={sizedImage(post.image, 360)}
            alt={post.title || 'Offer image'}
            className="ohk-card-image"
            loading={imagePriority ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={imagePriority ? 'high' : 'auto'}
          />
        ) : (
          <div className="ohk-card-image ohk-image-fallback">Offerhaikya</div>
        )}


        {offerPercent !== null ? (
          <span className="ohk-card-discount-badge" aria-label={`Upto ${offerPercent}% Off`}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M20.59 13.41 11 3.83V3H4v7h.83l9.58 9.59a2 2 0 0 0 2.83 0l3.35-3.35a2 2 0 0 0 0-2.83ZM7.5 7.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" fill="currentColor"/></svg>
            <span>Upto {offerPercent}% Off</span>
          </span>
        ) : null}

        <div className="ohk-card-body">
          <div className="ohk-card-meta-row">
            <span className="ohk-card-label">{cardLabel}</span>
            {expiry ? (
              <span className={`ohk-detail-status ${expiry === 'Expired' ? 'ohk-detail-status-expired' : 'ohk-detail-status-expiry'} ohk-card-expiry-inline`} title={expiry}>
                <span className="ohk-card-expiry-full">{expiry}</span>
                <span className="ohk-card-expiry-short">{expiry === 'Expired' ? 'Expired' : expiry.replace(/,\s*.*$/, '').replace(/\s+\d{4}$/, '') + '…'}</span>
              </span>
            ) : null}
          </div>
          <h2>{post.title}</h2>
          <div className="ohk-card-date">{post.date}</div>
          <p>{post.excerpt}</p>
          <div className="ohk-card-footer">
            <span className="ohk-read-more">Read more ›</span>
            {nearby ? (
              <span
                className="ohk-card-distance"
                aria-label={`Distance: ${formatDistance(post.nearbyDistanceKm)}`}
              >
                <Icon name="location" size={12} />
                {formatDistance(post.nearbyDistanceKm)}
              </span>
            ) : null}
          </div>
        </div>
      </a>
    </article>
  )
}


function CouponScratchCard({ item, dark }) {
  const [showTerms, setShowTerms] = useState(false)
  const canvasRef = useRef(null)
  const scratchRef = useRef({ drawing: false, lastX: 0, lastY: 0 })
  const resetTimerRef = useRef(null)
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  const paintScratchLayer = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#ff5b01'
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    let scratchFontSize = Math.min(14, rect.width * 0.042)
    ctx.font = `700 ${scratchFontSize}px Rubik, sans-serif`
    while (scratchFontSize > 6 && ctx.measureText('SCRATCH HERE').width > rect.width - 16) {
      scratchFontSize -= 0.5
      ctx.font = `700 ${scratchFontSize}px Rubik, sans-serif`
    }
    ctx.fillText('SCRATCH HERE', rect.width / 2, rect.height / 2 - 9)
    ctx.font = '24px sans-serif'
    ctx.fillText('✦', rect.width / 2, rect.height / 2 + 22)
  }

  useEffect(() => {
    if (revealed) return undefined
    paintScratchLayer()
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      if (!revealed) paintScratchLayer()
    }) : null
    if (observer) observer.observe(canvas)
    return () => {
      if (observer) observer.disconnect()
    }
  }, [revealed])

  useEffect(() => {
    if (!revealed) return undefined
    resetTimerRef.current = setTimeout(() => {
      setRevealed(false)
      setCopied(false)
      resetTimerRef.current = null
    }, 20000)
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    }
  }, [revealed])

  const scratchStart = (event) => {
    if (revealed) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    scratchRef.current = { drawing: true, lastX: point.x, lastY: point.y }
    canvas.setPointerCapture?.(event.pointerId)
    const ctx = canvas.getContext('2d')
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.arc(point.x, point.y, 20, 0, Math.PI * 2)
    ctx.fill()
  }

  const scratchMove = (event) => {
    if (!scratchRef.current.drawing || revealed) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const ctx = canvas.getContext('2d')
    ctx.globalCompositeOperation = 'destination-out'
    ctx.lineWidth = 40
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(scratchRef.current.lastX, scratchRef.current.lastY)
    ctx.lineTo(x, y)
    ctx.stroke()
    scratchRef.current.lastX = x
    scratchRef.current.lastY = y
  }

  const scratchEnd = () => {
    scratchRef.current.drawing = false
    if (revealed) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let transparent = 0
    let sampled = 0
    for (let i = 3; i < pixels.length; i += 4 * 8) {
      sampled += 1
      if (pixels[i] < 80) transparent += 1
    }
    if (sampled && transparent / sampled >= 0.8) setRevealed(true)
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(item.code)
      setCopied(true)
    } catch {
      const input = document.createElement('textarea')
      input.value = item.code
      input.style.position = 'fixed'
      input.style.opacity = '0'
      document.body.appendChild(input)
      input.select()
      const success = document.execCommand('copy')
      input.remove()
      setCopied(success)
    }
  }

  return (
    <article className="ohk-coupon-card">
      <div className="ohk-coupon-store">
        <div className="ohk-coupon-name-row">
          <strong>{item.title}</strong>
          <button type="button" className="ohk-coupon-terms-trigger" aria-label={`Terms and conditions for ${item.title}`} title="Terms & Conditions" onClick={() => setShowTerms(true)}>?</button>
        </div>
      </div>
      <div className="ohk-scratch-area">
        <button type="button" className={`ohk-coupon-code ${revealed ? 'is-revealed' : 'is-hidden'}`} onClick={revealed ? copyCode : undefined} disabled={!revealed} aria-label={revealed ? `Copy coupon code ${item.code}` : 'Scratch to reveal coupon code'}>
          {revealed ? item.code : '••••••••'}
        </button>
        {!revealed ? <canvas ref={canvasRef} className="ohk-scratch-canvas" aria-label={`Scratch to reveal ${item.title}`} onPointerDown={scratchStart} onPointerMove={scratchMove} onPointerUp={scratchEnd} onPointerCancel={scratchEnd} /> : null}
      </div>
      {revealed ? <button type="button" className="ohk-coupon-copy-hint" onClick={copyCode}>{copied ? 'Copied!' : 'Click to Copy'}</button> : <span className="ohk-coupon-hint">Scratch to reveal</span>}
      {showTerms ? (
        <div className="ohk-coupon-terms-backdrop" role="presentation" onClick={() => setShowTerms(false)}>
          <section className="ohk-coupon-terms-dialog" role="dialog" aria-modal="true" aria-labelledby={`ohk-terms-title-${item.id}`} onClick={(event) => event.stopPropagation()}>
            <div className="ohk-coupon-terms-heading">
              <h3 id={`ohk-terms-title-${item.id}`}>Terms &amp; Conditions</h3>
              <button type="button" className="ohk-coupon-terms-close" aria-label="Close terms and conditions" onClick={() => setShowTerms(false)}><Icon name="close" size={20} /></button>
            </div>
            <ul>
              <li>Coupon validity and availability may change.</li>
              <li>Check eligibility, minimum order value and any exclusions before using the coupon.</li>
              <li>Only one coupon may be allowed per order, depending on the retailer.</li>
              <li>Confirm the final terms with the retailer before purchase.</li>
            </ul>
          </section>
        </div>
      ) : null}
    </article>
  )
}

function CouponsSection({ dark, posts, couponSource }) {
  const [search, setSearch] = useState('')
  const [visibleCouponCount, setVisibleCouponCount] = useState(6)
  const couponPost = couponSource || posts.find((post) => String(post.title || '').trim().toLowerCase() === 'coupons')
  const couponText = String(couponPost?.rawContent || couponPost?.searchDescription || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\u00a0/g, ' ')
  const couponLines = couponText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const parsedCoupons = []
  let currentCoupon = null
  couponLines.forEach((line) => {
    const nameMatch = line.match(/^Name\s*:\s*(.+)$/i)
    const codeMatch = line.match(/^Code\s*:\s*([A-Za-z0-9_-]+)\s*$/i)
    if (nameMatch) {
      if (currentCoupon?.title && currentCoupon?.code) parsedCoupons.push(currentCoupon)
      currentCoupon = { title: nameMatch[1].trim(), store: nameMatch[1].trim(), code: '' }
    } else if (codeMatch && currentCoupon) {
      currentCoupon.code = codeMatch[1].trim()
      if (currentCoupon.title) {
        parsedCoupons.push({ ...currentCoupon, id: currentCoupon.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') })
        currentCoupon = null
      }
    }
  })
  if (currentCoupon?.title && currentCoupon?.code) {
    parsedCoupons.push({ ...currentCoupon, id: currentCoupon.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') })
  }
  const coupons = parsedCoupons
  const matches = coupons.filter((item) => (item.title + ' ' + item.store + ' ' + item.code).toLowerCase().includes(search.trim().toLowerCase()))
  const visibleCoupons = matches.slice(0, visibleCouponCount)

  return (
    <section id="ohk-coupons-section" className={`ohk-coupons-section ${dark ? 'ohk-coupons-dark' : 'ohk-coupons-light'}`} aria-labelledby="ohk-coupons-heading">
      <div className="ohk-section-title ohk-section-banner ohk-coupons-banner" style={{ backgroundImage: "linear-gradient(90deg, rgba(0,0,0,.72), rgba(0,0,0,.18)), url(" + bgImage + ")" }}>
        <h2 id="ohk-coupons-heading">Offer Hai Kya – Exclusive Coupons</h2>
        <span>{coupons.length} coupons</span>
      </div>
      <form className="ohk-search-box ohk-coupons-search-box" onSubmit={(event) => event.preventDefault()} role="search">
          <Icon name="search" size={22} />
          <input className="ohk-main-search-input" value={search} onChange={(event) => { setSearch(event.target.value); setVisibleCouponCount(6) }} placeholder="Search coupons..." aria-label="Search coupons" />
          {search ? <button type="button" className="ohk-search-clear" aria-label="Clear coupon search" onClick={() => setSearch('')}><Icon name="close" size={17} /></button> : null}
          <button type="submit">GO</button>
      </form>
      {matches.length ? (
        <>
          <div className="ohk-coupons-grid">{visibleCoupons.map((item) => <CouponScratchCard key={item.id} item={item} dark={dark} />)}</div>
          {matches.length > visibleCouponCount ? (
            <div className="ohk-load-more ohk-coupons-load-more">
              <button type="button" onClick={() => setVisibleCouponCount((count) => count + 6)}>Load More</button>
            </div>
          ) : null}
        </>
      ) : <div className="ohk-coupons-empty">No coupons found. Try another search.</div>}
    </section>
  )
}

function App() {
  const [posts, setPosts] = useState([])
  const [couponSource, setCouponSource] = useState(null)
  const detailRef = useRef(null)

  const [isPhoneAdLayout, setIsPhoneAdLayout] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const updateLayout = () => setIsPhoneAdLayout(mediaQuery.matches)
    updateLayout()
    mediaQuery.addEventListener('change', updateLayout)
    return () => mediaQuery.removeEventListener('change', updateLayout)
  }, [])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [activeLabel, setActiveLabel] = useState('All')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [nearbyVisible, setNearbyVisible] = useState(PAGE_SIZE)
  const [dark, setDark] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  useEffect(() => {
    if (!menuOpen) return undefined
    const previousOverflow = document.body.style.overflow
    const previousTouchAction = document.body.style.touchAction
    document.body.style.overflow = 'hidden'
    document.body.style.touchAction = 'none'
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.touchAction = previousTouchAction
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [desktopCategoryOpen, setDesktopCategoryOpen] = useState(false)
  const [desktopCategoryDismissed, setDesktopCategoryDismissed] = useState(false)
  const [specialDealsOpen, setSpecialDealsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [registrationOpen, setRegistrationOpen] = useState(false)
  const [locationPromptOpen, setLocationPromptOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [preloaderVisible, setPreloaderVisible] = useState(true)
  const [locationSearchPreloaderVisible, setLocationSearchPreloaderVisible] = useState(false)
  const [sitePage, setSitePage] = useState(null)
  const [bloggerPages, setBloggerPages] = useState([])
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [registrationName, setRegistrationName] = useState('')
  const [registrationPhone, setRegistrationPhone] = useState('')
  const [registrationEmail, setRegistrationEmail] = useState('')
  const [authUser, setAuthUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authBusy, setAuthBusy] = useState(false)
  const [profileCategories, setProfileCategories] = useState([])
  const [profilePhone, setProfilePhone] = useState('')
  const [profileDocExists, setProfileDocExists] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [saved, setSaved] = useState({})
  // Keep main-page card hearts independent from the detail-page Suggested/Latest cards.
  const [detail, setDetail] = useState(null)
  const [resolvedMapCoordinates, setResolvedMapCoordinates] = useState({})
  useEffect(() => { detailRef.current = detail }, [detail])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setAuthUser(currentUser)
      setAuthLoading(false)
      setProfileError('')

      if (!currentUser) {
        setProfileDocExists(false)
        setProfileCategories([])
        setProfilePhone('')
        return
      }

      try {
        const profileSnapshot = await getDoc(doc(db, 'userProfiles', currentUser.uid))
        if (profileSnapshot.exists()) {
          const data = profileSnapshot.data()
          const categories = Array.isArray(data.categories) ? data.categories.map((label) => String(label || '').replace(/imp$/i, '').trim()).filter(Boolean) : []
          setProfileCategories(categories)
          setProfilePhone(typeof data.phone === 'string' ? data.phone : '')
          setProfileDocExists(categories.length > 0)
          setProfileOpen(categories.length === 0)
        } else {
          setProfileCategories([])
          setProfilePhone('')
          setProfileDocExists(false)
          setProfileOpen(true)
        }
      } catch (error) {
        console.error('Offerhaikya profile load failed:', error)
        setProfileDocExists(false)
        setProfileOpen(true)
        setProfileError('We could not load your profile. Please check the Firebase Firestore setup and try again.')
      }
    })

    return unsubscribe
  }, [])

  const profileCategoryOptions = useMemo(() => {
    const labels = posts.flatMap((post) => Array.isArray(post.labels) ? post.labels : [])
    return [...new Set(labels
      .map((label) => String(label || '').replace(/imp$/i, '').trim())
      .filter((label) => label && !isExpiryControlLabel(label) && !/^(?:verified|expired)$/i.test(label)))]
      .sort((a, b) => a.localeCompare(b))
  }, [posts])

  const handleGoogleSignIn = async () => {
    setAuthBusy(true)
    setProfileError('')
    try {
    await signInWithPopup(auth, new GoogleAuthProvider(), browserPopupRedirectResolver)
    } catch (error) {
      console.error('Offerhaikya Google sign-in failed:', error)
      if (error?.code !== 'auth/popup-closed-by-user' && error?.code !== 'auth/cancelled-popup-request') {
        setProfileError(error?.code === 'auth/unauthorized-domain'
          ? 'This website domain is not authorized in Firebase Authentication.'
          : 'Google sign-in failed. Please try again.')
      }
    } finally {
      setAuthBusy(false)
    }
  }

  const handleSaveProfile = async () => {
    if (!authUser) {
      setProfileError('Please sign in with Google first.')
      return
    }
    if (!profileCategories.length) {
      setProfileError('Please select at least one category to complete registration.')
      return
    }

    setAuthBusy(true)
    setProfileError('')
    try {
      await setDoc(doc(db, 'userProfiles', authUser.uid), {
        uid: authUser.uid,
        email: authUser.email || '',
        displayName: authUser.displayName || '',
        phone: profilePhone.trim(),
        categories: profileCategories,
        profileComplete: true,
        updatedAt: new Date().toISOString(),
      }, { merge: true })
      setProfileDocExists(true)
      setProfileOpen(false)
    } catch (error) {
      console.error('Offerhaikya profile save failed:', error)
      setProfileError('Your categories could not be saved. Please check that Cloud Firestore is enabled and its security rules allow signed-in users to save their own profile.')
    } finally {
      setAuthBusy(false)
    }
  }

  const handleGoogleSignOut = async () => {
    setAuthBusy(true)
    setProfileError('')
    try {
      await signOut(auth)
      setProfileOpen(false)
    } catch (error) {
      console.error('Offerhaikya sign-out failed:', error)
      setProfileError('Sign-out failed. Please try again.')
    } finally {
      setAuthBusy(false)
    }
  }

  useEffect(() => { setDetailImageIndex(0) }, [detail?.id])
  const [detailTagFilter, setDetailTagFilter] = useState('')
  const [detailImageIndex, setDetailImageIndex] = useState(0)
  const detailThumbnailsRef = useRef(null)
  const [imageViewerOpen, setImageViewerOpen] = useState(false)
  const [imageViewerZoom, setImageViewerZoom] = useState(1)
  const [imageViewerPan, setImageViewerPan] = useState({ x: 0, y: 0 })
  const imageViewerPointersRef = useRef(new Map())
  const imageViewerGestureRef = useRef({ distance: 0, zoom: 1, x: 0, y: 0, panX: 0, panY: 0 })

  const resetImageViewer = () => {
    setImageViewerZoom(1)
    setImageViewerPan({ x: 0, y: 0 })
    imageViewerPointersRef.current.clear()
    imageViewerGestureRef.current = { distance: 0, zoom: 1, x: 0, y: 0, panX: 0, panY: 0 }
  }
  const closeImageViewer = () => {
    setImageViewerOpen(false)
    resetImageViewer()
  }
  const changeImageViewerZoom = (nextZoom) => {
    const zoom = Math.max(1, Math.min(5, nextZoom))
    setImageViewerZoom(zoom)
    if (zoom === 1) setImageViewerPan({ x: 0, y: 0 })
    imageViewerGestureRef.current.zoom = zoom
  }
  const imageViewerPointerDown = (event) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const pointers = imageViewerPointersRef.current
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const points = [...pointers.values()]
    imageViewerGestureRef.current = {
      ...imageViewerGestureRef.current,
      distance: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0,
      zoom: imageViewerZoom,
      x: event.clientX,
      y: event.clientY,
      panX: imageViewerPan.x,
      panY: imageViewerPan.y
    }
  }
  const imageViewerPointerMove = (event) => {
    const pointers = imageViewerPointersRef.current
    if (!pointers.has(event.pointerId)) return
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const points = [...pointers.values()]
    const gesture = imageViewerGestureRef.current
    if (points.length > 1 && gesture.distance > 0) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
      changeImageViewerZoom(gesture.zoom * distance / gesture.distance)
    } else if (points.length === 1 && imageViewerZoom > 1) {
      setImageViewerPan({
        x: gesture.panX + event.clientX - gesture.x,
        y: gesture.panY + event.clientY - gesture.y
      })
    }
  }
  const imageViewerPointerUp = (event) => {
    imageViewerPointersRef.current.delete(event.pointerId)
    const points = [...imageViewerPointersRef.current.values()]
    imageViewerGestureRef.current = {
      ...imageViewerGestureRef.current,
      distance: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0,
      zoom: imageViewerZoom,
      x: points[0]?.x ?? event.clientX,
      y: points[0]?.y ?? event.clientY,
      panX: imageViewerPan.x,
      panY: imageViewerPan.y
    }
  }

  useEffect(() => {
    if (!imageViewerOpen) return
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeImageViewer()
      if (event.key === '+' || event.key === '=') changeImageViewerZoom(imageViewerZoom + 0.5)
      if (event.key === '-') changeImageViewerZoom(imageViewerZoom - 0.5)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [imageViewerOpen, imageViewerZoom])
  const [shareTarget, setShareTarget] = useState(null)
  const [shareMessage, setShareMessage] = useState('')
  const [userLocation, setUserLocation] = useState(null)
  const [locationLabel, setLocationLabel] = useState('')
  const [locationQuery, setLocationQuery] = useState('')
  const [locationPickerOpen, setLocationPickerOpen] = useState(false)
  const [locationSuggestions, setLocationSuggestions] = useState([])
  const [locationSuggestionsOpen, setLocationSuggestionsOpen] = useState(false)
  const locationSuggestionCacheRef = useRef(new Map())
  const tagDragRef = useRef(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')
  const [activeTab, setActiveTab] = useState('home')
  const [notifications, setNotifications] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('offerhaikya_notifications') || '[]')
      return Array.isArray(saved) ? limitNotificationSections(saved.filter((post) => !isHiddenPost(post))) : []
    } catch {
      return []
    }
  })
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [wishlistOpen, setWishlistOpen] = useState(false)
  const [requestOpen, setRequestOpen] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [mapScope, setMapScope] = useState('all')
  const [mapFocusId, setMapFocusId] = useState(null)

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
        setPosts(sortPostsExpiredLast(cached.filter((post) => !isLockedPost(post))))
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
        const couponEntry = (data?.feed?.entry || []).find((entry) => String(entry?.title?.$t || '').trim().toLowerCase() === 'coupons')
        if (couponEntry) {
          setCouponSource({
            title: couponEntry?.title?.$t || 'Coupons',
            rawContent: couponEntry?.content?.$t || '',
            searchDescription: stripHtml(couponEntry?.summary?.$t || ''),
          })
        }
        const previousKnown = JSON.parse(localStorage.getItem('offerhaikya_known_post_ids') || 'null')
        const previousVersions = JSON.parse(localStorage.getItem('offerhaikya_known_post_versions') || 'null')
        const seen = new Set(JSON.parse(localStorage.getItem('offerhaikya_notification_seen') || '[]'))
        const existingNotifications = JSON.parse(localStorage.getItem('offerhaikya_notifications') || '[]').filter((post) => !isHiddenPost(post))
        const knownIds = new Set(Array.isArray(previousKnown) ? previousKnown : [])
        const knownVersions = previousVersions && typeof previousVersions === 'object' && !Array.isArray(previousVersions)
          ? previousVersions
          : {}
        const firstVersionBaseline = !previousVersions || typeof previousVersions !== 'object' || Array.isArray(previousVersions)
        let newAdditions = []
        let updatedAdditions = []

        const activeForNotifications = parsed.filter((post) => getExpiryLabel(post) !== 'Expired')

        if (!Array.isArray(previousKnown)) {
          // First visit: seed the bell with the 10 newest active posts only.
          newAdditions = sortPostsExpiredLast(activeForNotifications).slice(0, 10).map((post) => ({ ...post, notificationType: 'new' }))
        } else {
          newAdditions = activeForNotifications
            .filter((post) => !knownIds.has(post.id) && !seen.has(notificationVersionKey(post)) && !seen.has(post.id))
            .map((post) => ({ ...post, notificationType: 'new' }))

          if (!firstVersionBaseline) {
            updatedAdditions = activeForNotifications
              .filter((post) => {
                const priorVersion = knownVersions[post.id]
                return Boolean(priorVersion) &&
                  String(priorVersion) !== String(post.updatedAt || post.publishedAt || '') &&
                  isUpdatedBloggerPost(post) &&
                  !seen.has(notificationVersionKey(post)) &&
                  !seen.has(post.id)
              })
              .map((post) => ({ ...post, notificationType: 'updated' }))
          }
        }

        // If a post already has a notification, replace it with its newest version
        // rather than keeping the stale entry or appending a duplicate.
        const refreshedIds = new Set(updatedAdditions.map((post) => String(post.id)))
        const retained = existingNotifications
          .filter((post) => !isHiddenPost(post))
          .filter((post) => getExpiryLabel(post) !== 'Expired')
          .filter((post) => !seen.has(notificationVersionKey(post)) && !seen.has(post.id))
          .filter((post) => !refreshedIds.has(String(post.id)))
        const mergedNotifications = limitNotificationSections([...newAdditions, ...updatedAdditions, ...retained])
        const nextVersions = {}
        parsed.forEach((post) => {
          nextVersions[post.id] = String(post.updatedAt || post.publishedAt || '')
        })

        setPosts(sortPostsExpiredLast(parsed))
        setNotifications(mergedNotifications)
        try { localStorage.setItem('offerhaikya_known_post_ids', JSON.stringify(parsed.map((post) => post.id))) } catch {}
        try { localStorage.setItem('offerhaikya_known_post_versions', JSON.stringify(nextVersions)) } catch {}
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
    const path = window.location.pathname
    const infoPaths = ['/about-us', '/contact-us', '/privacy-policy', '/terms-and-condition']
    if (infoPaths.includes(path)) return
    if (path.startsWith('/offer/') && !detail) return
    setPageMetadata(detail)
  }, [detail])

  useEffect(() => {
    const timer = window.setTimeout(() => setPreloaderVisible(false), 700)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    let active = true
    let script = null
    const callbackName = "offerhaikyaPagesCallback_" + Date.now()
    const cleanup = () => {
      if (script) script.remove()
      // A JSONP response may already be in flight after cleanup (for example, in React Strict Mode).
      // Keep a harmless callback so a late response cannot throw a ReferenceError.
      window[callbackName] = () => {}
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
      const cleanOfferSlug = path.startsWith('/offer/') ? decodeURIComponent(path.slice(7).split('/')[0]) : ''
      if (postUrl || cleanOfferSlug) {
        // Resolve the route on initial load, but once a detail is open, keep it
        // associated with its stable Blogger URL while the feed refreshes.
        const currentDetailUrl = detailRef.current?.url
        const found = (currentDetailUrl
          ? posts.find((post) => post.url === currentDetailUrl)
          : null) || posts.find((post) => {
            if (postUrl && post.url === postUrl) return true
            if (!cleanOfferSlug) return false
            return offerSlugFromTitle(post.title) === cleanOfferSlug || legacyOfferSlugFromTitle(post.title) === cleanOfferSlug
          })
        if (found && getExpiryLabel(found) === 'Expired') {
          // Expired offers must not be accessible through a direct /offer/ URL.
          detailRef.current = null
          setDetail(null)
          setSitePage(null)
          window.history.replaceState({}, '', '/')
          return
        }
        if (found) {
          detailRef.current = found
          setDetail(found)
          const nextSlug = offerSlugFromTitle(found.title)
          if (nextSlug && path.startsWith('/offer/') && cleanOfferSlug !== nextSlug) {
            window.history.replaceState({}, '', '/offer/' + encodeURIComponent(nextSlug))
          }
        } else if (!detailRef.current) {
          setDetail(null)
        }
        setSitePage(null)
        return
      }
      if (['/about-us', '/contact-us', '/privacy-policy', '/terms-and-condition'].includes(path)) {
        detailRef.current = null
        setDetail(null)
        setSitePage(path.slice(1))
      } else if (path === '/' || path === '') {
        detailRef.current = null
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

  // Categories are intentionally hardcoded; only offers themselves are fetched from Blogger.
  const categoryGroups = [
    { title: 'Brands', tags: ['Amazon', 'Flipkart', 'Meesho', 'Myntra', 'Swiggy', 'Zomato', 'Blinkit'] },
    { title: 'Offer Types', tags: ['Online Offers', 'Offline Offers', 'Local Offers', 'Free Delivery', 'Coupons & Promo Codes', 'Bank Offers', 'Buy 1 Get 1', 'Clearance Sale', '₹1 Deals'] },
    { title: 'Discounts', tags: ['Upto 20% Off', 'Upto 40% Off', 'Upto 60% Off', 'Upto 80% Off'] },
  ]

  const filteredPosts = useMemo(() => {
    const text = query.trim().toLowerCase()

    return sortPostsExpiredLast(posts.filter((post) => {
      // Hide any post tagged "Lock" from public listings and search results.
      if ((post.labels || []).some((label) => String(label).trim().toLowerCase() === 'lock')) return false
      const labelMatch = activeLabel === 'All' || post.labels.some((label) => normalizeLabelForMatch(label) === normalizeLabelForMatch(activeLabel))
      const textMatch = !text || `${post.title} ${searchableLabels(post.labels)} ${post.excerpt} ${post.bloggerLocation || ''} ${post.rawContent ? stripHtml(post.rawContent) : ''}`.toLowerCase().includes(text)
      return labelMatch && textMatch
    }))
  }, [posts, query, activeLabel])

  const displayedPosts = filteredPosts.slice(0, visible)

  const detailSuggestedPosts = useMemo(() => {
    if (!detail) return []
    const text = detailTagFilter.trim().toLowerCase()
    const matches = sortPostsExpiredLast(posts.filter((post) => {
      if (isLockedPost(post) || post.id === detail.id) return false
      if (!text) return true
      const searchable = `${post.title} ${searchableLabels(post.labels)} ${post.excerpt || ''} ${post.rawContent ? stripHtml(post.rawContent) : ''}`.toLowerCase()
      return searchable.includes(text)
    }))
    const ordered = isLockedPost(detail) ? matches : sortPostsExpiredLast([detail, ...matches])
    return ordered.slice(0, 8)
  }, [detail, detailTagFilter, posts])

  const detailLatestPosts = useMemo(() => sortPostsExpiredLast(posts.filter((post) => !isLockedPost(post))).slice(0, 8), [posts])

  const searchSuggestions = useMemo(() => {
    const text = query.trim().toLowerCase()
    if (!text) return []
    const score = (post) => {
      const title = (post.title || '').toLowerCase()
      const tags = searchableLabels(post.labels).toLowerCase()
      const description = `${post.excerpt || ''} ${post.rawContent ? stripHtml(post.rawContent) : ''}`.toLowerCase()
      const location = (post.bloggerLocation || '').toLowerCase()
      if (title.includes(text)) return 0
      if (tags.includes(text)) return 1
      if (description.includes(text)) return 2
      if (location.includes(text)) return 3
      return -1
    }
    return posts
      .filter((post) => !isLockedPost(post))
      .map((post, index) => ({ post, index, rank: score(post), expired: getExpiryLabel(post) === 'Expired' }))
      .filter((item) => item.rank >= 0)
      .sort((a, b) => Number(a.expired) - Number(b.expired) || a.rank - b.rank || a.index - b.index)
      .map((item) => item.post)
  }, [posts, query])

  useEffect(() => {
    const text = locationQuery.trim()
    const normalizedQuery = text.toLocaleLowerCase().replace(/[,\\s]+/g, ' ').trim()
    if (normalizedQuery.length < 2) {
      setLocationSuggestions([])
      setLocationSuggestionsOpen(false)
      return undefined
    }

    const cache = locationSuggestionCacheRef.current
    const cachedExact = cache.get(normalizedQuery)
    const cachedPrefixEntry = !cachedExact
      ? [...cache.entries()].filter(([key]) => normalizedQuery.startsWith(key)).sort((a, b) => b[0].length - a[0].length)[0]
      : null
    const cachedResults = cachedExact || (cachedPrefixEntry
      ? cachedPrefixEntry[1].filter((place) => {
          const haystack = `${place.display_name || ''} ${place.name || ''}`.toLocaleLowerCase()
          return normalizedQuery.split(' ').every((word) => haystack.includes(word))
        })
      : null)

    if (cachedResults?.length) {
      setLocationSuggestions(cachedResults)
      setLocationSuggestionsOpen(true)
    }

    const controller = new AbortController()
    const biasLatitude = userLocation?.latitude ?? 15.8497
    const biasLongitude = userLocation?.longitude ?? 74.4977

    fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=15&lang=en&lat=${biasLatitude}&lon=${biasLongitude}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : { features: [] })
      .then((data) => {
        const queryWords = normalizedQuery.split(' ').filter(Boolean)
        const suggestions = (Array.isArray(data?.features) ? data.features : [])
          .map((feature) => {
            const properties = feature?.properties || {}
            const coordinates = feature?.geometry?.coordinates || []
            const longitude = Number(coordinates[0])
            const latitude = Number(coordinates[1])
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

            const localityName = properties.name || properties.locality || properties.neighbourhood || properties.suburb || ''
            const displayName = [
              localityName,
              properties.neighbourhood,
              properties.suburb,
              properties.street,
              properties.district,
              properties.city,
              properties.county,
              properties.state,
              properties.postcode,
              properties.country,
            ].filter((part, index, parts) => part && parts.indexOf(part) === index).join(', ')
            const searchableName = [
              localityName,
              properties.neighbourhood,
              properties.suburb,
              properties.street,
              properties.district,
              properties.city,
              properties.county,
              properties.state,
              properties.postcode,
            ].filter(Boolean).join(' ').toLocaleLowerCase()
            const matchedWords = queryWords.filter((word) => searchableName.includes(word)).length

            return {
              place_id: `${properties.osm_type || 'place'}-${properties.osm_id || `${latitude}-${longitude}`}`,
              lat: latitude,
              lon: longitude,
              name: localityName,
              display_name: displayName || properties.city || properties.state || 'Selected location',
              _matchedWords: matchedWords,
              address: {
                suburb: properties.suburb || '',
                neighbourhood: properties.neighbourhood || '',
                city_district: properties.district || '',
                city: properties.city || '',
                town: properties.city || '',
                county: properties.county || '',
                state_district: properties.state || '',
                state: properties.state || '',
                village: properties.locality || '',
                postcode: properties.postcode || '',
              },
            }
          })
          .filter(Boolean)
          .sort((a, b) => b._matchedWords - a._matchedWords)
          .map(({ _matchedWords, ...place }) => place)

        cache.set(normalizedQuery, suggestions)
        if (cache.size > 60) cache.delete(cache.keys().next().value)
        setLocationSuggestions(suggestions)
        setLocationSuggestionsOpen(true)
      })
      .catch((error) => {
        if (error?.name !== 'AbortError' && !cachedResults?.length) {
          setLocationSuggestions([])
          setLocationSuggestionsOpen(true)
        }
      })

    return () => controller.abort()
  }, [locationQuery, userLocation])
  const chooseSuggestedLocation = (place) => {
    const latitude = Number(place.lat)
    const longitude = Number(place.lon)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    const address = place.address || {}
    const label = address.suburb || address.neighbourhood || place.name || address.city || address.town || address.city_district || address.county || address.state_district || address.village || place.display_name?.split(',')[0] || locationQuery
    setUserLocation({ latitude, longitude })
    setLocationLabel(String(label).trim())
    setLocationQuery('')
    setLocationSuggestions([])
    setLocationSuggestionsOpen(false)
    setLocationPickerOpen(false)
    setLocationMessage('Nearby offers updated for ' + String(label).trim() + '.')
    setActiveTab('local')
  }

  const useTypedLocationFallback = async () => {
    const text = locationQuery.trim()
    if (text.length < 2 || locationLoading) return
    setLocationLoading(true)
    setLocationSearchPreloaderVisible(true)
    setLocationMessage('Finding this place on the map…')
    setLocationSuggestionsOpen(false)
    try {
      const biasLatitude = userLocation?.latitude ?? 15.8497
      const biasLongitude = userLocation?.longitude ?? 74.4977
      const normalizePlaceText = (value) => String(value || '')
        .toLocaleLowerCase()
        .replace(/belgaum/g, 'belagavi')
        .replace(/vijaynagar/g, 'vijayanagar')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
      const normalizedQuery = normalizePlaceText(text)
      const queryWords = normalizedQuery.split(/\s+/).filter(Boolean)

      // Reliable fallback for the specifically requested Vijaynagar area in Belagavi.
      // This avoids ambiguous geocoder results for the local spelling.
      if (normalizedQuery.includes('vijayanagar') && normalizedQuery.includes('belagavi')) {
        chooseSuggestedLocation({
          lat: 15.8697839,
          lon: 74.4811372,
          name: 'Vijaynagar',
          display_name: 'Vijaynagar, Belagavi, Karnataka, India',
          address: { suburb: 'Vijaynagar', neighbourhood: 'Vijaynagar', city: 'Belagavi', state: 'Karnataka' },
        })
        return
      }

      const searchQueries = [text]
      if (/vijaynagar/i.test(text)) searchQueries.push(text.replace(/vijaynagar/ig, 'Vijayanagar'))
      if (/belgaum/i.test(text)) searchQueries.push(text.replace(/belgaum/ig, 'Belagavi'))
      if (/vijaynagar/i.test(text) && /belgaum/i.test(text)) {
        searchQueries.push(text.replace(/vijaynagar/ig, 'Vijayanagar').replace(/belgaum/ig, 'Belagavi'))
      }
      const uniqueQueries = [...new Set(searchQueries.map((value) => value.trim()).filter(Boolean))]
      const photonResponses = await Promise.all(uniqueQueries.map(async (searchText) => {
        try {
          const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(searchText)}&limit=10&lang=en&lat=${biasLatitude}&lon=${biasLongitude}`)
          return response.ok ? await response.json() : { features: [] }
        } catch {
          return { features: [] }
        }
      }))
      const photonPlaces = photonResponses.flatMap((data) => Array.isArray(data?.features) ? data.features : []).map((feature) => {
        const properties = feature?.properties || {}
        const coordinates = feature?.geometry?.coordinates || []
        const longitude = Number(coordinates[0])
        const latitude = Number(coordinates[1])
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
        const name = properties.name || properties.locality || properties.neighbourhood || properties.suburb || ''
        const displayName = [name, properties.neighbourhood, properties.suburb, properties.street, properties.district, properties.city, properties.county, properties.state, properties.postcode, properties.country].filter((part, index, parts) => part && parts.indexOf(part) === index).join(', ')
        const searchable = normalizePlaceText(displayName)
        const score = queryWords.filter((word) => searchable.includes(word)).length
        return { place_id: `${properties.osm_type || 'place'}-${properties.osm_id || `${latitude}-${longitude}`}`, lat: latitude, lon: longitude, name, display_name: displayName || name || 'Selected location', _score: score, address: { suburb: properties.suburb || '', neighbourhood: properties.neighbourhood || '', city_district: properties.district || '', city: properties.city || '', town: properties.city || '', county: properties.county || '', state_district: properties.state || '', state: properties.state || '', village: properties.locality || '', postcode: properties.postcode || '' } }
      }).filter(Boolean).sort((a, b) => b._score - a._score)
      let place = photonPlaces[0] || null
      if (!place || place._score < queryWords.length) {
        const nominatimQuery = uniqueQueries[uniqueQueries.length - 1] + ', Karnataka, India'
        try {
          const nominatimResponse = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=5&q=${encodeURIComponent(nominatimQuery)}`)
          const nominatimData = nominatimResponse.ok ? await nominatimResponse.json() : []
          const results = Array.isArray(nominatimData) ? nominatimData : []
          const nominatimPlaces = results.filter((item) => item?.lat && item?.lon).map((item) => {
            const address = item.address || {}
            const displayName = item.display_name || text
            return { place_id: `nominatim-${item.place_id || item.osm_id || item.lat + '-' + item.lon}`, lat: Number(item.lat), lon: Number(item.lon), name: item.name || address.suburb || address.neighbourhood || address.city || address.town || '', display_name: displayName, _score: queryWords.filter((word) => normalizePlaceText(displayName).includes(word)).length, address: { suburb: address.suburb || '', neighbourhood: address.neighbourhood || '', city_district: address.city_district || '', city: address.city || '', town: address.town || '', county: address.county || '', state_district: address.state_district || '', state: address.state || '', village: address.village || '', postcode: address.postcode || '' } }
          }).sort((a, b) => b._score - a._score)
          if (nominatimPlaces.length && (!place || nominatimPlaces[0]._score > place._score)) place = nominatimPlaces[0]
        } catch {
          // Keep any usable Photon result if the fallback geocoder is unavailable.
        }
      }
      if (place && Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lon)) && place._score > 0) {
        chooseSuggestedLocation(place)
      } else {
        setLocationMessage('Location not found on the map. Try “Vijayanagar, Belagavi, Karnataka” or add a nearby area/city.')
        setLocationSuggestionsOpen(true)
      }
    } catch {
      setLocationMessage('Could not search the map right now. Please try again in a moment.')
      setLocationSuggestionsOpen(true)
    } finally {
      setLocationLoading(false)
      setLocationSearchPreloaderVisible(false)
    }
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

  // Ask about location once, 10 seconds after the first visit.
  // Persist the shown flag so refreshing the page does not show the popup again.
  useEffect(() => {
    if (userLocation || locationPromptOpen || localStorage.getItem('offerhaikya_location_prompt_shown') === 'true') return undefined
    const reminder = window.setTimeout(() => {
      localStorage.setItem('offerhaikya_location_prompt_shown', 'true')
      setLocationPromptOpen(true)
    }, 10 * 1000)
    return () => window.clearTimeout(reminder)
  }, [userLocation, locationPromptOpen])

  useEffect(() => { setNearbyVisible(PAGE_SIZE) }, [userLocation])

  const nearbyPosts = useMemo(() => {
    if (!userLocation) return []
    return posts
      .filter((post) => !isLockedPost(post) && isOfflinePost(post))
      .map((post) => {
        if (!post.coordinates) return null
        const distance = distanceKm(userLocation, post.coordinates)
        return distance <= NEARBY_RADIUS_KM ? { ...post, nearbyDistanceKm: distance } : null
      })
      .filter(Boolean)
      .sort((a, b) => {
        const aExpired = getExpiryLabel(a) === 'Expired' ? 1 : 0
        const bExpired = getExpiryLabel(b) === 'Expired' ? 1 : 0
        return aExpired - bExpired || a.nearbyDistanceKm - b.nearbyDistanceKm
      })
  }, [posts, userLocation])

    const mapPosts = useMemo(() => {
    const source = mapScope === 'nearby' ? nearbyPosts : posts
    return source
      .filter((post) => post.coordinates)
      .map((post) => ({
        ...post,
        isExpired: getExpiryLabel(post) === 'Expired',
        label: String(post.label || 'Offer').replace(/imp$/i, '').trim() || 'Offer',
      }))
  }, [posts, nearbyPosts, mapScope])

  const openAllMap = () => { setMapScope('all'); setMapFocusId(null); setMapOpen(true) }
  const openNearbyMap = () => { setMapScope('nearby'); setMapFocusId(null); setMapOpen(true) }
  const openMapForPost = (post) => { setMapScope('all'); setMapFocusId(post.id); setMapOpen(true) }

  const toggleSave = (id) => {
    setSaved((current) => ({ ...current, [id]: !current[id] }))
  }

  const sharePost = (post) => {
    setShareMessage('')
    if (!post) {
      setShareTarget({ title: 'Offerhaikya', url: window.location.href })
      return
    }
    const offerSlug = offerSlugFromTitle(post.title)
    setShareTarget({ ...post, url: offerSlug ? window.location.origin + '/offer/' + encodeURIComponent(offerSlug) : window.location.href })
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
    const showLocationPermissionMessage = () => {
      window.alert('Please turn on your device location and allow location permission in your browser to find nearby offers.')
    }

    if (!navigator.geolocation) {
      setLocationMessage('Location is not available in this browser.')
      showLocationPermissionMessage()
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
        showLocationPermissionMessage()
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
    detailRef.current = null
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
    // Keep expired offers visible in the feed, but never allow them to open.
    if (getExpiryLabel(post) === 'Expired') return
    setDetailImageIndex(0)
    detailRef.current = post
    setDetail(post)
    setSitePage(null)
    setSearchOpen(false)
    const offerSlug = offerSlugFromTitle(post.title)
    window.history.pushState({}, '', '/offer/' + encodeURIComponent(offerSlug))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openPostDistance = (post) => {
    openPost(post)
    window.setTimeout(() => {
      const detailPage = document.querySelector('.ohk-detail-page')
      if (detailPage) {
        const pageBottom = detailPage.getBoundingClientRect().bottom + window.scrollY
        window.scrollTo({ top: pageBottom, behavior: 'smooth' })
      }
    }, 180)
  }

  const getSitePage = (type) => {
    if (POLICY_PAGES[type]) return POLICY_PAGES[type]
    return bloggerPages.find((item) => {
      const title = item.title.toLowerCase()
      if (type === 'about-us') return title.includes('about')
      if (type === 'contact-us') return title.includes('contact')
      return false
    })
  }

  const openSitePage = (type) => {
    setDetail(null)
    setSitePage(type)
    window.history.pushState({}, '', '/' + type)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleBottomTab = (tab) => {
    if (tab === 'home') goHome()
    if (tab === 'local') {
      // Nearby Offers always returns to the main page and opens the nearby
      // location input, without changing the existing location/search logic.
      detailRef.current = null
      setDetail(null)
      setSitePage(null)
      setSearchOpen(false)
      setLocationPickerOpen(true)
      setActiveTab('local')
      if (window.location.pathname !== '/' || window.location.search) {
        window.history.pushState({}, '', '/')
      }
      window.setTimeout(() => {
        const nearbySection = document.getElementById('nearby')
        const nearbyInput = nearbySection?.querySelector('.ohk-nearby-search-row input')
        nearbySection?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        if (nearbyInput) {
          nearbyInput.focus({ preventScroll: true })
        }
      }, 120)
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

  const detailOhk = detail ? parseOhk(detail.rawContent || '') : null
  const detailImages = detail
    ? (detailOhk.has ? detailOhk.banner.map((url) => highResImage(url)) : extractPostImages(detail.image, detail.rawContent || ''))
    : []
  const detailVideos = detail
    ? extractPostVideos(detailOhk.has ? (extractOhkBlocks(detail.rawContent || '').BANNER || '') : (detail.rawContent || ''))
    : []
  const detailMapLinks = detail
    ? (detailOhk.has
        ? (detailOhk.map ? [{ url: detailOhk.map, label: 'Offer location' }] : [])
        : extractMapLinks(detail.rawContent || ''))
    : []
  useEffect(() => {
    let cancelled = false
    const shortLinks = detailMapLinks.filter((link) => /maps\.app\.goo\.gl|goo\.gl\/maps/i.test(link.url))
    if (!shortLinks.length) {
      setResolvedMapCoordinates({})
      return () => { cancelled = true }
    }
    setResolvedMapCoordinates({})
    shortLinks.forEach(async (link) => {
      try {
        // Resolve Google Maps short links through a CORS-readable redirect fetch.
        // If the final Google Maps HTML exposes coordinates, embed those coordinates
        // instead of asking Google Maps to search for the short URL as text.
        const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(link.url)
        const response = await fetch(proxyUrl)
        if (!response.ok) return
        const html = await response.text()
        const coordinates = extractCoordinates(html)
        if (!cancelled && coordinates) {
          setResolvedMapCoordinates((current) => ({ ...current, [link.url]: coordinates }))
        }
      } catch {
        // Keep the existing map-link fallback if short-link resolution is unavailable.
      }
    })
    return () => { cancelled = true }
  }, [detail?.id, detailMapLinks.map((link) => link.url).join('|')])
  const detailAddress = detail ? extractPostAddress(detail.rawContent || '') : ''
  const detailMedia = [...detailImages.map((url) => ({ type: 'image', url })), ...detailVideos.map((video) => ({ type: 'video', url: video.url, videoType: video.type }))]
  const selectedDetailMedia = detailMedia[detailImageIndex] || detailMedia[0] || null
  const detailVerified = (detail?.labels || []).some((label) => String(label).trim().toLowerCase() === 'verified')
  const detailExpiry = detail ? getExpiryLabel(detail) : ''
  const detailDistanceKm = detail?.nearbyDistanceKm ?? (userLocation && detail?.coordinates ? distanceKm(userLocation, detail.coordinates) : null)
  const detailPublicTags = (detail?.labels || []).filter((label) => {
    const normalized = String(label).trim().toLowerCase()
    return normalized !== 'verified' && normalized !== 'expired' && !isExpiryControlLabel(normalized)
  })

  const detailProductPages = []
  if (detailOhk && detailOhk.has) {
    for (let i = 0; i < detailOhk.products.length; i += 8) detailProductPages.push(detailOhk.products.slice(i, i + 8))
  }

  const detailFacts = detail ? buildDetailFacts(detail, detailDistanceKm) : []

  const renderFeedItems = (items, cardProps, prefix) => {
    const elements = []
    items.forEach((post, index) => {
      elements.push(
        <OfferCard
          key={prefix + '-post-' + post.id}
          post={post}
          {...cardProps}
          imagePriority={index === 0 && (prefix === 'main-feed' || prefix === 'nearby')}
          saved={Boolean(cardProps.saved?.[post.id])}
        />
      )
      const count = index + 1
      if (isPhoneAdLayout && count % 6 === 0 && count < items.length) {
        elements.push(
          <div key={prefix + '-mobile-ad-' + count} className="ohk-ad-feed-wrap ohk-ad-feed-mobile" aria-label="Advertisement">
            <AdSenseUnit slot="7436850854" kind="in-feed" />
          </div>
        )
      } else if (!isPhoneAdLayout && count % 9 === 0 && count < items.length) {
        elements.push(
          <div key={prefix + '-desktop-ad-' + count} className="ohk-ad-feed-wrap ohk-ad-feed-desktop" aria-label="Advertisement">
            <AdSenseUnit slot="7436850854" kind="in-feed" />
          </div>
        )
      }
    })
    return elements
  }

  return (
    <div className={`ohk-app ${dark ? 'ohk-dark' : ''}`}>
      {/* Desktop-only side display ads; hidden on phones and tablets. */}
      <aside className="ohk-ad-rail ohk-ad-rail-left" data-ad-placement="left" aria-label="Advertisement">
        <AdSenseUnit slot="5188401932" kind="display" />
      </aside>
      <aside className="ohk-ad-rail ohk-ad-rail-right" data-ad-placement="right" aria-label="Advertisement">
        <AdSenseUnit slot="5188401932" kind="display" />
      </aside>
      {(preloaderVisible || locationSearchPreloaderVisible) ? (
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
            <img src={dark ? darkLogoImage : logoImage} alt="Offerhaikya" />
          </button>

          <div className="ohk-header-dropdowns">
            <div className={`ohk-header-dropdown${desktopCategoryDismissed ? " is-dismissed" : ""}`} onMouseLeave={() => setDesktopCategoryDismissed(false)}>
              <button className="ohk-header-dropdown-button">
                <Icon name="tag" size={16} /> Categories
              </button>
              <div className="ohk-header-dropdown-menu ohk-category-mega-menu" style={desktopCategoryDismissed ? { display: 'none' } : undefined}>
                {categoryGroups.map((group) => (
                  <div className="ohk-category-mega-group" key={group.title}>
                    <strong>{group.title}</strong>
                    {group.tags.map((tag) => (
                      <button key={tag} onClick={(event) => { selectTag(tag); setDesktopCategoryOpen(false); setDesktopCategoryDismissed(true); event.currentTarget.blur() }}>{String(tag).replace(/imp$/i, '').trim()}</button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="ohk-header-dropdown-button ohk-header-coupons-button"
              onClick={() => document.getElementById('ohk-coupons-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              Coupons
            </button>
          </div>

          <div className="ohk-header-page-links">
            <span className="ohk-header-separator" aria-hidden="true" />
            <button onClick={() => openSitePage('about-us')}>About Us</button>
            <button onClick={() => openSitePage('contact-us')}>Contact Us</button>
          </div>

          <div className="ohk-header-actions">
            <button className="ohk-header-button" onClick={openAllMap} aria-label="Offers map" title="Offers map">
              <Icon name="map" size={21} />
            </button>

            <button className="ohk-header-button" onClick={() => setDark((value) => !value)} aria-label="Dark mode">
              {dark ? '☀' : <Icon name="moon" size={21} />}
            </button>

            <button className="ohk-header-button ohk-badge-button" onClick={() => setNotificationsOpen(true)} aria-label="Notifications">
              <Icon name="bell" size={21} />
              {notifications.length ? <span>{notifications.length > 99 ? '99+' : notifications.length}</span> : null}
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
              <button
                type="button"
                className="ohk-category-toggle"
                aria-expanded={categoryOpen}
                onClick={() => setCategoryOpen((open) => !open)}
              >
                Categories <span>{categoryOpen ? '−' : '+'}</span>
              </button>
              {categoryOpen ? (
                <>
                  {categoryGroups.map((group) => (
                    <div className="ohk-side-category-group" key={group.title}>
                      <strong>{group.title}</strong>
                      {group.tags.map((tag) => (
                        <button key={tag} onClick={() => { selectTag(tag); setMenuOpen(false) }}>{String(tag).replace(/imp$/i, '').trim()}</button>
                      ))}
                    </div>
                  ))}
                  <div className="ohk-side-category-group">
                    <strong>More</strong>
                    <button type="button" onClick={() => {
                      setMenuOpen(false)
                      setCategoryOpen(false)
                      window.setTimeout(() => document.getElementById('ohk-coupons-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
                    }}>Coupons</button>
                  </div>
                </>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      <main>
        {detail ? (
          <section className="ohk-detail-page">
            <div className="ohk-detail-page-inner">
              <button className="ohk-page-back" onClick={goHome}>← Back</button>

              <div className="ohk-detail-status-row" aria-label="Offer status">
                {detailVerified ? (
                  <span className="ohk-detail-status ohk-detail-status-verified">
                    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 1.5 12.3 3l2.8-.1 1 2.6 2.2 1.7-.8 2.7.8 2.7-2.2 1.7-1 2.6-2.8-.1L10 18.5l-2.3-1.7-2.8.1-1-2.6-2.2-1.7.8-2.7-.8-2.7 2.2-1.7 1-2.6 2.8.1Z" fill="currentColor" /><path d="m6.2 10.2 2.4 2.4 5.2-5.2" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Verified
                  </span>
                ) : null}
                {detailExpiry ? (
                  <span className={`ohk-detail-status ${detailExpiry === 'Expired' ? 'ohk-detail-status-expired' : 'ohk-detail-status-expiry'}`}>
                    {detailExpiry === 'Expired' ? 'Expired' : detailExpiry}
                  </span>
                ) : null}
                {Number.isFinite(detailDistanceKm) ? (
                  <span className="ohk-detail-status ohk-detail-status-distance">
                    <Icon name="location" size={14} /> {formatDistance(detailDistanceKm)} away
                  </span>
                ) : null}
                <div className="ohk-detail-content-actions ohk-detail-status-actions">
                  <button onClick={() => toggleSave(detail.id)} aria-label={saved[detail.id] ? 'Unsave offer' : 'Save offer'} aria-pressed={Boolean(saved[detail.id])} title={saved[detail.id] ? 'Unsave offer' : 'Save offer'}><svg className="ohk-heart-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" fill={saved[detail.id] ? '#e53935' : 'none'} stroke="#e53935" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
                  <button onClick={() => sharePost(detail)} aria-label="Share offer"><Icon name="share" size={19} /></button>
                </div>
              </div>

              {detailMedia.length ? (
                <div className={`ohk-detail-gallery ${detailMedia.length > 1 ? 'has-thumbnails' : 'single-image'}`}>
                  {detailMedia.length > 1 ? (
                    <div ref={detailThumbnailsRef} className="ohk-detail-thumbnails" aria-label="Offer photos and videos">
                      {detailMedia.map((media, index) => (
                        <button
                          key={media.url}
                          type="button"
                          className={index === detailImageIndex ? 'active' : ''}
                          aria-label={media.type === 'video' ? `Play offer video ${index + 1}` : `Show offer image ${index + 1}`}
                          aria-pressed={index === detailImageIndex}
                          onClick={() => {
                            setDetailImageIndex(index)
                            const thumbnails = detailThumbnailsRef.current
                            if (thumbnails && thumbnails.scrollHeight > thumbnails.clientHeight) {
                              thumbnails.scrollBy({ top: 87, behavior: 'smooth' })
                            }
                          }}
                        >
                          {media.type === 'image' ? (
                            <img src={media.url} alt={`${detail.title || 'Offer'} image ${index + 1}`} loading="lazy" />
                          ) : (
                            <span className="ohk-detail-video-thumbnail" aria-hidden="true"><span>▶</span><small>VIDEO</small></span>
                          )}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="ohk-detail-main-image">
                    {selectedDetailMedia?.type === 'image' ? (
                      <img
                        className="ohk-detail-featured-image"
                        src={selectedDetailMedia.url}
                        alt={detail.title || 'Offer image'}
                        role="button"
                        tabIndex={0}
                        aria-label="Open offer image full screen and zoom"
                        onClick={() => { resetImageViewer(); setImageViewerOpen(true) }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            resetImageViewer()
                            setImageViewerOpen(true)
                          }
                        }}
                        onError={(event) => { event.currentTarget.style.visibility = 'hidden' }}
                      />
                    ) : selectedDetailMedia?.type === 'video' ? (
                      <div className="ohk-detail-video">
                        {selectedDetailMedia.type === 'video' && selectedDetailMedia.url ? (
                          selectedDetailMedia.videoType === 'embed' ? (
                            <iframe
                              src={selectedDetailMedia.url}
                              title={`${detail.title || 'Offer'} video`}
                              loading="lazy"
                              referrerPolicy="strict-origin-when-cross-origin"
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                              allowFullScreen
                            />
                          ) : (
                            <video controls playsInline preload="metadata">
                              <source src={selectedDetailMedia.url} />
                              Your browser does not support embedded video.
                            </video>
                          )
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {detailPublicTags.length > 0 ? (
                <div className="ohk-detail-tags" aria-label="Tags for this offer">
                  {detailPublicTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        setDetailTagFilter(String(tag).replace(/imp$/i, '').trim())
                        document.getElementById('detail-related')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }}
                    >
                      {String(tag).replace(/imp$/i, '').trim()}
                    </button>
                  ))}
                </div>
              ) : null}

                              <section className="ohk-dp-card ohk-dp-titlebox" aria-label="Offer summary">
                <h1 className="ohk-detail-title">{detail.title || 'Offer'}</h1>
                {(detailOhk.has ? detailOhk.intro : [detail.searchDescription || detail.excerpt].filter(Boolean)).map((line, index) => (
                  <p className="ohk-dp-short" key={index}>{line}</p>
                ))}
              </section>

              {(detailOhk.has ? detailOhk.tiles.length > 0 : detailFacts.length > 0) ? (
                <section className="ohk-dp-card" aria-labelledby="ohk-dp-facts-title">
                  <h2 id="ohk-dp-facts-title" className="ohk-dp-heading">Offer Details</h2>
                  <div className="ohk-dp-tiles">
                    {detailOhk.has
                      ? detailOhk.tiles.map((tile, index) => (
                          <div className="ohk-dp-tile" key={index}>
                            <span className="ohk-dp-tile-icon" aria-hidden="true"><Icon name={TILE_ICONS[tile.kind] || 'tag'} size={20} /></span>
                            <strong>{tile.text}</strong>
                          </div>
                        ))
                      : detailFacts.map((fact) => (
                          <div className="ohk-dp-tile" key={fact.label}>
                            <span className="ohk-dp-tile-icon" aria-hidden="true"><Icon name="tag" size={20} /></span>
                            <strong>{fact.label}: {fact.value}</strong>
                          </div>
                        ))}
                  </div>
                </section>
              ) : null}

                {detailOhk.has && detailOhk.products.length > 0 ? (
                <section className="ohk-dp-card" aria-labelledby="ohk-dp-products-title">
                  <h2 id="ohk-dp-products-title" className="ohk-dp-heading">Our Products</h2>
                  <div className="ohk-dp-slider-wrap">
                    <button
                      type="button"
                      className="ohk-dp-slider-arrow ohk-dp-slider-prev"
                      aria-label="Previous products"
                      onClick={(event) => {
                        const row = event.currentTarget.parentElement.querySelector('.ohk-dp-slider')
                        if (row) row.scrollBy({ left: -row.clientWidth * 0.8, behavior: 'smooth' })
                      }}
                    >‹</button>
                    <div className="ohk-dp-slider">
                      {detailOhk.products.map((product, index) => (
                        <article className="ohk-dp-product" key={index}>
                          {product.image ? (
                            <img src={sizedImage(product.image, 400)} alt={product.name || detail.title} loading="lazy" decoding="async" />
                          ) : (
                            <div className="ohk-dp-product-noimg">Offer</div>
                          )}
                          <div className="ohk-dp-product-body">
                            {product.discount ? <span className="ohk-dp-product-badge">{product.discount}</span> : null}
                            <h3>{product.name}</h3>
                            {product.info ? <p>{product.info}</p> : null}
                            <div className="ohk-dp-product-price">
                              {product.price ? <strong>{product.price}</strong> : null}
                              {product.mrp ? <s>{product.mrp}</s> : null}
                            </div>
                            {product.link ? (
                              <a className="ohk-dp-product-buy" href={product.link} target="_blank" rel="sponsored nofollow noopener noreferrer">{product.buttonText || 'Buy Now'}</a>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="ohk-dp-slider-arrow ohk-dp-slider-next"
                      aria-label="Next products"
                      onClick={(event) => {
                        const row = event.currentTarget.parentElement.querySelector('.ohk-dp-slider')
                        if (row) row.scrollBy({ left: row.clientWidth * 0.8, behavior: 'smooth' })
                      }}
                    >›</button>
                  </div>
                </section>
              ) : null}

                            {(!detailOhk.has || detailOhk.fullInfoHtml.trim()) ? (
                <section className="ohk-dp-card" aria-labelledby="ohk-dp-info-title">
                  <h2 id="ohk-dp-info-title" className="ohk-dp-heading">Full Details</h2>
                  <div
                    className="ohk-detail-html"
                    dangerouslySetInnerHTML={{
                      __html: cleanBloggerDetailHtml(
                        detailOhk.has ? detailOhk.fullInfoHtml : (detail.rawContent || '<p>' + (detail.searchDescription || detail.excerpt) + '</p>'),
                        detail.title
                      )
                    }}
                  />
                </section>
              ) : null}


              {detailOhk.has && detailOhk.offerDetailHtml.trim() ? (
                <section className="ohk-dp-card" aria-labelledby="ohk-dp-offer-title">
                  <h2 id="ohk-dp-offer-title" className="ohk-dp-heading">Full Offers Details</h2>
                  <div
                    className="ohk-detail-html"
                    dangerouslySetInnerHTML={{ __html: cleanBloggerDetailHtml(detailOhk.offerDetailHtml, detail.title) }}
                  />
                </section>
              ) : null}

                            {detailOhk.has && detailOhk.contacts.length > 0 ? (
                <section className="ohk-dp-card" aria-labelledby="ohk-dp-contact-title">
                  <h2 id="ohk-dp-contact-title" className="ohk-dp-heading">Contact details</h2>
                  <div className="ohk-dp-contacts">
                    {detailOhk.contacts.map((contact, index) => (
                      <a
                        className="ohk-dp-contact"
                        key={index}
                        href={contact.link}
                        target={contact.link.startsWith('http') ? '_blank' : undefined}
                        rel="noopener noreferrer"
                      >
                        <span className="ohk-dp-tile-icon" aria-hidden="true"><Icon name={CONTACT_ICONS[contact.type] || 'tag'} size={20} /></span>
                        <span>{contact.label}</span>
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}

              {detailMapLinks.length > 0 ? (
                <section className="ohk-dp-card" aria-labelledby="ohk-dp-map-title">
                  <h2 id="ohk-dp-map-title" className="ohk-dp-heading">Map</h2>
                  <div className="ohk-detail-maps">
                    {detailMapLinks.map((mapLink, index) => (
                      <div className="ohk-detail-map-item" key={mapLink.url || 'offer-map-' + index}>
                        <iframe
                          title={mapLink.label || 'Offer map ' + (index + 1)}
                          src={(() => {
                            const coordinates = (mapLink.url && resolvedMapCoordinates[mapLink.url]) || detail.coordinates || (mapLink.url ? extractCoordinates(mapLink.url) : null)
                            const query = coordinates
                              ? `${coordinates.latitude},${coordinates.longitude}`
                              : detailAddress || detail.bloggerLocation || mapLink.url
                            return `https://www.google.com/maps?q=${encodeURIComponent(query)}&output=embed`
                          })()}
                          loading="lazy"
                          referrerPolicy="no-referrer-when-downgrade"
                          allowFullScreen
                        />
                      </div>
                    ))}
                  </div>
                  {detail.coordinates ? (
                    <a
                      className="ohk-dp-link"
                      href={`https://www.google.com/maps/search/?api=1&query=${detail.coordinates.latitude},${detail.coordinates.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open in Google Maps
                    </a>
                  ) : null}
                </section>
              ) : null}
                
            </div>

            <div className="ohk-detail-ad" aria-label="Advertisement">
              <AdSenseUnit slot="2503861791" kind="in-article" />
            </div>

            <section id="detail-related" className="ohk-detail-related">
              <div className="ohk-detail-related-inner">
                <h2>Search Offers by Tags</h2>
                <div className="ohk-detail-related-search-wrap">
                  <input
                    className="ohk-detail-related-search"
                    value={detailTagFilter}
                    onChange={(event) => setDetailTagFilter(event.target.value)}
                    placeholder="Search offers or select a tag above..."
                    aria-label="Search related offers"
                  />
                  {detailTagFilter ? <button type="button" className="ohk-search-clear ohk-detail-related-clear" aria-label="Clear tag search" onClick={() => setDetailTagFilter('')}><Icon name="close" size={17} /></button> : null}
                </div>
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
            <div className="ohk-hero-small">LOCAL OFFERS • ONLINE DEALS • COUPONS</div>
            <h1>Aaj Koi Offer Hai Kya?</h1>
            <p className="ohk-hero-subtitle">Haan! Yahin Search Karo.</p>

            <form className="ohk-search-box" onSubmit={(event) => { event.preventDefault(); setVisible(PAGE_SIZE); setSearchOpen(false) }}>
              <Icon name="search" size={22} />
              <input
                className="ohk-main-search-input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search offers..."
                aria-label="Search offers"
              />
              {query ? <button type="button" className="ohk-search-clear" aria-label="Clear search" onClick={() => setQuery('')}><Icon name="close" size={17} /></button> : null}
              <button type="submit">GO</button>
              {query.trim() ? (
                <div className="ohk-search-suggestions">
                  {searchSuggestions.length ? searchSuggestions.map((post) => (
                    <button type="button" className="ohk-search-suggestion" key={post.id} onClick={() => openPost(post)}>
                      {post.image ? <img src={sizedImage(post.image, 160)} alt={post.title || 'Offer image'} loading="lazy" decoding="async" /> : <span className="ohk-search-suggestion-image">Offer</span>}
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
            {query ? <button type="button" className="ohk-search-clear" aria-label="Clear search" onClick={() => setQuery('')}><Icon name="close" size={17} /></button> : null}
            <button type="button" className="ohk-mobile-search-go" onClick={() => { setVisible(PAGE_SIZE); setSearchOpen(false) }}>GO</button>
            <button type="button" aria-label="Close search" onClick={() => setSearchOpen(false)}><Icon name="close" size={20} /></button>
          </div>
        ) : null}

        <section className="ohk-content">
          {userLocation ? (
            <section id="nearby" className="ohk-section">
              <div className="ohk-section-title">
                <h2>Nearby Offer{locationLabel ? ` - ${locationLabel}` : ''} (Total {nearbyPosts.length})</h2>
                <div className="ohk-nearby-actions">
                  <button className="ohk-add-location-button" onClick={() => setLocationPickerOpen((value) => !value)}><Icon name="edit" size={15} /><span>{locationPickerOpen ? 'Close' : 'Edit Location'}</span></button>
                  <button type="button" onClick={openNearbyMap}><Icon name="map" size={15} /><span>Offers Map</span></button>
                </div>
              </div>

              {locationPickerOpen ? (
                <div className="ohk-nearby-prompt ohk-nearby-results-search">
                  <div className="ohk-location-autocomplete ohk-nearby-search-row">
                  <Icon name="location" size={18} />
                  <input
                    autoFocus
                    value={locationQuery}
                    onChange={(event) => { setLocationQuery(event.target.value); setLocationSuggestionsOpen(true) }}
                    onFocus={() => locationSuggestions.length && setLocationSuggestionsOpen(true)}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); useTypedLocationFallback() } }}
                    placeholder="Enter City, Town or State"
                    aria-label="Search location"
                  />
                  {locationQuery ? <button className="ohk-search-clear ohk-location-clear" type="button" aria-label="Clear location search" onClick={() => { setLocationQuery(''); setLocationSuggestionsOpen(false) }}><Icon name="close" size={17} /></button> : null}
                  <button className="ohk-nearby-search-button" type="button" onClick={useTypedLocationFallback}>GO</button>
                  <button className="ohk-nearby-map-button" type="button" onClick={openAllMap}>
                    <Icon name="map" size={18} /><span>View Offers Map</span>
                  </button>
                  <button className="ohk-nearby-find-button" type="button" onClick={requestLocation} disabled={locationLoading}>
                    <Icon name="location" size={18} />
                    <span>{locationLoading ? 'Checking...' : 'Set Current Location'}</span>
                  </button>
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
                </div>
              ) : null}

              {nearbyPosts.length ? (
                <>
                  <div className="ohk-grid">
                    {renderFeedItems(nearbyPosts.slice(0, nearbyVisible), { saved, onSave: toggleSave, onOpen: openPost, onOpenDistance: openPostDistance, onShare: sharePost, onMap: openMapForPost, dark, nearby: true }, 'nearby')}
                  </div>
                  {nearbyVisible < nearbyPosts.length ? (
                    <div className="ohk-load-more"><button onClick={() => setNearbyVisible((value) => value + PAGE_SIZE)}>Load More Nearby Offers</button></div>
                  ) : null}
                </>
              ) : (
                <div className="ohk-empty">No Offers Found Nearby/Entered Location</div>
              )}
            </section>
          ) : (
            <section id="nearby" className="ohk-nearby-prompt">
              <div className="ohk-nearby-prompt-copy">
                <strong>See offers near you</strong>
                <span>Allow location to find local offers within {NEARBY_RADIUS_KM} km, or add a place manually.</span>
                <div className="ohk-location-autocomplete ohk-nearby-search-row">
                  <Icon name="location" size={18} />
                  <input
                    value={locationQuery}
                    onChange={(event) => { setLocationQuery(event.target.value); setLocationSuggestionsOpen(true) }}
                    onFocus={() => locationSuggestions.length && setLocationSuggestionsOpen(true)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        useTypedLocationFallback()
                      }
                    }}
                    placeholder="Enter City, Town or State"
                    aria-label="Search location"
                  />
                  {locationQuery ? <button className="ohk-search-clear ohk-location-clear" type="button" aria-label="Clear location search" onClick={() => { setLocationQuery(''); setLocationSuggestionsOpen(false) }}><Icon name="close" size={17} /></button> : null}
                  <button className="ohk-nearby-search-button" type="button" onClick={useTypedLocationFallback}>GO</button>
                  <button className="ohk-nearby-map-button" type="button" onClick={openAllMap}>
                    <Icon name="map" size={18} /><span>View Offers Map</span>
                  </button>
                  <button className="ohk-nearby-find-button" type="button" onClick={requestLocation} disabled={locationLoading}>
                    <Icon name="location" size={18} />
                    <span>{locationLoading ? 'Checking...' : 'Set Current Location'}</span>
                  </button>
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
              </div>
            </section>
          )}

          <section id="deals" className="ohk-section">
            <div className="ohk-section-title ohk-section-banner" style={{ backgroundImage: "linear-gradient(90deg, rgba(0,0,0,.72), rgba(0,0,0,.18)), url(" + bgImage + ")" }}>
              <h2>{query ? `Search: ${query}` : activeLabel !== 'All' ? String(activeLabel).replace(/imp$/i, '').trim() : 'Latest Offers'}</h2>
              <span>{filteredPosts.length} offers</span>
            </div>

            {loading ? (
              <div className="ohk-state">Loading latest offers...</div>
            ) : displayedPosts.length ? (
              <>
                <div className="ohk-grid">
                  {renderFeedItems(displayedPosts, { saved, onSave: toggleSave, onOpen: openPost, onShare: sharePost, onMap: openMapForPost, dark }, 'main-feed')}
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

          <CouponsSection dark={dark} posts={posts} couponSource={couponSource} />

          <section className="ohk-faq-section" aria-labelledby="ohk-faq-heading">
            <div className="ohk-faq-intro">
              <h2 id="ohk-faq-heading">Frequently Asked Questions</h2>
              <p>Quick answers about today’s deals, shopping offers and nearby stores.</p>
            </div>
            <div className="ohk-faq-list">
              {HOME_FAQS.map((faq) => (
                <details className="ohk-faq-item" key={faq.question}>
                  <summary>{faq.question}</summary>
                  <p>{faq.answer}</p>
                  {faq.links?.length ? (
                    <div className="ohk-faq-links">
                      {faq.links.map((link) => (
                        <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer">{link.label} <span aria-hidden="true">↗</span></a>
                      ))}
                    </div>
                  ) : null}
                </details>
              ))}
            </div>
          </section>

        </section>
        </div>
        )}
      </main>

      <footer className="ohk-footer">
        <strong className="ohk-brand-wordmark"><span>Offer</span><span>haikya</span></strong>
        <span>Fresh offers. Simple browsing.</span>
                <div className="ohk-footer-links">
          {[
            ['about-us', 'About Us'],
            ['contact-us', 'Contact Us'],
            ['privacy-policy', 'Privacy Policy'],
            ['terms-and-condition', 'Terms & Conditions'],
          ].map(([page, label]) => (
            <a
              key={page}
              href={'/' + page}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
                event.preventDefault()
                openSitePage(page)
              }}
            >
              {label}
            </a>
          ))}
        </div>
        <div className="ohk-social-links" aria-label="Follow Offerhaikya on social media">
          {[
            ['YouTube', 'youtube', 'https://www.youtube.com/@offerhaikya'],
            ['Instagram', 'instagram', 'https://www.instagram.com/offerhaikya/'],
            ['Facebook', 'facebook', 'https://www.facebook.com/offerhaikya'],
            ['X', 'x', 'https://x.com/offerhaikya'],
            ['LinkedIn', 'linkedin', 'https://www.linkedin.com/in/offerhaikya/'],
          ].map(([label, icon, url]) => (
            <a key={label} href={url} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
              <Icon name={icon} size={19} />
            </a>
          ))}
        </div>
      </footer>

      <nav className="ohk-bottom-nav">
        {[
          ['request', 'mail', 'Request Offer'],
          ['hot', null, 'Hot Offers'],
          ['home', 'home', 'Home'],
          ['local', 'location', 'Nearby Offers'],
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
                {[
                  { type: 'new', title: 'TOP 10 — NEW POSTS' },
                  { type: 'updated', title: 'UPDATED POSTS' },
                ].map((section) => {
                  const sectionItems = notifications.filter((item) =>
                    section.type === 'updated' ? item.notificationType === 'updated' : item.notificationType !== 'updated'
                  )
                  if (!sectionItems.length) return null
                  return (
                    <div key={section.type}>
                      <h3 style={{ margin: '12px 14px 8px', fontSize: '13px', fontWeight: 800, letterSpacing: '0.04em' }}>
                        {section.title}
                      </h3>
                      {sectionItems.map((item) => {
                        const versionKey = notificationVersionKey(item)
                        const dismissItem = (event) => {
                          event?.stopPropagation?.()
                          const seen = new Set(JSON.parse(localStorage.getItem('offerhaikya_notification_seen') || '[]'))
                          // Dismiss this notification version only. If the post is updated again
                          // after dismissal, its new version may appear as a fresh notification.
                          seen.add(versionKey)
                          try { localStorage.setItem('offerhaikya_notification_seen', JSON.stringify([...seen])) } catch {}
                          setNotifications((current) => {
                            const next = current.filter((post) => notificationVersionKey(post) !== versionKey)
                            try { localStorage.setItem('offerhaikya_notifications', JSON.stringify(next)) } catch {}
                            return next
                          })
                        }
                        return (
                          <div className="ohk-favorite-item" key={versionKey}>
                            <button className="ohk-favorite-item-main" onClick={() => {
                              dismissItem()
                              setNotificationsOpen(false)
                              openPost(item)
                            }}>
                              {item.image ? <img src={item.image} alt={item.title || 'Offer image'} /> : <div className="ohk-favorite-item-image">Offer</div>}
                              <span>{item.title}</span>
                            </button>
                            <button className="ohk-favorite-remove" aria-label="Dismiss notification" onClick={dismissItem}>×</button>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
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
                      {item.image ? <img src={item.image} alt={item.title || 'Offer image'} /> : <div className="ohk-favorite-item-image">Offer</div>}
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
        <div className="ohk-modal-backdrop ohk-location-backdrop" onClick={() => setLocationPromptOpen(false)}>
          <div className="ohk-modal ohk-location-modal" role="dialog" aria-modal="true" aria-labelledby="ohk-location-modal-title" onClick={(event) => event.stopPropagation()}>
            <div className="ohk-location-modal-icon"><Icon name="location" size={28} /></div>
            <div className="ohk-modal-head">
              <h2 id="ohk-location-modal-title">Find Nearby Offers</h2>
            </div>
            <p className="ohk-registration-intro">Allow location access to find local offers within {NEARBY_RADIUS_KM} km. You can also enter a city or area manually.</p>
            <button type="button" className="ohk-primary-button ohk-location-allow-button" onClick={() => { setLocationPromptOpen(false); requestLocation() }}><Icon name="location" size={18} /> Allow Location</button>
            <button type="button" className="ohk-secondary-button ohk-location-later-button" onClick={() => setLocationPromptOpen(false)}>Maybe Later</button>
            {locationMessage ? <span className="ohk-location-message">{locationMessage}</span> : null}
          </div>
        </div>
      ) : null}

      {profileOpen ? (
        <div className={`ohk-modal-backdrop ${authUser && !profileDocExists ? 'ohk-profile-required-backdrop' : ''}`} onClick={() => {
          if (!authUser || profileDocExists) setProfileOpen(false)
        }}>
          <div className="ohk-modal ohk-profile-modal" role="dialog" aria-modal="true" aria-labelledby="ohk-profile-title" onClick={(event) => event.stopPropagation()}>
            <div className="ohk-modal-head">
              <h2 id="ohk-profile-title">{authUser && !profileDocExists ? 'Complete your profile' : 'Profile'}</h2>
              {(!authUser || profileDocExists) ? (
                <button onClick={() => setProfileOpen(false)} aria-label="Close profile"><Icon name="close" /></button>
              ) : null}
            </div>

            {authLoading ? (
              <p className="ohk-registration-intro">Checking your sign-in status…</p>
            ) : !authUser ? (
              <>
                <p className="ohk-registration-intro">Sign in with Google to create your Offerhaikya profile and save the offer categories you care about.</p>
                <button type="button" className="ohk-primary-button ohk-google-signin-button" onClick={handleGoogleSignIn} disabled={authBusy}>
                  <strong className="ohk-google-mark" aria-hidden="true">G</strong>
                  {authBusy ? 'Connecting to Google…' : 'Continue with Google'}
                </button>
              </>
            ) : (
              <>
                <div className="ohk-profile-identity">
                  {authUser.photoURL ? <img src={authUser.photoURL} alt="" /> : <span className="ohk-profile-avatar"><Icon name="user" size={22} /></span>}
                  <div>
                    <strong>{authUser.displayName || 'Offerhaikya user'}</strong>
                    <span>{authUser.email}</span>
                  </div>
                </div>
                <p className="ohk-registration-intro">
                  {profileDocExists
                    ? 'Update your interests below. Choose at least one category to save your profile.'
                    : 'Choose at least one category to complete registration. You cannot finish sign-up without selecting a category.'}
                </p>
                <label className="ohk-profile-field-label" htmlFor="ohk-profile-phone">Phone number (optional)</label>
                <input
                  id="ohk-profile-phone"
                  className="ohk-profile-phone"
                  type="tel"
                  autoComplete="tel"
                  value={profilePhone}
                  onChange={(event) => setProfilePhone(event.target.value)}
                  placeholder="Enter phone number (optional)"
                />
                <div className="ohk-profile-category-heading">
                  <strong>Choose your offer categories <span aria-hidden="true">*</span></strong>
                  <small>Select one or more</small>
                </div>
                {profileCategoryOptions.length ? (
                  <div className="ohk-profile-category-list">
                    {profileCategoryOptions.map((category) => (
                      <label className="ohk-profile-category-option" key={category}>
                        <input
                          type="checkbox"
                          checked={profileCategories.includes(category)}
                          onChange={(event) => {
                            setProfileCategories((current) => event.target.checked
                              ? [...new Set([...current, category])]
                              : current.filter((item) => item !== category))
                            setProfileError('')
                          }}
                        />
                        <span>{category}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="ohk-registration-intro">Offer categories are loading from Blogger. Please wait a moment and try again.</p>
                )}
                {profileError ? <p className="ohk-profile-error" role="alert">{profileError}</p> : null}
                <button
                  type="button"
                  className="ohk-primary-button"
                  onClick={handleSaveProfile}
                  disabled={authBusy || profileCategories.length === 0 || profileCategoryOptions.length === 0}
                >
                  {authBusy ? 'Saving profile…' : profileDocExists ? 'Save profile' : 'Complete registration'}
                </button>
                {profileDocExists ? (
                  <button type="button" className="ohk-secondary-button ohk-profile-signout" onClick={handleGoogleSignOut} disabled={authBusy}>Sign out</button>
                ) : null}
              </>
            )}
            {profileError && !authUser ? <p className="ohk-profile-error" role="alert">{profileError}</p> : null}
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
              <h2>Request Offer</h2>
              <button onClick={() => setRequestOpen(false)} aria-label="Close request message"><Icon name="close" /></button>
            </div>
            <div className="ohk-request-coming-soon">
              <div className="ohk-request-coming-soon-icon"><Icon name="mail" size={30} /></div>
              <h3>We're Working on It!</h3>
              <p>Our Request Offer feature is getting ready. We're working to make it easier for you to request the offers you want.</p>
              <p className="ohk-request-thanks">Thank you for your patience and support!</p>
              <span className="ohk-request-coming-soon-label">Coming Soon</span>
            </div>
            <div hidden>
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
        </div>
      ) : null}

      {mapOpen ? (
        <Suspense fallback={<div role="status">Loading offers map…</div>}>
          <OffersMap
            focusPostId={mapFocusId}
            posts={mapPosts}
            userLocation={userLocation}
            onRequestLocation={requestLocation}
            onOpenPost={(post) => { setMapOpen(false); openPost(post) }}
            onClose={() => setMapOpen(false)}
          />
        </Suspense>
      ) : null}

      {imageViewerOpen && selectedDetailMedia?.type === 'image' ? (
        <div className="ohk-image-viewer" role="dialog" aria-modal="true" aria-label="Offer image viewer" onClick={(event) => {
          if (event.target === event.currentTarget) closeImageViewer()
        }}>
          <button type="button" className="ohk-image-viewer-close" onClick={closeImageViewer} aria-label="Close enlarged image">×</button>
          <div className="ohk-image-viewer-controls" aria-label="Image zoom controls">
            <button type="button" onClick={() => changeImageViewerZoom(imageViewerZoom - 0.5)} disabled={imageViewerZoom <= 1} aria-label="Zoom out">−</button>
            <span>{Math.round(imageViewerZoom * 100)}%</span>
            <button type="button" onClick={() => changeImageViewerZoom(imageViewerZoom + 0.5)} disabled={imageViewerZoom >= 5} aria-label="Zoom in">+</button>
            <button type="button" onClick={resetImageViewer} aria-label="Reset zoom">Reset</button>
          </div>
          <div className="ohk-image-viewer-stage">
            <img
              className="ohk-image-viewer-image"
              src={selectedDetailMedia.url}
              alt={detail?.title || 'Enlarged offer image'}
              draggable="false"
              style={{ transform: `translate(${imageViewerPan.x}px, ${imageViewerPan.y}px) scale(${imageViewerZoom})` }}
              onPointerDown={imageViewerPointerDown}
              onPointerMove={imageViewerPointerMove}
              onPointerUp={imageViewerPointerUp}
              onPointerCancel={imageViewerPointerUp}
              onWheel={(event) => {
                event.preventDefault()
                changeImageViewerZoom(imageViewerZoom + (event.deltaY < 0 ? 0.25 : -0.25))
              }}
              onDoubleClick={() => changeImageViewerZoom(imageViewerZoom > 1 ? 1 : 2)}
              onError={(event) => { event.currentTarget.style.visibility = 'hidden' }}
            />
          </div>
          <p className="ohk-image-viewer-hint">Pinch or use + / − to zoom · Drag to explore · Double-click to zoom</p>
        </div>
      ) : null}
    </div>
  )
}

export default App
