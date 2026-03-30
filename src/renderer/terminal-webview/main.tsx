import { createRoot } from 'react-dom/client'
import { TerminalApp } from './TerminalApp'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<TerminalApp />)
}
