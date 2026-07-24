import { readFile } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { callClaude, extractJsonFromResponse } from '../services/claude-cli'
import type { CallClaudeFn } from '../services/claude-cli'
import { serializeArtifact } from '@shared/engine/parser'
import { inferFolder } from '@shared/engine/ghost-index'
import { PathGuard } from '../services/path-guard'
import { PathGuardError } from '@shared/agent-types'
import type { AuditEntry } from '@shared/agent-types'
import type { Artifact } from '@shared/types'
import type { Result } from '@shared/engine/types'
import type { IpcResponse } from '@shared/ipc-channels'
import { typedHandle } from '../typed-ipc'
import { createStampedNote } from '../utils/note-write'
import type { HitlGate } from '../services/hitl-gate'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReferenceNote {
  readonly title: string
  readonly tags: readonly string[]
  readonly body: string
}

interface EmergeResult {
  readonly tags: string[]
  readonly body: string
}

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

const MAX_REF_BODY_LENGTH = 500

export function buildEmergePrompt(ghostTitle: string, refs: readonly ReferenceNote[]): string {
  const refSections = refs
    .map((ref, i) => {
      const truncatedBody =
        ref.body.length > MAX_REF_BODY_LENGTH ? ref.body.slice(0, MAX_REF_BODY_LENGTH) : ref.body
      const tags = ref.tags.length > 0 ? ref.tags.join(', ') : 'none'
      return `### Reference ${i + 1}: ${ref.title}\nTags: ${tags}\n\n${truncatedBody}`
    })
    .join('\n\n')

  return `You are a knowledge synthesizer for a personal knowledge vault.

## Task
Create a unified note for the concept "${ghostTitle}" by synthesizing insights from the ${refs.length} notes that reference it.

## Reference Notes
${refSections}

## Instructions
1. Synthesize the key ideas about "${ghostTitle}" across all references into a cohesive note
2. Generate relevant tags based on the content
3. Write in the same voice and style as the reference notes

Respond ONLY with a JSON object. Do not add any prose before or after.

{"tags": ["string"], "body": "string — markdown body content"}`
}

// ---------------------------------------------------------------------------
// Response Parser
// ---------------------------------------------------------------------------

export function parseEmergeResponse(raw: string): Result<EmergeResult> {
  let parsed: unknown
  try {
    parsed = extractJsonFromResponse(raw)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to extract JSON: ${message}` }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Response is not a JSON object' }
  }

  const obj = parsed as Record<string, unknown>

  if (!Array.isArray(obj.tags)) {
    return { ok: false, error: 'Missing or invalid tags array' }
  }

  if (typeof obj.body !== 'string') {
    return { ok: false, error: 'Missing or invalid body string' }
  }

  return {
    ok: true,
    value: {
      tags: obj.tags.map(String),
      body: obj.body
    }
  }
}

// ---------------------------------------------------------------------------
// Quick-parse reference file (regex on frontmatter, not full parse)
// ---------------------------------------------------------------------------

function quickParseRef(content: string, filePath: string): ReferenceNote {
  const titleMatch = /^title:\s*(.+)$/m.exec(content)
  const title = titleMatch
    ? titleMatch[1].trim()
    : (filePath.split('/').pop()?.replace('.md', '') ?? 'Untitled')

  // Handle both inline [a, b] and multiline YAML list formats
  const inlineMatch = /^tags:\s*\[([^\]]*)\]/m.exec(content)
  const multilineMatch = /^tags:\s*\n((?:\s+-\s+.+\n?)*)/m.exec(content)
  const tags = inlineMatch
    ? inlineMatch[1]
        .split(',')
        .map((t) => t.trim().replace(/['"]/g, ''))
        .filter(Boolean)
    : multilineMatch
      ? multilineMatch[1]
          .split('\n')
          .map((l) => l.replace(/^\s+-\s+/, '').trim())
          .filter(Boolean)
      : []

  // Extract body: everything after the closing ---
  const fmEnd = content.indexOf('---', content.indexOf('---') + 3)
  const body = fmEnd >= 0 ? content.slice(fmEnd + 3).trim() : content

  return { title, tags, body }
}

// ---------------------------------------------------------------------------
// Build Artifact from ghost + emerge result
// ---------------------------------------------------------------------------

function buildArtifact(
  ghostId: string,
  ghostTitle: string,
  referencePaths: readonly string[],
  emergeResult: EmergeResult | null
): Artifact {
  const today = new Date().toISOString().split('T')[0]

  const connections = referencePaths.map((p) => {
    const filename = p.split('/').pop() ?? ''
    return filename.replace('.md', '')
  })

  const tags = emergeResult?.tags ?? []
  const body = emergeResult?.body ?? ''

  return {
    id: ghostId,
    title: ghostTitle,
    type: 'note',
    created: today,
    modified: today,
    signal: 'untested',
    tags,
    connections,
    clusters_with: [],
    tensions_with: [],
    appears_in: [],
    related: [],
    // Synthesized notes carry agent provenance: serializeArtifact stamps
    // `origin: agent` into frontmatter and the graph renders the agent stroke.
    origin: 'agent',
    sources: [],
    concepts: [],
    bodyLinks: [],
    body,
    frontmatter: {}
  }
}

// ---------------------------------------------------------------------------
// Security: filename sanitization
// ---------------------------------------------------------------------------

/** Strip dangerous characters from ghost title before using as filename. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:\0]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 200)
}

// ---------------------------------------------------------------------------
// Approval-gate wiring
// ---------------------------------------------------------------------------

/** Audit sink shape (AuditLogger in production, a mock in tests). */
interface AuditSink {
  log(entry: AuditEntry): void
}

export interface GhostEmergeDeps {
  readonly gate: HitlGate
  readonly audit?: AuditSink
}

/**
 * Fail-closed default gate: with no gate injected the synthesis is denied
 * rather than written un-gated (mirrors buildGate in mcp-lifecycle.ts).
 */
const FAIL_CLOSED_GATE: HitlGate = {
  confirm: async () => ({ allowed: false, reason: 'Approval gate not wired' })
}

// Content-preview cap for the approvals tray (native-mirror precedent, 4k chars).
const PREVIEW_MAX_CHARS = 4_000

interface EmergeArgs {
  readonly ghostId: string
  readonly ghostTitle: string
  readonly referencePaths: readonly string[]
  readonly vaultPath: string
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

let _emerging = false

/**
 * Synthesize a ghost into a note, gated by the approval spine: no vault write
 * happens until the user approves in the tray, and every decision is audited.
 * Extracted from the IPC registration so the main-side flow is unit-testable.
 */
export async function handleEmergeGhost(
  callClaudeFn: CallClaudeFn,
  deps: GhostEmergeDeps,
  { ghostId, ghostTitle, referencePaths, vaultPath }: EmergeArgs
): Promise<IpcResponse<'vault:emerge-ghost'>> {
  // Concurrency guard (server-side); intentionally spans the approval wait.
  if (_emerging) throw new Error('Ghost emergence already in progress')
  _emerging = true

  try {
    const guard = new PathGuard(vaultPath)

    // 1. Read reference files (validate paths, skip unreadable)
    const refContents: Array<{ path: string; content: string }> = []
    for (const refPath of referencePaths) {
      try {
        guard.assertWithinVault(refPath)
        const content = await readFile(refPath, 'utf-8')
        refContents.push({ path: refPath, content })
      } catch (err) {
        if (err instanceof PathGuardError) throw err
        // Skip unreadable files (ENOENT, EACCES, etc.)
      }
    }

    // 2. Quick-parse each for title, tags, body
    const refs: ReferenceNote[] = refContents.map((rc) => quickParseRef(rc.content, rc.path))

    // 3. Infer folder
    const folderPath = inferFolder(ghostId, referencePaths, vaultPath)
    guard.assertWithinVault(folderPath)

    // 4. Build prompt
    const prompt = buildEmergePrompt(ghostTitle, refs)

    // 5-6. Call Claude CLI and parse response (with fallback)
    let emergeResult: EmergeResult | null = null
    try {
      const rawResponse = await callClaudeFn(prompt)
      const parsed = parseEmergeResponse(rawResponse)
      if (parsed.ok) {
        emergeResult = parsed.value
      }
    } catch (err) {
      if (err instanceof PathGuardError) throw err
      // Fallback: empty note (Claude CLI not found, timeout, etc.)
    }

    // 7. Build Artifact
    const artifact = buildArtifact(ghostId, ghostTitle, referencePaths, emergeResult)

    // 8. Serialize
    const content = serializeArtifact(artifact)

    // 9. Sanitize filename, validate write path
    const safeFilename = sanitizeFilename(ghostTitle)
    const filePath = join(folderPath, `${safeFilename}.md`)
    guard.assertWithinVault(filePath)

    // 10. Gate on the approval spine before any folder creation or write.
    const decision = await deps.gate.confirm({
      tool: 'vault.emerge_ghost',
      path: filePath,
      description: `Create synthesized note "${ghostTitle}" from ${refs.length} references`,
      contentPreview: content.slice(0, PREVIEW_MAX_CHARS)
    })

    if (!decision.allowed) {
      deps.audit?.log({
        ts: new Date().toISOString(),
        tool: 'vault.emerge_ghost',
        args: { path: filePath, agentId: 'ghost-emerge' },
        affectedPaths: [filePath],
        decision: 'denied',
        error: decision.reason
      })
      return { status: 'denied', reason: decision.reason }
    }

    // 11. Approved: create the folder, then write through the stamped-note spine.
    const folderCreated = !existsSync(folderPath)
    if (folderCreated) {
      mkdirSync(folderPath, { recursive: true })
    }

    // No registrar: a brand-new file cannot be an open document to echo-suppress.
    await createStampedNote(filePath, content, 'ghost-emerge')

    deps.audit?.log({
      ts: new Date().toISOString(),
      tool: 'vault.emerge_ghost',
      args: { path: filePath, agentId: 'ghost-emerge' },
      affectedPaths: [filePath],
      decision: 'allowed'
    })

    return { status: 'created', filePath, folderCreated, folderPath }
  } finally {
    _emerging = false
  }
}

// ---------------------------------------------------------------------------
// IPC Registration
// ---------------------------------------------------------------------------

export function registerGhostEmergeIpc(
  callClaudeFn: CallClaudeFn = callClaude,
  deps?: { gate?: HitlGate; audit?: AuditSink }
): void {
  const gate = deps?.gate ?? FAIL_CLOSED_GATE
  typedHandle('vault:emerge-ghost', (args) =>
    handleEmergeGhost(callClaudeFn, { gate, audit: deps?.audit }, args)
  )
}
