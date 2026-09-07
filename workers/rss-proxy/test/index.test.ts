import { beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index'

const env = {
  RSS_PROXY_KEY: 'a'.repeat(64),
  ALLOWED_ORIGINS: 'https://thread.example, http://127.0.0.1:5173',
}

function context() {
  const waitUntil = vi.fn()
  return { value: { waitUntil } as unknown as ExecutionContext, waitUntil }
}

function request(path: string, init: RequestInit = {}) {
  return new Request(`https://thread-rss-proxy.example${path}`, {
    ...init,
    headers: {
      Origin: 'https://thread.example',
      ...(init.headers ?? {}),
    },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('caches', { default: { match: vi.fn().mockResolvedValue(undefined), put: vi.fn().mockResolvedValue(undefined) } })
})

describe('RSS Worker', () => {
  it('reports status only with the configured key and exact CORS origin', async () => {
    const unauthorized = await worker.fetch(request('/v1/status'), env, context().value)
    expect(unauthorized.status).toBe(401)

    const response = await worker.fetch(request('/v1/status', { headers: { Authorization: `Bearer ${env.RSS_PROXY_KEY}` } }), env, context().value)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, version: 1 })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://thread.example')
  })

  it('rejects unknown origins before proxying', async () => {
    const response = await worker.fetch(new Request('https://thread-rss-proxy.example/v1/status', { headers: { Origin: 'https://evil.example', Authorization: `Bearer ${env.RSS_PROXY_KEY}` } }), env, context().value)
    expect(response.status).toBe(403)
  })

  it('validates targets and proxies a public feed with a bounded cache write', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response('<rss><channel><title>Example</title></channel></rss>', { headers: { 'Content-Type': 'application/rss+xml' } }))
    vi.stubGlobal('fetch', upstream)
    const execution = context()
    const response = await worker.fetch(request(`/v1/feed?url=${encodeURIComponent('https://example.com/feed.xml')}`, { headers: { Authorization: `Bearer ${env.RSS_PROXY_KEY}` } }), env, execution.value)
    expect(response.status).toBe(200)
    expect(response.headers.get('X-RSS-Proxy-Cache')).toBe('MISS')
    expect(await response.text()).toContain('<rss>')
    expect(upstream).toHaveBeenCalledWith('https://example.com/feed.xml', expect.objectContaining({ redirect: 'manual' }))
    expect(execution.waitUntil).toHaveBeenCalledOnce()
  })

  it('proxies public article HTML through the article endpoint', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response('<html><main><h1>Story</h1><p>Full text</p></main></html>', { headers: { 'Content-Type': 'text/html' } }))
    vi.stubGlobal('fetch', upstream)
    const execution = context()
    const response = await worker.fetch(request(`/v1/article?url=${encodeURIComponent('https://example.com/story')}`, { headers: { Authorization: `Bearer ${env.RSS_PROXY_KEY}` } }), env, execution.value)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(await response.text()).toContain('Full text')
    expect(upstream).toHaveBeenCalledWith('https://example.com/story', expect.objectContaining({ redirect: 'manual' }))
    expect(execution.waitUntil).toHaveBeenCalledOnce()
  })

  it('rejects credentials and private/local targets', async () => {
    const auth = `Bearer ${env.RSS_PROXY_KEY}`
    const privateTarget = await worker.fetch(request(`/v1/feed?url=${encodeURIComponent('http://127.0.0.1/feed.xml')}`, { headers: { Authorization: auth } }), env, context().value)
    expect(privateTarget.status).toBe(400)
    const credentials = await worker.fetch(request(`/v1/feed?url=${encodeURIComponent('https://user:pass@example.com/feed.xml')}`, { headers: { Authorization: auth } }), env, context().value)
    expect(credentials.status).toBe(400)
  })
})
