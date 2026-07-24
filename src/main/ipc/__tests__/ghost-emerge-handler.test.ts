// @vitest-environment node
/**
 * Handler-level tests for the ghost-emerge write spine (PLAN Layer 1 item 3).
 * The synthesized-note write is now gated: no folder is created and no file is
 * written until the approval gate allows, the write goes through
 * createStampedNote (provenance + exclusive-create), and every decision is
 * audited. These tests exercise the real filesystem in a temp vault.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AuditEntry } from '@shared/agent-types'
import type { HitlConfirmOpts, HitlDecision } from '../../services/hitl-gate'

// Capture typedHandle registrations instead of touching ipcMain.
const captured = vi.hoisted(() => ({
  handlers: new Map<string, (args: never) => unknown>()
}))

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn((channel: string, handler: (args: never) => unknown) => {
    captured.handlers.set(channel, handler)
  })
}))

import { handleEmergeGhost, registerGhostEmergeIpc } from '../ghost-emerge'

const SYNTH_JSON = '{"tags": ["synth"], "body": "Synthesized body content."}'
const mockClaude = vi.fn(async () => SYNTH_JSON)

function makeGate(decision: HitlDecision) {
  const calls: HitlConfirmOpts[] = []
  return {
    calls,
    gate: {
      confirm: vi.fn(async (opts: HitlConfirmOpts) => {
        calls.push(opts)
        return decision
      })
    }
  }
}

function makeAudit() {
  const entries: AuditEntry[] = []
  return { entries, audit: { log: (e: AuditEntry) => entries.push(e) } }
}

describe('handleEmergeGhost write spine', () => {
  let vault: string

  beforeEach(() => {
    vault = mkdtempSync(join(tmpdir(), 'ghost-emerge-'))
    mockClaude.mockClear()
    captured.handlers.clear()
  })

  afterEach(() => {
    rmSync(vault, { recursive: true, force: true })
  })

  it('writes a stamped, agent-origin note when the gate allows', async () => {
    const ref = join(vault, 'ref.md')
    writeFileSync(ref, '---\ntitle: Ref\ntags: [a]\n---\n\nReference body.\n')
    const { gate, calls } = makeGate({ allowed: true, reason: '' })
    const { audit, entries } = makeAudit()

    const result = await handleEmergeGhost(
      mockClaude,
      { gate, audit },
      { ghostId: 'g1', ghostTitle: 'Emergent', referencePaths: [ref], vaultPath: vault }
    )

    expect(result).toEqual({
      status: 'created',
      filePath: join(vault, 'Emergent.md'),
      folderCreated: false,
      folderPath: vault
    })

    const written = readFileSync(join(vault, 'Emergent.md'), 'utf-8')
    expect(written).toContain('created_by: ghost-emerge')
    expect(written).toContain('created_at:')
    expect(written).toContain('origin: agent')
    expect(written).toContain('Synthesized body content.')

    // Gate saw the right tool and a content preview.
    expect(calls).toHaveLength(1)
    expect(calls[0].tool).toBe('vault.emerge_ghost')
    expect(calls[0].contentPreview).toContain('Synthesized body content.')

    // Exactly one 'allowed' audit entry, no error field.
    expect(entries).toHaveLength(1)
    expect(entries[0].decision).toBe('allowed')
    expect(entries[0].tool).toBe('vault.emerge_ghost')
    expect(entries[0].error).toBeUndefined()
  })

  it('writes nothing and audits a denial when the gate denies', async () => {
    // References in a not-yet-existent subfolder: inferFolder points there so we
    // can assert the folder is never created on deny.
    const refs = [join(vault, 'sub/a.md'), join(vault, 'sub/b.md')]
    const { gate } = makeGate({ allowed: false, reason: 'nope' })
    const { audit, entries } = makeAudit()

    const result = await handleEmergeGhost(
      mockClaude,
      { gate, audit },
      { ghostId: 'g1', ghostTitle: 'Emergent', referencePaths: refs, vaultPath: vault }
    )

    expect(result).toEqual({ status: 'denied', reason: 'nope' })
    expect(existsSync(join(vault, 'sub'))).toBe(false)
    expect(existsSync(join(vault, 'sub', 'Emergent.md'))).toBe(false)

    expect(entries).toHaveLength(1)
    expect(entries[0].decision).toBe('denied')
    expect(entries[0].error).toBe('nope')
  })

  it('fails closed (denies) when no gate is injected via registerGhostEmergeIpc', async () => {
    registerGhostEmergeIpc(mockClaude)
    const handler = captured.handlers.get('vault:emerge-ghost')!

    const ref = join(vault, 'ref.md')
    writeFileSync(ref, '---\ntitle: Ref\n---\n\nBody.\n')

    const result = (await handler({
      ghostId: 'g1',
      ghostTitle: 'Emergent',
      referencePaths: [ref],
      vaultPath: vault
    } as never)) as { status: string; reason?: string }

    expect(result.status).toBe('denied')
    expect(result.reason).toBe('Approval gate not wired')
    expect(existsSync(join(vault, 'Emergent.md'))).toBe(false)
  })

  it('propagates EEXIST when the target file already exists', async () => {
    const ref = join(vault, 'ref.md')
    writeFileSync(ref, '---\ntitle: Ref\n---\n\nBody.\n')
    writeFileSync(join(vault, 'Emergent.md'), 'pre-existing\n')
    const { gate } = makeGate({ allowed: true, reason: '' })
    const { audit } = makeAudit()

    await expect(
      handleEmergeGhost(
        mockClaude,
        { gate, audit },
        { ghostId: 'g1', ghostTitle: 'Emergent', referencePaths: [ref], vaultPath: vault }
      )
    ).rejects.toThrow(/EEXIST/)
  })
})
