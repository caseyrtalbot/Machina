import fs from 'node:fs/promises'
import path from 'node:path'
import { glob } from 'glob'
import type { ToolErrorCode } from '@shared/thread-types'

export interface ToolContext {
  readonly vaultPath: string
  readonly autoAccept: boolean
}

export type NativeToolResult =
  | { ok: true; output: unknown; pendingUserApproval?: boolean }
  | { ok: false; error: { code: ToolErrorCode; message: string; hint?: string } }

function safeJoin(vault: string, rel: string): string | null {
  const v = path.resolve(vault)
  const abs = path.resolve(v, rel)
  if (abs !== v && !abs.startsWith(v + path.sep)) return null
  return abs
}

async function readNote(rel: string, ctx: ToolContext): Promise<NativeToolResult> {
  const abs = safeJoin(ctx.vaultPath, rel)
  if (!abs) {
    return {
      ok: false,
      error: { code: 'PATH_OUT_OF_VAULT', message: `path escapes vault: ${rel}` }
    }
  }
  try {
    const content = await fs.readFile(abs, 'utf8')
    const lines = content.split('\n').length
    return { ok: true, output: { content, path: rel, lines: `1-${lines}` } }
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      return { ok: false, error: { code: 'FILE_NOT_FOUND', message: `not found: ${rel}` } }
    }
    return { ok: false, error: { code: 'IO_FATAL', message: e.message ?? String(err) } }
  }
}

async function listVault(
  globs: readonly string[] | undefined,
  ctx: ToolContext
): Promise<NativeToolResult> {
  const patterns = globs && globs.length > 0 ? [...globs] : ['**/*.md']
  try {
    const matches = await glob(patterns, {
      cwd: ctx.vaultPath,
      ignore: ['.machina/**'],
      nodir: true,
      dot: false
    })
    matches.sort()
    return { ok: true, output: { paths: matches } }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'IO_TRANSIENT', message } }
  }
}

export async function callTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<NativeToolResult> {
  switch (name) {
    case 'read_note': {
      const p = typeof input.path === 'string' ? input.path : null
      if (!p) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'read_note: missing path' } }
      }
      return readNote(p, ctx)
    }
    case 'list_vault': {
      const raw = input.globs
      const globs =
        Array.isArray(raw) && raw.every((g): g is string => typeof g === 'string')
          ? (raw as string[])
          : undefined
      return listVault(globs, ctx)
    }
    default:
      return { ok: false, error: { code: 'IO_FATAL', message: `unknown tool: ${name}` } }
  }
}
