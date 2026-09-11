import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { AIProvider } from '../lib/ai'
import { Button } from './ui'
import {
  DEFAULT_MODELS,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  getModels,
  resetModels,
  saveModels,
  type ModelOption,
} from '../lib/aiModels'
import {
  clearModelPriceOverride,
  getBuiltInModelPrice,
  getModelPriceOverride,
  saveModelPriceOverride,
} from '../lib/aiUsage'

interface Row extends ModelOption {
  uid: string
  inputPrice: string
  outputPrice: string
}

function toRow(model: ModelOption): Row {
  const override = getModelPriceOverride(model.provider, model.id)
  return {
    ...model,
    uid: crypto.randomUUID(),
    inputPrice: override ? String(override.inputUsdPerMillion) : '',
    outputPrice: override ? String(override.outputUsdPerMillion) : '',
  }
}

function toModel(row: Row): ModelOption {
  return { provider: row.provider, id: row.id.trim(), label: row.label.trim() || row.id.trim(), reasoning: row.reasoning }
}

// Persist a row's price cells into the override store: keep the override when
// both cells are valid non-negative numbers, drop it otherwise.
function commitPrice(row: Row) {
  if (!row.id.trim()) return
  const input = Number(row.inputPrice)
  const output = Number(row.outputPrice)
  const bothBlank = row.inputPrice.trim() === '' && row.outputPrice.trim() === ''
  if (bothBlank || !Number.isFinite(input) || input < 0 || !Number.isFinite(output) || output < 0) {
    clearModelPriceOverride(row.provider, row.id.trim())
    return
  }
  saveModelPriceOverride(row.provider, row.id.trim(), { inputUsdPerMillion: input, outputUsdPerMillion: output })
}

// Editable model catalog. Rows drive the model pickers in the composer and the
// AI provider card; the price cells feed the AI usage cost estimates. All of it
// lives in localStorage (`thread.ai.models` + `thread.ai.price-overrides`).
export function ModelCatalogTable() {
  const [rows, setRows] = useState<Row[]>(() => getModels().map(toRow))

  // The catalog side of the rows (no uid / price drafts) -- serialized so the
  // effect below only writes localStorage when it actually changes.
  const catalogJson = JSON.stringify(rows.map(toModel))
  const savedJson = useRef(catalogJson)
  useEffect(() => {
    if (catalogJson === savedJson.current) return
    savedJson.current = catalogJson
    saveModels(JSON.parse(catalogJson) as ModelOption[])
  }, [catalogJson])

  const duplicateIds = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rows) {
      const key = `${row.provider}:${row.id.trim()}`
      if (row.id.trim()) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key))
  }, [rows])

  // Every mutation uses the updater form so two edits before a re-render (e.g.
  // both price cells) can't clobber each other.
  function patchRow(uid: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.uid === uid ? { ...row, ...patch } : row)))
  }

  function commitRowPrice(uid: string) {
    setRows((current) => {
      const row = current.find((entry) => entry.uid === uid)
      if (row) commitPrice(row)
      return current
    })
  }

  function addRow() {
    setRows((current) => [...current, { provider: 'anthropic' as AIProvider, id: '', label: '', reasoning: false, uid: crypto.randomUUID(), inputPrice: '', outputPrice: '' }])
  }

  function removeRow(uid: string) {
    setRows((current) => {
      const target = current.find((row) => row.uid === uid)
      if (target?.id.trim()) clearModelPriceOverride(target.provider, target.id.trim())
      return current.filter((row) => row.uid !== uid)
    })
  }

  function restoreDefaults() {
    resetModels()
    // Keep the effect from immediately re-writing the key we just cleared.
    savedJson.current = JSON.stringify(DEFAULT_MODELS)
    setRows(DEFAULT_MODELS.map(toRow))
  }

  return (
    <section className="settings-card">
      <div className="settings-title">
        <div>
          <h2>Model catalog</h2>
          <p>Models offered in the composer and the AI provider picker. Prices per 1M tokens feed the usage cost estimates.</p>
        </div>
      </div>

      <div className="models-table-wrap">
        <table className="models-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Name</th>
              <th>Model ID</th>
              <th className="models-col-center">Thinking</th>
              <th className="models-col-num">Input $/1M</th>
              <th className="models-col-num">Output $/1M</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const builtIn = row.id.trim() ? getBuiltInModelPrice(row.provider, row.id.trim()) : null
              const duplicate = duplicateIds.has(`${row.provider}:${row.id.trim()}`)
              return (
                <tr key={row.uid}>
                  <td>
                    <select value={row.provider} onChange={(event) => patchRow(row.uid, { provider: event.target.value as AIProvider })}>
                      {PROVIDER_IDS.map((provider) => (
                        <option value={provider} key={provider}>{PROVIDER_LABELS[provider]}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={row.label}
                      onChange={(event) => patchRow(row.uid, { label: event.target.value })}
                      placeholder={row.id.trim() || 'Display name'}
                    />
                  </td>
                  <td>
                    <input
                      value={row.id}
                      onChange={(event) => patchRow(row.uid, { id: event.target.value })}
                      placeholder="provider-model-id"
                      className={duplicate ? 'models-input-warn' : undefined}
                      aria-invalid={duplicate || undefined}
                    />
                    {duplicate && <span className="models-cell-note">Duplicate ID</span>}
                  </td>
                  <td className="models-col-center">
                    <input
                      type="checkbox"
                      checked={row.reasoning}
                      aria-label="Supports thinking effort"
                      onChange={(event) => patchRow(row.uid, { reasoning: event.target.checked })}
                    />
                  </td>
                  <td className="models-col-num">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.inputPrice}
                      placeholder={builtIn ? String(builtIn.inputUsdPerMillion) : '—'}
                      onChange={(event) => patchRow(row.uid, { inputPrice: event.target.value })}
                      onBlur={() => commitRowPrice(row.uid)}
                    />
                  </td>
                  <td className="models-col-num">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={row.outputPrice}
                      placeholder={builtIn ? String(builtIn.outputUsdPerMillion) : '—'}
                      onChange={(event) => patchRow(row.uid, { outputPrice: event.target.value })}
                      onBlur={() => commitRowPrice(row.uid)}
                    />
                  </td>
                  <td>
                    <Button variant="ghost" size="sm" iconOnly className="models-remove" aria-label="Remove model" onClick={() => removeRow(row.uid)}>
                      <Trash2 size={14} />
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="settings-actions">
        <Button variant="outline" onClick={addRow}><Plus size={15} /> Add model</Button>
        <Button variant="ghost" onClick={restoreDefaults}><RotateCcw size={14} /> Reset to defaults</Button>
      </div>
      <p className="settings-hint">Blank prices fall back to any built-in rate (shown as a hint); with no rate the model's usage is left out of cost totals.</p>
    </section>
  )
}
