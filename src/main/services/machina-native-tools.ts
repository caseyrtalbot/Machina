import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { glob } from 'glob'
import type { ToolErrorCode } from '@shared/thread-types'
import type { AgentNativeApprovalPreview, DockAction } from '@shared/ipc-channels'
import type { DockTab, DockTabKind } from '@shared/dock-types'
import { createCanvasNode } from '@shared/canvas-types'
import type { CanvasMutationPlan } from '@shared/canvas-mutation-types'
import { TE_DIR } from '@shared/constants'
import { enqueueCanvasWrite } from './canvas-write-queue'

const SEARCH_HIT_LIMIT = 200
const SEARCH_PER_FILE_LIMIT = 20
const SEARCH_SNIPPET_LEN = 200
const SEARCH_TIMEOUT_MS = 15_000
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
  /** Snapshot of the active thread's dock tabs at run-start. Used by close_dock_tab
   * to translate kind→index when the agent does not specify an explicit index. */
  readonly dockTabsSnapshot?: readonly DockTab[]
  /** Drive the renderer's surface dock from the agent. */
  readonly emitDockAction?: (action: DockAction) => void
  /** Push canvas mutations to the renderer's in-memory store after an
   * agent tool writes the canvas file directly. Without this bridge,
   * the renderer's debounced autosave would later overwrite the disk
   * with stale in-memory state, silently dropping the agent's write.
   * The renderer applies the plan only when canvasPath matches the
   * currently loaded canvas. */
  readonly dispatchCanvasPlan?: (plan: CanvasMutationPlan, canvasPath: string) => void
  /** Aborted when the agent run is cancelled. Long-running tools (search_vault,
   * pin_to_canvas) check or wire this to short-circuit instead of running to
   * completion after the user has already pressed Stop. */
  readonly signal?: AbortSignal
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

function countLines(s: string): number {
  if (s.length === 0) return 0
  let n = 1
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++
  if (s.charCodeAt(s.length - 1) === 10) n--
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
        diff_stats: { added: countLines(replace), removed: countLines(find) }
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
  viewport?: unknown
  version?: number
  [k: string]: unknown
}

interface PinCardInput {
  readonly title: string
  readonly path?: string
  readonly content?: string
  readonly position?: { x: number; y: number }
  readonly refs?: readonly string[]
}

function canvasFilePath(vault: string, canvasId: string): string {
  if (canvasId === 'default') return path.join(vault, TE_DIR, 'canvas.json')
  return path.join(vault, TE_DIR, 'canvas', `${canvasId}.json`)
}

function buildAgentPlan(
  ops: CanvasMutationPlan['ops'],
  summary: CanvasMutationPlan['summary']
): CanvasMutationPlan {
  return {
    id: `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    operationId: `agent_${Date.now().toString(36)}`,
    source: 'agent',
    ops,
    summary
  }
}

const EMPTY_PLAN_SUMMARY: CanvasMutationPlan['summary'] = {
  addedNodes: 0,
  addedEdges: 0,
  movedNodes: 0,
  skippedFiles: 0,
  unresolvedRefs: 0
}

async function readCanvas(canvasId: string, ctx: ToolContext): Promise<NativeToolResult> {
  const file = canvasFilePath(ctx.vaultPath, canvasId)
  try {
    const raw = await fs.readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as CanvasFileShape
    return {
      ok: true,
      output: {
        canvasId,
        version: typeof parsed.version === 'number' ? parsed.version : undefined,
        viewport: parsed.viewport ?? null,
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
  return enqueueCanvasWrite(file, async () => {
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
    // Three pin shapes:
    //   1. path set → pin a `note` card pointing at the vault file. The
    //      canvas renderer reads the .md off disk and renders the actual
    //      note with full markdown formatting (this is the canonical way
    //      to pin existing vault content).
    //   2. content set → pin a `markdown` card with the agent-authored
    //      body so headings/bold/lists/wikilinks all render rich.
    //   3. neither → pin a `markdown` card with just the title.
    // Older `text` cards rendered as raw plaintext, which surfaced literal
    // `## heading` and `**bold**` markers when the agent passed markdown.
    const pos = { x: card.position?.x ?? 0, y: card.position?.y ?? 0 }
    const refs = card.refs ?? []
    const node = card.path
      ? createCanvasNode('note', pos, {
          content: card.path,
          metadata: { refs }
        })
      : (() => {
          const body = card.content ?? ''
          const text = body ? `# ${card.title}\n\n${body}` : `# ${card.title}`
          return createCanvasNode('markdown', pos, {
            content: text,
            metadata: { viewMode: 'rendered', refs }
          })
        })()
    const nodes = Array.isArray(canvas.nodes) ? [...canvas.nodes, node] : [node]
    const next: CanvasFileShape = { ...canvas, nodes }
    try {
      await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8')
      ctx.dispatchCanvasPlan?.(
        buildAgentPlan([{ type: 'add-node', node }], { ...EMPTY_PLAN_SUMMARY, addedNodes: 1 }),
        file
      )
      return { ok: true, output: { cardId: node.id, canvasId, node } }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'IO_FATAL', message } }
    }
  })
}

async function unpinFromCanvas(
  canvasId: string,
  cardId: string,
  ctx: ToolContext
): Promise<NativeToolResult> {
  const file = canvasFilePath(ctx.vaultPath, canvasId)
  return enqueueCanvasWrite(file, async () => {
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
    const nodes = Array.isArray(canvas.nodes) ? canvas.nodes : []
    const idx = nodes.findIndex(
      (n): n is { id: string } =>
        n != null &&
        typeof n === 'object' &&
        typeof (n as { id?: unknown }).id === 'string' &&
        (n as { id: string }).id === cardId
    )
    if (idx === -1) {
      return { ok: false, error: { code: 'CARD_NOT_FOUND', message: cardId } }
    }
    const nextNodes = [...nodes.slice(0, idx), ...nodes.slice(idx + 1)]
    // Drop edges that reference the removed card so the file stays consistent.
    const edges = Array.isArray(canvas.edges) ? canvas.edges : []
    const nextEdges = edges.filter((e) => {
      if (!e || typeof e !== 'object') return true
      const rec = e as Record<string, unknown>
      return rec.from !== cardId && rec.to !== cardId
    })
    const next: CanvasFileShape = { ...canvas, nodes: nextNodes, edges: nextEdges }
    try {
      await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8')
      // remove-node in applyPlanOps cascades to drop matching edges, so we
      // do not need to enumerate removed edges in the plan ops.
      ctx.dispatchCanvasPlan?.(
        buildAgentPlan([{ type: 'remove-node', nodeId: cardId }], EMPTY_PLAN_SUMMARY),
        file
      )
      return { ok: true, output: { cardId, canvasId } }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'IO_FATAL', message } }
    }
  })
}

async function listCanvases(ctx: ToolContext): Promise<NativeToolResult> {
  interface CanvasEntry {
    canvasId: string
    cardCount: number
  }
  const entries: CanvasEntry[] = []

  async function countNodes(file: string): Promise<number | null> {
    try {
      const raw = await fs.readFile(file, 'utf8')
      const parsed = JSON.parse(raw) as CanvasFileShape
      return Array.isArray(parsed.nodes) ? parsed.nodes.length : 0
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code === 'ENOENT') return null
      // Treat unreadable canvases as 0 cards rather than failing the whole list.
      return 0
    }
  }

  const defaultFile = path.join(ctx.vaultPath, TE_DIR, 'canvas.json')
  const defaultCount = await countNodes(defaultFile)
  if (defaultCount !== null) {
    entries.push({ canvasId: 'default', cardCount: defaultCount })
  }

  const dir = path.join(ctx.vaultPath, TE_DIR, 'canvas')
  let names: string[] = []
  try {
    names = await fs.readdir(dir)
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    if (e.code !== 'ENOENT') {
      return { ok: false, error: { code: 'IO_FATAL', message: e.message ?? String(err) } }
    }
  }
  const ids = names
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.slice(0, -'.json'.length))
    .filter((id) => CANVAS_ID_RE.test(id))
    .sort()
  for (const id of ids) {
    const file = path.join(dir, `${id}.json`)
    const count = await countNodes(file)
    if (count !== null) entries.push({ canvasId: id, cardCount: count })
  }
  return { ok: true, output: { canvases: entries } }
}

async function focusCanvas(
  canvasId: string,
  viewport: { x: number; y: number; zoom: number },
  ctx: ToolContext
): Promise<NativeToolResult> {
  const file = canvasFilePath(ctx.vaultPath, canvasId)
  return enqueueCanvasWrite(file, async () => {
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
    const next: CanvasFileShape = { ...canvas, viewport }
    try {
      await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf8')
      return { ok: true, output: { canvasId, viewport } }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: { code: 'IO_FATAL', message } }
    }
  })
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
  const rgResult = await searchWithRipgrep(query, scope, ctx.vaultPath, ctx.signal)
  if (rgResult.ok) return rgResult
  if (ctx.signal?.aborted) return rgResult
  if (rgResult.error.hint === 'rg-spawn-failed') {
    return searchWithJsFallback(query, paths ?? [], ctx.vaultPath, ctx.signal)
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
      const cardPath = typeof c.path === 'string' ? c.path : undefined
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
      return pinToCanvas(id, { title, path: cardPath, content, position, refs }, ctx)
    }
    case 'unpin_from_canvas': {
      const id = typeof input.canvasId === 'string' ? input.canvasId : null
      const cardId = typeof input.cardId === 'string' ? input.cardId : null
      if (!id) {
        return {
          ok: false,
          error: { code: 'IO_FATAL', message: 'unpin_from_canvas: missing canvasId' }
        }
      }
      if (!CANVAS_ID_RE.test(id)) {
        return {
          ok: false,
          error: { code: 'PATH_OUT_OF_VAULT', message: `invalid canvasId: ${id}` }
        }
      }
      if (!cardId) {
        return {
          ok: false,
          error: { code: 'IO_FATAL', message: 'unpin_from_canvas: missing cardId' }
        }
      }
      return unpinFromCanvas(id, cardId, ctx)
    }
    case 'list_canvases':
      return listCanvases(ctx)
    case 'focus_canvas': {
      const id = typeof input.canvasId === 'string' ? input.canvasId : null
      if (!id) {
        return {
          ok: false,
          error: { code: 'IO_FATAL', message: 'focus_canvas: missing canvasId' }
        }
      }
      if (!CANVAS_ID_RE.test(id)) {
        return {
          ok: false,
          error: { code: 'PATH_OUT_OF_VAULT', message: `invalid canvasId: ${id}` }
        }
      }
      const rawVp = input.viewport
      if (!rawVp || typeof rawVp !== 'object') {
        return {
          ok: false,
          error: { code: 'IO_FATAL', message: 'focus_canvas: missing viewport' }
        }
      }
      const vp = rawVp as Record<string, unknown>
      if (
        typeof vp.x !== 'number' ||
        typeof vp.y !== 'number' ||
        typeof vp.zoom !== 'number' ||
        !Number.isFinite(vp.x) ||
        !Number.isFinite(vp.y) ||
        !Number.isFinite(vp.zoom)
      ) {
        return {
          ok: false,
          error: {
            code: 'IO_FATAL',
            message: 'focus_canvas: viewport.{x,y,zoom} must all be finite numbers'
          }
        }
      }
      return focusCanvas(id, { x: vp.x, y: vp.y, zoom: vp.zoom }, ctx)
    }
    case 'open_dock_tab':
      return openDockTab(input, ctx)
    case 'close_dock_tab':
      return closeDockTab(input, ctx)
    default:
      return { ok: false, error: { code: 'IO_FATAL', message: `unknown tool: ${name}` } }
  }
}

const DOCK_KINDS: readonly DockTabKind[] = [
  'canvas',
  'editor',
  'terminal',
  'graph',
  'ghosts',
  'health'
]

function buildDockTab(input: Record<string, unknown>): DockTab | { error: string } {
  const kind = typeof input.kind === 'string' ? input.kind : null
  if (!kind || !DOCK_KINDS.includes(kind as DockTabKind)) {
    return { error: `open_dock_tab: kind must be one of ${DOCK_KINDS.join('|')}` }
  }
  switch (kind as DockTabKind) {
    case 'canvas':
      return { kind: 'canvas', id: typeof input.canvasId === 'string' ? input.canvasId : 'default' }
    case 'editor':
      return { kind: 'editor', path: typeof input.path === 'string' ? input.path : '' }
    case 'terminal':
      return {
        kind: 'terminal',
        sessionId: typeof input.sessionId === 'string' ? input.sessionId : ''
      }
    default:
      return { kind: kind as 'graph' | 'ghosts' | 'health' }
  }
}

function openDockTab(input: Record<string, unknown>, ctx: ToolContext): NativeToolResult {
  if (!ctx.emitDockAction) {
    return { ok: false, error: { code: 'IO_FATAL', message: 'dock action channel unavailable' } }
  }
  const built = buildDockTab(input)
  if ('error' in built) {
    return { ok: false, error: { code: 'IO_FATAL', message: built.error } }
  }
  ctx.emitDockAction({ action: 'open', tab: built })
  const index = ctx.dockTabsSnapshot ? ctx.dockTabsSnapshot.length : null
  return { ok: true, output: { opened: built, index } }
}

function closeDockTab(input: Record<string, unknown>, ctx: ToolContext): NativeToolResult {
  if (!ctx.emitDockAction) {
    return { ok: false, error: { code: 'IO_FATAL', message: 'dock action channel unavailable' } }
  }
  const tabs = ctx.dockTabsSnapshot ?? []
  let target: number | null = null
  if (typeof input.index === 'number' && Number.isInteger(input.index)) {
    target = input.index
  } else if (typeof input.kind === 'string') {
    const kind = input.kind as DockTabKind
    target = tabs.findIndex((t) => t.kind === kind)
    if (target < 0) target = null
  }
  if (target === null) {
    return { ok: true, output: { closed: null, reason: 'no matching tab' } }
  }
  if (target < 0 || target >= tabs.length) {
    return {
      ok: false,
      error: { code: 'IO_FATAL', message: `close_dock_tab: index ${target} out of range` }
    }
  }
  ctx.emitDockAction({ action: 'close', index: target })
  return { ok: true, output: { closed: target } }
}
