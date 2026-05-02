// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { callTool } from '../../../src/main/services/machina-native-tools'

describe('machina-native-tools read_note', () => {
  it('reads a vault note', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      writeFileSync(path.join(v, 'a.md'), 'hi\nthere\n')
      const res = await callTool('read_note', { path: 'a.md' }, { vaultPath: v, autoAccept: false })
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect((res.output as { content: string }).content).toBe('hi\nthere\n')
        expect((res.output as { lines: string }).lines).toBe('1-3')
      }
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('rejects path traversal', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      const res = await callTool(
        'read_note',
        { path: '../../etc/passwd' },
        { vaultPath: v, autoAccept: false }
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('PATH_OUT_OF_VAULT')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('reports FILE_NOT_FOUND', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      const res = await callTool(
        'read_note',
        { path: 'nope.md' },
        { vaultPath: v, autoAccept: false }
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('FILE_NOT_FOUND')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('reports unknown tool name', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      const res = await callTool('write_note', { path: 'x' }, { vaultPath: v, autoAccept: false })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('IO_FATAL')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })
})
