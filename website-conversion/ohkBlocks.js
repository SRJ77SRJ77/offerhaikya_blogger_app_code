const MAX_PRODUCTS = 24
const SECTION_NAMES = ['BANNER', 'PRODUCTS', 'CONTACTS', 'MAP']
const SECTION_MARKER = /OHK_(BANNER|PRODUCTS|CONTACTS|MAP)_(START|END)/gi
const PRODUCT_KEY = /^p(\d*)(img|name|info|link|discount|dis|price|mrp)\b\s*[:：–-]?\s*(.*)$/i
const IMG_RE = /<img\b[^>]*>/gi

function decodeEntities(value = '') {
  return String(value).replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
}
function stripTags(value = '') {
  return decodeEntities(String(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, '\n').replace(/<[^>]*>/g, ' ')).replace(/[\t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}
function safeUrl(value = '') {
  const candidate = decodeEntities(String(value)).trim().replace(/^['"]|['"]$/g, '')
  if (!candidate) return ''
  try { const url = new URL(candidate, 'https://offerhaikya.blogspot.com'); return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : '' } catch { return '' }
}
function attr(tag, name) {
  const match = String(tag).match(new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\\x27([^\\x27]*)\\x27|([^\\s>]+))', 'i'))
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : ''
}
function imgSrc(tag) { return safeUrl(attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-original') || attr(tag, 'data-lazy-src')) }
function htmlToLines(value = '') {
  return String(value).replace(IMG_RE, tag => '\n@@IMG@@' + imgSrc(tag) + '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:p|div|li|tr|h[1-6])\s*>/gi, '\n').replace(/<[^>]*>/g, ' ').split(/\r?\n/).map(line => stripTags(line).trim()).filter(Boolean)
}
export function extractOhkBlocks(html = '') {
  const source = String(html), blocks = {}, markers = [...source.matchAll(SECTION_MARKER)]
  for (const name of SECTION_NAMES) {
    const start = markers.find(m => m[1].toUpperCase() === name && m[2].toUpperCase() === 'START')
    if (!start) continue
    const end = markers.find(m => m[1].toUpperCase() === name && m[2].toUpperCase() === 'END' && m.index > start.index)
    if (end) blocks[name] = source.slice(start.index + start[0].length, end.index)
  }
  return blocks
}
function newProduct(number = '') { return { number, image: '', name: '', info: '', link: '', discount: '', price: '', mrp: '' } }
function parseProducts(inner = '') {
  const products = [], numbered = new Map()
  let current = null, imageTarget = null
  const getNumbered = number => {
    if (!number) return null
    if (!numbered.has(number)) { const product = newProduct(number); numbered.set(number, product); products.push(product) }
    return numbered.get(number)
  }
  for (const line of htmlToLines(inner)) {
    if (line.startsWith('@@IMG@@')) {
      const image = safeUrl(line.slice(7).trim())
      if (!image) continue
      const target = imageTarget && !imageTarget.image ? imageTarget : (current && !current.image ? current : null)
      if (target) target.image = image
      else { current = newProduct(); current.image = image; products.push(current) }
      imageTarget = null
      continue
    }
    const match = line.match(PRODUCT_KEY)
    if (!match) continue
    const [, number, rawKey, rawValue] = match, key = rawKey.toLowerCase(), value = rawValue.trim()
    let product = getNumbered(number)
    if (!product) {
      if (!current || key === 'img' || (key === 'name' && current.name)) { current = newProduct(); products.push(current) }
      product = current
    } else current = product
    if (key === 'img') { imageTarget = product; const image = safeUrl(value); if (image) { product.image = image; imageTarget = null } }
    else if (key === 'name') product.name = value
    else if (key === 'info') product.info = value
    else if (key === 'link') product.link = safeUrl(value)
    else if (key === 'price') product.price = value
    else if (key === 'mrp') product.mrp = value
    else if (key === 'discount' || key === 'dis') product.discount = /^\d+(?:\.\d+)?$/.test(value) ? value + '% Off' : value
  }
  return products.filter(item => item.name || item.image).slice(0, MAX_PRODUCTS)
}
function parseContacts(inner = '') {
  return htmlToLines(inner).map(line => {
    const match = line.match(/^(email|phone|whatsapp|instagram|facebook|youtube|x|twitter|linkedin|website|web)\s*[:：–-]?\s*(.*)$/i)
    if (!match) return null
    const type = match[1].toLowerCase(), value = match[2].trim()
    if (!value) return null
    let link = value
    if (type === 'email') link = /^mailto:/i.test(value) ? value : 'mailto:' + value
    else if (type === 'phone') link = /^tel:/i.test(value) ? value : 'tel:' + value.replace(/[^+\d]/g, '')
    else if (type === 'whatsapp') link = /^https?:/i.test(value) ? value : 'https://wa.me/' + value.replace(/\D/g, '')
    else if (!/^https?:|^mailto:|^tel:/i.test(value)) link = 'https://' + value.replace(/^@/, '')
    link = safeUrl(link)
    if (!link) return null
    const label = value.replace(/^(?:mailto:|tel:)/i, '')
    const icon = ({ email: '✉', phone: '☎', whatsapp: '◉', instagram: '◎', facebook: 'f', youtube: '▶', x: '𝕏', twitter: '𝕏', linkedin: 'in', website: '↗', web: '↗' })[type] || '↗'
    return { type, label, link, icon }
  }).filter(Boolean)
}
function findFirstUrl(value = '') {
  for (const tag of String(value).match(/<a\b[^>]*>/gi) || []) { const url = safeUrl(attr(tag, 'href')); if (url) return url }
  const match = stripTags(value).match(/https?:\/\/[^\s<>"']+/i)
  return match ? safeUrl(match[0].replace(/[),.;]+$/, '')) : ''
}
export function parseOhk(html = '') {
  const source = String(html), blocks = extractOhkBlocks(source), has = Object.keys(blocks).length > 0
  const banner = blocks.BANNER ? [...blocks.BANNER.matchAll(IMG_RE)].map(m => imgSrc(m[0])).filter(Boolean) : []
  const products = blocks.PRODUCTS ? parseProducts(blocks.PRODUCTS) : []
  const contacts = blocks.CONTACTS ? parseContacts(blocks.CONTACTS) : []
  const map = blocks.MAP ? findFirstUrl(blocks.MAP) : ''
  return { has, banner, products, contacts, map, intro: [], tiles: [], fullInfoHtml: '', offerDetailHtml: '', blocks }
}
export function ohkPlainText(html = '', maxLength = Infinity) {
  const source = String(html), blocks = extractOhkBlocks(source)
  const content = Object.keys(blocks).length ? SECTION_NAMES.map(name => blocks[name] || '').join('\n') : source
  const text = stripTags(content.replace(SECTION_MARKER, ' '))
  return Number.isFinite(maxLength) ? text.slice(0, Math.max(0, maxLength)) : text
}