// gray-matter uses Buffer.from() in its toFile() utility (utils.toBuffer).
// The renderer main thread lacks Node globals (nodeIntegration is off),
// so we shim Buffer from the 'buffer' polyfill before any gray-matter import.
// Without this, gray-matter throws ReferenceError in parseClaudeSkill,
// causing skill cards to show "SKILL" (the filename) instead of real names.
// The Web Worker doesn't need this because nodeIntegrationInWorker is on.
import { Buffer } from 'buffer'
if (typeof globalThis.Buffer === 'undefined') {
  globalThis.Buffer = Buffer
}

import './assets/index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Prevent Electron from navigating to dropped files.
// Without this, OS-level file drops load the file in the window
// instead of reaching React drop handlers on the canvas.
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
