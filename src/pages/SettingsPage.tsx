import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, BookOpen, Bot, Check, FileText, GitBranch, LoaderCircle, Palette, Plus, ShieldCheck, Trash2, Unplug, Users, Wand2 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useSearchParams } from 'react-router-dom'
import { generateText } from 'ai'
import { db, type PersonaRecord } from '../db'
import { isoToday } from '../lib/dates'
import { clearAIConfig, getAIConfig, resolveModel, saveAIConfig, type AIConfig, type AIProvider } from '../lib/ai'
import { DynamicIcon } from '../lib/icons'
import { archivePersona, createPersona, GENERAL_PERSONA_ID, updatePersona } from '../lib/personas'
import { generatePersonaFromDescription } from '../lib/personaBuilder'
import { IconPicker } from '../components/IconPicker'
import {
  clearGitHubConfig,
  getGitHubConfig,
  pullDay,
  resolveConflict,
  saveGitHubConfig,
  syncPending,
  validateGitHub,
  type GitHubConfig,
} from '../lib/github'
import { applyTheme, getTheme, themes, type ThemeId } from '../lib/theme'
import { commandRegistry } from '../lib/commands'
import { revokeCapability, useTrustedCapabilities } from '../lib/threadscript/trustedCapabilities'
import { MetadataSchemas } from '../components/MetadataSchemas'

export function SettingsPage() {
  const [searchParams] = useSearchParams()
  const focusSync = searchParams.get('focus') === 'sync'
  const syncHeadingRef = useRef<HTMLHeadingElement>(null)
  const existing = getGitHubConfig()
  const [repo, setRepo] = useState(existing?.repo ?? '')
  const [branch, setBranch] = useState(existing?.branch ?? 'main')
  const [token, setToken] = useState(existing?.token ?? '')
  const [state, setState] = useState<'idle' | 'checking' | 'syncing' | 'pulling' | 'done'>('idle')
  const [error, setError] = useState('')
  const [theme, setTheme] = useState<ThemeId>(() => getTheme())
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
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
    if (!focusSync) return
    syncHeadingRef.current?.scrollIntoView({ block: 'start' })
    syncHeadingRef.current?.focus({ preventScroll: true })
  }, [focusSync])

  async function connect() {
    setError('')
    const config: GitHubConfig = { repo: repo.trim(), branch: branch.trim(), token: token.trim() }
    if (!config.repo.includes('/')) return setError('Use owner/repository format.')
    setState('checking')
    try {
      await validateGitHub(config)
      saveGitHubConfig(config)
      setState('syncing')
      await syncPending()
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
      await syncPending()
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
      await pullDay(isoToday())
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

  const existingAI = getAIConfig()
  const [aiProvider, setAIProvider] = useState<AIProvider>(existingAI?.provider ?? 'anthropic')
  const [aiApiKey, setAIApiKey] = useState(existingAI?.apiKey ?? '')
  const [aiModel, setAIModel] = useState(existingAI?.model ?? '')
  const [aiState, setAIState] = useState<'idle' | 'checking' | 'done'>('idle')
  const [aiError, setAIError] = useState('')

  async function connectAI() {
    setAIError('')
    const config: AIConfig = { provider: aiProvider, apiKey: aiApiKey.trim(), model: aiModel.trim() }
    if (!config.apiKey || !config.model) return setAIError('An API key and model are both required.')
    setAIState('checking')
    try {
      await generateText({ model: resolveModel(config), prompt: 'Reply with the single word "ok".' })
      saveAIConfig(config)
      setAIState('done')
    } catch (caught) {
      setAIError(caught instanceof Error ? caught.message : String(caught))
      setAIState('idle')
    }
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
      <div className="eyebrow">Your data, your repository</div>
      <h1>Settings</h1>

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

      <MetadataSchemas />

      <section className="settings-card theme-card">
        <div className="settings-title"><Palette size={20} /><div><h2>Appearance</h2><p>Choose a familiar palette. Your theme stays on this device.</p></div></div>
        <div className="theme-groups">
          {(['Light', 'Dark'] as const).map((mode) => (
            <div className="theme-group" key={mode}>
              <div className="theme-group-label">{mode}</div>
              <div className="theme-options">
                {themes.filter((item) => item.mode === mode).map((item) => (
                  <button
                    type="button"
                    className="theme-option"
                    aria-pressed={theme === item.id}
                    onClick={() => chooseTheme(item.id)}
                    key={item.id}
                  >
                    <span className="theme-swatches" aria-hidden="true">
                      {item.swatches.map((color) => <span key={color} style={{ background: color }} />)}
                    </span>
                    <span className="theme-option-name">{item.name}</span>
                    <span className="theme-check">{theme === item.id && <Check size={14} />}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-card" id="sync-settings">
        <div className="settings-title"><GitBranch size={20} /><div><h2 ref={syncHeadingRef} tabIndex={-1}>GitHub sync</h2><p>Thread works locally first. Connect a private repository for backup and multi-device sync.</p></div></div>
        <div className="field-grid">
          <label><span>Data repository</span><input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="you/thread-data" /></label>
          <label><span>Branch</span><input value={branch} onChange={(event) => setBranch(event.target.value)} /></label>
        </div>
        <label><span>Fine-grained token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="github_pat_…" /></label>
        <div className="security-note"><ShieldCheck size={16} /><span>Stored only in this browser and sent only to api.github.com. Restrict it to the data repository with Contents read/write access.</span></div>
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
              Pull latest for today
            </button>
            <button className="text-button" onClick={() => { clearGitHubConfig(); setToken('') }}><Unplug size={15} /> Disconnect</button>
          </>}
        </div>
      </section>

      <section className="settings-card local-card">
        <div><h2>Local database</h2><p>IndexedDB is the working database. Notes open and save without a network connection.</p></div>
        <div className="database-stat"><strong>{pending}</strong><span>changes waiting to sync</span></div>
      </section>

      <section className="settings-card">
        <div className="settings-title"><Bot size={20} /><div><h2>AI provider</h2><p>Bring your own API key. Switching providers here changes every persona at once -- no other setup needed.</p></div></div>
        <div className="field-grid">
          <label>
            <span>Provider</span>
            <select value={aiProvider} onChange={(event) => setAIProvider(event.target.value as AIProvider)}>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="google">Google (Gemini)</option>
            </select>
          </label>
          <label><span>Model</span><input value={aiModel} onChange={(event) => setAIModel(event.target.value)} placeholder={aiProvider === 'anthropic' ? 'claude-sonnet-5' : aiProvider === 'google' ? 'gemini-2.5-pro' : 'gpt-5'} /></label>
        </div>
        <label><span>API key</span><input type="password" value={aiApiKey} onChange={(event) => setAIApiKey(event.target.value)} placeholder="sk-…" /></label>
        <div className="security-note"><ShieldCheck size={16} /><span>Stored only in this browser and sent only to the provider you pick, directly from this device.</span></div>
        {aiError && <p className="banner banner-error form-error">{aiError}</p>}
        <div className="settings-actions">
          <button className="primary-button" onClick={() => void connectAI()} disabled={aiState !== 'idle' || !aiApiKey || !aiModel}>
            {aiState === 'checking' ? <LoaderCircle className="spin" size={16} /> : aiState === 'done' ? <Check size={16} /> : <Bot size={16} />}
            {aiState === 'checking' ? 'Checking…' : aiState === 'done' ? 'Connected' : existingAI ? 'Reconnect' : 'Connect'}
          </button>
          {existingAI && <button className="text-button" onClick={() => { clearAIConfig(); setAIApiKey('') }}><Unplug size={15} /> Disconnect</button>}
        </div>
      </section>

      <TrustedActionsCard />

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

      <section className="settings-card">
        <div className="settings-title"><FileText size={20} /><div><h2>Thread templates</h2><p>Mark any thread <em>Use as template</em> in its header, then copy it onto another from the Omnibox (<kbd>⌘⇧P</kbd> → Apply template).</p></div></div>
        <div className="settings-actions">
          <a className="secondary-button" href="#/templates">Manage templates</a>
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-title"><BookOpen size={20} /><div><h2>Documentation</h2><p>Reference guides for Thread’s features.</p></div></div>
        <div className="settings-actions">
          <a className="secondary-button" href="#/docs/query-language">Query language</a>
          <a className="text-button" href="#/docs">All docs</a>
        </div>
      </section>
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
