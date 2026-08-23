import { AlertTriangle, Cloud, CloudOff } from 'lucide-react'
import { Link } from 'react-router-dom'

export interface RailSyncIndicatorProps {
  connected: boolean
  syncing: boolean
  pending: number
  conflicts: number
  error: string | null
  onSync: () => void
}

export function RailSyncIndicator({
  connected,
  syncing,
  pending,
  conflicts,
  error,
  onSync,
}: RailSyncIndicatorProps) {
  if (!connected) {
    return <Link to="/settings?focus=sync" className="rail-sync" aria-label="Local only. Notes are saved on this device. Connect GitHub sync." title="Local only"><CloudOff size={16} /></Link>
  }
  if (conflicts > 0 || error) {
    const detail = conflicts > 0 ? `${conflicts} ${conflicts === 1 ? 'conflict' : 'conflicts'} to resolve` : 'Sync could not finish'
    return <Link to="/settings?focus=sync" className="rail-sync rail-sync-alert" aria-label={`Needs attention. ${detail}. Open sync settings.`} title="Needs attention"><AlertTriangle size={16} /></Link>
  }
  if (syncing) {
    return <div className="rail-sync rail-sync-busy" role="status" aria-live="polite" title="Syncing" aria-label="Syncing"><Cloud size={16} /></div>
  }
  if (pending > 0) {
    return <button type="button" className="rail-sync rail-sync-pending" onClick={onSync} aria-label={`Pending. ${pending} ${pending === 1 ? 'change' : 'changes'} waiting. Sync now.`} title="Pending changes"><Cloud size={16} /></button>
  }
  return <Link to="/settings?focus=sync" className="rail-sync" aria-label="Up to date. Local changes are backed up to GitHub. Open sync settings." title="Up to date"><Cloud size={16} /></Link>
}
