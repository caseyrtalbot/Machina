// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TE_DIR } from '../../src/shared/constants'
import { VaultWatcher, DEFAULT_IGNORE_PATTERNS } from '../../src/main/services/vault-watcher'
import type { BatchedEvent } from '../../src/main/services/event-batcher'

describe('vault-watcher ignore patterns', () => {
  it('includes default ignores', () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain('node_modules')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('dist')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('build')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('.git')
    expect(DEFAULT_IGNORE_PATTERNS).toContain('.DS_Store')
  })

  it('includes blanket dotfile pattern to filter all hidden files', () => {
    expect(DEFAULT_IGNORE_PATTERNS).toContain('.*')
  })
})

describe('vault-watcher system-artifact carve-out', () => {
  let watcher: VaultWatcher | null = null

  afterEach(async () => {
    if (watcher) await watcher.stop()
    watcher = null
  })

  it('watches system-artifact .md but ignores state.json and audit logs under the TE dir', async () => {
    const base = join(tmpdir(), `vw-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const sessionsDir = join(base, TE_DIR, 'artifacts', 'sessions')
    const auditDir = join(base, TE_DIR, 'audit')
    mkdirSync(sessionsDir, { recursive: true })
    mkdirSync(auditDir, { recursive: true })
    mkdirSync(join(base, 'notes'), { recursive: true })
    const vaultRoot = realpathSync(base)

    const sessionMd = join(vaultRoot, TE_DIR, 'artifacts', 'sessions', 'session-1.md')
    const stateJson = join(vaultRoot, TE_DIR, 'state.json')
    const auditLog = join(vaultRoot, TE_DIR, 'audit', 'audit-2026-07-24.ndjson')

    const events: BatchedEvent[] = []
    watcher = new VaultWatcher()
    await watcher.start(vaultRoot, (batch) => events.push(...batch))
    await vi.waitFor(() => expect(watcher!.getHealthSnapshot().ready).toBe(true), { timeout: 5000 })

    // Write the ignored files first, then the watched one, so if ignores leaked
    // their events would arrive no later than the system-artifact event.
    writeFileSync(stateJson, '{"autosave":1}')
    writeFileSync(auditLog, '{"tool":"x"}\n')
    writeFileSync(sessionMd, '---\nid: session-1\n---\n\nbody')

    await vi.waitFor(() => expect(events.some((e) => e.path === sessionMd)).toBe(true), {
      timeout: 5000
    })
    // Let any straggler batch for the ignored files land before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 400))

    const paths = events.map((e) => e.path)
    expect(paths).toContain(sessionMd)
    expect(paths).not.toContain(stateJson)
    expect(paths).not.toContain(auditLog)

    rmSync(vaultRoot, { recursive: true, force: true })
  }, 15000)
})
