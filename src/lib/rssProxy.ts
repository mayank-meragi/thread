const STORAGE_KEY = 'thread.rss-proxy'

export interface RssProxyConfig {
  baseUrl: string
  accessKey: string
}

export class RssProxyConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RssProxyConfigError'
  }
}

export class RssProxyConnectionError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'RssProxyConnectionError'
    this.status = status
  }
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new RssProxyConfigError('Enter the URL of your deployed RSS Worker.')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new RssProxyConfigError('The Worker URL must use http:// or https://.')
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new RssProxyConfigError('The Worker URL must not contain credentials, a query, or a hash.')
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '')
  return parsed.toString().replace(/\/$/, '')
}

function normalizeConfig(config: RssProxyConfig): RssProxyConfig {
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const accessKey = config.accessKey.trim()
  if (!accessKey) throw new RssProxyConfigError('Enter the Worker access key.')
  return { baseUrl, accessKey }
}

export function getRssProxyConfig(): RssProxyConfig | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return normalizeConfig(JSON.parse(raw) as RssProxyConfig)
  } catch {
    return null
  }
}

export function saveRssProxyConfig(config: RssProxyConfig): RssProxyConfig {
  const normalized = normalizeConfig(config)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new Event('thread:rss-proxy-config'))
  return normalized
}

export function clearRssProxyConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
  window.dispatchEvent(new Event('thread:rss-proxy-config'))
}

export function generateRssProxyAccessKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function errorMessageFromResponse(response: Response, fallback: string): Promise<string> {
  return response.text().then((body) => {
    try {
      const payload = JSON.parse(body) as { error?: unknown }
      return typeof payload.error === 'string' ? payload.error : fallback
    } catch {
      return fallback
    }
  }).catch(() => fallback)
}

export async function testRssProxyConnection(config: RssProxyConfig): Promise<void> {
  const normalized = normalizeConfig(config)
  const controller = new AbortController()
  const timeout = globalThis.setTimeout(() => controller.abort(), 10_000)
  try {
    let response: Response
    try {
      response = await fetch(`${normalized.baseUrl}/v1/status`, {
        signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: `Bearer ${normalized.accessKey}` },
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new RssProxyConnectionError('The Worker took too long to respond.')
      }
      throw new RssProxyConnectionError('The Worker could not be reached. Check the URL and CORS settings.')
    }
    if (!response.ok) {
      const fallback = response.status === 401
        ? 'The Worker rejected this access key.'
        : response.status === 403
          ? 'This app origin is not allowed by the Worker.'
          : `The Worker returned HTTP ${response.status}.`
      throw new RssProxyConnectionError(await errorMessageFromResponse(response, fallback), response.status)
    }
  } finally {
    globalThis.clearTimeout(timeout)
  }
}

export function rssProxyEndpoint(config: RssProxyConfig, path: string): string {
  return `${normalizeBaseUrl(config.baseUrl)}${path}`
}
