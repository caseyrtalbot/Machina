import { execFileSync } from 'child_process'
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { is } from '@electron-toolkit/utils'

// ---------------------------------------------------------------------------
// Session metadata persisted as JSON in the user's home directory.
// Dev builds use a separate directory to avoid cross-contamination.
// ---------------------------------------------------------------------------

export interface SessionMeta {
  readonly shell: string
  readonly cwd: string
  readonly createdAt: string
  readonly label?: string
  readonly vaultPath?: string
}

// ---------------------------------------------------------------------------
// Path constants
// ---------------------------------------------------------------------------

const BASE_DIR = is.dev ? '.machina-dev' : '.machina'
const SESSION_DIR_NAME = 'terminal-sessions'

export const TMUX_SOCKET = 'machina'
export const SESSION_PREFIX = 'te-'
export const MIN_TMUX_VERSION = 2.6

/** Override for testing. When set, bypasses homedir() resolution. */
let _sessionDirOverride: string | null = null

/** @internal Test-only: redirect metadata I/O to a temp directory. */
export function _setSessionDirForTest(dir: string | null): void {
  _sessionDirOverride = dir
}

export function getSessionDir(): string {
  if (_sessionDirOverride) return _sessionDirOverride
  return join(homedir(), BASE_DIR, SESSION_DIR_NAME)
}

export function tmuxSessionName(sessionId: string): string {
  return `${SESSION_PREFIX}${sessionId}`
}

// ---------------------------------------------------------------------------
// Tmux CLI wrappers
// ---------------------------------------------------------------------------

const EXEC_TIMEOUT = 5_000
const QUIET_STDIO: ['ignore', 'pipe', 'pipe'] = ['ignore', 'pipe', 'pipe']

function getApp(): typeof import('electron').app | null {
  try {
    return require('electron').app
  } catch {
    return null
  }
}

function baseArgs(): string[] {
  return ['-L', TMUX_SOCKET, '-u', '-f', getTmuxConf()]
}

export function getTmuxBin(): string {
  const app = getApp()
  if (app?.isPackaged) {
    const bundled = join(process.resourcesPath, 'tmux')
    if (existsSync(bundled)) {
      return bundled
    }
  }
  return 'tmux'
}

export function getTmuxConf(): string {
  const app = getApp()
  if (app?.isPackaged) {
    const bundled = join(process.resourcesPath, 'tmux.conf')
    if (existsSync(bundled)) {
      return bundled
    }
  }

  const root = app?.getAppPath?.() ?? process.cwd()
  return join(root, 'resources', 'tmux.conf')
}

export function getTerminfoDir(): string | undefined {
  const app = getApp()
  if (app?.isPackaged) {
    const bundled = join(process.resourcesPath, 'terminfo')
    return existsSync(bundled) ? bundled : undefined
  }

  const devDir = join(process.cwd(), 'resources', 'terminfo')
  return existsSync(devDir) ? devDir : undefined
}

export function tmuxRuntimeEnv(): Record<string, string> {
  const env = { ...(process.env as Record<string, string>) }
  const terminfoDir = getTerminfoDir()
  if (terminfoDir) {
    env.TERMINFO = terminfoDir
  }
  return env
}

export function tmuxExec(...args: string[]): string {
  return execFileSync(getTmuxBin(), [...baseArgs(), ...args], {
    encoding: 'utf-8',
    timeout: EXEC_TIMEOUT,
    env: tmuxRuntimeEnv(),
    stdio: QUIET_STDIO
  }).trim()
}

// ---------------------------------------------------------------------------
// Tmux availability check
// ---------------------------------------------------------------------------

export function verifyTmuxAvailable(): boolean {
  try {
    const output = execFileSync(getTmuxBin(), ['-V'], {
      encoding: 'utf-8',
      timeout: EXEC_TIMEOUT,
      env: tmuxRuntimeEnv(),
      stdio: QUIET_STDIO
    }).trim()

    // Parse version from "tmux 3.4" or "tmux 2.6a"
    const match = output.match(/(\d+\.\d+)/)
    if (!match) return false

    const version = parseFloat(match[1])
    return version >= MIN_TMUX_VERSION
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Metadata CRUD
// ---------------------------------------------------------------------------

export function ensureSessionDir(): void {
  mkdirSync(getSessionDir(), { recursive: true })
}

function metaPath(sessionId: string): string {
  return join(getSessionDir(), `${sessionId}.json`)
}

export function writeSessionMeta(sessionId: string, meta: SessionMeta): void {
  ensureSessionDir()
  writeFileSync(metaPath(sessionId), JSON.stringify(meta, null, 2), 'utf-8')
}

export function readSessionMeta(sessionId: string): SessionMeta | null {
  try {
    const raw = readFileSync(metaPath(sessionId), 'utf-8')
    return JSON.parse(raw) as SessionMeta
  } catch {
    return null
  }
}

export function deleteSessionMeta(sessionId: string): void {
  try {
    unlinkSync(metaPath(sessionId))
  } catch {
    // File already gone
  }
}

export function sessionMetaExists(sessionId: string): boolean {
  return existsSync(metaPath(sessionId))
}
