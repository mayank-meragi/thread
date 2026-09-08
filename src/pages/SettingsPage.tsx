import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BarChart3, BookOpen, Bot, Check, Eye, EyeOff, FileText, GitBranch, LoaderCircle, Palette, Plus, RefreshCw, Rss, ShieldCheck, Trash2, Unplug, Users, Wand2 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSearchParams } from 'react-router-dom'
import { generateText } from 'ai'
import { db, type PersonaRecord } from '../db'
import { clearAIConfig, getAIConfig, resolveModel, saveAIConfig, type AIConfig, type AIProvider } from '../lib/ai'
import { DynamicIcon } from '../lib/icons'
import { archivePersona, createPersona, GENERAL_PERSONA_ID, updatePersona } from '../lib/personas'
import { generatePersonaFromDescription } from '../lib/personaBuilder'
import { IconPicker } from '../components/IconPicker'
import {
  clearGitHubConfig,
  getGitHubConfig,
  runGitHubSyncCycle,
  resolveConflict,
  saveGitHubConfig,
  validateGitHub,
  type GitHubConfig,
} from '../lib/github'
import { applyTheme, getTheme, themes, type ThemeId } from '../lib/theme'
import { commandRegistry } from '../lib/commands'
import { revokeCapability, useTrustedCapabilities } from '../lib/threadscript/trustedCapabilities'
import { MetadataSchemas } from '../components/MetadataSchemas'
import { clearRssProxyConfig, generateRssProxyAccessKey, getRssProxyConfig, saveRssProxyConfig, testRssProxyConnection } from '../lib/rssProxy'
import { refreshAllFeeds } from '../lib/rss'
import { getRssSettings, RSS_REFRESH_INTERVALS, saveRssSettings, type RssRefreshInterval } from '../lib/rssSettings'
import { clearModelPriceOverride, formatAIUsageCost, getBuiltInModelPrice, getEffectiveModelPrice, getModelPriceOverride, groupAIUsage, saveModelPriceOverride, summarizeAIUsage, type AIUsageFeature, type AIUsagePeriod } from '../lib/aiUsage'

const SETTINGS_CATEGORIES = [
  { id: 'appearance', label: 'Appearance', description: 'Theme and display', Icon: Palette },
  { id: 'rss', label: 'RSS feeds', description: 'Fetching and proxy', Icon: Rss },
  { id: 'sync', label: 'Data & sync', description: 'Storage and GitHub', Icon: GitBranch },
  { id: 'ai', label: 'AI & personas', description: 'Provider and assistants', Icon: Bot },
  { id: 'workspace', label: 'Workspace', description: 'Schemas and templates', Icon: FileText },
  { id: 'security', label: 'Security', description: 'Trusted actions', Icon: ShieldCheck },
  { id: 'help', label: 'Help', description: 'Guides and reference', Icon: BookOpen },
] as const

type SettingsCategory = typeof SETTINGS_CATEGORIES[number]['id']

const AI_USAGE_FEATURE_LABELS: Record<AIUsageFeature, string> = {
  chat: 'Chat',
  'persona-builder': 'Persona builder',
  'connection-test': 'Connection test',
}

const integerFormat = new Intl.NumberFormat('en-US')

function isSettingsCategory(value: string | null): value is SettingsCategory {
  return SETTINGS_CATEGORIES.some((category) => category.id === value)
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const focusSync = searchParams.get('focus') === 'sync'
  const requestedCategory = searchParams.get('section')
  const activeCategory: SettingsCategory = focusSync
    ? 'sync'
    : isSettingsCategory(requestedCategory) ? requestedCategory : 'appearance'
  const syncHeadingRef = useRef<HTMLHeadingElement>(null)
  const existing = getGitHubConfig()
  const [repo, setRepo] = useState(existing?.repo ?? '')
  const [branch, setBranch] = useState(existing?.branch ?? 'main')
  const [token, setToken] = useState(existing?.token ?? '')
  const [state, setState] = useState<'idle' | 'checking' | 'syncing' | 'pulling' | 'done'>('idle')
  const [error, setError] = useState('')
  const [theme, setTheme] = useState<ThemeId>(() => getTheme())
  const existingRssProxy = getRssProxyConfig()
  const [rssProxyUrl, setRssProxyUrl] = useState(existingRssProxy?.baseUrl ?? '')
  const [rssProxyKey, setRssProxyKey] = useState(existingRssProxy?.accessKey ?? '')
  const [showRssProxyKey, setShowRssProxyKey] = useState(false)
  const [rssProxyState, setRssProxyState] = useState<'idle' | 'checking' | 'done'>('idle')
  const [rssProxyError, setRssProxyError] = useState('')
  const initialRssSettings = getRssSettings()
  const [rssRefreshIntervalMs, setRssRefreshIntervalMs] = useState<RssRefreshInterval>(initialRssSettings.refreshIntervalMs)
  const [rssManualState, setRssManualState] = useState<'idle' | 'refreshing' | 'done'>('idle')
  const [rssManualMessage, setRssManualMessage] = useState('')
  const rssFeeds = useLiveQuery(() => db.feeds.toArray(), [], [])
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const syncStatus = useLiveQuery(
    async () => existing ? db.syncStates.get(`${existing.repo}@${existing.branch}`) : undefined,
    [existing?.repo, existing?.branch],
  )
  const conflicts = useLiveQuery(
    async () => {
      const unresolved = await db.conflicts.filter((conflict) => !conflict.resolvedAt).toArray()
      return unresolved.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
    },
    [],
    [],
  )
  const [resolving, setResolving] = useState<string | null>(null)
  const [resolveError, setResolveError] = useState('')
  const [hunkChoices, setHunkChoices] = useState<Record<string, Record<number, 'local' | 'remote'>>>({})

  function setHunkChoice(conflictId: string, index: number, choice: 'local' | 'remote') {
    setHunkChoices((prev) => ({ ...prev, [conflictId]: { ...prev[conflictId], [index]: choice } }))
  }

  async function resolve(conflictId: string, choice: 'local' | 'remote' | Map<number, 'local' | 'remote'>) {
    setResolving(conflictId)
    setResolveError('')
    try {
      await resolveConflict(conflictId, choice)
      setHunkChoices((prev) => {
        const next = { ...prev }
        delete next[conflictId]
        return next
      })
    } catch (caught) {
      setResolveError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setResolving(null)
    }
  }

  useEffect(() => {
    if (state !== 'done') return
    const timer = window.setTimeout(() => setState('idle'), 1800)
    return () => window.clearTimeout(timer)
  }, [state])

  useEffect(() => {
    if (!focusSync || activeCategory !== 'sync') return
    syncHeadingRef.current?.scrollIntoView({ block: 'start' })
    syncHeadingRef.current?.focus({ preventScroll: true })
  }, [activeCategory, focusSync])

  function chooseCategory(category: SettingsCategory) {
    const next = new URLSearchParams(searchParams)
    next.set('section', category)
    next.delete('focus')
    setSearchParams(next)
  }

  async function connect() {
    setError('')
    const config: GitHubConfig = { repo: repo.trim(), branch: branch.trim(), token: token.trim() }
    if (!config.repo.includes('/')) return setError('Use owner/repository format.')
    setState('checking')
    try {
      await validateGitHub(config)
      saveGitHubConfig(config)
      setState('syncing')
      await runGitHubSyncCycle()
      setState('done')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setState('idle')
    }
  }

  async function sync() {
    setError('')
    setState('syncing')
    try {
      await runGitHubSyncCycle()
      setState('done')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setState('idle')
    }
  }

  async function pull() {
    setError('')
    setState('pulling')
    try {
      await runGitHubSyncCycle({ forceFull: true })
      setState('done')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      setState('idle')
    }
  }

  function chooseTheme(nextTheme: ThemeId) {
    setTheme(nextTheme)
    applyTheme(nextTheme)
  }

  async function connectRssProxy() {
    setRssProxyError('')
    const config = { baseUrl: rssProxyUrl.trim(), accessKey: rssProxyKey.trim() }
    setRssProxyState('checking')
    try {
      await testRssProxyConnection(config)
      const saved = saveRssProxyConfig(config)
      setRssProxyUrl(saved.baseUrl)
      setRssProxyKey(saved.accessKey)
      setRssProxyState('done')
    } catch (caught) {
      setRssProxyError(caught instanceof Error ? caught.message : String(caught))
      setRssProxyState('idle')
    }
  }

  function changeRssRefreshInterval(value: string) {
    const next = saveRssSettings({ refreshIntervalMs: Number(value) as RssRefreshInterval })
    setRssRefreshIntervalMs(next.refreshIntervalMs)
    setRssManualMessage(next.refreshIntervalMs === 0 ? 'Automatic refresh is off. Manual refresh is still available.' : 'Refresh schedule updated.')
  }

  async function refreshRssFeedsNow() {
    setRssManualState('refreshing')
    setRssManualMessage('Refreshing feeds…')
    try {
      const result = await refreshAllFeeds()
      setRssManualMessage(result.total === 0
        ? 'No subscriptions yet.'
        : result.failed === 0
          ? `Refreshed ${result.refreshed} ${result.refreshed === 1 ? 'feed' : 'feeds'}.`
          : `Refreshed ${result.refreshed} of ${result.total} feeds; ${result.failed} failed.`)
      setRssManualState('done')
    } catch (caught) {
      setRssManualMessage(caught instanceof Error ? caught.message : String(caught))
      setRssManualState('idle')
    }
  }

  useEffect(() => {
    if (rssProxyState !== 'done') return
    const timer = window.setTimeout(() => setRssProxyState('idle'), 1800)
    return () => window.clearTimeout(timer)
  }, [rssProxyState])

  const existingAI = getAIConfig()
  const [aiProvider, setAIProvider] = useState<AIProvider>(existingAI?.provider ?? 'anthropic')
  const [aiApiKey, setAIApiKey] = useState(existingAI?.apiKey ?? '')
  const [aiModel, setAIModel] = useState(existingAI?.model ?? '')
  const [aiState, setAIState] = useState<'idle' | 'checking' | 'done'>('idle')
  const [aiError, setAIError] = useState('')
  const [usagePeriod, setUsagePeriod] = useState<AIUsagePeriod>('30-days')
  const usageRecords = useLiveQuery(() => db.aiUsageAggregates.toArray(), [], [])
  const usageSummary = summarizeAIUsage(usageRecords, usagePeriod)
  const usageBreakdown = groupAIUsage(usageRecords, usagePeriod)
  const [inputPriceOverride, setInputPriceOverride] = useState(() => {
    const price = getModelPriceOverride(aiProvider, aiModel.trim())
    return price ? String(price.inputUsdPerMillion) : ''
  })
  const [outputPriceOverride, setOutputPriceOverride] = useState(() => {
    const price = getModelPriceOverride(aiProvider, aiModel.trim())
    return price ? String(price.outputUsdPerMillion) : ''
  })
  const [priceMessage, setPriceMessage] = useState('')
  const normalizedAIModel = aiModel.trim()
  const builtInPrice = getBuiltInModelPrice(aiProvider, normalizedAIModel)
  const effectivePrice = getEffectiveModelPrice(aiProvider, normalizedAIModel)
  const hasPriceOverride = Boolean(getModelPriceOverride(aiProvider, normalizedAIModel))

  function resetAIPriceInputs(provider: AIProvider, model: string) {
    const price = getModelPriceOverride(provider, model.trim())
    setInputPriceOverride(price ? String(price.inputUsdPerMillion) : '')
    setOutputPriceOverride(price ? String(price.outputUsdPerMillion) : '')
    setPriceMessage('')
  }

  function changeAIProvider(provider: AIProvider) {
    setAIProvider(provider)
    resetAIPriceInputs(provider, aiModel)
  }

  function changeAIModel(model: string) {
    setAIModel(model)
    resetAIPriceInputs(aiProvider, model)
  }

  async function connectAI() {
    setAIError('')
    const config: AIConfig = { provider: aiProvider, apiKey: aiApiKey.trim(), model: aiModel.trim() }
    if (!config.apiKey || !config.model) return setAIError('An API key and model are both required.')
    setAIState('checking')
    try {
      await generateText({ model: resolveModel(config, 'connection-test'), prompt: 'Reply with the single word "ok".' })
      saveAIConfig(config)
      setAIState('done')
    } catch (caught) {
      setAIError(caught instanceof Error ? caught.message : String(caught))
      setAIState('idle')
    }
  }

  function saveAIPrice() {
    const input = Number(inputPriceOverride)
    const output = Number(outputPriceOverride)
    if (!normalizedAIModel || inputPriceOverride.trim() === '' || outputPriceOverride.trim() === ''
      || !Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
      setPriceMessage('Enter non-negative input and output prices for the selected model.')
      return
    }
    saveModelPriceOverride(aiProvider, normalizedAIModel, { inputUsdPerMillion: input, outputUsdPerMillion: output })
    setPriceMessage('Custom rates saved. They apply to future usage.')
  }

  function restoreBuiltInAIPrice() {
    clearModelPriceOverride(aiProvider, normalizedAIModel)
    setInputPriceOverride('')
    setOutputPriceOverride('')
    setPriceMessage(builtInPrice ? 'Built-in rates restored.' : 'Custom rates removed. Cost is unavailable for this model.')
  }

  useEffect(() => {
    if (aiState !== 'done') return
    const timer = window.setTimeout(() => setAIState('idle'), 1800)
    return () => window.clearTimeout(timer)
  }, [aiState])

  const personas = useLiveQuery(() => db.personas.filter((persona) => !persona.archivedAt).toArray(), [], [])
  const [creatingPersona, setCreatingPersona] = useState(false)
  const [newPersonaName, setNewPersonaName] = useState('')
  const [newPersonaIcon, setNewPersonaIcon] = useState('Bot')
  const [newPersonaPrompt, setNewPersonaPrompt] = useState('')
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null)
  const [aiDescription, setAIDescription] = useState('')
  const [aiBuilding, setAIBuilding] = useState(false)
  const [aiBuildError, setAIBuildError] = useState('')

  async function addPersona() {
    if (!newPersonaName.trim()) return
    await createPersona({ name: newPersonaName, icon: newPersonaIcon.trim() || 'Bot', systemPrompt: newPersonaPrompt })
    setNewPersonaName('')
    setNewPersonaIcon('Bot')
    setNewPersonaPrompt('')
    setAIDescription('')
    setCreatingPersona(false)
  }

  async function buildPersonaWithAI() {
    setAIBuildError('')
    setAIBuilding(true)
    try {
      const generated = await generatePersonaFromDescription(aiDescription)
      setNewPersonaName(generated.name)
      setNewPersonaIcon(generated.icon)
      setNewPersonaPrompt(generated.systemPrompt)
    } catch (caught) {
      setAIBuildError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setAIBuilding(false)
    }
  }

  return (
    <article className="utility-page settings-page">
      <h1>Settings</h1>
      <p className="settings-intro">Shape how Thread looks, stores your work, and works with AI.</p>

      <label className="settings-category-select">
        <span>Category</span>
        <select value={activeCategory} onChange={(event) => chooseCategory(event.target.value as SettingsCategory)}>
          {SETTINGS_CATEGORIES.map((category) => <option value={category.id} key={category.id}>{category.label}</option>)}
        </select>
      </label>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings categories">
          {SETTINGS_CATEGORIES.map(({ id, label, description, Icon }) => (
            <button type="button" className={activeCategory === id ? 'is-active' : ''} aria-current={activeCategory === id ? 'page' : undefined} onClick={() => chooseCategory(id)} key={id}>
              <Icon size={17} />
              <span><strong>{label}</strong><small>{description}</small></span>
              {id === 'sync' && conflicts.length > 0 ? <b className="settings-nav-alert" aria-label={`${conflicts.length} unresolved sync conflicts`}>{conflicts.length}</b> : null}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <section className="settings-category" hidden={activeCategory !== 'appearance'} aria-labelledby="settings-category-appearance">
            <header className="settings-category-header"><h2 id="settings-category-appearance">Appearance</h2><p>Choose how Thread looks on this device.</p></header>
            <section className="settings-card theme-card">
              <div className="settings-title"><Palette size={20} /><div><h3>Theme</h3><p>Choose a familiar palette. Your theme stays on this device.</p></div></div>
              <div className="theme-groups">
                {(['Light', 'Dark'] as const).map((mode) => (
                  <div className="theme-group" key={mode}>
                    <div className="theme-group-label">{mode}</div>
                    <div className="theme-options">
                      {themes.filter((item) => item.mode === mode).map((item) => (
                        <button type="button" className="theme-option" aria-pressed={theme === item.id} onClick={() => chooseTheme(item.id)} key={item.id}>
                          <span className="theme-swatches" aria-hidden="true">{item.swatches.map((color) => <span key={color} style={{ background: color }} />)}</span>
                          <span className="theme-option-name">{item.name}</span>
                          <span className="theme-check">{theme === item.id && <Check size={14} />}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </section>

          <section className="settings-category" hidden={activeCategory !== 'rss'} aria-labelledby="settings-category-rss">
            <header className="settings-category-header"><h2 id="settings-category-rss">RSS feeds</h2><p>Use your own Cloudflare Worker when a publisher blocks direct browser access.</p></header>

            <section className="settings-card">
              <div className="settings-title"><Rss size={20} /><div><h2>RSS proxy</h2><p>Each Thread user deploys and controls their own stateless proxy. Public HTTP and HTTPS feeds are supported; private feeds with credentials are intentionally rejected.</p></div></div>
              <label><span>Worker URL</span><input type="url" value={rssProxyUrl} onChange={(event) => setRssProxyUrl(event.target.value)} placeholder="https://thread-rss-proxy.your-name.workers.dev" /></label>
              <label><span>Worker access key</span><input type={showRssProxyKey ? 'text' : 'password'} value={rssProxyKey} onChange={(event) => setRssProxyKey(event.target.value)} placeholder="Generate a key, then add the same secret to Wrangler" autoComplete="off" /></label>
              <div className="settings-actions">
                <button type="button" className="secondary-button" onClick={() => { setRssProxyKey(generateRssProxyAccessKey()); setShowRssProxyKey(true) }}><Rss size={15} /> Generate key</button>
                <button type="button" className="text-button" onClick={() => setShowRssProxyKey((current) => !current)}>{showRssProxyKey ? <EyeOff size={15} /> : <Eye size={15} />}{showRssProxyKey ? 'Hide key' : 'Show key'}</button>
                <button type="button" className="primary-button" onClick={() => void connectRssProxy()} disabled={rssProxyState === 'checking' || !rssProxyUrl.trim() || !rssProxyKey.trim()}>
                  {rssProxyState === 'checking' ? <LoaderCircle className="spin" size={16} /> : rssProxyState === 'done' ? <Check size={16} /> : <Rss size={16} />}
                  {rssProxyState === 'checking' ? 'Testing…' : rssProxyState === 'done' ? 'Connected' : existingRssProxy ? 'Reconnect' : 'Test and connect'}
                </button>
                {existingRssProxy && <button type="button" className="text-button" onClick={() => { clearRssProxyConfig(); setRssProxyUrl(''); setRssProxyKey(''); setRssProxyError('') }}><Unplug size={15} /> Disconnect</button>}
              </div>
              {rssProxyError && <p className="banner banner-error form-error">{rssProxyError}</p>}
              <div className="security-note"><ShieldCheck size={16} /><span>The key is stored only in this browser and sent only to your Worker. Never paste a Cloudflare API token here; Wrangler uses that token on your machine.</span></div>
            </section>

            <section className="settings-card rss-refresh-card">
              <div className="settings-title"><RefreshCw size={20} /><div><h2>Refresh schedule</h2><p>Choose how often Thread checks subscribed feeds while the Feeds screen is open. Turning this off never deletes cached entries.</p></div></div>
              <label><span>Automatic refresh</span><select value={rssRefreshIntervalMs} onChange={(event) => changeRssRefreshInterval(event.target.value)}>{RSS_REFRESH_INTERVALS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <div className="settings-actions">
                <button type="button" className="secondary-button" onClick={() => void refreshRssFeedsNow()} disabled={rssManualState === 'refreshing' || rssFeeds.length === 0}>
                  {rssManualState === 'refreshing' ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
                  {rssManualState === 'refreshing' ? 'Refreshing…' : 'Refresh all feeds now'}
                </button>
              </div>
              {rssManualMessage && <p className="settings-hint rss-refresh-status">{rssManualMessage}</p>}
            </section>

            <section className="settings-card rss-proxy-instructions">
              <div className="settings-title"><BookOpen size={20} /><div><h2>Setup instructions</h2><p>Run these commands from the Thread repository. Your Worker configuration lives in <code>workers/rss-proxy</code>.</p></div></div>
              <ol>
                <li>Generate a key above and copy it somewhere safe.</li>
                <li>Run <code>npm run rss-worker:login</code> once to authenticate Wrangler.</li>
                <li>Run <code>npm run rss-worker:secret</code> and paste the generated key when prompted.</li>
                <li>Run <code>npm run rss-worker:origins</code> and enter this app’s exact origin (comma-separated if you use local and production origins).</li>
                <li>Run <code>npm run rss-worker:deploy</code>, copy the resulting <code>workers.dev</code> URL, then paste it above.</li>
              </ol>
              <p className="settings-hint">For local Worker development, copy <code>workers/rss-proxy/.dev.vars.example</code> to <code>.dev.vars</code> (it is ignored by Git) and run <code>npm run rss-worker:dev</code>. Rotate a key with <code>npm run rss-worker:secret</code>, then update it here.</p>
            </section>
          </section>

          <section className="settings-category" hidden={activeCategory !== 'sync'} aria-labelledby="settings-category-sync">
            <header className="settings-category-header"><h2 id="settings-category-sync">Data &amp; sync</h2><p>Manage local storage, backup, and multi-device sync.</p></header>
      {conflicts.length > 0 && (
        <section className="settings-card conflicts-card">
          <div className="settings-title">
            <AlertTriangle size={20} />
            <div>
              <h2>Sync conflicts</h2>
              <p>Most changes merge automatically. These spots were edited both here and in the data repository -- pick which side to keep.</p>
            </div>
          </div>
          {resolveError && <p className="banner banner-error form-error">{resolveError}</p>}
          {conflicts.map((conflict) => {
            const label = conflict.scope === 'day' ? conflict.aggregateId : `thread “${conflict.aggregateId}”`
            const spotWord = conflict.conflicts.length === 1 ? 'spot' : 'spots'
            const choices = hunkChoices[conflict.id] ?? {}
            return (
              <div className="conflict-row" key={conflict.id}>
                <div className="conflict-day">{label} -- {conflict.conflicts.length} {spotWord} differ</div>
                {conflict.conflicts.map((hunk) => {
                  const choice = choices[hunk.index] ?? 'local'
                  return (
                    <div className="conflict-hunk" key={hunk.index}>
                      <div className="conflict-hunk-label">near “{hunk.blockLabel}”</div>
                      <div className="conflict-hunk-sides">
                        <button
                          type="button"
                          className="secondary-button"
                          aria-pressed={choice === 'local'}
                          disabled={resolving === conflict.id}
                          onClick={() => setHunkChoice(conflict.id, hunk.index, 'local')}
                        >
                          <div className="conflict-hunk-side-title">This browser</div>
                          <pre className="conflict-hunk-text">{hunk.local || '(removed)'}</pre>
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          aria-pressed={choice === 'remote'}
                          disabled={resolving === conflict.id}
                          onClick={() => setHunkChoice(conflict.id, hunk.index, 'remote')}
                        >
                          <div className="conflict-hunk-side-title">Repository</div>
                          <pre className="conflict-hunk-text">{hunk.remote || '(removed)'}</pre>
                        </button>
                      </div>
                    </div>
                  )
                })}
                <div className="settings-actions conflict-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={resolving === conflict.id}
                    onClick={() => void resolve(conflict.id, 'local')}
                  >
                    Keep this browser's copy
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={resolving === conflict.id}
                    onClick={() => void resolve(conflict.id, 'remote')}
                  >
                    Keep the repository's copy
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={resolving === conflict.id}
                    onClick={() => void resolve(conflict.id, new Map(conflict.conflicts.map((hunk) => [hunk.index, choices[hunk.index] ?? 'local'])))}
                  >
                    Resolve all
                  </button>
                </div>
              </div>
            )
          })}
        </section>
      )}

      <section className="settings-card" id="sync-settings">
        <div className="settings-title"><GitBranch size={20} /><div><h2 ref={syncHeadingRef} tabIndex={-1}>GitHub sync</h2><p>Thread works locally first. Connect a private repository for backup and multi-device sync.</p></div></div>
        <div className="field-grid">
          <label><span>Data repository</span><input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="you/thread-data" /></label>
          <label><span>Branch</span><input value={branch} onChange={(event) => setBranch(event.target.value)} /></label>
        </div>
        <label><span>Fine-grained token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="github_pat_…" /></label>
        <div className="security-note"><ShieldCheck size={16} /><span>Stored only in this browser and sent only to api.github.com. Restrict it to the data repository with Contents read/write access.</span></div>
        {syncStatus && (
          <p className="settings-hint">
            {syncStatus.retryAt
              ? `GitHub sync is paused until ${new Date(syncStatus.retryAt).toLocaleString()}.`
              : syncStatus.totalFiles !== undefined && syncStatus.processedFiles !== undefined && syncStatus.processedFiles < syncStatus.totalFiles
              ? `Catching up ${syncStatus.processedFiles} of ${syncStatus.totalFiles} files…`
              : syncStatus.lastCheckedAt
                ? `GitHub checked ${new Date(syncStatus.lastCheckedAt).toLocaleString()}.`
                : 'Waiting for the first full GitHub check.'}
          </p>
        )}
        {error && <p className="banner banner-error form-error">{error}</p>}
        <div className="settings-actions">
          <button className="primary-button" onClick={() => void connect()} disabled={state !== 'idle' || !repo || !token}>
            {state === 'checking' || state === 'syncing' ? <LoaderCircle className="spin" size={16} /> : state === 'done' ? <Check size={16} /> : <GitBranch size={16} />}
            {state === 'checking' ? 'Checking…' : state === 'syncing' ? 'Syncing…' : state === 'done' ? 'Connected' : existing ? 'Reconnect' : 'Connect and sync'}
          </button>
          {getGitHubConfig() && <>
            <button className="secondary-button" onClick={() => void sync()} disabled={state !== 'idle'}>Sync {pending} changes</button>
            <button className="secondary-button" onClick={() => void pull()} disabled={state !== 'idle'}>
              {state === 'pulling' ? <LoaderCircle className="spin" size={16} /> : null}
              Refresh all data from GitHub
            </button>
            <button className="text-button" onClick={() => { clearGitHubConfig(); setToken('') }}><Unplug size={15} /> Disconnect</button>
          </>}
        </div>
      </section>

      <section className="settings-card local-card">
        <div><h2>Local database</h2><p>IndexedDB is the working database. Notes open and save without a network connection.</p></div>
        <div className="database-stat"><strong>{pending}</strong><span>changes waiting to sync</span></div>
      </section>

          </section>

          <section className="settings-category" hidden={activeCategory !== 'ai'} aria-labelledby="settings-category-ai">
            <header className="settings-category-header"><h2 id="settings-category-ai">AI &amp; personas</h2><p>Connect a model provider and shape the assistants you work with.</p></header>

      <section className="settings-card">
        <div className="settings-title"><Bot size={20} /><div><h2>AI provider</h2><p>Bring your own API key. Switching providers here changes every persona at once -- no other setup needed.</p></div></div>
        <div className="field-grid">
          <label>
            <span>Provider</span>
            <select value={aiProvider} onChange={(event) => changeAIProvider(event.target.value as AIProvider)}>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="google">Google (Gemini)</option>
            </select>
          </label>
          <label><span>Model</span><input value={aiModel} onChange={(event) => changeAIModel(event.target.value)} placeholder={aiProvider === 'anthropic' ? 'claude-sonnet-5' : aiProvider === 'google' ? 'gemini-2.5-pro' : 'gpt-5'} /></label>
        </div>
        <label><span>API key</span><input type="password" value={aiApiKey} onChange={(event) => setAIApiKey(event.target.value)} placeholder="sk-…" /></label>
        <div className="security-note"><ShieldCheck size={16} /><span>Stored only in this browser and sent only to the provider you pick, directly from this device.</span></div>
        <div className="ai-price-settings">
          <div className="ai-price-heading">
            <div><strong>Cost estimate</strong><span>Optional USD rates per 1 million tokens. Custom rates apply only to future usage.</span></div>
            {effectivePrice ? (
              <small>{hasPriceOverride ? `Custom rates · saved ${effectivePrice.checkedAt}` : `Built-in rates · checked ${effectivePrice.checkedAt}`}</small>
            ) : <small>Cost unavailable</small>}
          </div>
          {effectivePrice ? (
            <p className="settings-hint">Using ${effectivePrice.inputUsdPerMillion}/1M input tokens and ${effectivePrice.outputUsdPerMillion}/1M output tokens.</p>
          ) : null}
          {aiProvider === 'google' && normalizedAIModel === 'gemini-flash-latest' ? (
            <p className="settings-hint">This is a moving model alias. Override these rates if Google changes the model behind it.</p>
          ) : null}
          <div className="field-grid">
            <label><span>Input price / 1M</span><input type="number" min="0" step="0.01" value={inputPriceOverride} onChange={(event) => setInputPriceOverride(event.target.value)} placeholder={builtInPrice ? String(builtInPrice.inputUsdPerMillion) : 'Required for cost'} /></label>
            <label><span>Output price / 1M</span><input type="number" min="0" step="0.01" value={outputPriceOverride} onChange={(event) => setOutputPriceOverride(event.target.value)} placeholder={builtInPrice ? String(builtInPrice.outputUsdPerMillion) : 'Required for cost'} /></label>
          </div>
          <div className="settings-actions ai-price-actions">
            <button type="button" className="secondary-button" onClick={saveAIPrice} disabled={!normalizedAIModel}>Save custom rates</button>
            {hasPriceOverride ? <button type="button" className="text-button" onClick={restoreBuiltInAIPrice}>{builtInPrice ? 'Use built-in rates' : 'Remove custom rates'}</button> : null}
          </div>
          {priceMessage ? <p className="settings-hint ai-price-message">{priceMessage}</p> : null}
        </div>
        {aiError && <p className="banner banner-error form-error">{aiError}</p>}
        <div className="settings-actions">
          <button className="primary-button" onClick={() => void connectAI()} disabled={aiState !== 'idle' || !aiApiKey || !aiModel}>
            {aiState === 'checking' ? <LoaderCircle className="spin" size={16} /> : aiState === 'done' ? <Check size={16} /> : <Bot size={16} />}
            {aiState === 'checking' ? 'Checking…' : aiState === 'done' ? 'Connected' : existingAI ? 'Reconnect' : 'Connect'}
          </button>
          {existingAI && <button className="text-button" onClick={() => { clearAIConfig(); setAIApiKey('') }}><Unplug size={15} /> Disconnect</button>}
        </div>
      </section>

      <section className="settings-card ai-usage-card">
        <div className="settings-title"><BarChart3 size={20} /><div><h2>AI usage</h2><p>Provider-reported tokens across synced devices. Dollar amounts are estimates, not invoice totals.</p></div></div>
        <div className="ai-usage-period" role="group" aria-label="AI usage period">
          {([['today', 'Today'], ['30-days', 'Last 30 days'], ['all-time', 'All time']] as const).map(([value, label]) => (
            <button type="button" key={value} className={usagePeriod === value ? 'is-active' : ''} aria-pressed={usagePeriod === value} onClick={() => setUsagePeriod(value)}>{label}</button>
          ))}
        </div>
        {usageSummary.runCount === 0 ? (
          <p className="settings-empty">{usageRecords.length === 0 ? 'No AI usage recorded yet. Usage is tracked from this version onward.' : 'No AI usage was recorded during this period.'}</p>
        ) : (
          <>
            <div className="ai-usage-metrics">
              <div><span>Model calls</span><strong>{integerFormat.format(usageSummary.runCount)}</strong></div>
              <div><span>Input tokens</span><strong>{integerFormat.format(usageSummary.inputTokens)}</strong></div>
              <div><span>Output tokens</span><strong>{integerFormat.format(usageSummary.outputTokens)}</strong></div>
              <div><span>Total tokens</span><strong>{integerFormat.format(usageSummary.totalTokens)}</strong></div>
              <div><span>Est. cost</span><strong>{formatAIUsageCost(usageSummary.estimatedCostUsd)}</strong></div>
            </div>
            {usageSummary.unpricedRunCount > 0 ? <p className="settings-hint ai-usage-note">Excludes {integerFormat.format(usageSummary.unpricedRunCount)} {usageSummary.unpricedRunCount === 1 ? 'call' : 'calls'} without pricing.</p> : null}
            <div className="ai-usage-table-wrap">
              <table className="ai-usage-table">
                <thead><tr><th>Provider / model</th><th>Feature</th><th>Calls</th><th>Input</th><th>Output</th><th>Total</th><th>Est. cost</th></tr></thead>
                <tbody>
                  {usageBreakdown.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.model}</strong><small>{row.provider}</small></td>
                      <td>{AI_USAGE_FEATURE_LABELS[row.feature]}</td>
                      <td>{integerFormat.format(row.runCount)}</td>
                      <td>{integerFormat.format(row.inputTokens)}</td>
                      <td>{integerFormat.format(row.outputTokens)}</td>
                      <td>{integerFormat.format(row.totalTokens)}</td>
                      <td>{row.unpricedRunCount === row.runCount ? '—' : formatAIUsageCost(row.estimatedCostUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="settings-card">
        <div className="settings-title"><Users size={20} /><div><h2>Personas</h2><p>Each persona keeps its own notes and sessions, alongside your other threads.</p></div></div>
        <div className="persona-settings-list">
          {personas.map((persona) => (
            <PersonaRow
              key={persona.id}
              persona={persona}
              editing={editingPersonaId === persona.id}
              onEdit={() => setEditingPersonaId(persona.id)}
              onCancelEdit={() => setEditingPersonaId(null)}
              onSaved={() => setEditingPersonaId(null)}
            />
          ))}
        </div>
        {creatingPersona ? (
          <div className="persona-create-form">
            <div className="persona-ai-builder">
              <label>
                <span>Describe the persona you want</span>
                <textarea
                  value={aiDescription}
                  onChange={(event) => setAIDescription(event.target.value)}
                  rows={2}
                  placeholder="A blunt fitness coach who checks in on my workouts and calls out excuses"
                />
              </label>
              {aiBuildError && <p className="banner banner-error form-error">{aiBuildError}</p>}
              <div className="settings-actions">
                <button className="secondary-button" onClick={() => void buildPersonaWithAI()} disabled={aiBuilding || !aiDescription.trim()}>
                  {aiBuilding ? <LoaderCircle className="spin" size={16} /> : <Wand2 size={16} />}
                  {aiBuilding ? 'Generating…' : 'Generate with AI'}
                </button>
              </div>
            </div>
            <div className="field-grid">
              <label><span>Name</span><input value={newPersonaName} onChange={(event) => setNewPersonaName(event.target.value)} placeholder="Career coach" /></label>
              <label><span>Icon</span><IconPicker value={newPersonaIcon} onChange={setNewPersonaIcon} /></label>
              <label className="persona-prompt-field"><span>System prompt</span><textarea value={newPersonaPrompt} onChange={(event) => setNewPersonaPrompt(event.target.value)} rows={3} placeholder="You are a supportive career coach…" /></label>
              <div className="settings-actions">
                <button className="primary-button" onClick={() => void addPersona()} disabled={!newPersonaName.trim()}><Plus size={16} /> Create persona</button>
                <button className="text-button" onClick={() => setCreatingPersona(false)}>Cancel</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="settings-actions">
            <button className="secondary-button" onClick={() => setCreatingPersona(true)}><Plus size={16} /> New persona</button>
          </div>
        )}
      </section>

          </section>

          <section className="settings-category" hidden={activeCategory !== 'workspace'} aria-labelledby="settings-category-workspace">
            <header className="settings-category-header"><h2 id="settings-category-workspace">Workspace</h2><p>Define reusable structure for threads and their metadata.</p></header>

            <MetadataSchemas />

      <section className="settings-card">
        <div className="settings-title"><FileText size={20} /><div><h2>Thread templates</h2><p>Mark any thread <em>Use as template</em> in its header, then copy it onto another from the Omnibox (<kbd>⌘⇧P</kbd> → Apply template).</p></div></div>
        <div className="settings-actions">
          <a className="secondary-button" href="#/templates">Manage templates</a>
        </div>
      </section>

          </section>

          <section className="settings-category" hidden={activeCategory !== 'security'} aria-labelledby="settings-category-security">
            <header className="settings-category-header"><h2 id="settings-category-security">Security</h2><p>Review permissions that Thread can reuse without asking.</p></header>
            <TrustedActionsCard />
          </section>

          <section className="settings-category" hidden={activeCategory !== 'help'} aria-labelledby="settings-category-help">
            <header className="settings-category-header"><h2 id="settings-category-help">Help</h2><p>Learn the language and workflows available in Thread.</p></header>

      <section className="settings-card">
        <div className="settings-title"><BookOpen size={20} /><div><h2>Documentation</h2><p>Reference guides for Thread’s features.</p></div></div>
        <div className="settings-actions">
          <a className="secondary-button" href="#/docs/query-language">Query language</a>
          <a className="text-button" href="#/docs">All docs</a>
        </div>
      </section>

          </section>
        </div>
      </div>
    </article>
  )
}

function TrustedActionsCard() {
  const trusted = useTrustedCapabilities()
  return (
    <section className="settings-card">
      <div className="settings-title">
        <ShieldCheck size={20} />
        <div>
          <h2>Trusted actions</h2>
          <p>Choosing <em>Always allow</em> on a proposal skips its confirmation next time. Only non-destructive actions can be trusted.</p>
        </div>
      </div>
      {trusted.length === 0 ? (
        <p className="settings-empty">Nothing trusted yet.</p>
      ) : (
        <div className="trusted-actions-list">
          {trusted.map((name) => {
            const summary = commandRegistry.get(name)?.summary
            return (
              <div key={name} className="trusted-actions-row">
                <div>
                  <code>{name}</code>
                  {summary ? <span>{summary}</span> : null}
                </div>
                <button className="text-button" onClick={() => revokeCapability(name)}>Revoke</button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function PersonaRow({
  persona,
  editing,
  onEdit,
  onCancelEdit,
  onSaved,
}: {
  persona: PersonaRecord
  editing: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(persona.name)
  const [icon, setIcon] = useState(persona.icon)
  const [systemPrompt, setSystemPrompt] = useState(persona.systemPrompt)

  async function save() {
    await updatePersona(persona.id, { name, icon, systemPrompt })
    onSaved()
  }

  if (!editing) {
    return (
      <div className="persona-row">
        <DynamicIcon name={persona.icon} size={16} />
        <span className="persona-row-name">{persona.name}</span>
        <div className="settings-actions">
          <button className="text-button" onClick={onEdit}>Edit</button>
          {persona.id !== GENERAL_PERSONA_ID && (
            <button className="text-button" onClick={() => void archivePersona(persona.id)}><Trash2 size={15} /></button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="persona-create-form field-grid">
      <label><span>Name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label><span>Icon</span><IconPicker value={icon} onChange={setIcon} /></label>
      <label className="persona-prompt-field"><span>System prompt</span><textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} rows={3} /></label>
      <div className="settings-actions">
        <button className="primary-button" onClick={() => void save()}>Save</button>
        <button className="text-button" onClick={onCancelEdit}>Cancel</button>
      </div>
    </div>
  )
}
