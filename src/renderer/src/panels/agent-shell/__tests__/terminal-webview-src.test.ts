import { describe, it, expect } from 'vitest'
import { buildTerminalWebviewSrc, resolveTerminalWebviewBase } from '../terminal-webview-src'

const BASE = 'http://localhost:5173/terminal-webview/index.html'

describe('buildTerminalWebviewSrc', () => {
  it('returns the base untouched (no trailing ?) when no params are set', () => {
    expect(buildTerminalWebviewSrc(BASE, {})).toBe(BASE)
  })

  it('omits empty-string params (falsy guard), returning the bare base', () => {
    expect(buildTerminalWebviewSrc(BASE, { sessionId: '', cwd: '', label: '' })).toBe(BASE)
  })

  it('omits an empty sessionId but keeps cwd', () => {
    const src = buildTerminalWebviewSrc(BASE, { sessionId: '', cwd: '/Users/casey/proj' })
    const qs = new URL(src).searchParams
    expect(qs.has('sessionId')).toBe(false)
    expect(qs.get('cwd')).toBe('/Users/casey/proj')
  })

  it('always includes cwd alongside sessionId when both are set', () => {
    const src = buildTerminalWebviewSrc(BASE, { sessionId: 'pty-1', cwd: '/Users/casey/proj' })
    const qs = new URL(src).searchParams
    expect(qs.get('sessionId')).toBe('pty-1')
    expect(qs.get('cwd')).toBe('/Users/casey/proj')
  })

  it('URL-encodes paths with spaces so they survive a parse round-trip', () => {
    const cwd = '/Users/casey/My Vault/sub dir'
    const src = buildTerminalWebviewSrc(BASE, { cwd })
    // Raw space must not leak into the URL string.
    expect(src.includes(' ')).toBe(false)
    expect(new URL(src).searchParams.get('cwd')).toBe(cwd)
  })

  it('encodes reserved characters in values (&, =, ?) without corrupting neighbors', () => {
    const src = buildTerminalWebviewSrc(BASE, {
      cwd: '/tmp/a&b=c?d',
      label: 'shell one'
    })
    const qs = new URL(src).searchParams
    expect(qs.get('cwd')).toBe('/tmp/a&b=c?d')
    expect(qs.get('label')).toBe('shell one')
  })

  it('includes every set param and omits every unset one', () => {
    const src = buildTerminalWebviewSrc(BASE, {
      sessionId: 's',
      cwd: '/c',
      vaultPath: '/v',
      initialCommand: 'claude',
      label: 'L',
      accent: '#fff',
      bg: '#000',
      systemPrompt: 'be terse'
    })
    const qs = new URL(src).searchParams
    expect(qs.get('sessionId')).toBe('s')
    expect(qs.get('cwd')).toBe('/c')
    expect(qs.get('vaultPath')).toBe('/v')
    expect(qs.get('initialCommand')).toBe('claude')
    expect(qs.get('label')).toBe('L')
    expect(qs.get('accent')).toBe('#fff')
    expect(qs.get('bg')).toBe('#000')
    expect(qs.get('systemPrompt')).toBe('be terse')
    const partial = buildTerminalWebviewSrc(BASE, { sessionId: 's' })
    expect([...new URL(partial).searchParams.keys()]).toEqual(['sessionId'])
  })

  // Agent projection (workstation Phase 2 step 4): the reattachOnly param is
  // what disables the guest's terminal:create fallback — its name must stay
  // in sync with TerminalApp.readUrlParams.
  it('sets reattachOnly=1 when the flag is true', () => {
    const src = buildTerminalWebviewSrc(BASE, { sessionId: 's', reattachOnly: true })
    expect(new URL(src).searchParams.get('reattachOnly')).toBe('1')
  })

  it('omits reattachOnly when false or unset (plain terminals keep the respawn)', () => {
    const unset = buildTerminalWebviewSrc(BASE, { sessionId: 's' })
    expect(new URL(unset).searchParams.has('reattachOnly')).toBe(false)
    const explicit = buildTerminalWebviewSrc(BASE, { sessionId: 's', reattachOnly: false })
    expect(new URL(explicit).searchParams.has('reattachOnly')).toBe(false)
  })
})

describe('resolveTerminalWebviewBase', () => {
  it('dev: resolves the multi-page entry against the dev-server origin', () => {
    expect(
      resolveTerminalWebviewBase(true, 'http://localhost:5173', 'http://localhost:5173/index.html')
    ).toBe('http://localhost:5173/terminal-webview/index.html')
  })

  it('prod: resolves the entry relative to the current renderer file', () => {
    expect(
      resolveTerminalWebviewBase(
        false,
        'file://',
        'file:///Applications/Machina.app/Contents/Resources/app/out/renderer/index.html'
      )
    ).toBe(
      'file:///Applications/Machina.app/Contents/Resources/app/out/renderer/terminal-webview/index.html'
    )
  })

  it('prod: ignores the origin argument entirely', () => {
    expect(
      resolveTerminalWebviewBase(false, 'http://unused:9999', 'file:///out/renderer/index.html')
    ).toBe('file:///out/renderer/terminal-webview/index.html')
  })
})
