import { promises as fsp } from 'fs'
import { dirname, join, basename } from 'path'

// ---------------------------------------------------------------------------
// One-click block-protocol hook installation.
//
// Copies the bundled resources/shell-hooks/te.<shell> file into the user's
// home directory and (for zsh/bash) appends a guarded source line to the rc
// file. fish needs no rc edit: files in ~/.config/fish/conf.d/ are
// auto-sourced. The hooks themselves no-op unless TE_SESSION_ID is set, so
// installation is safe for every shell the user opens outside the app.
//
// Pure with respect to Electron: callers (src/main/ipc/shell.ts) supply the
// home directory and the bundled hook content so this module stays unit-
// testable against temp dirs.
// ---------------------------------------------------------------------------

export type SupportedShell = 'zsh' | 'bash' | 'fish'

export interface ShellHookTarget {
  readonly shell: SupportedShell
  /** Bundled source file name under resources/shell-hooks/. */
  readonly hookFileName: string
  /** Absolute destination path of the installed hook. */
  readonly hookPath: string
  /** rc file that must source the hook, or null when none is needed (fish). */
  readonly rcPath: string | null
  /** Guarded source line appended to rcPath, or null when rcPath is null. */
  readonly sourceLine: string | null
}

export interface ShellHookStatus {
  readonly installed: boolean
  readonly shell: SupportedShell
  readonly hookPath: string
}

export interface ShellHookInstallResult {
  readonly ok: boolean
  readonly shell: SupportedShell
  readonly hookPath: string
  readonly rcPath: string | null
  /** True when this install appended the source line (false if already present). */
  readonly rcUpdated: boolean
  readonly error?: string
}

/** Map $SHELL to a supported shell; macOS default (zsh) when unrecognized. */
export function detectShell(shellEnv: string | undefined): SupportedShell {
  const name = basename(shellEnv ?? '')
  if (name === 'bash' || name.startsWith('bash')) return 'bash'
  if (name === 'fish' || name.startsWith('fish')) return 'fish'
  return 'zsh'
}

export function hookTarget(shell: SupportedShell, home: string): ShellHookTarget {
  switch (shell) {
    case 'zsh':
      return {
        shell,
        hookFileName: 'te.zsh',
        hookPath: join(home, '.te.zsh'),
        rcPath: join(home, '.zshrc'),
        sourceLine: '[ -f ~/.te.zsh ] && source ~/.te.zsh'
      }
    case 'bash':
      return {
        shell,
        hookFileName: 'te.bash',
        hookPath: join(home, '.te.bash'),
        rcPath: join(home, '.bashrc'),
        sourceLine: '[ -f ~/.te.bash ] && source ~/.te.bash'
      }
    case 'fish':
      // fish auto-sources every file in conf.d — no rc edit required.
      return {
        shell,
        hookFileName: 'te.fish',
        hookPath: join(home, '.config', 'fish', 'conf.d', 'te.fish'),
        rcPath: null,
        sourceLine: null
      }
  }
}

async function readFileOrEmpty(path: string): Promise<string> {
  try {
    return await fsp.readFile(path, 'utf-8')
  } catch {
    return ''
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await fsp.access(path)
    return true
  } catch {
    return false
  }
}

/** Substring whose presence in the rc file counts as "already sourced".
 * Matches both the line we append and hand-rolled variants that reference
 * the installed hook file. */
function rcMarker(shell: SupportedShell): string {
  return `.te.${shell}`
}

export async function getShellHookStatus(target: ShellHookTarget): Promise<ShellHookStatus> {
  const base = { shell: target.shell, hookPath: target.hookPath }
  if (!(await fileExists(target.hookPath))) {
    return { ...base, installed: false }
  }
  if (target.rcPath === null) {
    return { ...base, installed: true }
  }
  const rc = await readFileOrEmpty(target.rcPath)
  return { ...base, installed: rc.includes(rcMarker(target.shell)) }
}

export async function installShellHooks(
  target: ShellHookTarget,
  hookContent: string
): Promise<ShellHookInstallResult> {
  const base = {
    shell: target.shell,
    hookPath: target.hookPath,
    rcPath: target.rcPath
  }
  try {
    await fsp.mkdir(dirname(target.hookPath), { recursive: true })
    await fsp.writeFile(target.hookPath, hookContent, 'utf-8')

    let rcUpdated = false
    if (target.rcPath !== null && target.sourceLine !== null) {
      const rc = await readFileOrEmpty(target.rcPath)
      if (!rc.includes(rcMarker(target.shell))) {
        const needsNewline = rc !== '' && !rc.endsWith('\n')
        const suffix =
          (needsNewline ? '\n' : '') +
          '\n# Machina: structured terminal blocks (block protocol)\n' +
          target.sourceLine +
          '\n'
        await fsp.appendFile(target.rcPath, suffix, 'utf-8')
        rcUpdated = true
      }
    }
    return { ...base, ok: true, rcUpdated }
  } catch (error) {
    return {
      ...base,
      ok: false,
      rcUpdated: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
