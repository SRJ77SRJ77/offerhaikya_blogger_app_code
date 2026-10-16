import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import logoImage from './assets/logo.png'
import preloaderGif from './assets/Offer.gif'
import bgImage from './assets/bg.jpg'
import OffersMap from './OffersMap.jsx'

const BLOG_URL = 'https://offerhaikya.blogspot.com'
const FEED_URL = BLOG_URL + '/feeds/posts/default?alt=json&max-results=500'
const ACCENT = '#ff5b01'
const PAGE = '#f3f4f6'
const WHITE = '#ffffff'
const TEXT = '#202124'
const MUTED = '#77747a'
const NEARBY_RADIUS_KM = 300
const PAGE_SIZE = 20
const LOGO_URL = logoImage


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
    .replace(/\/s\d+(-c)?\//i, target)
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
  const suffix = isHome ? ' | Offerhaikya' : ' | Offerhaikya'
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
  const rawTitle = post?.title || 'Offerhaikya | Online Deals, Local Offers and Shopping Offers'
  const title = seoTitle(rawTitle, !post)
  const rawDescription = post?.searchDescription || post?.excerpt || 'Discover online deals, local offers, shopping discounts and useful offers on Offerhaikya.'
  const description = seoDescription(rawDescription)
  const url = post?.title
    ? window.location.origin + '/offer/' + encodeURIComponent(offerSlugFromTitle(post.title))
    : window.location.origin + '/'
  const image = new URL(post?.image || LOGO_URL, window.location.origin).href
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
    '@type': 'WebSite',
    name: 'Offerhaikya',
    url: window.location.origin + '/'
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
      searchDescription: stripHtml(entry?.summary?.$t || '').slice(0, 300),
      url: alternate,
      date: entry?.published?.$t
        ? new Date(entry.published.$t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : '',
      publishedAt: entry?.published?.$t || '',
      updatedAt: entry?.updated?.$t || entry?.published?.$t || '',
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

function getExpiryLabel(post) {
  const labels = (post.labels || []).map((label) => label.trim().toLowerCase())
  // An explicit Blogger "Expired" label always shows the Expired badge.
  if (labels.includes('expired')) return 'Expired'

  // E<number> means days (E1 = 24 hours); EY<number> means years (EY1 = 365 days, EY2 = 730 days).
  const expiryTag = (post.labels || []).find((label) => /^(?:E\d+|EY\d+)$/i.test(label.trim()))
  // Use Blogger's last-updated timestamp so editing a listing starts its expiry window again.
  const expiryBase = post.updatedAt || post.publishedAt
  if (!expiryTag || !expiryBase) return ''

  const tag = expiryTag.trim().toUpperCase()
  const isYearTag = /^EY\d+$/.test(tag)
  const duration = Number(tag.slice(isYearTag ? 2 : 1))
  if (!Number.isFinite(duration) || duration <= 0) return ''

  const durationDays = isYearTag ? duration * 365 : duration
  const expiryTime = new Date(expiryBase).getTime() + durationDays * 24 * 60 * 60 * 1000
  const remainingMs = expiryTime - Date.now()

  if (remainingMs <= 0) return 'Expired'

  const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000))
  const expiryDate = new Date(expiryTime)
  const expiryYear = expiryDate.getFullYear()
  const expiryDateTimeLabel = expiryDate.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    hour12: true,
  }).replace(/\\b(am|pm)\\b/i, (period) => period.toUpperCase())

  // Always show the exact expiry date and time.
  return `Expires on ${expiryDateTimeLabel}`
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
    map: <><path d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z" /><path d="M9 4v13.5M15 6.5V20" /></>,
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

    if (!document.querySelector('script[data-ohk-adsense="true"]')) {
      const script = document.createElement('script')
      script.async = true
      script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-2974987879547173'
      script.crossOrigin = 'anonymous'
      script.dataset.ohkAdsense = 'true'
      document.head.appendChild(script)
    }

    const initializeAd = () => {
      if (!ad.isConnected || ad.offsetParent === null || ad.dataset.ohkAdInitialized === 'true') return
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({})
        ad.dataset.ohkAdInitialized = 'true'
      } catch (error) {
        console.warn('Offerhaikya AdSense ad could not initialize.', error)
      }
    }

    initializeAd()
    window.addEventListener('resize', initializeAd)
    return () => window.removeEventListener('resize', initializeAd)
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

function OfferCard({ post, saved, onSave, onOpen, onOpenDistance, onShare, onMap, dark, nearby, imagePriority = false }) {
  const expiry = getExpiryLabel(post)
  const offerPercent = getOfferPercent(post)

  return (
    <article className={`ohk-card ${dark ? 'ohk-card-dark' : ''} ${expiry === 'Expired' ? 'ohk-card-expired-locked' : ''}`}>
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
            stroke="#e53935"
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

      {nearby ? (
        <div
          className="ohk-card-distance"
          aria-label={`Distance: ${formatDistance(post.nearbyDistanceKm)}`}
        >
          <Icon name="location" size={12} />
          {formatDistance(post.nearbyDistanceKm)}
        </div>
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
            src={sizedImage(post.image, 480)}
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
            <span className="ohk-card-label">{post.label}</span>
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
          </div>
        </div>
      </a>
    </article>
  )
}

function App() {
  const [posts, setPosts] = useState([])
  const detailRef = useRef(null)

  const [isPhoneAdLayout, setIsPhoneAdLayout] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)')
    const updateLayout = () => setIsPhoneAdLayout(mediaQuery.matches)
    updateLayout()
    mediaQuery.addEventListener('change', updateLayout)
    return () => mediaQuery.removeEventListener('change', updateLayout)
  }, [])
  const [bloggerMenus, setBloggerMenus] = useState({ categories: [], specialDeals: [], stores: [] })
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
  const [authMode, setAuthMode] = useState('choice')
  const [preloaderVisible, setPreloaderVisible] = useState(true)
  const [locationSearchPreloaderVisible, setLocationSearchPreloaderVisible] = useState(false)
  const [sitePage, setSitePage] = useState(null)
  const [bloggerPages, setBloggerPages] = useState([])
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [registrationName, setRegistrationName] = useState('')
  const [registrationPhone, setRegistrationPhone] = useState('')
  const [registrationEmail, setRegistrationEmail] = useState('')
  const [saved, setSaved] = useState({})
  // Keep main-page card hearts independent from the detail-page Suggested/Latest cards.
  const [detail, setDetail] = useState(null)
  const [resolvedMapCoordinates, setResolvedMapCoordinates] = useState({})
  useEffect(() => { detailRef.current = detail }, [detail])
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
      return Array.isArray(saved) ? limitNotificationSections(saved) : []
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
        const previousVersions = JSON.parse(localStorage.getItem('offerhaikya_known_post_versions') || 'null')
        const seen = new Set(JSON.parse(localStorage.getItem('offerhaikya_notification_seen') || '[]'))
        const existingNotifications = JSON.parse(localStorage.getItem('offerhaikya_notifications') || '[]')
        const knownIds = new Set(Array.isArray(previousKnown) ? previousKnown : [])
        const knownVersions = previousVersions && typeof previousVersions === 'object' && !Array.isArray(previousVersions)
          ? previousVersions
          : {}
        const firstVersionBaseline = !previousVersions || typeof previousVersions !== 'object' || Array.isArray(previousVersions)
        let newAdditions = []
        let updatedAdditions = []

        if (!Array.isArray(previousKnown)) {
          // First visit: seed the bell with the 10 newest posts, not hundreds of historical edits.
          newAdditions = parsed.slice(0, 10).map((post) => ({ ...post, notificationType: 'new' }))
        } else {
          newAdditions = parsed
            .filter((post) => !knownIds.has(post.id) && !seen.has(notificationVersionKey(post)) && !seen.has(post.id))
            .map((post) => ({ ...post, notificationType: 'new' }))

          if (!firstVersionBaseline) {
            updatedAdditions = parsed
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
          .filter((post) => !seen.has(notificationVersionKey(post)) && !seen.has(post.id))
          .filter((post) => !refreshedIds.has(String(post.id)))
        const mergedNotifications = limitNotificationSections([...newAdditions, ...updatedAdditions, ...retained])
        const nextVersions = {}
        parsed.forEach((post) => {
          nextVersions[post.id] = String(post.updatedAt || post.publishedAt || '')
        })

        setPosts(parsed)
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
    let active = true
    let inFlight = false

    const syncBloggerMenus = async () => {
      if (!active || inFlight) return
      inFlight = true
      const sourceUrl = BLOG_URL + '/?ohk-menu-sync=' + Date.now()
      const requests = [
        // Public CORS proxies can rate-limit or temporarily fail, so try independent fallbacks.
        () => fetch('https://api.allorigins.win/raw?url=' + encodeURIComponent(sourceUrl), { cache: 'no-store' }),
        () => fetch('https://corsproxy.io/?url=' + encodeURIComponent(sourceUrl), { cache: 'no-store' }),
        () => fetch('https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(sourceUrl), { cache: 'no-store' }),
        // Read the original Blogger site, where the Link List gadgets are managed.
        () => fetch('https://r.jina.ai/http://offerhaikya.blogspot.com/', { cache: 'no-store' }),
      ]
      try {
        let lastError = null
        for (const request of requests) {
          try {
            const response = await request()
            if (!response.ok) throw new Error('Blogger menu proxy returned HTTP ' + response.status)
            const source = await response.text()
            if (!active) return
            const menus = parseBloggerLinkLists(source)
            if (menus.specialDeals.length || menus.stores.length) {
              setBloggerMenus((current) => ({
                ...current,
                specialDeals: menus.specialDeals.length ? menus.specialDeals : current.specialDeals,
                stores: menus.stores.length ? menus.stores : current.stores,
                categories: [],
              }))
              console.log('Offerhaikya Blogger Link Lists synced', {
                specialDeals: menus.specialDeals.length,
                stores: menus.stores.length,
              })
              return
            }
            lastError = new Error('Homepage response contained no readable Blogger Link List items')
          } catch (error) {
            lastError = error
          }
        }
        console.warn('Offerhaikya Blogger Link List sync failed; will retry automatically.', lastError)
      } finally {
        inFlight = false
      }
    }

    syncBloggerMenus()
    const interval = window.setInterval(syncBloggerMenus, 30000)
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
    { title: 'Brands', tags: ['Amazon', 'Flipkart', 'Meesho', 'MyIntra', 'Swiggy', 'Zomato', 'Blinkit'] },
    { title: 'Offer Types', tags: ['Online Offers', 'Offline Offers', 'Local Offers', 'Free Delivery', 'Coupons & Promo Codes', 'Bank Offers', 'Buy 1 Get 1', 'Clearance Sale', '₹1 Deals'] },
    { title: 'Discounts', tags: ['Upto 20% Off', 'Upto 40% Off', 'Upto 60% Off', 'Upto 80% Off'] },
  ]

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
      .filter(isOfflinePost)
      .map((post) => {
        if (!post.coordinates) return null
        const distance = distanceKm(userLocation, post.coordinates)
        return distance <= NEARBY_RADIUS_KM ? { ...post, nearbyDistanceKm: distance } : null
      })
      .filter(Boolean)
      .sort((a, b) => a.nearbyDistanceKm - b.nearbyDistanceKm)
  }, [posts, userLocation])

    const mapPosts = useMemo(() => {
    const source = mapScope === 'nearby' ? nearbyPosts : posts
    return source.filter((post) => post.coordinates && getExpiryLabel(post) !== 'Expired')
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

  const detailImages = detail ? extractPostImages(detail.image, detail.rawContent || '') : []
  const detailVideos = detail ? extractPostVideos(detail.rawContent || '') : []
  const detailMapLinks = detail ? extractMapLinks(detail.rawContent || '') : []
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
    return normalized !== 'verified' && normalized !== 'expired' && !/^e\d+$/i.test(normalized)
  })

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
            <img src={LOGO_URL} alt="Offerhaikya" />
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
                      <button key={tag} onClick={(event) => { selectTag(tag); setDesktopCategoryOpen(false); setDesktopCategoryDismissed(true); event.currentTarget.blur() }}>{tag}</button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
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
              {categoryOpen ? categoryGroups.map((group) => (
                <div className="ohk-side-category-group" key={group.title}>
                  <strong>{group.title}</strong>
                  {group.tags.map((tag) => (
                    <button key={tag} onClick={() => { selectTag(tag); setMenuOpen(false) }}>{tag}</button>
                  ))}
                </div>
              )) : null}
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
                {detailVerified ? <span className="ohk-detail-status ohk-detail-status-verified">✓ Verified</span> : null}
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
                        setDetailTagFilter(tag)
                        document.getElementById('detail-related')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              ) : null}

              <section className="ohk-detail-description-section" aria-label="Offer details">
                <div className="ohk-detail-description-content">
                  <h1 className="ohk-detail-title">{detail.title || 'Offer'}</h1>
                  <div
                    className="ohk-detail-html"
                dangerouslySetInnerHTML={{
                  __html: cleanBloggerDetailHtml(
                    detail.rawContent || '<p>' + (detail.searchDescription || detail.excerpt) + '</p>',
                    detail.title
                  )
                  }}
                  />
                </div>
              </section>

              {detailMapLinks.length > 0 ? (
              <section className="ohk-detail-location" aria-label="Offer location">
                <h2>Map</h2>
                {detail.coordinates ? (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${detail.coordinates.latitude},${detail.coordinates.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Icon name="location" size={16} /> Click to View on Google Maps
                  </a>
                ) : null}
                {(detailMapLinks.length || detail.coordinates || detailAddress || detail.bloggerLocation) ? (
                  <div className="ohk-detail-maps">
                    {(detailMapLinks.length ? detailMapLinks : [{ url: '', label: 'Offer location' }]).map((mapLink, index) => (
                      <div className="ohk-detail-map-item" key={mapLink.url || 'offer-location-map'}>
                        <iframe
                          title={mapLink.label || `Offer map ${index + 1}`}
                          src={(() => {
                            const coordinates = (mapLink.url && resolvedMapCoordinates[mapLink.url]) || detail.coordinates || (mapLink.url ? extractCoordinates(mapLink.url) : null)
                            // Prefer Blogger coordinates, then the address. Never search using a short URL as text.
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
                ) : null}
                {!detailAddress && !detail.bloggerLocation && !detail.coordinates && !detailMapLinks.length ? (
                  <p className="ohk-detail-location-hint">Add “Address - Belgaum” as plain text and add a Google Maps link after “Location” in the Blogger post to show the address and map here.</p>
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
                  <button className="ohk-add-location-button" onClick={() => setLocationPickerOpen((value) => !value)}><Icon name="pencil" size={15} /><span>{locationPickerOpen ? 'Close' : 'Edit Location'}</span></button>
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
                    <Icon name="map" size={18} /> View All Offers on Map
                  </button>
                  <button className="ohk-nearby-find-button" type="button" onClick={requestLocation} disabled={locationLoading}>
                    <Icon name="location" size={18} />
                    {locationLoading ? 'Checking...' : 'Set Current Location'}
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
                    <Icon name="map" size={18} /> View All Offers on Map
                  </button>
                  <button className="ohk-nearby-find-button" type="button" onClick={requestLocation} disabled={locationLoading}>
                    <Icon name="location" size={18} />
                    {locationLoading ? 'Checking...' : 'Set Current Location'}
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
              <h2>{query ? `Search: ${query}` : activeLabel !== 'All' ? activeLabel : 'Latest Offers'}</h2>
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
        <OffersMap
          focusPostId={mapFocusId}
          posts={mapPosts}
          userLocation={userLocation}
          onRequestLocation={requestLocation}
          onOpenPost={(post) => { setMapOpen(false); openPost(post) }}
          onClose={() => setMapOpen(false)}
        />
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
