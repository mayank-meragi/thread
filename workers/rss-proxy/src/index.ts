const MAX_FEED_BYTES = 1_500_000
const MAX_REDIRECTS = 5
const CACHE_TTL_SECONDS = 300
const UPSTREAM_TIMEOUT_MS = 12_000

interface Env {
  RSS_PROXY_KEY: string
  ALLOWED_ORIGINS: string
}

function workerCache(): Cache {
  return (caches as CacheStorage & { default: Cache }).default
}

type ErrorCode = 'auth' | 'origin' | 'target' | 'upstream' | 'timeout' | 'oversize'

function allowedOrigins(env: Env): Set<string> {
  return new Set((env.ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean))
}

function requestOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin')
  if (!origin) return null
  return allowedOrigins(env).has(origin) ? origin : ''
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({ Vary: 'Origin' })
  const origin = request.headers.get('Origin')
  if (origin && requestOrigin(request, env)) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    headers.set('Access-Control-Max-Age', '86400')
  }
  return headers
}

function jsonResponse(request: Request, env: Env, status: number, body: Record<string, unknown>): Response {
  const headers = corsHeaders(request, env)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  return new Response(JSON.stringify(body), { status, headers })
}

function errorResponse(request: Request, env: Env, status: number, code: ErrorCode, message: string): Response {
  return jsonResponse(request, env, status, { error: message, code })
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  let difference = a.length ^ b.length
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0)
  return difference === 0
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [first, second] = parts
  return first === 0 || first === 10 || first === 127 || (first === 100 && second >= 64 && second <= 127) || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 0) || (first === 192 && second === 168) || (first === 198 && (second === 18 || second === 19)) || first >= 224
}

function isPrivateIpv6(hostname: string): boolean {
  const value = hostname.toLowerCase()
  const mappedIpv4 = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4[1])
  return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')
}

function validateTarget(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('The feed URL is not valid.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http:// and https:// feed URLs are supported.')
  if (url.username || url.password || url.hash) throw new Error('Feed URLs cannot contain credentials or fragments.')
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('Only standard HTTP and HTTPS ports are supported.')
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal') || !hostname.includes('.') || isPrivateIpv4(hostname) || isPrivateIpv6(hostname)) {
    throw new Error('Private and local feed targets are not allowed.')
  }
  url.hash = ''
  return url
}

function cacheRequest(kind: 'feed' | 'article', url: string, digest: string): Request {
  return new Request(`https://rss-proxy-cache.invalid/v1/${kind}/${digest}?url=${encodeURIComponent(url)}`)
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readLimitedBody(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > MAX_FEED_BYTES) throw new Error('The upstream feed is larger than the 1.5 MB limit.')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > MAX_FEED_BYTES) throw new Error('The upstream feed is larger than the 1.5 MB limit.')
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

async function fetchUpstream(url: URL, accept: string): Promise<{ body: string; status: number }> {
  let current = url
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
    try {
      const response = await fetch(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: accept,
          'User-Agent': 'Thread RSS proxy (+https://github.com/mayank-meragi/thread)',
        },
      })
      if (response.status >= 300 && response.status < 400) {
        if (redirect === MAX_REDIRECTS) throw new Error('The feed redirected too many times.')
        const location = response.headers.get('Location')
        if (!location) throw new Error('The feed returned a redirect without a destination.')
        current = validateTarget(new URL(location, current).toString())
        continue
      }
      if (!response.ok) return { body: '', status: response.status }
      return { body: await readLimitedBody(response), status: response.status }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw Object.assign(new Error('The upstream feed timed out.'), { code: 'timeout' as ErrorCode })
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error('The feed redirected too many times.')
}

async function serveFeed(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const rawUrl = new URL(request.url).searchParams.get('url')
  if (!rawUrl) return errorResponse(request, env, 400, 'target', 'A feed URL is required.')
  let target: URL
  try {
    target = validateTarget(rawUrl)
  } catch (error) {
    return errorResponse(request, env, 400, 'target', error instanceof Error ? error.message : 'The feed URL is not allowed.')
  }
  const canonicalUrl = target.toString()
  const digest = await sha256Hex(canonicalUrl)
  const cacheKey = cacheRequest('feed', canonicalUrl, digest)
  const cached = await workerCache().match(cacheKey)
  if (cached) {
    const headers = corsHeaders(request, env)
    headers.set('Content-Type', 'application/xml; charset=utf-8')
    headers.set('Cache-Control', 'no-store')
    headers.set('X-RSS-Proxy-Cache', 'HIT')
    headers.set('X-RSS-Proxy-Version', '1')
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'no-referrer')
    return new Response(cached.body, { status: 200, headers })
  }
  try {
    const upstream = await fetchUpstream(target, 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1')
    if (upstream.status < 200 || upstream.status >= 300) return errorResponse(request, env, 502, 'upstream', `The upstream feed returned HTTP ${upstream.status}.`)
    const cacheHeaders = new Headers({ 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`, 'X-RSS-Proxy-Version': '1', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
    const cacheResponse = new Response(upstream.body, { status: 200, headers: cacheHeaders })
    ctx.waitUntil(workerCache().put(cacheKey, cacheResponse.clone()))
    const headers = corsHeaders(request, env)
    for (const [key, value] of cacheHeaders) headers.set(key, value)
    headers.set('Cache-Control', 'no-store')
    headers.set('X-RSS-Proxy-Cache', 'MISS')
    return new Response(upstream.body, { status: 200, headers })
  } catch (error) {
    const code = (error as { code?: ErrorCode }).code
    if (code === 'timeout') return errorResponse(request, env, 504, 'timeout', error instanceof Error ? error.message : 'The upstream feed timed out.')
    if (error instanceof Error && error.message.includes('1.5 MB')) return errorResponse(request, env, 413, 'oversize', error.message)
    return errorResponse(request, env, 502, 'upstream', error instanceof Error ? error.message : 'The upstream feed could not be fetched.')
  }
}

async function serveArticle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const rawUrl = new URL(request.url).searchParams.get('url')
  if (!rawUrl) return errorResponse(request, env, 400, 'target', 'An article URL is required.')
  let target: URL
  try {
    target = validateTarget(rawUrl)
  } catch (error) {
    return errorResponse(request, env, 400, 'target', error instanceof Error ? error.message : 'The article URL is not allowed.')
  }
  const canonicalUrl = target.toString()
  const digest = await sha256Hex(canonicalUrl)
  const cacheKey = cacheRequest('article', canonicalUrl, digest)
  const cached = await workerCache().match(cacheKey)
  if (cached) {
    const headers = corsHeaders(request, env)
    headers.set('Content-Type', 'text/html; charset=utf-8')
    headers.set('Cache-Control', 'no-store')
    headers.set('X-RSS-Proxy-Cache', 'HIT')
    headers.set('X-RSS-Proxy-Version', '1')
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'no-referrer')
    return new Response(cached.body, { status: 200, headers })
  }
  try {
    const upstream = await fetchUpstream(target, 'text/html, application/xhtml+xml;q=0.9, */*;q=0.1')
    if (upstream.status < 200 || upstream.status >= 300) return errorResponse(request, env, 502, 'upstream', `The upstream article returned HTTP ${upstream.status}.`)
    const cacheHeaders = new Headers({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`, 'X-RSS-Proxy-Version': '1', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
    const cacheResponse = new Response(upstream.body, { status: 200, headers: cacheHeaders })
    ctx.waitUntil(workerCache().put(cacheKey, cacheResponse.clone()))
    const headers = corsHeaders(request, env)
    for (const [key, value] of cacheHeaders) headers.set(key, value)
    headers.set('Cache-Control', 'no-store')
    headers.set('X-RSS-Proxy-Cache', 'MISS')
    return new Response(upstream.body, { status: 200, headers })
  } catch (error) {
    const code = (error as { code?: ErrorCode }).code
    if (code === 'timeout') return errorResponse(request, env, 504, 'timeout', error instanceof Error ? error.message : 'The upstream article timed out.')
    if (error instanceof Error && error.message.includes('1.5 MB')) return errorResponse(request, env, 413, 'oversize', error.message)
    return errorResponse(request, env, 502, 'upstream', error instanceof Error ? error.message : 'The upstream article could not be fetched.')
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const origin = requestOrigin(request, env)
    if (request.method === 'OPTIONS') {
      return origin === '' ? errorResponse(request, env, 403, 'origin', 'This app origin is not allowed.') : new Response(null, { status: 204, headers: corsHeaders(request, env) })
    }
    if (origin === '') return errorResponse(request, env, 403, 'origin', 'This app origin is not allowed.')
    if (request.method !== 'GET') return errorResponse(request, env, 405, 'target', 'Only GET and OPTIONS are supported.')
    if (!env.RSS_PROXY_KEY) return errorResponse(request, env, 503, 'auth', 'The Worker is missing RSS_PROXY_KEY.')
    const authorization = request.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ') || !constantTimeEqual(authorization.slice(7), env.RSS_PROXY_KEY)) return errorResponse(request, env, 401, 'auth', 'A valid Worker access key is required.')
    if (url.pathname === '/v1/status') return jsonResponse(request, env, 200, { ok: true, version: 1 })
    if (url.pathname === '/v1/feed') return serveFeed(request, env, ctx)
    if (url.pathname === '/v1/article') return serveArticle(request, env, ctx)
    return errorResponse(request, env, 404, 'target', 'Unknown RSS Worker endpoint.')
  },
}
