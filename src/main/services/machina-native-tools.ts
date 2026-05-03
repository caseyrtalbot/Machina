import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { glob } from 'glob'
import type { ToolErrorCode } from '@shared/thread-types'
import type { AgentNativeApprovalPreview } from '@shared/ipc-channels'
import { createCanvasNode } from '@shared/canvas-types'
import { TE_DIR } from '@shared/constants'

const SEARCH_HIT_LIMIT = 200
const SEARCH_PER_FILE_LIMIT = 20
const SEARCH_SNIPPET_LEN = 200
const CANVAS_ID_RE = /^[a-zA-Z0-9_-]+$/

interface ApprovalDecision {
  readonly accept: boolean
  readonly rejectReason?: string
}

const approvals = new Map<string, (decision: ApprovalDecision) => void>()

export function decideApproval(toolUseId: string, accept: boolean, rejectReason?: string): void {
  const resolver = approvals.get(toolUseId)
  if (!resolver) return
  approvals.delete(toolUseId)
  resolver({ accept, rejectReason })
}

// Resolve any pending approval as rejected and drop it from the map. Call this
// when a run aborts or errors out so the awaiting tool returns instead of
// leaking a zombie entry forever.
export function clearApproval(toolUseId: string, reason = 'run aborted'): void {
  const resolver = approvals.get(toolUseId)
  if (!resolver) return
  approvals.delete(toolUseId)
  resolver({ accept: false, rejectReason: reason })
}

function awaitApproval(toolUseId: string): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    approvals.set(toolUseId, resolve)
  })
}

export interface ToolContext {
  readonly vaultPath: string
  readonly autoAccept: boolean
  readonly toolUseId?: string
  readonly emitPending?: (toolUseId: string, preview: AgentNativeApprovalPreview) => void
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

function normalizeSearchHitPath(p: string): string {
  return p.replace(/^\.[/\\]/, '')
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
            path: normalizeSearchHitPath(p),
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function writeNote(
  rel: string,
  content: string,
  ctx: ToolContext
): Promise<NativeToolResult> {
  const abs = safeJoin(ctx.vaultPath, rel)
  if (!abs) {
    return {
      ok: false,
      error: { code: 'PATH_OUT_OF_VAULT', message: `path escapes vault: ${rel}` }
    }
  }
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
    await fs.writeFile(abs, content, 'utf8')
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

function countNewlines(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++
  return n
}

async function editNote(
  rel: string,
  find: string,
  replace: string,
  ctx: ToolContext
): Promise<NativeToolResult> {
  const abs = safeJoin(ctx.vaultPath, rel)
  if (!abs) {
    return {
      ok: false,
      error: { code: 'PATH_OUT_OF_VAULT', message: `path escapes vault: ${rel}` }
    }
  }
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
    await fs.writeFile(abs, next, 'utf8')
    return {
      ok: true,
      output: {
        path: rel,
        diff_stats: { added: countNewlines(replace), removed: countNewlines(find) }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'IO_FATAL', message } }
  }
}

interface CanvasFileShape {
  nodes?: unknown[]
  edges?: unknown[]
  [k: string]: unknown
}

interface PinCardInput {
  readonly title: string
  readonly content?: string
  readonly position?: { x: number; y: number }
  readonly refs?: readonly string[]
}

function canvasFilePath(vault: string, canvasId: string): string {
  if (canvasId === 'default') return path.join(vault, TE_DIR, 'canvas.json')
  return path.join(vault, TE_DIR, 'canvas', `${canvasId}.json`)
}

async function readCanvas(canvasId: string, ctx: ToolContext): Promise<NativeToolResult> {
  const file = canvasFilePath(ctx.vaultPath, canvasId)
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as CanvasFileShape
    return {
      ok: true,
      output: {
        cards: Array.isArray(parsed.nodes) ? parsed.nodes : [],
        edges: Array.isArray(parsed.edges) ? parsed.edges : []
      }
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      return { ok: false, error: { code: 'CANVAS_NOT_FOUND', message: canvasId } }
    }
    return { ok: false, error: { code: 'IO_FATAL', message: e.message ?? String(err) } }
  }
}

async function pinToCanvas(
  canvasId: string,
  card: PinCardInput,
  ctx: ToolContext
): Promise<NativeToolResult> {
  const file = canvasFilePath(ctx.vaultPath, canvasId)
  let canvas: CanvasFileShape
  try {
    canvas = JSON.parse(await fs.readFile(file, 'utf8')) as CanvasFileShape
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code === 'ENOENT') {
      return { ok: false, error: { code: 'CANVAS_NOT_FOUND', message: canvasId } }
    }
    return { ok: false, error: { code: 'IO_FATAL', message: e.message ?? String(err) } }
  }
  const body = card.content ?? ''
  const text = body ? `${card.title}\n\n${body}` : card.title
  const node = createCanvasNode(
    'text',
    { x: card.position?.x ?? 0, y: card.position?.y ?? 0 },
    { content: text, metadata: { refs: card.refs ?? [] } }
  )
  const nodes = Array.isArray(canvas.nodes) ? [...canvas.nodes, node] : [node]
  const next: CanvasFileShape = { ...canvas, nodes }
  try {
    await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8')
    return { ok: true, output: { cardId: node.id, canvasId, node } }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: { code: 'IO_FATAL', message } }
  }
}

async function searchVault(
  query: string,
  paths: readonly string[] | undefined,
  ctx: ToolContext
): Promise<NativeToolResult> {
  if (!query) {
    return { ok: false, error: { code: 'IO_FATAL', message: 'search_vault: empty query' } }
  }
  if (paths && paths.length > 0) {
    for (const p of paths) {
      if (!safeJoin(ctx.vaultPath, p)) {
        return {
          ok: false,
          error: { code: 'PATH_OUT_OF_VAULT', message: `path escapes vault: ${p}` }
        }
      }
    }
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
    case 'write_note': {
      const p = typeof input.path === 'string' ? input.path : null
      const content = typeof input.content === 'string' ? input.content : null
      if (!p) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'write_note: missing path' } }
      }
      if (content == null) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'write_note: missing content' } }
      }
      return writeNote(p, content, ctx)
    }
    case 'edit_note': {
      const p = typeof input.path === 'string' ? input.path : null
      const find = typeof input.find === 'string' ? input.find : null
      const replace = typeof input.replace === 'string' ? input.replace : null
      if (!p) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'edit_note: missing path' } }
      }
      if (find == null) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'edit_note: missing find' } }
      }
      if (replace == null) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'edit_note: missing replace' } }
      }
      return editNote(p, find, replace, ctx)
    }
    case 'read_canvas': {
      const id = typeof input.canvasId === 'string' ? input.canvasId : null
      if (!id) {
        return { ok: false, error: { code: 'IO_FATAL', message: 'read_canvas: missing canvasId' } }
      }
      if (!CANVAS_ID_RE.test(id)) {
        return {
          ok: false,
          error: { code: 'PATH_OUT_OF_VAULT', message: `invalid canvasId: ${id}` }
        }
      }
      return readCanvas(id, ctx)
    }
    case 'pin_to_canvas': {
      const id = typeof input.canvasId === 'string' ? input.canvasId : null
      const rawCard = input.card
      if (!id) {
        return {
          ok: false,
          error: { code: 'IO_FATAL', message: 'pin_to_canvas: missing canvasId' }
        }
      }
      if (!CANVAS_ID_RE.test(id)) {
        return {
          ok: false,
          error: { code: 'PATH_OUT_OF_VAULT', message: `invalid canvasId: ${id}` }
        }
      }
      if (!rawCard || typeof rawCard !== 'object') {
        return {
          ok: false,
          error: { code: 'IO_FATAL', message: 'pin_to_canvas: missing card' }
        }
      }
      const c = rawCard as Record<string, unknown>
      const title = typeof c.title === 'string' ? c.title : null
      if (!title) {
        return {
          ok: false,
          error: { code: 'IO_FATAL', message: 'pin_to_canvas: card.title is required' }
        }
      }
      const content = typeof c.content === 'string' ? c.content : undefined
      const rawPos = c.position
      let position: { x: number; y: number } | undefined
      if (rawPos && typeof rawPos === 'object') {
        const pos = rawPos as Record<string, unknown>
        if (typeof pos.x === 'number' && typeof pos.y === 'number') {
          position = { x: pos.x, y: pos.y }
        }
      }
      const rawRefs = c.refs
      const refs =
        Array.isArray(rawRefs) && rawRefs.every((r): r is string => typeof r === 'string')
          ? (rawRefs as string[])
          : undefined
      return pinToCanvas(id, { title, content, position, refs }, ctx)
    }
    default:
      return { ok: false, error: { code: 'IO_FATAL', message: `unknown tool: ${name}` } }
  }
}
