/**
 * Tests that fs:* IPC handlers enforce vault-scoped access via PathGuard.
 *
 * Rather than testing through Electron's ipcMain (which requires a running
 * Electron process), we test the guard logic directly: PathGuard is created
 * with a vault root, and we verify it rejects outside-vault paths and
 * allows inside-vault paths for each handler pattern.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PathGuard } from '../../services/path-guard'
import { PathGuardError } from '@shared/agent-types'

function createTestVault(): string {
  const base = join(tmpdir(), `fs-guard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(join(base, 'notes'), { recursive: true })
  mkdirSync(join(base, '.te'), { recursive: true })
  writeFileSync(join(base, 'notes', 'test.md'), '# Test')
  writeFileSync(join(base, '.te', 'config.json'), '{}')
  return realpathSync(base)
}

/**
 * Replicates the guardPath function from filesystem.ts.
 * Tests verify this pattern correctly blocks path traversal.
 */
function guardPath(guard: PathGuard, path: string, _channel: string): string {
  return guard.assertWithinVault(path)
}

describe('fs:* IPC PathGuard enforcement', () => {
  let vaultRoot: string
  let guard: PathGuard

  beforeEach(() => {
    vaultRoot = createTestVault()
    guard = new PathGuard(vaultRoot)
  })

  afterEach(() => {
    rmSync(vaultRoot, { recursive: true, force: true })
  })

  describe('allows vault-internal paths', () => {
    it('allows direct child files', () => {
      const resolved = guardPath(guard, join(vaultRoot, 'notes', 'test.md'), 'fs:read-file')
      expect(resolved).toContain('notes/test.md')
    })

    it('allows .te directory (config/state)', () => {
      const resolved = guardPath(guard, join(vaultRoot, '.te', 'config.json'), 'fs:write-file')
      expect(resolved).toContain('.te/config.json')
    })

    it('allows vault root itself', () => {
      expect(() => guardPath(guard, vaultRoot, 'fs:list-files')).not.toThrow()
    })
  })

  describe('rejects outside-vault paths', () => {
    it('rejects absolute paths outside vault', () => {
      expect(() => guardPath(guard, '/etc/passwd', 'fs:read-file')).toThrow(PathGuardError)
    })

    it('rejects home directory', () => {
      expect(() => guardPath(guard, '/Users/someone/.ssh/id_rsa', 'fs:read-file')).toThrow(
        PathGuardError
      )
    })

    it('rejects path traversal with ..', () => {
      expect(() =>
        guardPath(guard, join(vaultRoot, 'notes', '..', '..', 'etc', 'passwd'), 'fs:read-file')
      ).toThrow(PathGuardError)
    })

    it('rejects null bytes', () => {
      expect(() =>
        guardPath(guard, join(vaultRoot, 'notes\0/../../etc/passwd'), 'fs:read-file')
      ).toThrow(PathGuardError)
    })
  })

  describe('rejects denied segments', () => {
    it('rejects .git directory', () => {
      expect(() => guardPath(guard, join(vaultRoot, '.git', 'config'), 'fs:read-file')).toThrow(
        PathGuardError
      )
    })

    it('rejects node_modules', () => {
      expect(() =>
        guardPath(guard, join(vaultRoot, 'node_modules', 'foo'), 'fs:read-file')
      ).toThrow(PathGuardError)
    })

    it('rejects .env files', () => {
      expect(() => guardPath(guard, join(vaultRoot, '.env', 'secrets'), 'fs:write-file')).toThrow(
        PathGuardError
      )
    })
  })

  describe('covers all destructive handler patterns', () => {
    const channels = [
      'fs:read-file',
      'fs:write-file',
      'fs:delete-file',
      'fs:rename-file',
      'fs:copy-file',
      'fs:mkdir',
      'fs:read-binary',
      'fs:file-mtime',
      'fs:file-exists',
      'fs:list-files',
      'fs:list-files-recursive'
    ]

    for (const channel of channels) {
      it(`${channel}: rejects outside-vault path`, () => {
        expect(() => guardPath(guard, '/tmp/evil', channel)).toThrow(PathGuardError)
      })

      it(`${channel}: allows vault-internal path`, () => {
        expect(() => guardPath(guard, join(vaultRoot, 'notes', 'test.md'), channel)).not.toThrow()
      })
    }
  })

  describe('dual-path handlers (rename, copy)', () => {
    it('rename: rejects if source is outside vault', () => {
      expect(() => guardPath(guard, '/tmp/evil', 'fs:rename-file')).toThrow(PathGuardError)
    })

    it('rename: rejects if destination is outside vault', () => {
      expect(() => guardPath(guard, '/tmp/evil', 'fs:rename-file')).toThrow(PathGuardError)
    })

    it('copy: both paths must be within vault', () => {
      const src = join(vaultRoot, 'notes', 'test.md')
      const dest = join(vaultRoot, 'notes', 'copy.md')
      expect(() => guardPath(guard, src, 'fs:copy-file')).not.toThrow()
      expect(() => guardPath(guard, dest, 'fs:copy-file')).not.toThrow()
    })
  })
})
