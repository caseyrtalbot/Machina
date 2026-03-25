import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// Mock @electron-toolkit/utils so is.dev = true (use .machina-dev paths)
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

import {
  TMUX_SOCKET,
  SESSION_PREFIX,
  MIN_TMUX_VERSION,
  getSessionDir,
  tmuxSessionName,
  ensureSessionDir,
  writeSessionMeta,
  readSessionMeta,
  deleteSessionMeta,
  sessionMetaExists,
  verifyTmuxAvailable,
  _setSessionDirForTest,
  type SessionMeta
} from '../../src/main/services/tmux-paths'

const TEST_DIR = join(tmpdir(), `tmux-paths-test-${randomUUID()}`)

describe('tmux-paths', () => {
  beforeEach(() => {
    _setSessionDirForTest(TEST_DIR)
  })

  afterEach(() => {
    _setSessionDirForTest(null)
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  // -----------------------------------------------------------------------
  // Constants
  // -----------------------------------------------------------------------

  it('uses machina socket name', () => {
    expect(TMUX_SOCKET).toBe('machina')
  })

  it('uses te- session prefix', () => {
    expect(SESSION_PREFIX).toBe('te-')
  })

  it('minimum tmux version is 2.6', () => {
    expect(MIN_TMUX_VERSION).toBe(2.6)
  })

  it('getSessionDir returns override when set', () => {
    expect(getSessionDir()).toBe(TEST_DIR)
  })

  it('getSessionDir returns real path when override cleared', () => {
    _setSessionDirForTest(null)
    const dir = getSessionDir()
    expect(dir).toContain('.machina')
    expect(dir).toContain('terminal-sessions')
    _setSessionDirForTest(TEST_DIR) // restore for afterEach
  })

  it('tmuxSessionName adds te- prefix', () => {
    expect(tmuxSessionName('abc123')).toBe('te-abc123')
  })

  // -----------------------------------------------------------------------
  // Metadata CRUD round-trip
  // -----------------------------------------------------------------------

  describe('metadata CRUD', () => {
    const sessionId = 'test-session-1'
    const meta: SessionMeta = {
      shell: '/bin/zsh',
      cwd: '/Users/test/project',
      createdAt: '2026-03-24T00:00:00.000Z',
      label: 'Shell 1',
      vaultPath: '/Users/test/vault'
    }

    it('write then read returns same data', () => {
      writeSessionMeta(sessionId, meta)
      const result = readSessionMeta(sessionId)
      expect(result).toEqual(meta)
    })

    it('readSessionMeta returns null for missing file', () => {
      expect(readSessionMeta('nonexistent')).toBeNull()
    })

    it('readSessionMeta returns null for corrupted JSON', () => {
      ensureSessionDir()
      const filePath = join(getSessionDir(), `${sessionId}.json`)
      writeFileSync(filePath, '{invalid json!!!', 'utf-8')
      expect(readSessionMeta(sessionId)).toBeNull()
    })

    it('deleteSessionMeta removes the file', () => {
      writeSessionMeta(sessionId, meta)
      expect(sessionMetaExists(sessionId)).toBe(true)

      deleteSessionMeta(sessionId)
      expect(sessionMetaExists(sessionId)).toBe(false)
    })

    it('deleteSessionMeta is safe for nonexistent files', () => {
      expect(() => deleteSessionMeta('nonexistent')).not.toThrow()
    })

    it('sessionMetaExists returns false when no file', () => {
      expect(sessionMetaExists('nope')).toBe(false)
    })

    it('write creates the session directory if missing', () => {
      expect(existsSync(TEST_DIR)).toBe(false)
      writeSessionMeta(sessionId, meta)
      expect(existsSync(TEST_DIR)).toBe(true)
    })

    it('metadata without optional fields round-trips cleanly', () => {
      const minimal: SessionMeta = {
        shell: '/bin/bash',
        cwd: '/tmp',
        createdAt: '2026-01-01T00:00:00.000Z'
      }
      writeSessionMeta('minimal', minimal)
      const result = readSessionMeta('minimal')
      expect(result).toEqual(minimal)
    })
  })

  // -----------------------------------------------------------------------
  // verifyTmuxAvailable
  // -----------------------------------------------------------------------

  describe('verifyTmuxAvailable', () => {
    it('returns a boolean without throwing', () => {
      const result = verifyTmuxAvailable()
      expect(typeof result).toBe('boolean')
    })
  })
})
