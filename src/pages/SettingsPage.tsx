import { useEffect, useState } from 'react'
import { Check, GitBranch, LoaderCircle, Palette, ShieldCheck, Unplug } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import {
  clearGitHubConfig,
  getGitHubConfig,
  saveGitHubConfig,
  syncPending,
  validateGitHub,
  type GitHubConfig,
} from '../lib/github'
import { applyTheme, getTheme, themes, type ThemeId } from '../lib/theme'

export function SettingsPage() {
  const existing = getGitHubConfig()
  const [repo, setRepo] = useState(existing?.repo ?? '')
  const [branch, setBranch] = useState(existing?.branch ?? 'main')
  const [token, setToken] = useState(existing?.token ?? '')
  const [state, setState] = useState<'idle' | 'checking' | 'syncing' | 'done'>('idle')
  const [error, setError] = useState('')
  const [theme, setTheme] = useState<ThemeId>(() => getTheme())
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)

  useEffect(() => {
    if (state !== 'done') return
    const timer = window.setTimeout(() => setState('idle'), 1800)
    return () => window.clearTimeout(timer)
  }, [state])

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

  function chooseTheme(nextTheme: ThemeId) {
    setTheme(nextTheme)
    applyTheme(nextTheme)
  }

  return (
    <article className="utility-page settings-page">
      <div className="eyebrow">Your data, your repository</div>
      <h1>Settings</h1>

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

      <section className="settings-card">
        <div className="settings-title"><GitBranch size={20} /><div><h2>GitHub sync</h2><p>Thread works locally first. Connect a private repository for backup and multi-device sync.</p></div></div>
        <div className="field-grid">
          <label><span>Data repository</span><input value={repo} onChange={(event) => setRepo(event.target.value)} placeholder="you/thread-data" /></label>
          <label><span>Branch</span><input value={branch} onChange={(event) => setBranch(event.target.value)} /></label>
        </div>
        <label><span>Fine-grained token</span><input type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="github_pat_…" /></label>
        <div className="security-note"><ShieldCheck size={16} /><span>Stored only in this browser and sent only to api.github.com. Restrict it to the data repository with Contents read/write access.</span></div>
        {error && <p className="form-error">{error}</p>}
        <div className="settings-actions">
          <button className="primary-button" onClick={() => void connect()} disabled={state !== 'idle' || !repo || !token}>
            {state === 'checking' || state === 'syncing' ? <LoaderCircle className="spin" size={16} /> : state === 'done' ? <Check size={16} /> : <GitBranch size={16} />}
            {state === 'checking' ? 'Checking…' : state === 'syncing' ? 'Syncing…' : state === 'done' ? 'Connected' : existing ? 'Reconnect' : 'Connect and sync'}
          </button>
          {getGitHubConfig() && <>
            <button className="secondary-button" onClick={() => void sync()} disabled={state !== 'idle'}>Sync {pending} changes</button>
            <button className="text-button" onClick={() => { clearGitHubConfig(); setToken('') }}><Unplug size={15} /> Disconnect</button>
          </>}
        </div>
      </section>

      <section className="settings-card local-card">
        <div><h2>Local database</h2><p>IndexedDB is the working database. Notes open and save without a network connection.</p></div>
        <div className="database-stat"><strong>{pending}</strong><span>changes waiting to sync</span></div>
      </section>
    </article>
  )
}
