import DOMPurify from 'dompurify'
import { XMLParser } from 'fast-xml-parser'
import { db, type FeedEntryRecord, type FeedFolderRecord, type FeedRecord } from '../db'
import { getRssProxyConfig, rssProxyEndpoint, type RssProxyConfig } from './rssProxy'

export interface NormalizedFeedEntry {
  externalId: string
  title: string
  url?: string
  author?: string
  publishedAt?: string
  summaryHtml?: string
}

export interface NormalizedFeed {
  title: string
  description?: string
  siteUrl?: string
  entries: NormalizedFeedEntry[]
}

export type FeedFetchErrorKind = 'network' | 'cors' | 'http' | 'timeout' | 'malformed' | 'proxy-auth' | 'proxy-origin' | 'proxy-target' | 'proxy-unavailable'

export class FeedFetchError extends Error {
  readonly kind: FeedFetchErrorKind
  readonly status?: number

  constructor(kind: FeedFetchErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'FeedFetchError'
    this.kind = kind
    this.status = status
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  processEntities: true,
})

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

function textOf(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim() || undefined
  if (typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record['#text'] === 'string' || typeof record['#text'] === 'number') return String(record['#text']).trim() || undefined
  if (typeof record['#cdata'] === 'string' || typeof record['#cdata'] === 'number') return String(record['#cdata']).trim() || undefined
  return Object.values(record).map(textOf).filter((part): part is string => Boolean(part)).join(' ').trim() || undefined
}

function linkOf(value: unknown): string | undefined {
  const links = asArray(value)
  for (const link of links) {
    if (typeof link === 'string') return link.trim() || undefined
    if (!link || typeof link !== 'object') continue
    const record = link as Record<string, unknown>
    const rel = textOf(record['@_rel'])
    const href = textOf(record['@_href']) ?? textOf(record['#text'])
    if (href && (!rel || rel === 'alternate')) return href
  }
  return undefined
}

function dateOf(value: unknown): string | undefined {
  const raw = textOf(value)
  if (!raw) return undefined
  const timestamp = Date.parse(raw)
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString()
}

function stripNamespace(value: Record<string, unknown>, key: string): unknown {
  const namespacedKey = Object.keys(value).find((candidate) => candidate.split(':').pop() === key)
  return value[key] ?? (namespacedKey ? value[namespacedKey] : undefined)
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function entryId(entry: Record<string, unknown>, index: number, feedUrl: string): string {
  const candidate = textOf(entry.guid) ?? textOf(entry.id) ?? linkOf(entry.link) ?? `${textOf(entry.title) ?? ''}|${textOf(entry.pubDate) ?? textOf(entry.updated) ?? ''}|${index}`
  return hashString(`${feedUrl}|${candidate}`)
}

function parseRssRoot(root: Record<string, unknown>, feedUrl: string): NormalizedFeed | undefined {
  const rss = (root.rss ?? root.channel ?? stripNamespace(root, 'RDF')) as Record<string, unknown> | undefined
  const channel = (rss && 'channel' in rss ? rss.channel : rss) as Record<string, unknown> | undefined
  if (!channel) return undefined
  const entries = asArray((channel.item ?? rss?.item) as Record<string, unknown> | Record<string, unknown>[] | undefined)
  return {
    title: textOf(channel.title) ?? new URL(feedUrl).hostname,
    description: textOf(channel.description),
    siteUrl: linkOf(channel.link),
    entries: entries.map((entry, index) => ({
      externalId: entryId(entry, index, feedUrl),
      title: textOf(entry.title) ?? 'Untitled item',
      url: linkOf(entry.link),
      author: textOf(entry.author) ?? textOf(entry['dc:creator']) ?? textOf(entry.creator),
      publishedAt: dateOf(entry.pubDate) ?? dateOf(entry.isoDate) ?? dateOf(entry.date) ?? dateOf(entry['dc:date']),
      summaryHtml: textOf(entry.description) ?? textOf(entry.encoded) ?? textOf(entry['content:encoded']) ?? textOf(entry.content),
    })),
  }
}

function parseAtomRoot(root: Record<string, unknown>, feedUrl: string): NormalizedFeed | undefined {
  const feed = (root.feed ?? stripNamespace(root, 'feed')) as Record<string, unknown> | undefined
  if (!feed) return undefined
  const entries = asArray(feed.entry as Record<string, unknown> | Record<string, unknown>[] | undefined)
  return {
    title: textOf(feed.title) ?? new URL(feedUrl).hostname,
    description: textOf(feed.subtitle),
    siteUrl: linkOf(feed.link),
    entries: entries.map((entry, index) => ({
      externalId: entryId(entry, index, feedUrl),
      title: textOf(entry.title) ?? 'Untitled item',
      url: linkOf(entry.link),
      author: textOf((entry.author as Record<string, unknown> | undefined)?.name) ?? textOf(entry.author),
      publishedAt: dateOf(entry.published) ?? dateOf(entry.updated),
      summaryHtml: textOf(entry.content) ?? textOf(entry.summary),
    })),
  }
}

export function parseFeedXml(xml: string, feedUrl: string): NormalizedFeed {
  if (!xml.trim()) throw new FeedFetchError('malformed', 'The feed response was empty.')
  let root: Record<string, unknown>
  try {
    root = parser.parse(xml) as Record<string, unknown>
  } catch {
    throw new FeedFetchError('malformed', 'The response was not valid XML.')
  }
  try {
    const normalized = parseRssRoot(root, feedUrl) ?? parseAtomRoot(root, feedUrl)
    if (!normalized) throw new FeedFetchError('malformed', 'This document is not a supported RSS or Atom feed.')
    return {
      ...normalized,
      entries: normalized.entries.filter((entry) => entry.title || entry.url).slice(0, 1000),
    }
  } catch (error) {
    if (error instanceof FeedFetchError) throw error
    throw new FeedFetchError('malformed', 'This feed could not be read.')
  }
}

export function resolveUrl(value: string | null | undefined, baseUrl?: string): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value, baseUrl || undefined).toString()
  } catch {
    return undefined
  }
}

export function sanitizeFeedHtml(value: string | undefined, baseUrl?: string): string {
  if (!value) return ''
  if (typeof document === 'undefined') return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const clean = DOMPurify.sanitize(value, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'dl', 'dt', 'dd'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'rel', 'src', 'alt', 'width', 'height'],
    FORBID_ATTR: ['style', 'class', 'id'],
  })
  const template = document.createElement('template')
  template.innerHTML = clean
  for (const image of template.content.querySelectorAll('img')) {
    const resolved = resolveUrl(image.getAttribute('src'), baseUrl)
    if (!resolved || !/^(https?|data):/i.test(resolved)) {
      image.remove()
      continue
    }
    image.setAttribute('src', resolved)
    image.removeAttribute('srcset')
    image.setAttribute('loading', 'lazy')
    image.setAttribute('decoding', 'async')
    image.setAttribute('referrerpolicy', 'no-referrer')
  }
  for (const anchor of template.content.querySelectorAll('a[href]')) {
    const resolved = resolveUrl(anchor.getAttribute('href'), baseUrl)
    if (resolved) anchor.setAttribute('href', resolved)
  }
  return template.innerHTML
}

export interface FeedGateway {
  fetchFeed(url: string): Promise<NormalizedFeed>
}

export class DirectFeedGateway implements FeedGateway {
  constructor(private readonly timeoutMs = 12_000) {}

  async fetchFeed(url: string): Promise<NormalizedFeed> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      let response: Response
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw new FeedFetchError('timeout', 'The feed took too long to respond.')
        throw new FeedFetchError('cors', 'This feed could not be reached from the browser. It may block cross-origin requests.')
      }
      if (!response.ok) throw new FeedFetchError('http', `The feed returned HTTP ${response.status}.`, response.status)
      const contentLength = Number(response.headers.get('content-length') ?? 0)
      if (contentLength > 1_500_000) throw new FeedFetchError('malformed', 'The feed is larger than the 1.5 MB limit.')
      const xml = await response.text()
      if (xml.length > 1_500_000) throw new FeedFetchError('malformed', 'The feed is larger than the 1.5 MB limit.')
      return parseFeedXml(xml, url)
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }
}

export class WorkerFeedGateway implements FeedGateway {
  constructor(private readonly config: RssProxyConfig, private readonly timeoutMs = 12_000) {}

  async fetchFeed(url: string): Promise<NormalizedFeed> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      let response: Response
      try {
        response = await fetch(rssProxyEndpoint(this.config, `/v1/feed?url=${encodeURIComponent(url)}`), {
          signal: controller.signal,
          headers: {
            Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
            Authorization: `Bearer ${this.config.accessKey}`,
          },
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw new FeedFetchError('timeout', 'The RSS Worker took too long to respond.')
        throw new FeedFetchError('proxy-unavailable', 'The RSS Worker could not be reached. Check its URL and allowed origins.')
      }
      if (!response.ok) {
        const message = await proxyErrorMessage(response)
        if (response.status === 401) throw new FeedFetchError('proxy-auth', message, response.status)
        if (response.status === 403) throw new FeedFetchError('proxy-origin', message, response.status)
        if (response.status === 400 || response.status === 413) throw new FeedFetchError('proxy-target', message, response.status)
        throw new FeedFetchError('proxy-unavailable', message, response.status)
      }
      const contentLength = Number(response.headers.get('content-length') ?? 0)
      if (contentLength > 1_500_000) throw new FeedFetchError('malformed', 'The feed is larger than the 1.5 MB limit.')
      const xml = await response.text()
      if (xml.length > 1_500_000) throw new FeedFetchError('malformed', 'The feed is larger than the 1.5 MB limit.')
      return parseFeedXml(xml, url)
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }
}

async function proxyErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: unknown }
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  } catch {
    // Fall through to a status-specific message.
  }
  if (response.status === 401) return 'The RSS Worker rejected the configured access key.'
  if (response.status === 403) return 'This app origin is not allowed by the RSS Worker.'
  if (response.status === 400) return 'The RSS Worker rejected this feed URL.'
  if (response.status === 413) return 'The feed is larger than the 1.5 MB limit.'
  return `The RSS Worker returned HTTP ${response.status}.`
}

class ConfiguredFeedGateway implements FeedGateway {
  async fetchFeed(url: string): Promise<NormalizedFeed> {
    const config = getRssProxyConfig()
    return config ? new WorkerFeedGateway(config).fetchFeed(url) : new DirectFeedGateway().fetchFeed(url)
  }
}

// Keep this stable for reader consumers: transport selection is a local setting,
// and a configured Worker is authoritative (there is no silent direct fallback).
export const feedGateway: FeedGateway = new ConfiguredFeedGateway()

export function canonicalFeedUrl(value: string): string {
  const parsed = new URL(value.trim())
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Use an http:// or https:// feed URL.')
  if (parsed.username || parsed.password) throw new Error('Feed URLs cannot contain credentials; use a public feed URL.')
  parsed.hash = ''
  return parsed.toString()
}

export function feedUrlPrivacyWarning(value: string): string | undefined {
  try {
    const parsed = new URL(canonicalFeedUrl(value))
    const sensitive = Array.from(parsed.searchParams.keys()).some((key) => /token|key|auth|secret|sig|pass|credential/i.test(key))
    return sensitive ? 'This URL appears to contain a token or credential. Your Worker treats feeds as public and caches successful responses, so use a public feed URL instead.' : undefined
  } catch {
    return undefined
  }
}

export function feedIdForUrl(url: string): string {
  return `feed-${hashString(url)}`
}

export interface SubscribeFeedOptions {
  folderId?: string
}

function folderNameKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

function newFolderId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `folder-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export async function createFeedFolder(value: string): Promise<FeedFolderRecord> {
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name) throw new Error('Folder names cannot be empty.')
  const normalizedName = folderNameKey(name)
  if (await db.feedFolders.where('normalizedName').equals(normalizedName).count()) {
    throw new Error('A folder with this name already exists.')
  }
  const now = new Date().toISOString()
  const folder: FeedFolderRecord = { id: newFolderId(), name, normalizedName, createdAt: now, updatedAt: now }
  await db.feedFolders.add(folder)
  return folder
}

export async function renameFeedFolder(folderId: string, value: string): Promise<FeedFolderRecord> {
  const current = await db.feedFolders.get(folderId)
  if (!current) throw new Error('That folder no longer exists.')
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name) throw new Error('Folder names cannot be empty.')
  const normalizedName = folderNameKey(name)
  const duplicate = await db.feedFolders.where('normalizedName').equals(normalizedName).first()
  if (duplicate && duplicate.id !== folderId) throw new Error('A folder with this name already exists.')
  const next = { ...current, name, normalizedName, updatedAt: new Date().toISOString() }
  await db.feedFolders.put(next)
  return next
}

export async function deleteFeedFolder(folderId: string, mode: 'ungroup' | 'delete'): Promise<void> {
  const folder = await db.feedFolders.get(folderId)
  if (!folder) return
  const feeds = await db.feeds.where('folderId').equals(folderId).toArray()
  await db.transaction('rw', [db.feedFolders, db.feeds, db.feedEntries], async () => {
    if (mode === 'delete') {
      for (const feed of feeds) {
        await db.feedEntries.where('feedId').equals(feed.id).delete()
        await db.feeds.delete(feed.id)
      }
    } else {
      for (const feed of feeds) {
        const next = { ...feed }
        delete next.folderId
        next.updatedAt = new Date().toISOString()
        await db.feeds.put(next)
      }
    }
    await db.feedFolders.delete(folderId)
  })
}

export async function moveFeedToFolder(feedId: string, folderId: string | undefined): Promise<void> {
  if (folderId && !(await db.feedFolders.get(folderId))) throw new Error('That folder no longer exists.')
  const feed = await db.feeds.get(feedId)
  if (!feed) throw new Error('That feed no longer exists.')
  const next = { ...feed, updatedAt: new Date().toISOString() }
  if (folderId) next.folderId = folderId
  else delete next.folderId
  await db.feeds.put(next)
}

export async function subscribeToFeed(value: string, gateway: FeedGateway = feedGateway, options: SubscribeFeedOptions = {}): Promise<FeedRecord> {
  const url = canonicalFeedUrl(value)
  const id = feedIdForUrl(url)
  const existing = await db.feeds.get(id)
  if (existing) throw new Error('You are already subscribed to this feed.')
  if (options.folderId && !(await db.feedFolders.get(options.folderId))) throw new Error('That folder no longer exists.')
  const normalized = await gateway.fetchFeed(url)
  const now = new Date().toISOString()
  const feed: FeedRecord = {
    id,
    url,
    title: normalized.title,
    folderId: options.folderId,
    description: normalized.description,
    siteUrl: normalized.siteUrl,
    createdAt: now,
    updatedAt: now,
    lastFetchedAt: now,
  }
  await persistFeedSnapshot(feed, normalized)
  return feed
}

export async function refreshFeed(feed: FeedRecord, gateway: FeedGateway = feedGateway): Promise<FeedRecord> {
  const normalized = await gateway.fetchFeed(feed.url)
  const now = new Date().toISOString()
  const next = { ...feed, title: normalized.title, description: normalized.description, siteUrl: normalized.siteUrl, lastFetchedAt: now, lastError: undefined, updatedAt: now }
  await persistFeedSnapshot(next, normalized)
  return next
}

export async function refreshAllFeeds(gateway: FeedGateway = feedGateway): Promise<{ total: number; refreshed: number; failed: number }> {
  const feeds = await db.feeds.toArray()
  let refreshed = 0
  let failed = 0
  for (let index = 0; index < feeds.length; index += 4) {
    const results = await Promise.all(feeds.slice(index, index + 4).map(async (feed) => {
      try {
        await refreshFeed(feed, gateway)
        return true
      } catch (error) {
        await recordFeedError(feed, error)
        return false
      }
    }))
    refreshed += results.filter(Boolean).length
    failed += results.length - results.filter(Boolean).length
  }
  return { total: feeds.length, refreshed, failed }
}

export async function recordFeedError(feed: FeedRecord, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  await db.feeds.update(feed.id, { lastError: message, updatedAt: new Date().toISOString() })
}

async function persistFeedSnapshot(feed: FeedRecord, normalized: NormalizedFeed): Promise<void> {
  const fetchedAt = feed.lastFetchedAt ?? new Date().toISOString()
  const entries: FeedEntryRecord[] = normalized.entries.map((entry) => ({
    id: `${feed.id}:${entry.externalId}`,
    feedId: feed.id,
    externalId: entry.externalId,
    title: entry.title,
    url: entry.url,
    author: entry.author,
    publishedAt: entry.publishedAt,
    summaryHtml: sanitizeFeedHtml(entry.summaryHtml, entry.url ?? feed.siteUrl ?? feed.url),
    fetchedAt,
  }))
  await db.transaction('rw', [db.feeds, db.feedEntries], async () => {
    await db.feeds.put(feed)
    for (const entry of entries) {
      const current = await db.feedEntries.get(entry.id)
      await db.feedEntries.put({
        ...entry,
        readAt: current?.readAt,
        articleHtml: current?.articleHtml,
        articleFetchedAt: current?.articleFetchedAt,
        articleError: current?.articleError,
      })
    }
    await pruneFeedEntries(feed.id)
  })
}

export async function pruneFeedEntries(feedId?: string): Promise<void> {
  const feeds = feedId ? [feedId] : (await db.feeds.toArray()).map((feed) => feed.id)
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
  for (const id of feeds) {
    const entries = await db.feedEntries.where('feedId').equals(id).toArray()
    const newestFirst = entries.sort((a, b) => (b.publishedAt ?? b.fetchedAt).localeCompare(a.publishedAt ?? a.fetchedAt))
    const remove = newestFirst.slice(500).filter((entry) => Boolean(entry.readAt))
    for (const entry of newestFirst) {
      const timestamp = Date.parse(entry.publishedAt ?? entry.fetchedAt)
      if (entry.readAt && Number.isFinite(timestamp) && timestamp < cutoff) remove.push(entry)
    }
    const seen = new Set<string>()
    await db.feedEntries.bulkDelete(remove.filter((entry) => !seen.has(entry.id) && seen.add(entry.id)).map((entry) => entry.id))
  }
}

export async function markFeedEntryRead(entryId: string, read: boolean): Promise<void> {
  await db.feedEntries.update(entryId, { readAt: read ? new Date().toISOString() : undefined })
}

export async function markAllFeedEntriesRead(feedId?: string): Promise<void> {
  const entries = feedId ? await db.feedEntries.where('feedId').equals(feedId).toArray() : await db.feedEntries.toArray()
  const now = new Date().toISOString()
  await db.transaction('rw', db.feedEntries, async () => {
    for (const entry of entries) if (!entry.readAt) await db.feedEntries.update(entry.id, { readAt: now })
  })
}

export async function markAllFeedEntriesUnread(feedId?: string): Promise<void> {
  const entries = feedId ? await db.feedEntries.where('feedId').equals(feedId).toArray() : await db.feedEntries.toArray()
  await db.transaction('rw', db.feedEntries, async () => {
    for (const entry of entries) if (entry.readAt) await db.feedEntries.update(entry.id, { readAt: undefined })
  })
}

export async function removeFeed(feedId: string): Promise<void> {
  await db.transaction('rw', [db.feeds, db.feedEntries], async () => {
    await db.feeds.delete(feedId)
    await db.feedEntries.where('feedId').equals(feedId).delete()
  })
}
