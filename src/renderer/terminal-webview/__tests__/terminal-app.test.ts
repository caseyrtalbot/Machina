import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const webviewDir = resolve(__dirname, '..')

describe('TerminalApp component', () => {
  const src = readFileSync(resolve(webviewDir, 'TerminalApp.tsx'), 'utf-8')

  describe('exports', () => {
    it('exports a named TerminalApp function', () => {
      expect(src).toContain('export function TerminalApp()')
    })
  })

  describe('URL params', () => {
    it('reads sessionId from URL search params', () => {
      expect(src).toContain('sessionId')
      expect(src).toContain('URLSearchParams')
    })

    it('reads cwd from URL search params', () => {
      expect(src).toContain("'cwd'")
    })

    it('reads initialCommand from URL search params', () => {
      expect(src).toContain("'initialCommand'")
    })

    it('reads systemPrompt from URL search params', () => {
      expect(src).toContain("'systemPrompt'")
    })
  })

  describe('xterm setup', () => {
    it('imports Terminal from @xterm/xterm', () => {
      expect(src).toContain("from '@xterm/xterm'")
    })

    it('imports FitAddon', () => {
      expect(src).toContain("from '@xterm/addon-fit'")
    })

    it('imports WebLinksAddon', () => {
      expect(src).toContain("from '@xterm/addon-web-links'")
    })

    it('imports WebglAddon', () => {
      expect(src).toContain("from '@xterm/addon-webgl'")
    })

    it('imports SearchAddon', () => {
      expect(src).toContain("from '@xterm/addon-search'")
    })

    it('uses Catppuccin Mocha theme colors', () => {
      expect(src).toContain('#0c0e14') // background
      expect(src).toContain('#cdd6f4') // foreground
      expect(src).toContain('#f38ba8') // red
      expect(src).toContain('#a6e3a1') // green
      expect(src).toContain('#89b4fa') // blue
      expect(src).toContain('#cba6f7') // magenta
      expect(src).toContain('#94e2d5') // cyan
    })

    it('uses JetBrains Mono as primary font', () => {
      expect(src).toContain('JetBrains Mono')
    })

    it('configures font size 13', () => {
      expect(src).toContain('fontSize: 13')
    })

    it('configures lineHeight 1.2', () => {
      expect(src).toContain('lineHeight: 1.2')
    })

    it('configures scrollback 10000', () => {
      expect(src).toContain('scrollback: 10000')
    })

    it('configures cursorBlink and bar style', () => {
      expect(src).toContain('cursorBlink: true')
      expect(src).toContain("cursorStyle: 'bar'")
    })
  })

  describe('WebGL with canvas fallback', () => {
    it('creates WebglAddon inside a try block', () => {
      expect(src).toContain('new WebglAddon()')
      // The try-catch pattern for WebGL fallback
      expect(src).toMatch(/try\s*\{[\s\S]*?new WebglAddon\(\)[\s\S]*?\}\s*catch/)
    })
  })

  describe('search addon', () => {
    it('loads SearchAddon', () => {
      expect(src).toContain('new SearchAddon()')
    })

    it('attaches a custom key event handler for Cmd/Ctrl+F', () => {
      expect(src).toContain('attachCustomKeyEventHandler')
      expect(src).toContain("e.key === 'f'")
    })
  })

  describe('data coalescing buffer', () => {
    it('uses a 5ms flush timer for data coalescing', () => {
      expect(src).toContain('setTimeout(flushData, 5)')
    })

    it('accumulates data in a buffer array', () => {
      expect(src).toContain('dataBuffer')
    })

    it('joins buffer contents before writing', () => {
      expect(src).toMatch(/\.join\(['"]/)
    })
  })

  describe('session lifecycle', () => {
    it('calls terminalApi.reconnect when sessionId is present', () => {
      expect(src).toContain('window.terminalApi.reconnect')
    })

    it('calls terminalApi.create for new sessions', () => {
      expect(src).toContain('window.terminalApi.create')
    })

    it('sends session-created to host after creation', () => {
      expect(src).toContain("sendToHost('session-created'")
    })

    it('writes scrollback on successful reconnect', () => {
      expect(src).toContain('scrollback')
    })

    it('sends initial command after 500ms delay', () => {
      expect(src).toContain('500')
      expect(src).toContain('initialCommand')
    })

    it('constructs claude command with system prompt when present', () => {
      expect(src).toContain('--append-system-prompt')
    })
  })

  describe('resize handling', () => {
    it('uses ResizeObserver for container sizing', () => {
      expect(src).toContain('ResizeObserver')
    })

    it('uses requestAnimationFrame for fit timing', () => {
      expect(src).toContain('requestAnimationFrame')
    })

    it('calls terminalApi.resize with session dimensions', () => {
      expect(src).toContain('window.terminalApi.resize')
    })
  })

  describe('focus protocol', () => {
    it('listens for focus events via terminalApi.onFocus', () => {
      expect(src).toContain('window.terminalApi.onFocus')
    })

    it('listens for blur events via terminalApi.onBlur', () => {
      expect(src).toContain('window.terminalApi.onBlur')
    })
  })

  describe('data and exit listeners', () => {
    it('subscribes to data events via terminalApi.onData', () => {
      expect(src).toContain('window.terminalApi.onData')
    })

    it('subscribes to exit events via terminalApi.onExit', () => {
      expect(src).toContain('window.terminalApi.onExit')
    })
  })

  describe('cleanup', () => {
    it('disposes the terminal', () => {
      expect(src).toContain('term.dispose()')
    })

    it('disposes the WebGL addon', () => {
      expect(src).toMatch(/webgl.*\.dispose\(\)/)
    })

    it('clears the flush timer', () => {
      expect(src).toMatch(/clearTimeout\(flushTimer/)
    })

    it('unsubscribes data listener via offData', () => {
      expect(src).toContain('window.terminalApi.offData')
    })

    it('unsubscribes exit listener via offExit', () => {
      expect(src).toContain('window.terminalApi.offExit')
    })
  })

  describe('user input wiring', () => {
    it('writes user keystrokes to PTY via terminalApi.write', () => {
      expect(src).toContain('window.terminalApi.write')
    })
  })
})

describe('terminal-api.d.ts type declarations', () => {
  const dts = readFileSync(resolve(webviewDir, 'terminal-api.d.ts'), 'utf-8')

  it('declares the TerminalApi interface', () => {
    expect(dts).toContain('interface TerminalApi')
  })

  it('declares create method', () => {
    expect(dts).toContain('create:')
  })

  it('declares write method', () => {
    expect(dts).toContain('write:')
  })

  it('declares resize method', () => {
    expect(dts).toContain('resize:')
  })

  it('declares kill method', () => {
    expect(dts).toContain('kill:')
  })

  it('declares reconnect method', () => {
    expect(dts).toContain('reconnect:')
  })

  it('declares onData and offData methods', () => {
    expect(dts).toContain('onData:')
    expect(dts).toContain('offData:')
  })

  it('declares onExit and offExit methods', () => {
    expect(dts).toContain('onExit:')
    expect(dts).toContain('offExit:')
  })

  it('declares onFocus and onBlur methods', () => {
    expect(dts).toContain('onFocus:')
    expect(dts).toContain('onBlur:')
  })

  it('declares sendToHost method', () => {
    expect(dts).toContain('sendToHost:')
  })

  it('augments Window with terminalApi', () => {
    expect(dts).toContain('interface Window')
    expect(dts).toContain('terminalApi: TerminalApi')
  })

  it('exports empty to make it a module', () => {
    expect(dts).toContain('export {}')
  })
})
