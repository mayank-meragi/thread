import { useState } from 'react'

export function TaskDraft({ label, value, placeholder, multiline, onSave }: { label: string; value: string; placeholder?: string; multiline?: boolean; onSave: (value: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value)
  const control = multiline
    ? <textarea rows={label === 'Title' ? 2 : 4} value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== value) void onSave(draft) }} />
    : <input value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== value) void onSave(draft) }} />
  return <label className={`task-detail-draft task-detail-${label.toLocaleLowerCase()}`}><span>{label}</span>{control}</label>
}
