import { useState } from 'react'
import { Field, Input, Textarea } from 'fiber'

export function TaskDraft({ label, value, placeholder, multiline, onSave }: { label: string; value: string; placeholder?: string; multiline?: boolean; onSave: (value: string) => Promise<void> }) {
  const [draft, setDraft] = useState(value)
  const control = multiline
    ? <Textarea rows={label === 'Title' ? 2 : 4} value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== value) void onSave(draft) }} />
    : <Input value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== value) void onSave(draft) }} />
  return <Field className={`task-detail-draft task-detail-${label.toLocaleLowerCase()}`} label={label}>{control}</Field>
}
