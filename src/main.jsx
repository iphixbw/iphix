import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// ── Globally prevent mouse scroll from changing ANY number input ─────────────
// Uses capture phase so it fires before the input can consume the event
document.addEventListener('wheel', function (e) {
  if (e.target && e.target.type === 'number') {
    e.preventDefault()    // stop the value changing
    e.target.blur()       // also remove focus so further scrolls don't re-trigger
  }
}, { passive: false, capture: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
