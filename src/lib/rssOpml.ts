import { XMLParser } from 'fast-xml-parser'
import { db } from '../db'
import {
  canonicalFeedUrl,
  createFeedFolder,
  feedGateway,
  feedIdForUrl,
  moveFeedToFolder,
  subscribeToFeed,
  type FeedGateway,
} from './rss'

export interface OpmlFeedSource {
  url: string
  title: string
  folderPath?: string
}

export interface OpmlImportItem {
  url: string
  title?: string
  folderPath?: string
  reason?: string
}

export interface OpmlImportResult {
  imported: OpmlImportItem[]
  skipped: OpmlImportItem[]
  failed: OpmlImportItem[]
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
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim() || undefined
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const text = record['#text']
  return typeof text === 'string' || typeof text === 'number' ? String(text).trim() || undefined : undefined
}

function outlineName(outline: Record<string, unknown>): string | undefined {
  return textOf(outline['@_title']) ?? textOf(outline['@_text']) ?? textOf(outline.title) ?? textOf(outline.text)
}

function outlineUrl(outline: Record<string, unknown>): string | undefined {
  return textOf(outline['@_xmlUrl']) ?? textOf(outline['@_xmlurl']) ?? textOf(outline.xmlUrl)
}

function walkOutlines(value: unknown, parents: string[], output: OpmlFeedSource[]): void {
  for (const outline of asArray(value as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    if (!outline || typeof outline !== 'object') continue
    const record = outline as Record<string, unknown>
    const name = outlineName(record)
    const url = outlineUrl(record)
    if (url) {
      output.push({ url, title: name ?? url, folderPath: parents.length ? parents.join(' / ') : undefined })
    }
    const children = record.outline
    if (children) walkOutlines(children, url ? parents : name ? [...parents, name] : parents, output)
  }
}

export function parseOpml(xml: string): OpmlFeedSource[] {
  if (!xml.trim()) throw new Error('The OPML file is empty.')
  let root: Record<string, unknown>
  try {
    root = parser.parse(xml) as Record<string, unknown>
  } catch {
    throw new Error('The OPML file is not valid XML.')
  }
  const opml = root.opml as Record<string, unknown> | undefined
  const body = opml?.body as Record<string, unknown> | undefined
  if (!opml || !body) throw new Error('This file is not a supported OPML document.')
  const sources: OpmlFeedSource[] = []
  walkOutlines(body.outline, [], sources)
  if (sources.length === 0) throw new Error('The OPML file does not contain any feed URLs.')
  return sources
}

function folderKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
}

async function folderForPath(path: string, cache: Map<string, string>): Promise<string> {
  const key = folderKey(path)
  const cached = cache.get(key)
  if (cached) return cached
  const existing = await db.feedFolders.where('normalizedName').equals(key).first()
  if (existing) {
    cache.set(key, existing.id)
    return existing.id
  }
  try {
    const created = await createFeedFolder(path)
    cache.set(key, created.id)
    return created.id
  } catch (error) {
    // Two feeds in the same import batch can reach this point concurrently.
    // The unique normalized-name index makes the loser safe to re-read.
    const raced = await db.feedFolders.where('normalizedName').equals(key).first()
    if (raced) {
      cache.set(key, raced.id)
      return raced.id
    }
    throw error
  }
}

async function importOne(source: OpmlFeedSource, seen: Set<string>, folders: Map<string, string>, gateway: FeedGateway): Promise<{ kind: 'imported' | 'skipped' | 'failed'; item: OpmlImportItem }> {
  const item: OpmlImportItem = { url: source.url, title: source.title, folderPath: source.folderPath }
  let url: string
  try {
    url = canonicalFeedUrl(source.url)
  } catch (error) {
    return { kind: 'failed', item: { ...item, reason: error instanceof Error ? error.message : String(error) } }
  }
  item.url = url
  const id = feedIdForUrl(url)
  if (seen.has(id)) return { kind: 'skipped', item: { ...item, reason: 'Already subscribed' } }
  seen.add(id)
  if (await db.feeds.get(id)) return { kind: 'skipped', item: { ...item, reason: 'Already subscribed' } }
  try {
    const feed = await subscribeToFeed(url, gateway)
    if (source.folderPath) {
      const folderId = await folderForPath(source.folderPath, folders)
      await moveFeedToFolder(feed.id, folderId)
    }
    return { kind: 'imported', item: { ...item, title: feed.title } }
  } catch (error) {
    return { kind: 'failed', item: { ...item, reason: error instanceof Error ? error.message : String(error) } }
  }
}

export async function importOpml(xml: string, gateway: FeedGateway = feedGateway): Promise<OpmlImportResult> {
  const sources = parseOpml(xml)
  const seen = new Set<string>()
  const folders = new Map<string, string>()
  const result: OpmlImportResult = { imported: [], skipped: [], failed: [] }
  for (let index = 0; index < sources.length; index += 4) {
    const batch = await Promise.all(sources.slice(index, index + 4).map((source) => importOne(source, seen, folders, gateway)))
    for (const item of batch) result[item.kind].push(item.item)
  }
  return result
}
