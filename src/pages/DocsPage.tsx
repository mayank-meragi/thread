import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen } from 'lucide-react'
import { QueryLanguageDoc } from '../components/docs/QueryLanguageDoc'

interface DocEntry {
  slug: string
  title: string
  blurb: string
  body: () => React.ReactNode
}

// Add future docs here; the index and routing pick them up automatically.
const DOCS: DocEntry[] = [
  {
    slug: 'query-language',
    title: 'Query language',
    blurb: 'Write ```tql blocks to list and tabulate threads and tags.',
    body: () => <QueryLanguageDoc />,
  },
]

export function DocsPage() {
  const { topic } = useParams()
  const entry = topic ? DOCS.find((doc) => doc.slug === topic) : undefined

  if (topic && !entry) {
    return (
      <article className="utility-page docs-page">
        <Link to="/docs" className="back-link"><ArrowLeft size={15} /> Documentation</Link>
        <h1>Not found</h1>
        <p>There is no doc called “{topic}”.</p>
      </article>
    )
  }

  if (entry) {
    return (
      <article className="utility-page docs-page">
        <Link to="/docs" className="back-link"><ArrowLeft size={15} /> Documentation</Link>
        {entry.body()}
      </article>
    )
  }

  return (
    <article className="utility-page docs-page">
      <div className="eyebrow">Reference</div>
      <h1>Documentation</h1>
      <div className="docs-index">
        {DOCS.map((doc) => (
          <Link key={doc.slug} to={`/docs/${doc.slug}`} className="docs-index-card">
            <BookOpen size={18} />
            <div>
              <strong>{doc.title}</strong>
              <span>{doc.blurb}</span>
            </div>
          </Link>
        ))}
      </div>
    </article>
  )
}
