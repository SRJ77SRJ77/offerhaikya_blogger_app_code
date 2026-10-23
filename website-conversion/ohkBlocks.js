const PRODUCT_KEY = /^p(\d*)(img|name|info|link|discount|dis|price|mrp)\b\s*[:：–-]?\s*(.*)$/i

function newProduct() {
  return { image: '', name: '', info: '', link: '', discount: '', price: '', mrp: '' }
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
  })
  return products.filter((p) => p.name || p.image).slice(0, MAX_PRODUCTS)
}
