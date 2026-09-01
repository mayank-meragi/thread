import { AlertTriangle } from 'lucide-react'
import type { WorkoutDiagnostic } from '../../lib/workouts/types'

export function WorkoutDiagnostics({ diagnostics }: { diagnostics: WorkoutDiagnostic[] }) {
  if (diagnostics.length === 0) return null
  return (
    <div className="workout-diagnostics" role="status">
      {diagnostics.map((diagnostic, index) => (
        <a
          key={`${diagnostic.blockId}-${diagnostic.code}-${index}`}
          className="workout-diagnostic"
          href={`#/?block=${diagnostic.blockId}`}
        >
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{diagnostic.message}</span>
        </a>
      ))}
    </div>
  )
}
