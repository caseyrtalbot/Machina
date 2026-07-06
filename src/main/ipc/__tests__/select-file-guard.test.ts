// @vitest-environment node
/**
 * guardSelectedFile (fs:select-file): the native picker roams anywhere, but
 * only paths inside the workspace root come back. Everything else — outside
 * paths, traversal, or no open workspace — returns null rather than throwing,
 * so the renderer treats it exactly like a cancelled dialog.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PathGuard } from '../../services/path-guard'

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  shell: {}
}))

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn()
}))

vi.mock('../../services/file-service', () => ({
  FileService: class {}
}))

vi.mock('../../services/vault-watcher', () => ({
  createVaultIgnoreFilter: vi.fn().mockResolvedValue(() => false)
}))

vi.mock('../../utils/vault-config', () => ({
  getIgnorePatterns: vi.fn().mockResolvedValue([])
}))

vi.mock('../documents', () => ({
  getDocumentManager: vi.fn()
}))

import { guardSelectedFile } from '../filesystem'

function createTestVault(): string {
  const base = join(
    tmpdir(),
    `select-file-guard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  mkdirSync(join(base, 'notes'), { recursive: true })
  writeFileSync(join(base, 'notes', 'test.md'), '# Test')
  return realpathSync(base)
}

describe('guardSelectedFile (fs:select-file)', () => {
  let vaultRoot: string
  let guard: PathGuard

  beforeEach(() => {
    vaultRoot = createTestVault()
    guard = new PathGuard(vaultRoot)
  })

  afterEach(() => {
    rmSync(vaultRoot, { recursive: true, force: true })
  })

  it('returns the resolved path for an inside-vault file', () => {
    const picked = join(vaultRoot, 'notes', 'test.md')
    const result = guardSelectedFile(picked, guard)
    expect(result).toBe(guard.assertWithinVault(picked))
    expect(result).toContain(join('notes', 'test.md'))
  })

  it('returns null (not throw) for an outside-vault path', () => {
    expect(guardSelectedFile('/etc/passwd', guard)).toBeNull()
  })

  it('returns null for a traversal path that escapes with ..', () => {
    const sneaky = join(vaultRoot, 'notes', '..', '..', 'etc', 'passwd')
    expect(guardSelectedFile(sneaky, guard)).toBeNull()
  })

  it('returns null when no workspace is open (null guard)', () => {
    expect(guardSelectedFile(join(vaultRoot, 'notes', 'test.md'), null)).toBeNull()
  })
})
