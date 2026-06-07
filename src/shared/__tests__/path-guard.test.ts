import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PathGuard } from '../../main/services/path-guard'
import { PathGuardError } from '../agent-types'

/**
 * Creates a temporary vault directory with known structure for testing.
 * Uses realpathSync to resolve OS-level symlinks (e.g. macOS /var -> /private/var)
 * so test assertions match PathGuard's resolved paths.
 */
function createTestVault(): string {
  const base = join(tmpdir(), `pathguard-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(base, { recursive: true })
  mkdirSync(join(base, 'notes'), { recursive: true })
  mkdirSync(join(base, '.git', 'objects'), { recursive: true })
  mkdirSync(join(base, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(base, 'notes', 'hello.md'), '# Hello')
  writeFileSync(join(base, '.env'), 'SECRET=hunter2')
  writeFileSync(join(base, '.git', 'config'), '[core]')
  // realpathSync resolves OS symlinks like /var -> /private/var on macOS
  return realpathSync(base)
}

describe('PathGuard', () => {
  let vaultRoot: string
  let guard: PathGuard

  beforeEach(() => {
    vaultRoot = createTestVault()
    guard = new PathGuard(vaultRoot)
  })

  afterEach(() => {
    rmSync(vaultRoot, { recursive: true, force: true })
  })

  // --- Valid paths ---

  it('accepts a valid path within the vault', () => {
    const filePath = join(vaultRoot, 'notes', 'hello.md')
    const resolved = guard.assertWithinVault(filePath)
    expect(resolved).toBe(filePath)
  })

  it('returns the resolved absolute path on success', () => {
    const filePath = join(vaultRoot, 'notes', 'hello.md')
    const result = guard.assertWithinVault(filePath)
    // realpathSync resolves OS-level symlinks (e.g. /var -> /private/var)
    expect(result).toBe(realpathSync(filePath))
  })

  it('accepts the vault root itself', () => {
    const result = guard.assertWithinVault(vaultRoot)
    expect(result).toBe(vaultRoot)
  })

  // --- Path traversal ---

  it('rejects path traversal with ../../etc/passwd', () => {
    const malicious = join(vaultRoot, '..', '..', 'etc', 'passwd')
    expect(() => guard.assertWithinVault(malicious)).toThrow(PathGuardError)
  })

  it('rejects path traversal targeting .ssh', () => {
    const malicious = join(vaultRoot, '..', '.ssh', 'id_rsa')
    expect(() => guard.assertWithinVault(malicious)).toThrow(PathGuardError)
  })

  it('rejects absolute paths outside the vault', () => {
    expect(() => guard.assertWithinVault('/etc/passwd')).toThrow(PathGuardError)
  })

  it('includes attempted path and vault root in the error', () => {
    const malicious = '/etc/passwd'
    try {
      guard.assertWithinVault(malicious)
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(PathGuardError)
      const pgErr = err as PathGuardError
      // vaultRoot in the error is the realpathSync-resolved vault root
      expect(pgErr.vaultRoot).toBe(realpathSync(vaultRoot))
      expect(pgErr.attemptedPath).toBeTruthy()
    }
  })

  // --- Null bytes ---

  it('rejects paths containing null bytes', () => {
    const malicious = join(vaultRoot, 'notes\0', 'hello.md')
    expect(() => guard.assertWithinVault(malicious)).toThrow(PathGuardError)
    expect(() => guard.assertWithinVault(malicious)).toThrow(/null bytes/)
  })

  it('rejects a path that is just a null byte', () => {
    expect(() => guard.assertWithinVault('\0')).toThrow(PathGuardError)
  })

  // --- Deny list ---

  it('rejects .git/config', () => {
    const filePath = join(vaultRoot, '.git', 'config')
    expect(() => guard.assertWithinVault(filePath)).toThrow(PathGuardError)
    expect(() => guard.assertWithinVault(filePath)).toThrow(/denied segment.*\.git/)
  })

  it('rejects .env file', () => {
    const filePath = join(vaultRoot, '.env')
    expect(() => guard.assertWithinVault(filePath)).toThrow(PathGuardError)
  })

  it('rejects dotenv-family files (.env.local, .env.production)', () => {
    expect(() => guard.assertWithinVault(join(vaultRoot, '.env.local'))).toThrow(PathGuardError)
    expect(() => guard.assertWithinVault(join(vaultRoot, '.env.production'))).toThrow(
      PathGuardError
    )
  })

  it('permits environment.md (not a dotenv file)', () => {
    const filePath = join(vaultRoot, 'environment.md')
    expect(guard.assertWithinVault(filePath)).toBe(filePath)
  })

  it('rejects node_modules paths', () => {
    const filePath = join(vaultRoot, 'node_modules', 'pkg', 'index.js')
    expect(() => guard.assertWithinVault(filePath)).toThrow(PathGuardError)
  })

  it('rejects .ssh paths inside the vault', () => {
    const sshDir = join(vaultRoot, '.ssh')
    mkdirSync(sshDir, { recursive: true })
    writeFileSync(join(sshDir, 'id_rsa'), 'private key')
    expect(() => guard.assertWithinVault(join(sshDir, 'id_rsa'))).toThrow(PathGuardError)
  })

  it('rejects .DS_Store', () => {
    const filePath = join(vaultRoot, '.DS_Store')
    expect(() => guard.assertWithinVault(filePath)).toThrow(PathGuardError)
  })

  // --- Symlinks ---

  it('rejects symlinks pointing outside the vault', () => {
    const linkPath = join(vaultRoot, 'notes', 'escape-link')
    // Create a file symlink pointing outside vault (use a file, not a dir,
    // to avoid rmSync issues with directory symlinks on some platforms)
    const outsideFile = join(tmpdir(), `pathguard-outside-${Date.now()}`)
    writeFileSync(outsideFile, 'outside')
    try {
      symlinkSync(realpathSync(outsideFile), linkPath)
    } catch {
      // Skip if symlinks aren't supported (CI environments)
      rmSync(outsideFile, { force: true })
      return
    }

    expect(() => guard.assertWithinVault(linkPath)).toThrow(PathGuardError)

    // Cleanup
    rmSync(linkPath, { force: true })
    rmSync(outsideFile, { force: true })
  })

  it('rejects a nonexistent child under a symlinked directory that points outside the vault', () => {
    const outsideDir = join(tmpdir(), `pathguard-outside-dir-${Date.now()}`)
    const linkPath = join(vaultRoot, 'notes', 'escape-dir')
    mkdirSync(outsideDir, { recursive: true })

    try {
      symlinkSync(realpathSync(outsideDir), linkPath)
    } catch {
      rmSync(outsideDir, { recursive: true, force: true })
      return
    }

    expect(() => guard.assertWithinVault(join(linkPath, 'new-note.md'))).toThrow(PathGuardError)

    unlinkSync(linkPath)
    rmSync(outsideDir, { recursive: true, force: true })
  })

  it('accepts symlinks pointing within the vault', () => {
    const targetPath = join(vaultRoot, 'notes', 'hello.md')
    const linkPath = join(vaultRoot, 'link-to-hello.md')
    try {
      symlinkSync(targetPath, linkPath)
    } catch {
      return
    }

    const result = guard.assertWithinVault(linkPath)
    // realpathSync resolves the symlink to the real target path
    expect(result).toBe(realpathSync(targetPath))

    rmSync(linkPath, { force: true })
  })

  it('accepts a nonexistent child under a real directory inside the vault', () => {
    const result = guard.assertWithinVault(join(vaultRoot, 'notes', 'new-note.md'))
    expect(result).toBe(join(vaultRoot, 'notes', 'new-note.md'))
  })

  // --- Unicode normalization ---

  it('handles Unicode normalization (NFC vs NFD)', () => {
    // Create a file with a Unicode name so the path exists on disk
    const nfc = 'caf\u00e9.md' // precomposed é (NFC)
    const nfd = 'cafe\u0301.md' // e + combining acute (NFD)

    // Write the file using NFC form
    writeFileSync(join(vaultRoot, 'notes', nfc), '# Café')

    const pathNFC = join(vaultRoot, 'notes', nfc)
    const pathNFD = join(vaultRoot, 'notes', nfd)

    // Both forms should be accepted (not throw) since they refer to
    // the same file after NFC normalization + realpathSync resolution
    const resultNFC = guard.assertWithinVault(pathNFC)

    // On macOS (APFS/HFS+), NFD and NFC resolve to the same file.
    // On Linux (ext4), they may be different files. Either way,
    // the path should either resolve within vault (pass) or not exist
    // (in which case the normalized form is still inside vault bounds).
    try {
      const resultNFD = guard.assertWithinVault(pathNFD)
      // If both succeed, they should resolve to the same NFC-normalized path
      expect(resultNFD.normalize('NFC')).toBe(resultNFC.normalize('NFC'))
    } catch (err) {
      // On Linux where NFD creates a separate non-existent file,
      // it may still pass (resolve within vault) or be a different file.
      // The key security property: it must NOT escape the vault.
      expect(err).not.toBeInstanceOf(PathGuardError)
    }
  })

  // --- Edge cases ---

  it('rejects empty string path', () => {
    // Empty string resolves to cwd, which is outside vault
    expect(() => guard.assertWithinVault('')).toThrow(PathGuardError)
  })

  it('handles paths with trailing slashes', () => {
    const filePath = join(vaultRoot, 'notes') + '/'
    // Should still resolve correctly (to the notes directory inside vault)
    const result = guard.assertWithinVault(filePath)
    expect(result).toContain('notes')
  })

  it('rejects a vault root prefix attack (e.g. /vault-root-evil)', () => {
    // If vault is at /tmp/vault, then /tmp/vault-evil should be rejected
    const evil = vaultRoot + '-evil'
    mkdirSync(evil, { recursive: true })
    try {
      expect(() => guard.assertWithinVault(join(evil, 'file.md'))).toThrow(PathGuardError)
    } finally {
      rmSync(evil, { recursive: true, force: true })
    }
  })
})
