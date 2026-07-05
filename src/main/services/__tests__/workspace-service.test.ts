// @vitest-environment node
/**
 * WorkspaceService tests (workstation step 1).
 *
 * Real temp folders on disk: capability detection is a filesystem walk and
 * the load-bearing regression (detection BEFORE scaffold) only shows up when
 * initVault actually materializes TE_DIR between two open() calls.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TE_DIR } from '@shared/constants'
import { classifyCapabilities, collectEvidence, WorkspaceService } from '../workspace-service'

let root: string

beforeEach(() => {
  root = join(tmpdir(), `workspace-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(root, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('classifyCapabilities', () => {
  it.each([
    [{ hasMarkdown: true, hasGit: false, hasManifest: false }, ['knowledge']],
    [{ hasMarkdown: false, hasGit: true, hasManifest: false }, ['coding']],
    [{ hasMarkdown: false, hasGit: false, hasManifest: true }, ['coding']],
    [{ hasMarkdown: true, hasGit: true, hasManifest: false }, ['knowledge', 'coding']],
    [{ hasMarkdown: true, hasGit: false, hasManifest: true }, ['knowledge', 'coding']],
    // Empty evidence defaults to knowledge (first-run UX for an empty folder).
    [{ hasMarkdown: false, hasGit: false, hasManifest: false }, ['knowledge']]
  ])('classifies %o as %o', (evidence, expected) => {
    expect(classifyCapabilities(evidence)).toEqual(expected)
  })
})

describe('collectEvidence', () => {
  it('finds markdown nested within the depth bound', () => {
    mkdirSync(join(root, 'a', 'b', 'c'), { recursive: true })
    writeFileSync(join(root, 'a', 'b', 'c', 'note.md'), '# hi')
    expect(collectEvidence(root).hasMarkdown).toBe(true)
  })

  it('ignores markdown deeper than the depth bound', () => {
    mkdirSync(join(root, 'a', 'b', 'c', 'd', 'e'), { recursive: true })
    writeFileSync(join(root, 'a', 'b', 'c', 'd', 'e', 'deep.md'), '# deep')
    expect(collectEvidence(root).hasMarkdown).toBe(false)
  })

  it('ignores markdown inside TE_DIR, dot-dirs, and node_modules', () => {
    mkdirSync(join(root, TE_DIR), { recursive: true })
    mkdirSync(join(root, '.hidden'), { recursive: true })
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(root, TE_DIR, 'state.md'), '# state')
    writeFileSync(join(root, '.hidden', 'note.md'), '# hidden')
    writeFileSync(join(root, 'node_modules', 'pkg', 'README.md'), '# readme')
    expect(collectEvidence(root).hasMarkdown).toBe(false)
  })

  it('detects .git and root manifests without a walk hit', () => {
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, 'package.json'), '{}')
    const evidence = collectEvidence(root)
    expect(evidence.hasGit).toBe(true)
    expect(evidence.hasManifest).toBe(true)
    expect(evidence.hasMarkdown).toBe(false)
  })

  it('only recognizes manifests at the root, not nested ones', () => {
    mkdirSync(join(root, 'sub'), { recursive: true })
    writeFileSync(join(root, 'sub', 'package.json'), '{}')
    expect(collectEvidence(root).hasManifest).toBe(false)
  })
})

describe('WorkspaceService.open', () => {
  it('opens a markdown folder as knowledge and scaffolds TE_DIR', async () => {
    writeFileSync(join(root, 'note.md'), '# note')
    const service = new WorkspaceService()
    const ws = await service.open(root)
    expect(ws.capabilities).toEqual(['knowledge'])
    expect(existsSync(join(ws.root, TE_DIR, 'config.json'))).toBe(true)
    expect(service.current()).toEqual(ws)
  })

  it('keeps classifying a coding repo as coding after TE_DIR exists (detection before scaffold)', async () => {
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, 'package.json'), '{}')
    const service = new WorkspaceService()

    const first = await service.open(root)
    expect(first.capabilities).toEqual(['coding'])
    // The scaffold happened — TE_DIR (config.json etc.) now exists on disk.
    expect(existsSync(join(first.root, TE_DIR, 'config.json'))).toBe(true)

    // Reopen: the scaffolded TE_DIR must not reclassify the repo.
    const second = await service.open(root)
    expect(second.capabilities).toEqual(['coding'])
  })

  it('guard() before open() throws; after open() it enforces the boundary', async () => {
    const service = new WorkspaceService()
    expect(() => service.guard()).toThrow('before workspace:open')
    expect(service.current()).toBeNull()

    writeFileSync(join(root, 'note.md'), '# note')
    const ws = await service.open(root)
    expect(service.guard().assertWithinVault(join(ws.root, 'note.md'))).toBe(
      join(ws.root, 'note.md')
    )
    expect(() => service.guard().assertWithinVault('/etc/passwd')).toThrow()
  })

  it('fires ready callbacks sequentially in registration order', async () => {
    const service = new WorkspaceService()
    const order: string[] = []
    service.onReady(async (ws) => {
      await new Promise((r) => setTimeout(r, 20))
      order.push(`first:${ws.root}`)
    })
    service.onReady((ws) => {
      order.push(`second:${ws.root}`)
    })
    const ws = await service.open(root)
    expect(order).toEqual([`first:${ws.root}`, `second:${ws.root}`])
  })

  it('propagates a ready-callback rejection to the open() caller', async () => {
    const service = new WorkspaceService()
    service.onReady(() => {
      throw new Error('wiring failed')
    })
    await expect(service.open(root)).rejects.toThrow('wiring failed')
  })

  it('serializes concurrent open() calls — no interleaving, last caller wins', async () => {
    const rootA = join(root, 'a')
    const rootB = join(root, 'b')
    mkdirSync(rootA, { recursive: true })
    mkdirSync(rootB, { recursive: true })

    const service = new WorkspaceService()
    const events: string[] = []
    service.onReady(async (ws) => {
      const name = ws.root.endsWith('/a') ? 'a' : 'b'
      events.push(`start:${name}`)
      // Yield long enough that an unserialized second open would interleave.
      await new Promise((r) => setTimeout(r, 30))
      events.push(`end:${name}`)
    })

    const [wsA, wsB] = await Promise.all([service.open(rootA), service.open(rootB)])

    expect(events).toEqual(['start:a', 'end:a', 'start:b', 'end:b'])
    expect(wsA.root.endsWith('/a')).toBe(true)
    expect(wsB.root.endsWith('/b')).toBe(true)
    expect(service.current()?.root).toBe(wsB.root)
    expect(service.guard().assertWithinVault(join(wsB.root, 'x.md'))).toBe(join(wsB.root, 'x.md'))
  })

  it('a failed open() does not poison the chain for the next call', async () => {
    const service = new WorkspaceService()
    let failFirst = true
    service.onReady(() => {
      if (failFirst) {
        failFirst = false
        throw new Error('wiring failed')
      }
    })

    await expect(service.open(root)).rejects.toThrow('wiring failed')
    const ws = await service.open(root)
    expect(service.current()).toEqual(ws)
  })
})
