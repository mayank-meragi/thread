import type { CommandChange } from '../../lib/commands'
import type { PlanStepPreview } from '../../lib/threadscript/types'

const KIND_LABEL: Record<CommandChange['kind'], string> = {
  create: 'Create',
  update: 'Set',
  append: 'Append',
  replace: 'Replace',
  remove: 'Remove',
}

function scalarText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function DiffBlock({ before, after }: { before: string; after: string }) {
  const long = before.length > 600 || after.length > 600
  const body = (
    <div className="chat-proposal-diff">
      {before ? <pre data-role="before">{before}</pre> : null}
      <pre data-role="after">{after}</pre>
    </div>
  )
  if (!long) return body
  return (
    <details className="chat-proposal-diff-wrap">
      <summary>Show content</summary>
      {body}
    </details>
  )
}

function ChangeRow({ change }: { change: CommandChange }) {
  const stringDiff = typeof change.before === 'string' || typeof change.after === 'string'
  const hasScalar = change.before !== undefined || change.after !== undefined
  return (
    <div className="chat-proposal-change">
      <span className="chat-proposal-change-kind">{KIND_LABEL[change.kind]}</span>
      <div className="chat-proposal-change-body">
        <span className="chat-proposal-change-target">
          {change.target.label || '(pending result)'}
          {change.field ? <em> · {change.field}</em> : null}
        </span>
        <span className="chat-proposal-change-desc">{change.description}</span>
        {stringDiff ? (
          <DiffBlock
            before={typeof change.before === 'string' ? change.before : ''}
            after={typeof change.after === 'string' ? change.after : ''}
          />
        ) : hasScalar ? (
          <span className="chat-proposal-change-scalar">
            {scalarText(change.before)} → {scalarText(change.after)}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function ActionPreview({ step }: { step: PlanStepPreview }) {
  return (
    <div className="chat-proposal-step">
      <div className="chat-proposal-step-head">
        <code>{step.capability}</code>
        <span className={`chat-proposal-risk chat-proposal-risk-${step.risk}`}>{step.risk}</span>
        {step.alias ? <span className="chat-proposal-step-alias">${step.alias}</span> : null}
        {step.status === 'deferred' ? <span className="chat-proposal-step-deferred">deferred</span> : null}
      </div>
      <p className="chat-proposal-step-summary">{step.preview.summary}</p>
      {step.preview.changes.map((change, index) => (
        <ChangeRow key={index} change={change} />
      ))}
      {step.preview.warnings?.map((warning, index) => (
        <p key={index} className="chat-proposal-warning">{warning}</p>
      ))}
    </div>
  )
}
