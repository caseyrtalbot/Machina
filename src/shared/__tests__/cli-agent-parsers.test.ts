import { describe, expect, it } from 'vitest'
import {
  claudeToolCallParser,
  codexToolCallParser,
  geminiToolCallParser
} from '../cli-agent-parsers'

describe('claudeToolCallParser', () => {
  it('returns an empty list for empty input', () => {
    expect(claudeToolCallParser('')).toEqual([])
  })

  it('returns an empty list when the chunk has no tool calls', () => {
    const chunk = 'Just some prose about the codebase.\nNo tool calls here.\n'
    expect(claudeToolCallParser(chunk)).toEqual([])
  })

  it('extracts a single Read tool call with its file path', () => {
    const chunk = '⏺ Read(file_path: "/Users/c/proj/src/index.ts")\n'
    const calls = claudeToolCallParser(chunk)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Read')
    expect(calls[0].inputPreview).toContain('/Users/c/proj/src/index.ts')
  })

  it('extracts a Bash tool call with its command', () => {
    const chunk = '⏺ Bash(command: "npm test")\n  ⎿  Running tests...'
    const calls = claudeToolCallParser(chunk)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Bash')
    expect(calls[0].inputPreview).toContain('npm test')
  })

  it('extracts multiple tool calls in order from a transcript', () => {
    const chunk = [
      '⏺ Read(file_path: "/a.ts")',
      '  ⎿  Read 10 lines',
      '⏺ Edit(file_path: "/a.ts", old_string: "foo")',
      '  ⎿  Edited',
      '⏺ Bash(command: "npm test")'
    ].join('\n')
    const calls = claudeToolCallParser(chunk)
    expect(calls.map((c) => c.name)).toEqual(['Read', 'Edit', 'Bash'])
  })

  it('truncates very long input previews', () => {
    const longArg = 'x'.repeat(500)
    const chunk = `⏺ Bash(command: "${longArg}")`
    const calls = claudeToolCallParser(chunk)
    expect(calls).toHaveLength(1)
    expect(calls[0].inputPreview.length).toBeLessThanOrEqual(120)
  })

  it('survives nested parentheses in the tool input', () => {
    const chunk = '⏺ Bash(command: "echo $(date)")'
    const calls = claudeToolCallParser(chunk)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('Bash')
    expect(calls[0].inputPreview).toContain('echo')
  })

  it('ignores prose that mentions tool names but is not a tool call line', () => {
    const chunk = 'I will use Read and Bash to investigate.'
    expect(claudeToolCallParser(chunk)).toEqual([])
  })
})

describe('codexToolCallParser', () => {
  it('returns an empty list for empty input', () => {
    expect(codexToolCallParser('')).toEqual([])
  })

  it('returns an empty list when no tool calls appear', () => {
    expect(codexToolCallParser('plain prose with no markers')).toEqual([])
  })

  it('parses a [tool_call] prefixed line', () => {
    const chunk = '[tool_call] read_file path=/a.ts'
    const calls = codexToolCallParser(chunk)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('read_file')
    expect(calls[0].inputPreview).toContain('/a.ts')
  })

  it('parses a "tool: name args" line', () => {
    const chunk = 'tool: shell {"command":"ls"}'
    const calls = codexToolCallParser(chunk)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('shell')
    expect(calls[0].inputPreview).toContain('"command":"ls"')
  })

  it('extracts multiple tool calls in order', () => {
    const chunk = [
      '[tool_call] read_file path=/a.ts',
      'some output',
      'tool: shell ls -la',
      '[tool_call] write_file path=/b.ts'
    ].join('\n')
    const names = codexToolCallParser(chunk).map((c) => c.name)
    expect(names).toEqual(['read_file', 'shell', 'write_file'])
  })

  it('is case-insensitive on the marker prefix', () => {
    expect(codexToolCallParser('[Tool_Call] read_file path=/x').map((c) => c.name)).toEqual([
      'read_file'
    ])
  })

  it('truncates long previews', () => {
    const big = 'x'.repeat(500)
    const calls = codexToolCallParser(`tool: shell ${big}`)
    expect(calls[0].inputPreview.length).toBeLessThanOrEqual(120)
  })
})

describe('geminiToolCallParser', () => {
  it('returns an empty list for empty input', () => {
    expect(geminiToolCallParser('')).toEqual([])
  })

  it('parses a "▷ name(args)" line', () => {
    const chunk = '▷ read_file(path="/a.ts")'
    const calls = geminiToolCallParser(chunk)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('read_file')
    expect(calls[0].inputPreview).toContain('/a.ts')
  })

  it('parses a "Calling <name> with {args}" line', () => {
    const chunk = 'Calling shell with {"cmd":"ls"}'
    const calls = geminiToolCallParser(chunk)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('shell')
    expect(calls[0].inputPreview).toContain('"cmd":"ls"')
  })

  it('extracts multiple tool calls in order across mixed line styles', () => {
    const chunk = [
      '▷ read_file(path="/a.ts")',
      'some output line',
      'Calling shell with ls',
      '▷ write_file(path="/b.ts", content="hi")'
    ].join('\n')
    const names = geminiToolCallParser(chunk).map((c) => c.name)
    expect(names).toEqual(['read_file', 'shell', 'write_file'])
  })

  it('handles a marker line without args', () => {
    const chunk = '▷ list_dir'
    const calls = geminiToolCallParser(chunk)
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('list_dir')
  })

  it('ignores prose that contains "Calling" mid-sentence', () => {
    expect(geminiToolCallParser('I am Calling for context')).toEqual([])
  })

  it('truncates long previews', () => {
    const big = 'x'.repeat(500)
    const calls = geminiToolCallParser(`Calling shell with ${big}`)
    expect(calls[0].inputPreview.length).toBeLessThanOrEqual(120)
  })
})
