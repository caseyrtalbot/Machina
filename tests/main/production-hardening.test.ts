// @vitest-environment node
// Source-level assertions for item 2.6 wiring that lives in Electron startup
// code we can't unit-test without a full app boot (same pattern as
// webview-config.test.ts). Behavior is covered by the document-manager,
// main-logger, atomic-write, and useDocument tests.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const mainSource = readFileSync(join(__dirname, '../../src/main/index.ts'), 'utf-8')

describe('production hardening wiring (main/index.ts)', () => {
  it('drops unsafe-eval from the production CSP script-src', () => {
    expect(mainSource).not.toContain("script-src 'self' 'unsafe-eval'")
    expect(mainSource).toContain('"script-src \'self\'",')
  })

  it('recovers from renderer crashes via render-process-gone', () => {
    expect(mainSource).toContain("'render-process-gone'")
    expect(mainSource).toContain('webContents.reload()')
  })

  it('locks down webview attachment to the terminal preload', () => {
    expect(mainSource).toContain("'will-attach-webview'")
    expect(mainSource).toContain('terminal-webview.js')
    expect(mainSource).toContain('contextIsolation = true')
  })

  it('starts the crash reporter with local-only minidumps', () => {
    expect(mainSource).toContain('crashReporter.start({ uploadToServer: false })')
  })

  it('forwards renderer console warnings/errors to main.log', () => {
    expect(mainSource).toContain("'console-message'")
    expect(mainSource).toContain('logRendererConsole')
  })

  it('registers the reveal-logs handler', () => {
    expect(mainSource).toContain("typedHandle('app:reveal-logs'")
  })
})

describe('pixi CSP isolation (graph-renderer.ts)', () => {
  it('loads the unsafe-eval shim before pixi renderer creation', () => {
    const rendererSource = readFileSync(
      join(__dirname, '../../src/renderer/src/panels/graph/graph-renderer.ts'),
      'utf-8'
    )
    expect(rendererSource).toContain("import 'pixi.js/unsafe-eval'")
  })
})
