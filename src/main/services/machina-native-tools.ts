import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { glob } from 'glob'
import type { ToolErrorCode } from '@shared/thread-types'

const SEARCH_HIT_LIMIT = 200
const SEARCH_PER_FILE_LIMIT = 20
const SEARCH_SNIPPET_LEN = 200

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

interface SearchHit {
  readonly path: string
  readonly line: number
  readonly snippet: string
}

function searchWithRipgrep(
  query: string,
  paths: readonly string[],
  vaultPath: string
): Promise<NativeToolResult> {
  return new Promise((resolve) => {
    const args = [
      '--json',
      '--max-count',
      String(SEARCH_PER_FILE_LIMIT),
      '--glob',
      '!.machina/**',
      query,
      ...paths
    ]
    const child = spawn('rg', args, { cwd: vaultPath })
    const hits: SearchHit[] = []
    let buf = ''
    let resolved = false
    let spawnFailed = false

    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString('utf8')
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line) continue
        if (hits.length >= SEARCH_HIT_LIMIT) return
        try {
          const ev = JSON.parse(line) as {
            type: string
            data?: {
              path?: { text?: string }
              line_number?: number
              lines?: { text?: string }
            }
          }
          if (ev.type !== 'match' || !ev.data) continue
          const p = ev.data.path?.text
          const ln = ev.data.line_number
          const text = ev.data.lines?.text ?? ''
          if (typeof p !== 'string' || typeof ln !== 'number') continue
          hits.push({
            path: p,
            line: ln,
            snippet: text.replace(/\n+$/, '').slice(0, SEARCH_SNIPPET_LEN)
          })
        } catch {
          // ignore malformed json line
        }
      }
    })

    child.on('error', (err) => {
      if (resolved) return
      resolved = true
      spawnFailed = true
      // ENOENT means rg is not installed; signal upstream so we can fall back
      const code = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'IO_TRANSIENT' : 'IO_FATAL'
      resolve({ ok: false, error: { code, message: err.message, hint: 'rg-spawn-failed' } })
    })

    child.on('close', (code) => {
      if (resolved) return
      resolved = true
      // ripgrep returns 1 when no matches, 0 when matches; both are success for us
      if (code !== 0 && code !== 1 && !spawnFailed) {
        resolve({ ok: false, error: { code: 'IO_FATAL', message: `rg exited ${code}` } })
        return
      }
      resolve({ ok: true, output: { hits } })
    })
  })
}

async function searchWithJsFallback(
  query: string,
  paths: readonly string[],
  vaultPath: string
): Promise<NativeToolResult> {
  const scopeGlobs =
    paths.length > 0 ? paths.map((p) => `${p.replace(/\/$/, '')}/**/*.md`) : ['**/*.md']
  let files: string[]
  try {
    files = await glob(scopeGlobs, {
      cwd: vaultPath,
      ignore: ['.machina/**'],
      nodir: true,
      dot: false
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'IO_TRANSIENT', message } }
  }
  files.sort()
  const hits: SearchHit[] = []
  outer: for (const rel of files) {
    let content: string
    try {
      content = await fs.readFile(path.join(vaultPath, rel), 'utf8')
    } catch {
      continue
    }
    const lines = content.split('\n')
    let perFile = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(query)) {
        hits.push({ path: rel, line: i + 1, snippet: lines[i].slice(0, SEARCH_SNIPPET_LEN) })
        perFile++
        if (hits.length >= SEARCH_HIT_LIMIT) break outer
        if (perFile >= SEARCH_PER_FILE_LIMIT) break
      }
    }
  }
  return { ok: true, output: { hits } }
}

async function searchVault(
  query: string,
  paths: readonly string[] | undefined,
  ctx: ToolContext
): Promise<NativeToolResult> {
  if (!query) {
    return { ok: false, error: { code: 'IO_FATAL', message: 'search_vault: empty query' } }
  }
  const scope = paths && paths.length > 0 ? [...paths] : ['.']
  const rgResult = await searchWithRipgrep(query, scope, ctx.vaultPath)
  if (rgResult.ok) return rgResult
  if (rgResult.error.hint === 'rg-spawn-failed') {
    return searchWithJsFallback(query, paths ?? [], ctx.vaultPath)
  }
  return rgResult
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
    case 'search_vault': {
      const query = typeof input.query === 'string' ? input.query : null
      if (!query) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'search_vault: missing query' } }
      }
      const rawPaths = input.paths
      const paths =
        Array.isArray(rawPaths) && rawPaths.every((p): p is string => typeof p === 'string')
          ? (rawPaths as string[])
          : undefined
      return searchVault(query, paths, ctx)
    }
    default:
      return { ok: false, error: { code: 'IO_FATAL', message: `unknown tool: ${name}` } }
  }
}
