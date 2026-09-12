import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ArrowLeft, FlaskConical } from 'lucide-react'
import { FiberGallery } from './components/fiber/FiberGallery'
import './styles/tokens.css'
import './styles/base.css'
import 'fiber/styles.css'
import './styles/fiber-page.css'
import { initializeTheme } from './lib/theme'

initializeTheme()

export function FiberApp() {
  return (
    <BrowserRouter>
      <div className="fiber-page">
        <header className="fiber-page-topbar">
          <a className="fiber-page-brand" href="/thread/">
            <span className="fiber-page-brand-mark"><FlaskConical size={15} /></span>
            <span>Fiber UI</span>
          </a>
          <a className="fiber-page-back" href="/thread/"><ArrowLeft size={15} /> Back to Thread</a>
        </header>
        <main className="fiber-page-main">
          <FiberGallery hidden={false} />
        </main>
      </div>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FiberApp />
  </StrictMode>,
)
