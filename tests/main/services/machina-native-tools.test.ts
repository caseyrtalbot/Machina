// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { callTool, decideApproval } from '../../../src/main/services/machina-native-tools'

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
      const res = await callTool('not_a_tool', { path: 'x' }, { vaultPath: v, autoAccept: false })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('IO_FATAL')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })
})

describe('machina-native-tools list_vault', () => {
  it('lists markdown files by default', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      writeFileSync(path.join(v, 'a.md'), '')
      writeFileSync(path.join(v, 'b.md'), '')
      writeFileSync(path.join(v, 'c.txt'), '')
      const res = await callTool('list_vault', {}, { vaultPath: v, autoAccept: false })
      expect(res.ok).toBe(true)
      if (res.ok) {
        const paths = (res.output as { paths: string[] }).paths
        expect(paths).toEqual(['a.md', 'b.md'])
      }
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('ignores .machina/**', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      writeFileSync(path.join(v, 'real.md'), '')
      mkdirSync(path.join(v, '.machina'), { recursive: true })
      writeFileSync(path.join(v, '.machina', 'state.md'), '')
      const res = await callTool('list_vault', {}, { vaultPath: v, autoAccept: false })
      expect(res.ok).toBe(true)
      if (res.ok) {
        const paths = (res.output as { paths: string[] }).paths
        expect(paths).toEqual(['real.md'])
      }
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('honors custom globs', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      writeFileSync(path.join(v, 'a.md'), '')
      mkdirSync(path.join(v, 'notes'), { recursive: true })
      writeFileSync(path.join(v, 'notes', 'b.md'), '')
      const res = await callTool(
        'list_vault',
        { globs: ['notes/**/*.md'] },
        { vaultPath: v, autoAccept: false }
      )
      expect(res.ok).toBe(true)
      if (res.ok) {
        const paths = (res.output as { paths: string[] }).paths
        expect(paths).toEqual(['notes/b.md'])
      }
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })
})

describe('machina-native-tools search_vault', () => {
  it('returns hits with path/line/snippet', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      writeFileSync(path.join(v, 'a.md'), 'first line\nthe needle is here\nthird line\n')
      writeFileSync(path.join(v, 'b.md'), 'no match\nstill no match\n')
      const res = await callTool(
        'search_vault',
        { query: 'needle' },
        { vaultPath: v, autoAccept: false }
      )
      expect(res.ok).toBe(true)
      if (res.ok) {
        const hits = (
          res.output as { hits: Array<{ path: string; line: number; snippet: string }> }
        ).hits
        expect(hits.length).toBe(1)
        expect(hits[0].path).toBe('a.md')
        expect(hits[0].line).toBe(2)
        expect(hits[0].snippet).toContain('needle')
      }
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('rejects empty query', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      const res = await callTool('search_vault', {}, { vaultPath: v, autoAccept: false })
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('IO_FATAL')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('returns zero hits for misses without erroring', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      writeFileSync(path.join(v, 'a.md'), 'hello world\n')
      const res = await callTool(
        'search_vault',
        { query: 'definitely-not-present-xyz' },
        { vaultPath: v, autoAccept: false }
      )
      expect(res.ok).toBe(true)
      if (res.ok) {
        const hits = (res.output as { hits: unknown[] }).hits
        expect(hits).toEqual([])
      }
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('ignores .machina/**', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      writeFileSync(path.join(v, 'a.md'), 'no match here\n')
      mkdirSync(path.join(v, '.machina'), { recursive: true })
      writeFileSync(path.join(v, '.machina', 'state.md'), 'should not match needle\n')
      const res = await callTool(
        'search_vault',
        { query: 'needle' },
        { vaultPath: v, autoAccept: false }
      )
      expect(res.ok).toBe(true)
      if (res.ok) {
        const hits = (res.output as { hits: unknown[] }).hits
        expect(hits).toEqual([])
      }
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })
})

describe('machina-native-tools write_note', () => {
  it('writes a new file with autoAccept', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      const res = await callTool(
        'write_note',
        { path: 'new.md', content: 'hello world\n' },
        { vaultPath: v, autoAccept: true }
      )
      expect(res.ok).toBe(true)
      if (res.ok) {
        const out = res.output as { created: boolean; path: string; bytes: number }
        expect(out.created).toBe(true)
        expect(out.path).toBe('new.md')
        expect(out.bytes).toBe(12)
      }
      expect(readFileSync(path.join(v, 'new.md'), 'utf8')).toBe('hello world\n')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('overwrites an existing file with autoAccept (created=false)', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      writeFileSync(path.join(v, 'existing.md'), 'old\n')
      const res = await callTool(
        'write_note',
        { path: 'existing.md', content: 'new\n' },
        { vaultPath: v, autoAccept: true }
      )
      expect(res.ok).toBe(true)
      if (res.ok) {
        expect((res.output as { created: boolean }).created).toBe(false)
      }
      expect(readFileSync(path.join(v, 'existing.md'), 'utf8')).toBe('new\n')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('creates parent directories', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      const res = await callTool(
        'write_note',
        { path: 'deep/nested/note.md', content: 'x' },
        { vaultPath: v, autoAccept: true }
      )
      expect(res.ok).toBe(true)
      expect(readFileSync(path.join(v, 'deep/nested/note.md'), 'utf8')).toBe('x')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('rejects path traversal', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      const res = await callTool(
        'write_note',
        { path: '../escape.md', content: 'x' },
        { vaultPath: v, autoAccept: true }
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('PATH_OUT_OF_VAULT')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('blocks on emitPending and resolves on decideApproval(accept=true)', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      let pendingId: string | null = null
      let pendingPath: string | null = null
      const promise = callTool(
        'write_note',
        { path: 'gated.md', content: 'gated\n' },
        {
          vaultPath: v,
          autoAccept: false,
          toolUseId: 'toolu_test_1',
          emitPending: (id, preview) => {
            pendingId = id
            if (preview.approvalKind === 'write_note') pendingPath = preview.preview.path
          }
        }
      )

      // Yield so the impl can register the awaiter and emit the pending event.
      await new Promise((r) => setTimeout(r, 20))
      expect(pendingId).toBe('toolu_test_1')
      expect(pendingPath).toBe('gated.md')
      // File should not exist yet — write happens after acceptance.
      expect(existsSync(path.join(v, 'gated.md'))).toBe(false)

      decideApproval('toolu_test_1', true)
      const res = await promise
      expect(res.ok).toBe(true)
      expect(readFileSync(path.join(v, 'gated.md'), 'utf8')).toBe('gated\n')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('returns rejection error on decideApproval(accept=false)', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      const promise = callTool(
        'write_note',
        { path: 'rejected.md', content: 'x' },
        {
          vaultPath: v,
          autoAccept: false,
          toolUseId: 'toolu_test_2',
          emitPending: () => {}
        }
      )
      await new Promise((r) => setTimeout(r, 20))
      decideApproval('toolu_test_2', false, 'do not want')

      const res = await promise
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('IO_TRANSIENT')
        expect(res.error.message).toBe('rejected by user')
        expect(res.error.hint).toBe('do not want')
      }
      expect(existsSync(path.join(v, 'rejected.md'))).toBe(false)
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('rejects missing path / missing content', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      const r1 = await callTool('write_note', { content: 'x' }, { vaultPath: v, autoAccept: true })
      expect(r1.ok).toBe(false)
      const r2 = await callTool('write_note', { path: 'a.md' }, { vaultPath: v, autoAccept: true })
      expect(r2.ok).toBe(false)
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })
})

describe('machina-native-tools edit_note', () => {
  it('replaces a unique find with autoAccept and returns diff_stats', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      writeFileSync(path.join(v, 'a.md'), 'one\ntwo\nthree\n')
      const res = await callTool(
        'edit_note',
        { path: 'a.md', find: 'two', replace: 'TWO\nadded' },
        { vaultPath: v, autoAccept: true }
      )
      expect(res.ok).toBe(true)
      if (res.ok) {
        const out = res.output as {
          path: string
          diff_stats: { added: number; removed: number }
        }
        expect(out.path).toBe('a.md')
        expect(out.diff_stats).toEqual({ added: 1, removed: 0 })
      }
      expect(readFileSync(path.join(v, 'a.md'), 'utf8')).toBe('one\nTWO\nadded\nthree\n')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('reports FILE_NOT_FOUND when the file is missing', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      const res = await callTool(
        'edit_note',
        { path: 'missing.md', find: 'x', replace: 'y' },
        { vaultPath: v, autoAccept: true }
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('FILE_NOT_FOUND')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('reports EDIT_FIND_NOT_FOUND when the find is absent', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      writeFileSync(path.join(v, 'a.md'), 'hello world\n')
      const res = await callTool(
        'edit_note',
        { path: 'a.md', find: 'goodbye', replace: 'farewell' },
        { vaultPath: v, autoAccept: true }
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('EDIT_FIND_NOT_FOUND')
      expect(readFileSync(path.join(v, 'a.md'), 'utf8')).toBe('hello world\n')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('reports EDIT_FIND_NOT_UNIQUE when the find matches multiple times', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      writeFileSync(path.join(v, 'a.md'), 'hi\nhi\nhi\n')
      const res = await callTool(
        'edit_note',
        { path: 'a.md', find: 'hi', replace: 'yo' },
        { vaultPath: v, autoAccept: true }
      )
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('EDIT_FIND_NOT_UNIQUE')
        expect(res.error.hint).toContain('surrounding context')
      }
      expect(readFileSync(path.join(v, 'a.md'), 'utf8')).toBe('hi\nhi\nhi\n')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('rejects path traversal', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      const res = await callTool(
        'edit_note',
        { path: '../escape.md', find: 'x', replace: 'y' },
        { vaultPath: v, autoAccept: true }
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('PATH_OUT_OF_VAULT')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('blocks on emitPending and writes on decideApproval(accept=true)', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      writeFileSync(path.join(v, 'gated.md'), 'before\nNEEDLE\nafter\n')
      let pendingId: string | null = null
      let pendingReplace: string | null = null
      const promise = callTool(
        'edit_note',
        { path: 'gated.md', find: 'NEEDLE', replace: 'FOUND' },
        {
          vaultPath: v,
          autoAccept: false,
          toolUseId: 'toolu_edit_1',
          emitPending: (id, preview) => {
            pendingId = id
            if (preview.approvalKind === 'edit_note') pendingReplace = preview.preview.replace
          }
        }
      )
      await new Promise((r) => setTimeout(r, 20))
      expect(pendingId).toBe('toolu_edit_1')
      expect(pendingReplace).toBe('FOUND')
      // File should still hold the original content until approval lands.
      expect(readFileSync(path.join(v, 'gated.md'), 'utf8')).toBe('before\nNEEDLE\nafter\n')

      decideApproval('toolu_edit_1', true)
      const res = await promise
      expect(res.ok).toBe(true)
      expect(readFileSync(path.join(v, 'gated.md'), 'utf8')).toBe('before\nFOUND\nafter\n')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('returns rejection error and leaves the file alone on accept=false', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      writeFileSync(path.join(v, 'r.md'), 'keep\nME\nplease\n')
      const promise = callTool(
        'edit_note',
        { path: 'r.md', find: 'ME', replace: 'YOU' },
        {
          vaultPath: v,
          autoAccept: false,
          toolUseId: 'toolu_edit_2',
          emitPending: () => {}
        }
      )
      await new Promise((r) => setTimeout(r, 20))
      decideApproval('toolu_edit_2', false, 'no thanks')

      const res = await promise
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error.code).toBe('IO_TRANSIENT')
        expect(res.error.message).toBe('rejected by user')
        expect(res.error.hint).toBe('no thanks')
      }
      expect(readFileSync(path.join(v, 'r.md'), 'utf8')).toBe('keep\nME\nplease\n')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('rejects empty find as EDIT_FIND_NOT_FOUND', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      writeFileSync(path.join(v, 'a.md'), 'anything\n')
      const res = await callTool(
        'edit_note',
        { path: 'a.md', find: '', replace: 'x' },
        { vaultPath: v, autoAccept: true }
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('EDIT_FIND_NOT_FOUND')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })
})

describe('machina-native-tools read_canvas / pin_to_canvas', () => {
  function seedCanvas(vault: string, id: string, content: unknown): void {
    mkdirSync(path.join(vault, '.machina', 'canvas'), { recursive: true })
    writeFileSync(
      path.join(vault, '.machina', 'canvas', `${id}.json`),
      JSON.stringify(content, null, 2)
    )
  }

  it('reads cards and edges from an existing canvas', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      seedCanvas(v, 'main', {
        nodes: [{ id: 'card_1', type: 'note', title: 'A' }],
        edges: [{ id: 'e1', from: 'card_1', to: 'card_2' }]
      })
      const res = await callTool(
        'read_canvas',
        { canvasId: 'main' },
        { vaultPath: v, autoAccept: false }
      )
      expect(res.ok).toBe(true)
      if (res.ok) {
        const out = res.output as { cards: unknown[]; edges: unknown[] }
        expect(out.cards.length).toBe(1)
        expect(out.edges.length).toBe(1)
      }
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('returns CANVAS_NOT_FOUND for read_canvas of a missing canvas', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      const res = await callTool(
        'read_canvas',
        { canvasId: 'ghost' },
        { vaultPath: v, autoAccept: false }
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('CANVAS_NOT_FOUND')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('tolerates a canvas with no nodes / edges keys', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      seedCanvas(v, 'empty', {})
      const res = await callTool(
        'read_canvas',
        { canvasId: 'empty' },
        { vaultPath: v, autoAccept: false }
      )
      expect(res.ok).toBe(true)
      if (res.ok) {
        const out = res.output as { cards: unknown[]; edges: unknown[] }
        expect(out.cards).toEqual([])
        expect(out.edges).toEqual([])
      }
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('pins a card and returns a cardId', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      seedCanvas(v, 'main', { nodes: [], edges: [] })
      const res = await callTool(
        'pin_to_canvas',
        {
          canvasId: 'main',
          card: {
            title: 'Spark idea',
            content: 'body',
            position: { x: 100, y: 200 },
            refs: ['notes/idea.md']
          }
        },
        { vaultPath: v, autoAccept: false }
      )
      expect(res.ok).toBe(true)
      if (res.ok) {
        const out = res.output as { cardId: string; canvasId: string }
        expect(out.cardId).toMatch(/^card_/)
        expect(out.canvasId).toBe('main')
      }
      const after = JSON.parse(
        readFileSync(path.join(v, '.machina', 'canvas', 'main.json'), 'utf8')
      ) as { nodes: Array<{ title: string; x: number; y: number; refs: string[] }> }
      expect(after.nodes.length).toBe(1)
      expect(after.nodes[0].title).toBe('Spark idea')
      expect(after.nodes[0].x).toBe(100)
      expect(after.nodes[0].y).toBe(200)
      expect(after.nodes[0].refs).toEqual(['notes/idea.md'])
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('returns CANVAS_NOT_FOUND when pin_to_canvas targets a missing canvas', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      const res = await callTool(
        'pin_to_canvas',
        { canvasId: 'nope', card: { title: 'x' } },
        { vaultPath: v, autoAccept: false }
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('CANVAS_NOT_FOUND')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('rejects pin_to_canvas without a card.title', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mnt-'))
    try {
      seedCanvas(v, 'main', { nodes: [] })
      const res = await callTool(
        'pin_to_canvas',
        { canvasId: 'main', card: {} },
        { vaultPath: v, autoAccept: false }
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('IO_FATAL')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })
})
