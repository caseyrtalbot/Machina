import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { glob } from 'glob'
import { atomicWrite } from '../../utils/atomic-write'
import { awaitApproval, resolveInVault, type NativeToolResult, type ToolContext } from './context'

const SEARCH_HIT_LIMIT = 200
const SEARCH_PER_FILE_LIMIT = 20
const SEARCH_SNIPPET_LEN = 200
const SEARCH_TIMEOUT_MS = 15_000

export async function readNote(rel: string, ctx: ToolContext): Promise<NativeToolResult> {
  const resolved = resolveInVault(ctx.vaultPath, rel)
  if (!resolved.ok) return resolved
  try {
    const content = await fs.readFile(resolved.abs, 'utf8')
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

export async function listVault(
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

function normalizeSearchHitPath(p: string): string {
  return p.replace(/^\.[/\\]/, '')
}

function parseRipgrepMatchLine(line: string, hits: SearchHit[]): void {
  if (!line) return
  try {
    const ev = JSON.parse(line) as {
      type: string
      data?: {
        path?: { text?: string }
        line_number?: number
        lines?: { text?: string }
      }
    }
    if (ev.type !== 'match' || !ev.data) return
    const p = ev.data.path?.text
    const ln = ev.data.line_number
    const text = ev.data.lines?.text ?? ''
    if (typeof p !== 'string' || typeof ln !== 'number') return
    hits.push({
      path: normalizeSearchHitPath(p),
      line: ln,
      snippet: text.replace(/\n+$/, '').slice(0, SEARCH_SNIPPET_LEN)
    })
  } catch {
    // ignore malformed json line
  }
}

function searchWithRipgrep(
  query: string,
  paths: readonly string[],
  vaultPath: string,
  signal?: AbortSignal
): Promise<NativeToolResult> {
  // Short-circuit before spawning so we don't leak an rg child process whose
  // error/close events would land on a Promise that's already resolved.
  if (signal?.aborted) {
    return Promise.resolve({
      ok: false,
      error: { code: 'IO_TRANSIENT', message: 'aborted by user' }
    })
  }
  return new Promise((resolve) => {
    // --fixed-strings: query is a literal substring, not a regex. Matches the
    // JS fallback's String.includes semantics so the engine choice never
    // changes match results for the same query.
    const args = [
      '--json',
      '--fixed-strings',
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
    let truncated = false
    let killedForLimit = false

    function killChild(): void {
      child.kill('SIGTERM')
      // Force-kill if SIGTERM doesn't take effect promptly.
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, 1000).unref()
    }

    // Per-process timeout: a pathological regex can pin CPU until something
    // kills the child. The agent loop pauses its own timer during tool calls,
    // so without this the search has no upper bound at all.
    const timer = setTimeout(() => {
      if (resolved) return
      resolved = true
      signal?.removeEventListener('abort', onAbort)
      killChild()
      resolve({
        ok: false,
        error: {
          code: 'IO_TRANSIENT',
          message: `search_vault timed out after ${SEARCH_TIMEOUT_MS}ms`,
          hint: 'narrow the query or scope with paths'
        }
      })
    }, SEARCH_TIMEOUT_MS)

    function onAbort(): void {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      killChild()
      resolve({ ok: false, error: { code: 'IO_TRANSIENT', message: 'aborted by user' } })
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (d: Buffer) => {
      if (killedForLimit) return
      buf += d.toString('utf8')
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (hits.length >= SEARCH_HIT_LIMIT) {
          truncated = true
          killedForLimit = true
          killChild()
          return
        }
        parseRipgrepMatchLine(line, hits)
      }
      if (hits.length >= SEARCH_HIT_LIMIT) {
        truncated = true
        killedForLimit = true
        killChild()
      }
    })

    child.on('error', (err) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      spawnFailed = true
      // ENOENT means rg is not installed; signal upstream so we can fall back
      const code = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'IO_TRANSIENT' : 'IO_FATAL'
      resolve({ ok: false, error: { code, message: err.message, hint: 'rg-spawn-failed' } })
    })

    child.on('close', (code) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      // Flush any trailing partial line. ripgrep --json normally terminates
      // every event with \n, but if it ever exits without a trailing newline
      // (or we read the final chunk mid-line), the last match would otherwise
      // sit in `buf` and be silently dropped.
      if (buf.length > 0 && hits.length < SEARCH_HIT_LIMIT) {
        parseRipgrepMatchLine(buf, hits)
      }
      buf = ''
      if (hits.length >= SEARCH_HIT_LIMIT) truncated = true
      // ripgrep returns 0 with matches, 1 with no matches; both are success.
      // When we kill it after hitting the global limit, code is null on macOS
      // and that is also success — we have the hits we wanted.
      const cleanExit = code === 0 || code === 1 || (killedForLimit && code === null)
      if (!cleanExit && !spawnFailed) {
        resolve({ ok: false, error: { code: 'IO_FATAL', message: `rg exited ${code}` } })
        return
      }
      resolve({ ok: true, output: { hits, truncated, engine: 'ripgrep' } })
    })
  })
}

async function searchWithJsFallback(
  query: string,
  paths: readonly string[],
  vaultPath: string,
  signal?: AbortSignal
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
  let truncated = false
  const deadline = Date.now() + SEARCH_TIMEOUT_MS
  outer: for (const rel of files) {
    if (signal?.aborted) {
      return { ok: false, error: { code: 'IO_TRANSIENT', message: 'aborted by user' } }
    }
    if (Date.now() > deadline) {
      return {
        ok: false,
        error: {
          code: 'IO_TRANSIENT',
          message: `search_vault timed out after ${SEARCH_TIMEOUT_MS}ms`,
          hint: 'narrow the query or scope with paths'
        }
      }
    }
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
        if (hits.length >= SEARCH_HIT_LIMIT) {
          truncated = true
          break outer
        }
        if (perFile >= SEARCH_PER_FILE_LIMIT) break
      }
    }
  }
  return { ok: true, output: { hits, truncated, engine: 'fallback' } }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function writeNote(
  rel: string,
  content: string,
  ctx: ToolContext
): Promise<NativeToolResult> {
  const resolved = resolveInVault(ctx.vaultPath, rel)
  if (!resolved.ok) return resolved
  const abs = resolved.abs
  const created = !(await pathExists(abs))

  if (!ctx.autoAccept && ctx.toolUseId && ctx.emitPending) {
    ctx.emitPending(ctx.toolUseId, {
      approvalKind: 'write_note',
      preview: { path: rel, content, created }
    })
    const decision = await awaitApproval(ctx.toolUseId)
    if (!decision.accept) {
      return {
        ok: false,
        error: {
          code: 'IO_TRANSIENT',
          message: 'rejected by user',
          hint: decision.rejectReason
        }
      }
    }
  }

  try {
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await atomicWrite(abs, content)
    return {
      ok: true,
      output: { created, path: rel, bytes: Buffer.byteLength(content, 'utf8') }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'IO_FATAL', message } }
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let from = 0
  while (true) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) break
    count++
    from = idx + needle.length
  }
  return count
}

function countLines(s: string): number {
  if (s.length === 0) return 0
  let n = 1
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++
  if (s.charCodeAt(s.length - 1) === 10) n--
  return n
}

export async function editNote(
  rel: string,
  find: string,
  replace: string,
  ctx: ToolContext
): Promise<NativeToolResult> {
  const resolved = resolveInVault(ctx.vaultPath, rel)
  if (!resolved.ok) return resolved
  const abs = resolved.abs
  let content: string
  try {
    content = await fs.readFile(abs, 'utf8')
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      return { ok: false, error: { code: 'FILE_NOT_FOUND', message: `not found: ${rel}` } }
    }
    return { ok: false, error: { code: 'IO_FATAL', message: e.message ?? String(err) } }
  }

  if (find.length === 0) {
    return {
      ok: false,
      error: { code: 'EDIT_FIND_NOT_FOUND', message: 'edit_note: find string is empty' }
    }
  }
  const occurrences = countOccurrences(content, find)
  if (occurrences === 0) {
    return {
      ok: false,
      error: { code: 'EDIT_FIND_NOT_FOUND', message: `find not present in ${rel}` }
    }
  }
  if (occurrences > 1) {
    return {
      ok: false,
      error: {
        code: 'EDIT_FIND_NOT_UNIQUE',
        message: `find matched ${occurrences} times in ${rel}`,
        hint: 'add more surrounding context to make the find unique'
      }
    }
  }

  if (!ctx.autoAccept && ctx.toolUseId && ctx.emitPending) {
    ctx.emitPending(ctx.toolUseId, {
      approvalKind: 'edit_note',
      preview: { path: rel, find, replace }
    })
    const decision = await awaitApproval(ctx.toolUseId)
    if (!decision.accept) {
      return {
        ok: false,
        error: {
          code: 'IO_TRANSIENT',
          message: 'rejected by user',
          hint: decision.rejectReason
        }
      }
    }
  }

  const next = content.replace(find, replace)
  try {
    await atomicWrite(abs, next)
    return {
      ok: true,
      output: {
        path: rel,
        diff_stats: { added: countLines(replace), removed: countLines(find) }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'IO_FATAL', message } }
  }
}

export async function searchVault(
  query: string,
  paths: readonly string[] | undefined,
  ctx: ToolContext
): Promise<NativeToolResult> {
  if (!query) {
    return { ok: false, error: { code: 'IO_FATAL', message: 'search_vault: empty query' } }
  }
  if (paths && paths.length > 0) {
    for (const p of paths) {
      const resolved = resolveInVault(ctx.vaultPath, p)
      if (!resolved.ok) return resolved
    }
  }
  const scope = paths && paths.length > 0 ? [...paths] : ['.']
  const rgResult = await searchWithRipgrep(query, scope, ctx.vaultPath, ctx.signal)
  if (rgResult.ok) return rgResult
  if (ctx.signal?.aborted) return rgResult
  if (rgResult.error.hint === 'rg-spawn-failed') {
    return searchWithJsFallback(query, paths ?? [], ctx.vaultPath, ctx.signal)
  }
  return rgResult
}
