import { Readability } from '@mozilla/readability'
import { getRssProxyConfig, rssProxyEndpoint, type RssProxyConfig } from './rssProxy'

const MAX_ARTICLE_BYTES = 1_500_000

export interface NormalizedArticle {
  title?: string
  byline?: string
  contentHtml: string
}

export interface ArticleGateway {
  fetchArticle(url: string): Promise<NormalizedArticle>
}

export class ArticleFetchError extends Error {
  readonly kind: 'network' | 'cors' | 'http' | 'timeout' | 'malformed' | 'proxy'
  readonly status?: number

  constructor(kind: ArticleFetchError['kind'], message: string, status?: number) {
    super(message)
    this.name = 'ArticleFetchError'
    this.kind = kind
    this.status = status
  }
}

export function parseArticleHtml(html: string): NormalizedArticle {
  if (!html.trim()) throw new ArticleFetchError('malformed', 'The article response was empty.')
  if (typeof DOMParser === 'undefined') throw new ArticleFetchError('malformed', 'This browser cannot parse article pages.')
  const document = new DOMParser().parseFromString(html, 'text/html')
  const parsed = new Readability(document).parse()
  if (!parsed?.content?.trim()) throw new ArticleFetchError('malformed', 'Readable article content was not found on this page.')
  return { title: parsed.title || undefined, byline: parsed.byline || undefined, contentHtml: parsed.content }
}

async function responseText(response: Response): Promise<string> {
  if (!response.ok) throw new ArticleFetchError('http', `The article returned HTTP ${response.status}.`, response.status)
  const contentLength = Number(response.headers.get('content-length') ?? 0)
  if (contentLength > MAX_ARTICLE_BYTES) throw new ArticleFetchError('malformed', 'The article is larger than the 1.5 MB limit.')
  const html = await response.text()
  if (html.length > MAX_ARTICLE_BYTES) throw new ArticleFetchError('malformed', 'The article is larger than the 1.5 MB limit.')
  return html
}

export class DirectArticleGateway implements ArticleGateway {
  constructor(private readonly timeoutMs = 12_000) {}

  async fetchArticle(url: string): Promise<NormalizedArticle> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      let response: Response
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'text/html, application/xhtml+xml' },
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw new ArticleFetchError('timeout', 'The article took too long to respond.')
        throw new ArticleFetchError('cors', 'This article could not be reached from the browser. Configure an RSS Worker to fetch it.')
      }
      return parseArticleHtml(await responseText(response))
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }
}

export class WorkerArticleGateway implements ArticleGateway {
  constructor(private readonly config: RssProxyConfig, private readonly timeoutMs = 12_000) {}

  async fetchArticle(url: string): Promise<NormalizedArticle> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      let response: Response
      try {
        response = await fetch(rssProxyEndpoint(this.config, `/v1/article?url=${encodeURIComponent(url)}`), {
          signal: controller.signal,
          headers: { Accept: 'text/html, application/xhtml+xml', Authorization: `Bearer ${this.config.accessKey}` },
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw new ArticleFetchError('timeout', 'The RSS Worker took too long to respond.')
        throw new ArticleFetchError('proxy', 'The RSS Worker could not be reached while fetching the article.')
      }
      if (!response.ok) {
        let message = `The RSS Worker returned HTTP ${response.status}.`
        try {
          const payload = await response.json() as { error?: unknown }
          if (typeof payload.error === 'string' && payload.error.trim()) message = payload.error
        } catch {
          // Use the status-specific fallback above.
        }
        if (response.status === 404 && message.includes('Unknown RSS Worker endpoint')) {
          message = 'Your RSS Worker is outdated. Redeploy it to enable full-article fetching.'
        }
        throw new ArticleFetchError('proxy', message, response.status)
      }
      return parseArticleHtml(await responseText(response))
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }
}

class ConfiguredArticleGateway implements ArticleGateway {
  async fetchArticle(url: string): Promise<NormalizedArticle> {
    const config = getRssProxyConfig()
    return config ? new WorkerArticleGateway(config).fetchArticle(url) : new DirectArticleGateway().fetchArticle(url)
  }
}

export const articleGateway: ArticleGateway = new ConfiguredArticleGateway()
