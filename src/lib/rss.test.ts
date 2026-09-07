import 'fake-indexeddb/auto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db, type FeedEntryRecord } from '../db'
import { canonicalFeedUrl, createFeedFolder, deleteFeedFolder, FeedFetchError, feedUrlPrivacyWarning, markAllFeedEntriesUnread, markFeedEntryRead, moveFeedToFolder, parseFeedXml, pruneFeedEntries, refreshAllFeeds, refreshFeed, resolveUrl, sanitizeFeedHtml, subscribeToFeed, type NormalizedFeed } from './rss'
import { importOpml, parseOpml } from './rssOpml'

beforeEach(async () => {
  await db.open()
  await Promise.all(db.tables.map((table) => table.clear()))
})

afterAll(() => db.close())

describe('RSS and Atom normalization', () => {
  it('normalizes an RSS 2.0 channel and preserves CDATA summaries', () => {
    const feed = parseFeedXml(`
      <rss version="2.0"><channel>
        <title>Signal Notes</title><link>https://example.com/</link>
        <description>Short notes</description>
        <item><guid>one</guid><title>First note</title><link>https://example.com/one</link>
          <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">Mina</dc:creator>
          <pubDate>Tue, 03 Sep 2024 12:00:00 GMT</pubDate>
          <description><![CDATA[<p>Hello <strong>world</strong>.</p>]]></description>
        </item>
      </channel></rss>`, 'https://example.com/feed.xml')

    expect(feed.title).toBe('Signal Notes')
    expect(feed.siteUrl).toBe('https://example.com/')
    expect(feed.entries).toHaveLength(1)
    expect(feed.entries[0]).toMatchObject({
      externalId: expect.any(String),
      title: 'First note',
      url: 'https://example.com/one',
      author: 'Mina',
      publishedAt: '2024-09-03T12:00:00.000Z',
      summaryHtml: '<p>Hello <strong>world</strong>.</p>',
    })
  })

  it('normalizes Atom links and uses updated when published is absent', () => {
    const feed = parseFeedXml(`
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom Journal</title><subtitle>Updates</subtitle>
        <link href="https://example.com/" rel="alternate" />
        <entry><id>tag:example.com,2024:first</id><title>Atom item</title>
          <link href="https://example.com/atom-item" />
          <author><name>Ravi</name></author>
          <updated>2024-09-04T12:00:00Z</updated>
          <summary type="html"><![CDATA[<p>Summary</p>]]></summary>
        </entry>
      </feed>`, 'https://example.com/atom.xml')

    expect(feed).toMatchObject({ title: 'Atom Journal', siteUrl: 'https://example.com/', description: 'Updates' })
    expect(feed.entries[0]).toMatchObject({ title: 'Atom item', url: 'https://example.com/atom-item', author: 'Ravi', publishedAt: '2024-09-04T12:00:00.000Z', summaryHtml: '<p>Summary</p>' })
  })

  it('rejects unsupported documents and canonicalizes valid URLs', () => {
    expect(() => parseFeedXml('<html><body>not a feed</body></html>', 'https://example.com/feed')).toThrow(FeedFetchError)
    expect(canonicalFeedUrl(' HTTPS://Example.com/feed#section ')).toBe('https://example.com/feed')
    expect(() => canonicalFeedUrl('file:///tmp/feed.xml')).toThrow('http:// or https://')
    expect(() => canonicalFeedUrl('https://user:pass@example.com/feed.xml')).toThrow('credentials')
    expect(feedUrlPrivacyWarning('https://example.com/feed.xml?token=abc')).toContain('token')
  })

  it('reduces markup to text when no browser document is available', () => {
    // The DOM-backed path (DOMPurify allowlist + image hardening) is exercised
    // in the browser; under the Node test environment sanitizeFeedHtml falls
    // back to stripping every tag.
    const input = '<p>Good</p><script>alert(1)</script><img src="https://imgs.example.com/pic.png" alt="Pic" /><a href="https://example.com">Link</a>'
    const output = sanitizeFeedHtml(input)
    expect(output).not.toContain('<script')
    expect(output).not.toContain('<img')
    expect(output).toContain('Good')
  })

  it('resolves relative URLs against a base and rejects bare-relative without one', () => {
    expect(resolveUrl('https://imgs.xkcd.com/comics/x.png')).toBe('https://imgs.xkcd.com/comics/x.png')
    expect(resolveUrl('/comics/x.png', 'https://xkcd.com/2000/')).toBe('https://xkcd.com/comics/x.png')
    expect(resolveUrl('../p', 'https://xkcd.com/a/b/')).toBe('https://xkcd.com/a/p')
    expect(resolveUrl('/comics/x.png')).toBeUndefined()
    expect(resolveUrl(null)).toBeUndefined()
  })

  it('subscribes, upserts entries, and preserves read state', async () => {
    const normalized: NormalizedFeed = {
      title: 'Local feed',
      entries: [{ externalId: 'entry-1', title: 'A note', url: 'https://example.com/a', summaryHtml: '<p>Hi</p>' }],
    }
    const gateway = { fetchFeed: async () => normalized }
    const feed = await subscribeToFeed('https://example.com/feed.xml', gateway)
    expect(await db.feeds.get(feed.id)).toMatchObject({ title: 'Local feed', url: 'https://example.com/feed.xml' })
    const entry = await db.feedEntries.get(`${feed.id}:entry-1`)
    expect(entry).toMatchObject({ title: 'A note', readAt: undefined })
    await markFeedEntryRead(entry!.id, true)
    await refreshFeed(feed, gateway)
    expect((await db.feedEntries.get(entry!.id))?.readAt).toEqual(expect.any(String))
    await markAllFeedEntriesUnread(feed.id)
    expect((await db.feedEntries.get(entry!.id))?.readAt).toBeUndefined()
  })

  it('prunes read history while retaining unread entries', async () => {
    const feedId = 'feed-test'
    await db.feeds.put({ id: feedId, url: 'https://example.com/feed.xml', title: 'Test', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    const now = Date.now()
    const entries: FeedEntryRecord[] = Array.from({ length: 502 }, (_, index) => ({
      id: `${feedId}:entry-${index}`,
      feedId,
      externalId: `entry-${index}`,
      title: `Entry ${index}`,
      publishedAt: new Date(now - index * 60_000).toISOString(),
      fetchedAt: new Date(now).toISOString(),
      readAt: new Date(now).toISOString(),
    }))
    entries.push({ id: `${feedId}:old-unread`, feedId, externalId: 'old-unread', title: 'Old unread', publishedAt: new Date(now - 120 * 86_400_000).toISOString(), fetchedAt: new Date(now).toISOString(), readAt: undefined })
    await db.feedEntries.bulkPut(entries)
    await pruneFeedEntries(feedId)
    expect(await db.feedEntries.get(`${feedId}:old-unread`)).toBeDefined()
    expect(await db.feedEntries.count()).toBe(501)
  })

  it('refreshes all subscriptions and records individual failures', async () => {
    const now = new Date().toISOString()
    await db.feeds.bulkPut([
      { id: 'feed-one', url: 'https://one.example/feed.xml', title: 'One', createdAt: now, updatedAt: now },
      { id: 'feed-two', url: 'https://two.example/feed.xml', title: 'Two', createdAt: now, updatedAt: now },
    ])
    const gateway = {
      fetchFeed: async (url: string) => {
        if (url.includes('two.example')) throw new Error('two is unavailable')
        return { title: 'One', entries: [] }
      },
    }
    await expect(refreshAllFeeds(gateway)).resolves.toMatchObject({ total: 2, refreshed: 1, failed: 1 })
    expect((await db.feeds.get('feed-two'))?.lastError).toBe('two is unavailable')
  })
})

describe('RSS folders and OPML import', () => {
  it('parses nested OPML groups into one-level folder paths', () => {
    const sources = parseOpml(`<opml version="2.0"><body><outline text="Reading"><outline title="Tech" text="Tech"><outline text="Signal" xmlUrl="https://example.com/signal.xml" /></outline><outline text="News" xmlUrl="https://example.com/news.xml" /></outline></body></opml>`)
    expect(sources).toEqual([
      { url: 'https://example.com/signal.xml', title: 'Signal', folderPath: 'Reading / Tech' },
      { url: 'https://example.com/news.xml', title: 'News', folderPath: 'Reading' },
    ])
  })

  it('imports valid feeds, preserves folders, skips duplicates, and continues after failures', async () => {
    const gateway = {
      fetchFeed: async (url: string) => {
        if (url.includes('bad.example')) throw new Error('unavailable')
        return { title: url.includes('one.example') ? 'One feed' : 'Two feed', entries: [] }
      },
    }
    const result = await importOpml(`<opml><body><outline text="Group"><outline text="One" xmlUrl="https://one.example/feed.xml" /><outline text="One duplicate" xmlUrl="https://one.example/feed.xml" /><outline text="Bad" xmlUrl="https://bad.example/feed.xml" /></outline><outline text="Two" xmlUrl="https://two.example/feed.xml" /></body></opml>`, gateway)
    expect(result.imported).toHaveLength(2)
    expect(result.skipped).toHaveLength(1)
    expect(result.failed).toHaveLength(1)
    expect(await db.feedFolders.toArray()).toHaveLength(1)
    expect((await db.feeds.toArray()).map((feed) => feed.title).sort()).toEqual(['One feed', 'Two feed'])
  })

  it('supports folder move and both folder deletion modes', async () => {
    const folder = await createFeedFolder('Read later')
    const feed = await subscribeToFeed('https://example.com/feed.xml', { fetchFeed: async () => ({ title: 'Example', entries: [] }) }, { folderId: folder.id })
    await moveFeedToFolder(feed.id, undefined)
    expect((await db.feeds.get(feed.id))?.folderId).toBeUndefined()
    await moveFeedToFolder(feed.id, folder.id)
    await deleteFeedFolder(folder.id, 'ungroup')
    expect(await db.feeds.get(feed.id)).toBeDefined()
    expect((await db.feeds.get(feed.id))?.folderId).toBeUndefined()

    const deleteFolder = await createFeedFolder('Delete me')
    const deleteFeed = await subscribeToFeed('https://example.com/delete.xml', { fetchFeed: async () => ({ title: 'Delete', entries: [] }) }, { folderId: deleteFolder.id })
    await deleteFeedFolder(deleteFolder.id, 'delete')
    expect(await db.feeds.get(deleteFeed.id)).toBeUndefined()
  })
})
