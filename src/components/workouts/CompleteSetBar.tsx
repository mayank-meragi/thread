import { useState } from 'react'
import { Check } from 'lucide-react'
import { completeSet } from '../../lib/workouts/lifecycle'

export function CompleteSetBar({
  selectedSetId,
  isDone,
  flush,
  onAdvance,
}: {
  selectedSetId: string | null
  isDone: boolean
  flush: () => Promise<void>
  onAdvance: (nextSetId: string | undefined) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const complete = async () => {
    if (!selectedSetId) return
    setBusy(true)
    setError(null)
    try {
      await flush()
      const next = await completeSet(selectedSetId)
      onAdvance(typeof next === 'string' ? next : undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="complete-set-bar">
      {error && <p className="complete-set-error" role="alert">{error}</p>}
      <button
        type="button"
        className="complete-set-button"
        disabled={busy || isDone || !selectedSetId}
        onClick={() => void complete()}
      >
        <Check size={18} aria-hidden="true" /> {isDone ? 'Set completed' : 'Complete set'}
      </button>
    </div>
  )
}
