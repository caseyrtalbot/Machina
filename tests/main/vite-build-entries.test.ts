// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('electron.vite.config build entries', () => {
  const configSource = readFileSync(join(__dirname, '../../electron.vite.config.ts'), 'utf-8')

  describe('preload section', () => {
    it('has rollupOptions.input with index entry', () => {
      expect(configSource).toContain("'src/preload/index.ts'")
    })

    it('has rollupOptions.input with terminal-webview entry', () => {
      expect(configSource).toContain("'src/preload/terminal-webview.ts'")
    })
  })

  describe('renderer section', () => {
    it('has rollupOptions.input with index entry', () => {
      expect(configSource).toContain("'src/renderer/index.html'")
    })

    it('has rollupOptions.input with terminal-webview entry', () => {
      expect(configSource).toContain("'src/renderer/terminal-webview/index.html'")
    })
  })

  it('preserves existing renderer plugins', () => {
    expect(configSource).toContain('react()')
    expect(configSource).toContain('tailwindcss()')
  })

  it('preserves existing renderer aliases', () => {
    expect(configSource).toContain("'@renderer'")
    expect(configSource).toContain("'@engine'")
  })

  it('preserves existing preload alias', () => {
    // Preload section should still have the @shared alias
    // Match the preload block specifically
    const preloadMatch = configSource.match(/preload:\s*\{([\s\S]*?)\n\s{2}\}/)
    expect(preloadMatch).toBeTruthy()
    expect(preloadMatch![1]).toContain("'@shared'")
  })

  it('preserves existing optimizeDeps', () => {
    expect(configSource).toContain('optimizeDeps')
    expect(configSource).toContain('@xterm/xterm')
  })
})
