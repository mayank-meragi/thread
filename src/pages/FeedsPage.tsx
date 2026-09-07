import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ExternalLink, FileUp, Folder, FolderPlus, MoreHorizontal, Pencil, Plus, RefreshCw, Rss, Trash2, X } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type FeedEntryRecord, type FeedFolderRecord, type FeedRecord } from '../db'
import { feedGateway, feedUrlPrivacyWarning, markAllFeedEntriesRead, markAllFeedEntriesUnread, markFeedEntryRead, recordFeedError, refreshFeed, removeFeed, sanitizeFeedHtml, subscribeToFeed, createFeedFolder, renameFeedFolder, deleteFeedFolder, moveFeedToFolder } from '../lib/rss'
import { importOpml, type OpmlImportResult } from '../lib/rssOpml'
import { articleGateway } from '../lib/rssArticle'
import { getRssSettings } from '../lib/rssSettings'

type InboxFilter = 'all' | 'unread'
type MobilePane = 'sources' | 'entries' | 'reader'
type SourceSelection =
  | { kind: 'all' }
  | { kind: 'folder'; id: string }
  | { kind: 'feed'; id: string }

function displayDate(value: string | undefined): string {
  if (!value) return 'No date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'No date'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function relativeDate(value: string | undefined): string {
  if (!value) return ''
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return ''
  const days = Math.floor((Date.now() - timestamp) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return displayDate(value)
}

function entryDateBucket(value: string | undefined): string {
  if (!value) return 'Earlier'
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'Earlier'
  const days = Math.floor((Date.now() - timestamp) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'Previous 7 days'
  return 'Earlier'
}

function entryTime(value: string | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const sameDay = Math.floor((Date.now() - date.getTime()) / 86_400_000) <= 0
  return new Intl.DateTimeFormat(undefined, sameDay ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' }).format(date)
}

function readerMeta(entry: FeedEntryRecord): string {
  const stamp = entry.publishedAt ?? entry.fetchedAt
  const absolute = displayDate(stamp)
  const relative = relativeDate(stamp)
  return [entry.author, absolute, relative && relative !== absolute ? relative : undefined].filter(Boolean).join(' · ')
}

function sourceKey(source: SourceSelection): string {
  return source.kind === 'all' ? 'all' : `${source.kind}:${source.id}`
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

export function FeedsPage() {
  const feeds = useLiveQuery(() => db.feeds.orderBy('title').toArray(), [], [])
  const folders = useLiveQuery(() => db.feedFolders.orderBy('name').toArray(), [], [])
  const [selectedSource, setSelectedSource] = useState<SourceSelection>({ kind: 'all' })
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<'subscribe' | 'import' | 'folder' | 'folder-delete' | null>(null)
  const [folderDialogMode, setFolderDialogMode] = useState<'create' | 'rename'>('create')
  const [folderDialogTarget, setFolderDialogTarget] = useState<FeedFolderRecord | null>(null)
  const [folderName, setFolderName] = useState('')
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<FeedFolderRecord | null>(null)
  const [folderError, setFolderError] = useState('')
  const [feedUrl, setFeedUrl] = useState('')
  const [feedUrlWarning, setFeedUrlWarning] = useState<string | undefined>()
  const [subscribeFolderId, setSubscribeFolderId] = useState<string | undefined>()
  const [subscribeState, setSubscribeState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [subscribeError, setSubscribeError] = useState('')
  const [importState, setImportState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [importError, setImportError] = useState('')
  const [importResult, setImportResult] = useState<OpmlImportResult | null>(null)
  const [fullArticleLoadingId, setFullArticleLoadingId] = useState<string | null>(null)
  const [mobilePane, setMobilePane] = useState<MobilePane>('sources')
  const [sourceMenuId, setSourceMenuId] = useState<string | null>(null)
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set())
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(() => getRssSettings().refreshIntervalMs)
  const importInputRef = useRef<HTMLInputElement>(null)
  const autoRefreshStartedRef = useRef(false)
  const autoRefreshInFlightRef = useRef(false)

  useEffect(() => {
    const update = () => setRefreshIntervalMs(getRssSettings().refreshIntervalMs)
    window.addEventListener('thread:rss-settings', update)
    return () => window.removeEventListener('thread:rss-settings', update)
  }, [])

  useEffect(() => {
    if (!dialog) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialog(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [dialog])

  const runRefresh = useCallback(async (feed: FeedRecord) => {
    setRefreshing((current) => new Set(current).add(feed.id))
    try {
      await refreshFeed(feed, feedGateway)
    } catch (error) {
      await recordFeedError(feed, error)
    } finally {
      setRefreshing((current) => {
        const next = new Set(current)
        next.delete(feed.id)
        return next
      })
    }
  }, [])

  const refreshMany = useCallback(async (source: FeedRecord[]) => {
    for (let index = 0; index < source.length; index += 4) {
      await Promise.all(source.slice(index, index + 4).map((feed) => runRefresh(feed)))
    }
  }, [runRefresh])

  async function runAutomaticRefresh(source: FeedRecord[]) {
    if (autoRefreshInFlightRef.current || source.length === 0) return
    autoRefreshInFlightRef.current = true
    try {
      await refreshMany(source)
    } finally {
      autoRefreshInFlightRef.current = false
    }
  }

  const entries = useLiveQuery(async () => {
    let source: FeedEntryRecord[]
    if (selectedSource.kind === 'feed') {
      source = await db.feedEntries.where('feedId').equals(selectedSource.id).toArray()
    } else if (selectedSource.kind === 'folder') {
      const folderFeeds = await db.feeds.where('folderId').equals(selectedSource.id).toArray()
      const feedIds = new Set(folderFeeds.map((feed) => feed.id))
      source = (await db.feedEntries.toArray()).filter((entry) => feedIds.has(entry.feedId))
    } else {
      source = await db.feedEntries.toArray()
    }
    return source.sort((a, b) => (b.publishedAt ?? b.fetchedAt).localeCompare(a.publishedAt ?? a.fetchedAt))
  }, [sourceKey(selectedSource)], [])

  const selectedFeed = selectedSource.kind === 'feed' ? feeds.find((feed) => feed.id === selectedSource.id) : undefined
  const selectedFolder = selectedSource.kind === 'folder' ? folders.find((folder) => folder.id === selectedSource.id) : undefined
  const visibleEntries = useMemo(() => filter === 'unread' ? entries.filter((entry) => !entry.readAt) : entries, [entries, filter])
  const groupedEntries = useMemo(() => {
    const groups: { label: string; entries: FeedEntryRecord[] }[] = []
    for (const entry of visibleEntries) {
      const label = entryDateBucket(entry.publishedAt ?? entry.fetchedAt)
      const last = groups[groups.length - 1]
      if (last && last.label === label) last.entries.push(entry)
      else groups.push({ label, entries: [entry] })
    }
    return groups
  }, [visibleEntries])
  const selectedEntry = visibleEntries.find((entry) => entry.id === selectedEntryId) ?? visibleEntries[0]
  const unreadByFeed = useLiveQuery(async () => {
    const all = await db.feedEntries.toArray()
    return new Map(feeds.map((feed) => [feed.id, all.filter((entry) => entry.feedId === feed.id && !entry.readAt).length]))
  }, [feeds], new Map<string, number>())
  const folderUnread = useMemo(() => {
    const counts = new Map<string, number>()
    for (const feed of feeds) if (feed.folderId) counts.set(feed.folderId, (counts.get(feed.folderId) ?? 0) + (unreadByFeed.get(feed.id) ?? 0))
    return counts
  }, [feeds, unreadByFeed])
  const totalUnread = [...unreadByFeed.values()].reduce((total, count) => total + count, 0)

  useEffect(() => {
    if (refreshIntervalMs === 0 || autoRefreshStartedRef.current || feeds.length === 0) return
    autoRefreshStartedRef.current = true
    const stale = feeds.filter((feed) => !feed.lastFetchedAt || Date.now() - new Date(feed.lastFetchedAt).getTime() > refreshIntervalMs)
    void runAutomaticRefresh(stale)
  // The initial list is intentionally the only trigger for this refresh pass.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeds.length, refreshIntervalMs])

  useEffect(() => {
    if (refreshIntervalMs === 0) return
    const timer = window.setInterval(() => {
      void db.feeds.toArray().then((source) => runAutomaticRefresh(source))
    }, refreshIntervalMs)
    return () => window.clearInterval(timer)
  // The timer deliberately depends only on the persisted user preference.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshIntervalMs])

  async function refreshAll() {
    await refreshMany(feeds)
  }

  function openSubscribe() {
    setDialog('subscribe')
    setSubscribeState('idle')
    setSubscribeError('')
    setFeedUrlWarning(undefined)
    setSubscribeFolderId(selectedSource.kind === 'folder' ? selectedSource.id : undefined)
  }

  async function submitSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubscribeState('loading')
    setSubscribeError('')
    try {
      const feed = await subscribeToFeed(feedUrl, feedGateway, { folderId: subscribeFolderId })
      setSelectedSource({ kind: 'feed', id: feed.id })
      setSelectedEntryId(null)
      setMobilePane('entries')
      setFeedUrl('')
      setFeedUrlWarning(undefined)
      setDialog(null)
      setSubscribeState('idle')
    } catch (error) {
      setSubscribeState('error')
      setSubscribeError(error instanceof Error ? error.message : String(error))
    }
  }

  function openFolderDialog(mode: 'create' | 'rename', folder?: FeedFolderRecord) {
    setFolderDialogMode(mode)
    setFolderDialogTarget(folder ?? null)
    setFolderName(folder?.name ?? '')
    setFolderError('')
    setDialog('folder')
    setSourceMenuId(null)
  }

  async function submitFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFolderError('')
    try {
      if (folderDialogMode === 'create') await createFeedFolder(folderName)
      else if (folderDialogTarget) await renameFeedFolder(folderDialogTarget.id, folderName)
      setDialog(null)
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : String(error))
    }
  }

  function openFolderDelete(folder: FeedFolderRecord) {
    setFolderDeleteTarget(folder)
    setDialog('folder-delete')
    setSourceMenuId(null)
  }

  async function finishFolderDelete(mode: 'ungroup' | 'delete') {
    if (!folderDeleteTarget) return
    await deleteFeedFolder(folderDeleteTarget.id, mode)
    if (selectedSource.kind === 'folder' && selectedSource.id === folderDeleteTarget.id) {
      setSelectedSource({ kind: 'all' })
      setSelectedEntryId(null)
    }
    setFolderDeleteTarget(null)
    setDialog(null)
  }

  function openImport() {
    setDialog('import')
    setImportState('idle')
    setImportError('')
    setImportResult(null)
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) return
    setImportState('loading')
    setImportError('')
    setImportResult(null)
    try {
      const result = await importOpml(await file.text(), feedGateway)
      setImportResult(result)
      setImportState('idle')
    } catch (error) {
      setImportState('error')
      setImportError(error instanceof Error ? error.message : String(error))
    }
  }

  function selectSource(source: SourceSelection) {
    setSelectedSource(source)
    setSelectedEntryId(null)
    setSourceMenuId(null)
    setMobilePane('entries')
  }

  const markFolderRead = useCallback(async (folderId: string) => {
    const folderFeeds = await db.feeds.where('folderId').equals(folderId).toArray()
    await Promise.all(folderFeeds.map((feed) => markAllFeedEntriesRead(feed.id)))
  }, [])

  const refreshFolder = useCallback(async (folderId: string) => {
    await refreshMany(feeds.filter((feed) => feed.folderId === folderId))
  }, [feeds, refreshMany])

  function toggleFolder(folderId: string) {
    setCollapsedFolderIds((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  const foldersCollapsed = folders.length > 0 && folders.every((folder) => collapsedFolderIds.has(folder.id))

  function toggleAllFolders() {
    setCollapsedFolderIds(foldersCollapsed ? new Set() : new Set(folders.map((folder) => folder.id)))
  }

  async function selectEntry(entry: FeedEntryRecord) {
    setSelectedEntryId(entry.id)
    setMobilePane('reader')
    if (!entry.readAt) await markFeedEntryRead(entry.id, true)
  }

  const fetchFullArticle = useCallback(async (entry: FeedEntryRecord) => {
    if (!entry.url || fullArticleLoadingId === entry.id) return
    setFullArticleLoadingId(entry.id)
    try {
      const article = await articleGateway.fetchArticle(entry.url)
      const articleHtml = sanitizeFeedHtml(article.contentHtml, entry.url)
      if (!articleHtml) throw new Error('Readable article content was not found on this page.')
      await db.feedEntries.update(entry.id, { articleHtml, articleFetchedAt: new Date().toISOString(), articleError: undefined })
    } catch (error) {
      await db.feedEntries.update(entry.id, { articleError: error instanceof Error ? error.message : String(error) })
    } finally {
      setFullArticleLoadingId((current) => current === entry.id ? null : current)
    }
  }, [fullArticleLoadingId])

  async function markCurrentSource(read: boolean) {
    if (selectedSource.kind === 'feed') {
      if (read) await markAllFeedEntriesRead(selectedSource.id)
      else await markAllFeedEntriesUnread(selectedSource.id)
      return
    }
    if (selectedSource.kind === 'folder') {
      const source = await db.feeds.where('folderId').equals(selectedSource.id).toArray()
      await Promise.all(source.map((feed) => read ? markAllFeedEntriesRead(feed.id) : markAllFeedEntriesUnread(feed.id)))
      return
    }
    if (read) await markAllFeedEntriesRead()
    else await markAllFeedEntriesUnread()
  }

  const refreshCurrentSource = useCallback(async () => {
    if (selectedSource.kind === 'feed') {
      const feed = feeds.find((item) => item.id === selectedSource.id)
      if (feed) await runRefresh(feed)
      return
    }
    const source = selectedSource.kind === 'folder' ? feeds.filter((feed) => feed.folderId === selectedSource.id) : feeds
    await refreshMany(source)
  }, [feeds, refreshMany, runRefresh, selectedSource])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || dialog || isEditableTarget(event.target)) return
      const key = event.key.toLocaleLowerCase()
      if (key === 'j' || key === 'k') {
        if (visibleEntries.length === 0) return
        event.preventDefault()
        const currentIndex = selectedEntry ? visibleEntries.findIndex((entry) => entry.id === selectedEntry.id) : key === 'j' ? -1 : visibleEntries.length
        const nextIndex = Math.max(0, Math.min(visibleEntries.length - 1, currentIndex + (key === 'j' ? 1 : -1)))
        const next = visibleEntries[nextIndex]
        setSelectedEntryId(next.id)
        setMobilePane('reader')
        void markFeedEntryRead(next.id, true)
        window.setTimeout(() => document.querySelector<HTMLElement>(`[data-feed-entry-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' }), 0)
      } else if (key === 'f' && selectedEntry?.url) {
        event.preventDefault()
        void fetchFullArticle(selectedEntry)
      } else if (key === 'o' && selectedEntry?.url) {
        event.preventDefault()
        window.open(selectedEntry.url, '_blank', 'noopener,noreferrer')
      } else if (key === 'm' && selectedEntry) {
        event.preventDefault()
        const shouldRead = !selectedEntry.readAt
        if (shouldRead && filter === 'unread') {
          const index = visibleEntries.findIndex((entry) => entry.id === selectedEntry.id)
          setSelectedEntryId(visibleEntries[index + 1]?.id ?? visibleEntries[index - 1]?.id ?? null)
        }
        void markFeedEntryRead(selectedEntry.id, shouldRead)
      } else if (key === 'r') {
        event.preventDefault()
        void refreshCurrentSource()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog, fetchFullArticle, filter, refreshCurrentSource, selectedEntry, visibleEntries])

  const renderFeedRow = (feed: FeedRecord) => (
    <div className="feed-source-row-wrap" key={feed.id}>
      <button type="button" className={`feed-source-row${selectedSource.kind === 'feed' && selectedSource.id === feed.id ? ' is-active' : ''}`} onClick={() => selectSource({ kind: 'feed', id: feed.id })} title={feed.lastError ?? feed.title}>
        <span className="feed-source-icon"><span className="feed-source-dot" /></span><span className="feed-source-name">{feed.title}</span>{feed.lastError && <span className="feed-source-error" aria-label="Feed has an error">!</span>}{(unreadByFeed.get(feed.id) ?? 0) > 0 && <b>{unreadByFeed.get(feed.id)}</b>}
      </button>
      <button type="button" className="feed-source-more" aria-label={`Actions for ${feed.title}`} onClick={() => setSourceMenuId(sourceMenuId === feed.id ? null : feed.id)}><MoreHorizontal size={15} /></button>
      {sourceMenuId === feed.id && <div className="feed-source-menu menu-panel"><button type="button" className="menu-item" onClick={() => void runRefresh(feed)} disabled={refreshing.has(feed.id)}><RefreshCw size={14} /> Refresh</button><span className="feed-menu-label">Move to</span><button type="button" className="menu-item" onClick={() => { void moveFeedToFolder(feed.id, undefined); setSourceMenuId(null) }}>Ungrouped</button>{folders.map((folder) => <button type="button" className="menu-item" key={folder.id} onClick={() => { void moveFeedToFolder(feed.id, folder.id); setSourceMenuId(null) }}>{folder.name}</button>)}<button type="button" className="menu-item feed-menu-danger" onClick={() => { setSourceMenuId(null); if (window.confirm(`Remove “${feed.title}” and its cached entries?`)) void removeFeed(feed.id) }}><Trash2 size={14} /> Remove subscription</button></div>}
    </div>
  )

  return (
    <article className="feeds-page" aria-keyshortcuts="J K F O M R">
      <header className="feeds-topbar"><div className="feeds-topbar-title"><Rss size={16} /><strong>Feeds</strong><span className="feeds-shortcuts">J/K navigate · F full article · O open · M read · R refresh</span></div><div className="feeds-topbar-actions"><button type="button" className="secondary-button" onClick={() => void refreshAll()} disabled={refreshing.size > 0 || feeds.length === 0}><RefreshCw size={15} className={refreshing.size > 0 ? 'feeds-spin' : undefined} /> <span>Refresh</span></button><button type="button" className="secondary-button" onClick={openImport}><FileUp size={15} /> <span>Import</span></button><button type="button" className="primary-button" onClick={openSubscribe}><Plus size={15} /> <span>Add feed</span></button></div></header>

      <div className="feeds-workspace" data-mobile-pane={mobilePane}>
        <aside className="feeds-sources" aria-label="Subscriptions"><div className="feeds-panel-head"><span>Subscriptions</span><div><span className="feeds-panel-count">{feeds.length}</span><button type="button" className="feed-panel-action" aria-label={foldersCollapsed ? 'Expand all folders' : 'Collapse all folders'} title={foldersCollapsed ? 'Expand all folders' : 'Collapse all folders'} onClick={toggleAllFolders} disabled={folders.length === 0}>{foldersCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}</button><button type="button" className="feed-panel-action" aria-label="Create folder" onClick={() => openFolderDialog('create')}><FolderPlus size={15} /></button></div></div><div className="feeds-source-scroll"><button type="button" className={`feed-source-row${selectedSource.kind === 'all' ? ' is-active' : ''}`} onClick={() => selectSource({ kind: 'all' })}><span className="feed-source-icon"><Rss size={15} /></span><span className="feed-source-name">All feeds</span>{totalUnread > 0 && <b>{totalUnread}</b>}</button>{folders.map((folder) => { const collapsed = collapsedFolderIds.has(folder.id); return <div className="feed-source-group" key={folder.id}><div className="feed-folder-row-wrap" onContextMenu={(event) => { event.preventDefault(); setSourceMenuId(sourceMenuId === `folder:${folder.id}` ? null : `folder:${folder.id}`) }}><button type="button" className="feed-folder-toggle" aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${folder.name}`} aria-expanded={!collapsed} onClick={(event) => { event.stopPropagation(); toggleFolder(folder.id) }}>{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}</button><button type="button" className={`feed-source-row feed-folder-row${selectedSource.kind === 'folder' && selectedSource.id === folder.id ? ' is-active' : ''}`} onClick={() => selectSource({ kind: 'folder', id: folder.id })}><span className="feed-source-icon"><Folder size={14} /></span><span className="feed-source-name">{folder.name}</span>{(folderUnread.get(folder.id) ?? 0) > 0 && <b>{folderUnread.get(folder.id)}</b>}</button><button type="button" className="feed-source-more" aria-label={`Actions for ${folder.name}`} onClick={() => setSourceMenuId(sourceMenuId === `folder:${folder.id}` ? null : `folder:${folder.id}`)}><MoreHorizontal size={15} /></button>{sourceMenuId === `folder:${folder.id}` && <div className="feed-source-menu menu-panel"><button type="button" className="menu-item" onClick={() => { void markFolderRead(folder.id); setSourceMenuId(null) }}><Check size={14} /> Mark all read</button><button type="button" className="menu-item" onClick={() => { void refreshFolder(folder.id); setSourceMenuId(null) }}><RefreshCw size={14} /> Refresh feeds</button><button type="button" className="menu-item" onClick={() => openFolderDialog('rename', folder)}><Pencil size={14} /> Rename</button><button type="button" className="menu-item feed-menu-danger" onClick={() => openFolderDelete(folder)}><Trash2 size={14} /> Delete folder</button></div>}</div>{!collapsed && feeds.filter((feed) => feed.folderId === folder.id).map(renderFeedRow)}</div> })}{feeds.some((feed) => !feed.folderId) && <div className="feed-source-group feed-ungrouped"><div className="feed-group-label">Ungrouped</div>{feeds.filter((feed) => !feed.folderId).map(renderFeedRow)}</div>}{feeds.length === 0 && <div className="feeds-empty-source"><p>No subscriptions yet.</p><button type="button" onClick={openSubscribe}>Add your first feed</button></div>}</div></aside>

        <section className="feeds-inbox" aria-label="Feed inbox"><div className="feeds-inbox-head"><button type="button" className="feed-mobile-back" onClick={() => setMobilePane('sources')}><ArrowLeft size={15} /> Sources</button><div className="feeds-tabs" role="tablist"><button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>All <span>{entries.length}</span></button><button type="button" role="tab" aria-selected={filter === 'unread'} className={filter === 'unread' ? 'is-active' : ''} onClick={() => setFilter('unread')}>Unread <span>{entries.filter((entry) => !entry.readAt).length}</span></button></div><div className="feeds-bulk-actions"><button type="button" className="feeds-mark-all" onClick={() => void markCurrentSource(true)} disabled={!entries.some((entry) => !entry.readAt)}><Check size={14} /> Mark all read</button><button type="button" className="feeds-mark-all" onClick={() => void markCurrentSource(false)} disabled={!entries.some((entry) => entry.readAt)}>Mark all unread</button></div></div><div className="feeds-entry-list">{groupedEntries.map((group) => <div className="feed-entry-group" key={group.label}><div className="feed-entry-group-label">{group.label}</div>{group.entries.map((entry) => { const source = feeds.find((feed) => feed.id === entry.feedId); return <button type="button" data-feed-entry-id={entry.id} className={`feed-entry-row${selectedEntry?.id === entry.id ? ' is-active' : ''}${entry.readAt ? '' : ' is-unread'}`} onClick={() => void selectEntry(entry)} key={entry.id}><span className="feed-entry-copy"><strong>{entry.title}</strong><span className="feed-entry-sub"><span className="feed-entry-source">{source?.title ?? 'Feed'}</span><time className="feed-entry-time">{entryTime(entry.publishedAt ?? entry.fetchedAt)}</time></span></span></button> })}</div>)}{visibleEntries.length === 0 && <div className="feeds-empty-list"><Rss size={25} /><strong>{feeds.length === 0 ? 'Your reading list starts here.' : filter === 'unread' ? 'You are caught up.' : 'No entries cached yet.'}</strong><p>{feeds.length === 0 ? 'Add a feed to bring a little more signal into your day.' : 'Refresh a subscription to check for new entries.'}</p></div>}</div></section>

        <section className="feed-reader" aria-label="Article detail"><div className="feed-reader-head"><button type="button" className="feed-mobile-back" onClick={() => setMobilePane('entries')}><ArrowLeft size={15} /> Entries</button><span>{selectedFeed?.title ?? selectedFolder?.name ?? (selectedSource.kind === 'all' ? 'All feeds' : 'Feed')}</span>{selectedEntry && <div className="feed-reader-head-actions">{selectedEntry.url && <a className="icon-button" href={selectedEntry.url} target="_blank" rel="noreferrer" aria-label="Open original article"><ExternalLink size={15} /></a>}<button type="button" className="icon-button" aria-label={selectedEntry.readAt ? 'Mark unread' : 'Mark read'} onClick={() => void markFeedEntryRead(selectedEntry.id, !selectedEntry.readAt)}>{selectedEntry.readAt ? <span className="feed-read-indicator" aria-hidden="true" /> : <Check size={16} />}</button></div>}</div>{selectedEntry ? <div className="feed-reader-scroll"><div className="feed-reader-body"><h2>{selectedEntry.title}</h2><div className="feed-reader-meta">{readerMeta(selectedEntry)}</div>{selectedEntry.articleError && <p className="feed-article-error" role="alert">{selectedEntry.articleError}</p>}{selectedEntry.articleHtml ? <><div className="feed-article-badge">Full article{selectedEntry.articleFetchedAt ? ` · fetched ${relativeDate(selectedEntry.articleFetchedAt).toLowerCase()}` : ''}</div><div className="feed-reader-content" dangerouslySetInnerHTML={{ __html: selectedEntry.articleHtml }} /></> : selectedEntry.summaryHtml ? <div className="feed-reader-content" dangerouslySetInnerHTML={{ __html: sanitizeFeedHtml(selectedEntry.summaryHtml, selectedEntry.url ?? selectedFeed?.siteUrl) }} /> : <p className="feed-reader-empty">This entry has no summary. Fetch the full article or open the original article to continue reading.</p>}{selectedEntry.url && <div className="feed-reader-actions"><button type="button" className="feed-fetch-article" onClick={() => void fetchFullArticle(selectedEntry)} disabled={fullArticleLoadingId === selectedEntry.id}>{fullArticleLoadingId === selectedEntry.id ? 'Fetching article…' : selectedEntry.articleHtml ? 'Refresh full article' : 'Get full article'} <kbd>F</kbd></button><a className="feed-original-link" href={selectedEntry.url} target="_blank" rel="noreferrer">Open original article <ExternalLink size={14} /></a></div>}</div></div> : <div className="feed-reader-empty-state"><Rss size={28} /><strong>Select an entry to read.</strong><p>Your selected feed’s summaries will appear here.</p></div>}</section>
      </div>

      {dialog === 'subscribe' && <div className="layer-backdrop layer-backdrop-center feeds-dialog-backdrop"><form className="dialog feed-dialog" onSubmit={(event) => void submitSubscription(event)}><div className="feed-dialog-head"><div><Rss size={16} /><strong>Subscribe to a feed</strong></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setDialog(null)}><X size={16} /></button></div><label className="field"><span className="field-label">Feed URL</span><input className="field-control" autoFocus type="url" value={feedUrl} onChange={(event) => { setFeedUrl(event.target.value); setFeedUrlWarning(feedUrlPrivacyWarning(event.target.value)) }} placeholder="https://example.com/feed.xml" required /></label>{folders.length > 0 && <label className="field"><span className="field-label">Folder</span><select className="field-control" value={subscribeFolderId ?? ''} onChange={(event) => setSubscribeFolderId(event.target.value || undefined)}><option value="">Ungrouped</option>{folders.map((folder) => <option value={folder.id} key={folder.id}>{folder.name}</option>)}</select></label>}{feedUrlWarning && <p className="field-hint field-hint-error">{feedUrlWarning}</p>}{subscribeState === 'error' && <p className="banner banner-error" role="alert">{subscribeError}</p>}<div className="feed-dialog-actions"><button type="button" className="secondary-button" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="primary-button" disabled={subscribeState === 'loading'}>{subscribeState === 'loading' ? 'Checking…' : 'Subscribe'}</button></div></form></div>}

      {dialog === 'import' && <div className="layer-backdrop layer-backdrop-center feeds-dialog-backdrop"><div className="dialog feed-dialog"><div className="feed-dialog-head"><div><FileUp size={16} /><strong>Import OPML</strong></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setDialog(null)}><X size={16} /></button></div><p className="feed-dialog-copy">Import subscriptions from an OPML file. Existing feeds are skipped and folders are preserved as one-level paths.</p><input ref={importInputRef} type="file" accept=".opml,application/xml,text/xml" hidden onChange={(event) => { void handleImportFile(event.target.files?.[0]); event.currentTarget.value = '' }} /><button type="button" className="secondary-button feed-file-button" onClick={() => importInputRef.current?.click()} disabled={importState === 'loading'}><FileUp size={15} /> {importState === 'loading' ? 'Importing…' : 'Choose .opml file'}</button>{importState === 'error' && <p className="banner banner-error" role="alert">{importError}</p>}{importResult && <div className="feed-import-summary" aria-live="polite"><strong>Import complete</strong><span>{importResult.imported.length} imported · {importResult.skipped.length} skipped · {importResult.failed.length} failed</span>{importResult.failed.length > 0 && <ul>{importResult.failed.slice(0, 8).map((item, index) => <li key={`${item.url}-${index}`}>{item.url}: {item.reason}</li>)}</ul>}</div>}<div className="feed-dialog-actions"><button type="button" className="secondary-button" onClick={() => setDialog(null)}>Close</button></div></div></div>}

      {dialog === 'folder' && <div className="layer-backdrop layer-backdrop-center feeds-dialog-backdrop"><form className="dialog feed-dialog" onSubmit={(event) => void submitFolder(event)}><div className="feed-dialog-head"><div><Folder size={16} /><strong>{folderDialogMode === 'create' ? 'Create folder' : 'Rename folder'}</strong></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setDialog(null)}><X size={16} /></button></div><label className="field"><span className="field-label">Folder name</span><input className="field-control" autoFocus value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="e.g. Design" required /></label>{folderError && <p className="banner banner-error" role="alert">{folderError}</p>}<div className="feed-dialog-actions"><button type="button" className="secondary-button" onClick={() => setDialog(null)}>Cancel</button><button type="submit" className="primary-button">{folderDialogMode === 'create' ? 'Create folder' : 'Save name'}</button></div></form></div>}

      {dialog === 'folder-delete' && folderDeleteTarget && <div className="layer-backdrop layer-backdrop-center feeds-dialog-backdrop"><div className="dialog feed-dialog"><div className="feed-dialog-head"><div><Trash2 size={16} /><strong>Delete {folderDeleteTarget.name}?</strong></div><button type="button" className="icon-button" aria-label="Close" onClick={() => setDialog(null)}><X size={16} /></button></div><p className="feed-dialog-copy">Choose whether to keep the subscriptions in this folder.</p><div className="feed-delete-actions"><button type="button" className="secondary-button" onClick={() => void finishFolderDelete('ungroup')}>Move feeds to Ungrouped</button><button type="button" className="danger-button" onClick={() => void finishFolderDelete('delete')}>Delete subscriptions</button></div></div></div>}
    </article>
  )
}
