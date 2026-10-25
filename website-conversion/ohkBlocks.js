const MAX_BANNER = 5
const MAX_PRODUCTS = 25
const MAX_CONTACTS = 4
const IMG_RE = /<img\b[^>]*>/gi

const decode = (value = '') =>
  String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&amp;/gi, '&')

export function htmlToLines(html = '') {
  return decode(
    String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|ul|ol|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function safeUrl(value = '') {
  const v = String(value).trim().replace(/^<|>$/g, '')
  if (/^https:\/\/\S+$/i.test(v)) return v
  if (/^http:\/\/\S+$/i.test(v)) return 'https://' + v.slice(7)
  if (/^mailto:\S+$/i.test(v)) return v
  if (/^tel:[+\d]+$/i.test(v)) return v
  return ''
}

function imgSrc(tag) {
  const match = tag.match(/\b(?:src|data-src)\s*=\s*["']([^"']+)["']/i)
  let url = match ? match[1].replace(/&amp;/g, '&') : ''
  if (url.startsWith('//')) url = 'https:' + url
  return safeUrl(url)
}

export function hasOhkBlocks(html = '') {
  return /OHK_[A-Z]+_START/.test(String(html))
}

export function extractOhkBlocks(html = '') {
  const blocks = {}
  const re = /OHK_([A-Z]+)_START([\s\S]*?)OHK_\1_END/g
  let match
  while ((match = re.exec(String(html)))) {
    if (!(match[1] in blocks)) blocks[match[1]] = match[2]
  }
  return blocks
}

export function stripOhkBlocks(html = '') {
  return String(html).replace(/OHK_([A-Z]+)_START[\s\S]*?OHK_\1_END/g, ' ')
}

function parseBanner(inner = '') {
  const urls = []
  const add = (url) => {
    const clean = safeUrl(url)
    if (clean && !urls.includes(clean)) urls.push(clean)
  }
  String(inner).replace(IMG_RE, (tag) => { add(imgSrc(tag)); return tag })
  htmlToLines(String(inner).replace(IMG_RE, ' ')).forEach((line) => {
    if (/^https?:\/\/\S+\.(?:jpe?g|png|webp|gif|avif)(?:\?\S*)?$/i.test(line)) add(line)
  })
  return urls.slice(0, MAX_BANNER)
}

function tileKind(text) {
  if (/^offline\b/i.test(text)) return 'offline'
  if (/^online\b/i.test(text)) return 'online'
  if (/%|\boff\b|discount|cashback/i.test(text)) return 'discount'
  if (/valid|expire|till|until|last date|ends?\b/i.test(text)) return 'time'
  if (/verified/i.test(text)) return 'verified'
  if (/available on|store|brand|shop|amazon|flipkart|meesho|myntra/i.test(text)) return 'store'
  return 'info'
}

function parseTiles(inner = '') {
  return htmlToLines(inner).slice(0, 7).map((text) => ({ text, kind: tileKind(text) }))
}

const PRODUCT_KEY = /^p(\d*)(img|name|info|link|discount|dis|price|mrp|btn)\b\s*[:：–-]?\s*(.*)$/i

function newProduct() {
  return { image: '', name: '', info: '', link: '', discount: '', price: '', mrp: '', buttonText: '' }
}

function parseProducts(inner = '') {
  const withImages = String(inner).replace(IMG_RE, (tag) => '\n@@IMG@@ ' + imgSrc(tag) + '\n')
  const products = []
  const byNumber = {}
  let current = null
  let imageTarget = null

  const productFor = (num) => {
    if (num) {
      if (!byNumber[num]) { byNumber[num] = newProduct(); products.push(byNumber[num]) }
      return byNumber[num]
    }
    return null
  }

  htmlToLines(withImages).forEach((line) => {
    if (line.startsWith('@@IMG@@')) {
      const url = safeUrl(line.slice(7).trim())
      if (!url) return
      const target = imageTarget && !imageTarget.image ? imageTarget : (current && !current.image ? current : null)
      if (target) { target.image = url; imageTarget = null; return }
      current = newProduct()
      current.image = url
      products.push(current)
      return
    }
    const match = line.match(PRODUCT_KEY)
    if (!match) return
    const num = match[1]
    const key = match[2].toLowerCase()
    const value = match[3].trim()
    let product = productFor(num)
    if (!product) {
      const startsNew = key === 'img' || (key === 'name' && current && current.name)
      if (startsNew || !current) { current = newProduct(); products.push(current) }
      product = current
    } else {
      current = product
    }
    if (key === 'img') {
      imageTarget = product
      const url = safeUrl(value)
      if (url) { product.image = url; imageTarget = null }
    }
    if (key === 'name') product.name = value
    if (key === 'info') product.info = value
    if (key === 'link') product.link = safeUrl(value)
    if (key === 'discount' || key === 'dis') product.discount = /^\d+(\.\d+)?$/.test(value) ? value + '% Off' : value
    if (key === 'price') product.price = value
    if (key === 'mrp') product.mrp = value
    if (key === 'btn') product.buttonText = value
  })
  return products.filter((p) => p.name || p.image).slice(0, MAX_PRODUCTS)
}

const fullNumber = (digits) => (digits.length === 10 ? '91' + digits : digits)

function parseContacts(inner = '') {
  const contacts = []
  let current = null
  let map = ''
  htmlToLines(inner).forEach((line) => {
    const match = line.match(/^(ctype|cvalue|clink|map|cmap)\s*[:：]\s*(.*)$/i)
    if (!match) return
    const key = match[1].toLowerCase()
    const value = match[2].trim()
    if (key === 'map' || key === 'cmap') { map = safeUrl(value); return }
    if (key === 'ctype') { current = { type: value.toLowerCase(), value: '', link: '' }; contacts.push(current); return }
    if (!current) return
    if (key === 'cvalue') {
      const md = value.match(/^\[([^\]]*)\]\(([^)]*)\)$/)
      if (md) { current.value = md[1].trim(); if (!current.link) current.link = safeUrl(md[2]) } else current.value = value
    }
    if (key === 'clink') current.link = safeUrl(value)
  })
  const built = contacts.map((c) => {
    const digits = c.value.replace(/\D/g, '')
    let link = c.link
    let label = c.value
    if (c.type === 'email' && !link && /^\S+@\S+\.\S+$/.test(c.value)) link = 'mailto:' + c.value
    if (c.type === 'phone' && !link && digits.length >= 10) link = 'tel:+' + fullNumber(digits)
    if (c.type === 'whatsapp') {
      if (!link && digits.length >= 10) link = 'https://wa.me/' + fullNumber(digits)
      if (!/[a-z]/i.test(label)) label = 'Chat on WhatsApp'
    }
    if (!label) label = c.type.charAt(0).toUpperCase() + c.type.slice(1)
    return { type: c.type, label, link }
  }).filter((c) => c.link)
  return { contacts: built.slice(0, MAX_CONTACTS), map }
}

export function parseOhk(html = '') {
  const blocks = extractOhkBlocks(html)
  const contact = parseContacts(blocks.CONTACT || '')
  return {
    has: hasOhkBlocks(html),
    banner: parseBanner(blocks.BANNER || ''),
    intro: htmlToLines(blocks.INTRO || '').slice(0, 3),
    tiles: parseTiles(blocks.SHORT || ''),
    fullInfoHtml: blocks.FULLINFO || '',
    products: parseProducts(blocks.PRODUCTS || ''),
    offerDetailHtml: blocks.OFFERDETAIL || '',
    contacts: contact.contacts,
    map: contact.map,
  }
}

export function ohkPlainText(html = '', limit = 180) {
  const parsed = parseOhk(html)
  const source = parsed.intro.length ? parsed.intro.join(' ') : htmlToLines(parsed.fullInfoHtml).join(' ')
  return source.replace(/\s+/g, ' ').trim().slice(0, limit)
}
