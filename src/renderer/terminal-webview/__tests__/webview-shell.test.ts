import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const webviewDir = resolve(__dirname, '..')

describe('terminal webview shell files', () => {
  describe('index.html', () => {
    const html = readFileSync(resolve(webviewDir, 'index.html'), 'utf-8')

    it('has a root div for React mounting', () => {
      expect(html).toContain('<div id="root"></div>')
    })

    it('loads main.tsx as a module script', () => {
      expect(html).toContain('<script type="module" src="./main.tsx"></script>')
    })

    it('sets charset to UTF-8', () => {
      expect(html).toContain('charset="UTF-8"')
    })

    it('includes full-bleed reset styles on html, body, and #root', () => {
      expect(html).toContain('margin: 0')
      expect(html).toContain('padding: 0')
      expect(html).toContain('width: 100%')
      expect(html).toContain('height: 100%')
    })

    it('hides overflow to prevent scrollbars', () => {
      expect(html).toContain('overflow: hidden')
    })

    it('sets a dark background color', () => {
      expect(html).toContain('background: #1e1e2e')
    })
  })

  describe('main.tsx', () => {
    const tsx = readFileSync(resolve(webviewDir, 'main.tsx'), 'utf-8')

    it('imports createRoot from react-dom/client', () => {
      expect(tsx).toContain("import { createRoot } from 'react-dom/client'")
    })

    it('imports TerminalApp component', () => {
      expect(tsx).toContain("import { TerminalApp } from './TerminalApp'")
    })

    it('mounts into the #root element', () => {
      expect(tsx).toContain("document.getElementById('root')")
    })

    it('calls createRoot to render TerminalApp', () => {
      expect(tsx).toContain('createRoot(root).render(<TerminalApp />)')
    })
  })
})
