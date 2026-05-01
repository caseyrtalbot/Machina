import { describe, it, expect } from 'vitest'
import { stripTerminalControls, extractCommand, dropPromptHeader } from '../terminal-text'

const ESC = '\x1b'
const BEL = '\x07'

describe('stripTerminalControls', () => {
  it('returns empty for empty input', () => {
    expect(stripTerminalControls('')).toBe('')
  })

  it('preserves plain text untouched', () => {
    expect(stripTerminalControls('hello world\n')).toBe('hello world\n')
  })

  it('strips SGR (color/attribute) CSI sequences', () => {
    expect(stripTerminalControls(`${ESC}[0m${ESC}[27m${ESC}[24mhello`)).toBe('hello')
  })

  it('strips DEC private mode toggles like bracketed paste', () => {
    expect(stripTerminalControls(`${ESC}[?2004hready${ESC}[?2004l`)).toBe('ready')
  })

  it('strips erase/cursor CSI sequences', () => {
    expect(stripTerminalControls(`${ESC}[Khello${ESC}[J world`)).toBe('hello world')
  })

  it('strips OSC sequences terminated by BEL', () => {
    expect(stripTerminalControls(`${ESC}]7;file://host/cwd${BEL}done`)).toBe('done')
  })

  it('strips OSC sequences terminated by ST', () => {
    expect(stripTerminalControls(`${ESC}]2;title text${ESC}\\done`)).toBe('done')
  })

  it('strips two-byte ESC sequences (charset, RIS)', () => {
    expect(stripTerminalControls(`${ESC}(Bhello${ESC}c`)).toBe('hello')
  })

  it('strips stray C0 controls except TAB/LF/CR', () => {
    expect(stripTerminalControls('a\x00b\x07c\td\ne\rf')).toBe('abc\td\ne\rf')
  })

  it('handles a realistic prompt-redraw sequence', () => {
    const raw = `${ESC}[0m${ESC}[27m${ESC}[24m${ESC}[Jcaseytalbot@host % ${ESC}[K${ESC}[?2004h`
    expect(stripTerminalControls(raw)).toBe('caseytalbot@host % ')
  })
})

describe('extractCommand', () => {
  it('returns empty for empty input', () => {
    expect(extractCommand('')).toBe('')
  })

  it('returns the first non-empty trimmed line', () => {
    expect(extractCommand('\n\n  ls -la  \nfoo\n')).toBe('ls -la')
  })

  it('peels off a zsh prompt prefix on the first line', () => {
    expect(extractCommand('caseytalbot@host / % ls -la\nApplications\n')).toBe('ls -la')
  })

  it('peels off a bash $ prompt prefix', () => {
    expect(extractCommand('user@host:~$ echo hi\nhi\n')).toBe('echo hi')
  })

  it('returns empty when the first line is just a bare prompt', () => {
    expect(extractCommand('user@host:~$ \n')).toBe('')
  })

  it('skips fully whitespace lines', () => {
    expect(extractCommand('   \n\t\nls')).toBe('ls')
  })

  it('returns the only line when there is just one', () => {
    expect(extractCommand('echo hi')).toBe('echo hi')
  })

  it('handles CRLF line endings', () => {
    expect(extractCommand('\r\nls -la\r\n')).toBe('ls -la')
  })

  it('returns empty when only whitespace lines', () => {
    expect(extractCommand('   \n\t\n   ')).toBe('')
  })
})

describe('dropPromptHeader', () => {
  it('returns input unchanged when the first line is not a prompt', () => {
    expect(dropPromptHeader('hello\nworld')).toBe('hello\nworld')
  })

  it('drops a zsh prompt + command echo line and keeps the rest', () => {
    const raw = 'caseytalbot@host / % ls -la\nApplications\nbin\n'
    expect(dropPromptHeader(raw)).toBe('Applications\nbin\n')
  })

  it('drops a bash $ prompt line', () => {
    const raw = 'user@host:~$ echo hi\nhi\n'
    expect(dropPromptHeader(raw)).toBe('hi\n')
  })

  it('skips leading blank lines before the prompt', () => {
    const raw = '\n\nuser@host:~$ ls\nfoo\nbar\n'
    expect(dropPromptHeader(raw)).toBe('foo\nbar\n')
  })

  it('returns empty when only whitespace', () => {
    expect(dropPromptHeader('  \n\t\n')).toBe('')
  })

  it('does not mistake an output line containing % for a prompt', () => {
    const raw = '50% complete\nstill going\n'
    expect(dropPromptHeader(raw)).toBe('50% complete\nstill going\n')
  })
})
