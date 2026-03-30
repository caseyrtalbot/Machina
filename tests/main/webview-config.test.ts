// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('BrowserWindow webPreferences', () => {
  const mainSource = readFileSync(join(__dirname, '../../src/main/index.ts'), 'utf-8')

  it('enables webviewTag for <webview> support', () => {
    expect(mainSource).toContain('webviewTag: true')
  })
})
