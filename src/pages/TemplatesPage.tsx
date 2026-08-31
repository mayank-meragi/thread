import { FileText, GitBranch, Trash2 } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db, setThreadIsTemplate } from '../db'

// A template is just a thread with `isTemplate` set -- authored in the normal
// thread editor. This page is only a directory of those threads.
export function TemplatesPage() {
  const templates = useLiveQuery(
    () => db.threads.filter((thread) => !!thread.isTemplate).toArray(),
    [],
    [],
  )
  const sorted = [...templates].sort((a, b) => a.title.localeCompare(b.title))

  return (
    <article className="utility-page templates-page">
      <header className="thread-heading">
        <div className="thread-mark"><FileText size={21} /></div>
        <div><div className="eyebrow">Reusable</div><h1>Thread templates</h1></div>
      </header>

      <p className="templates-intro">
        Any thread marked <strong>Use as template</strong> shows up here. Copy one onto another
        thread from the Omnibox (<kbd>⌘⇧P</kbd> → <em>Apply template</em>).
      </p>

      <div className="templates-list">
        {sorted.map((template) => (
          <div className="templates-list-item" key={template.id}>
            <Link to={`/thread/${template.id}`}>
              <GitBranch size={15} />
              <span>{template.title}</span>
            </Link>
            <button
              type="button"
              className="tap-target-sm"
              aria-label={`Remove ${template.title} from templates`}
              title="Remove from templates"
              onClick={() => void setThreadIsTemplate(template.id, false)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {sorted.length === 0 && (
          <p className="section-empty">
            No templates yet — open any thread and choose <strong>Use as template</strong>.
          </p>
        )}
      </div>
    </article>
  )
}
