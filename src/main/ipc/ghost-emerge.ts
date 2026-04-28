import { readFile } from 'fs/promises'
import { existsSync, mkdirSync, openSync, writeSync, closeSync, constants } from 'fs'
import { join } from 'path'
import { callClaude, extractJsonFromResponse } from '../services/agent-action-runner'
import type { CallClaudeFn } from '../services/agent-action-runner'
import { serializeArtifact } from '@shared/engine/parser'
import { inferFolder } from '@shared/engine/ghost-index'
import { PathGuard } from '../services/path-guard'
import { PathGuardError } from '@shared/agent-types'
import type { Artifact } from '@shared/types'
import type { Result } from '@shared/engine/types'
import { typedHandle } from '../typed-ipc'

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
  readonly origin: string
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

{"tags": ["string"], "origin": "emerge", "body": "string — markdown body content"}`
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

  if (typeof obj.origin !== 'string') {
    return { ok: false, error: 'Missing or invalid origin string' }
  }

  if (typeof obj.body !== 'string') {
    return { ok: false, error: 'Missing or invalid body string' }
  }

  return {
    ok: true,
    value: {
      tags: obj.tags.map(String),
      origin: obj.origin,
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
  const origin = emergeResult?.origin ?? undefined

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
    origin: 'human',
    sources: [],
    concepts: [],
    bodyLinks: [],
    body,
    frontmatter: origin ? { origin } : {}
  }
}

// ---------------------------------------------------------------------------
// Security: filename sanitization
// ---------------------------------------------------------------------------

const VALID_ORIGINS = new Set(['emerge', 'challenge'])

/** Strip dangerous characters from ghost title before using as filename. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:\0]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 200)
}

// ---------------------------------------------------------------------------
// IPC Registration
// ---------------------------------------------------------------------------

let _emerging = false

export function registerGhostEmergeIpc(callClaudeFn: CallClaudeFn = callClaude): void {
  typedHandle('vault:emerge-ghost', async ({ ghostId, ghostTitle, referencePaths, vaultPath }) => {
    // Concurrency guard (server-side)
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
          // Validate origin is from allowlist
          const validatedOrigin = VALID_ORIGINS.has(parsed.value.origin)
            ? parsed.value.origin
            : 'emerge'
          emergeResult = { ...parsed.value, origin: validatedOrigin }
        }
      } catch (err) {
        if (err instanceof PathGuardError) throw err
        // Fallback: empty note (Claude CLI not found, timeout, etc.)
      }

      // 7. Build Artifact
      const artifact = buildArtifact(ghostId, ghostTitle, referencePaths, emergeResult)

      // 8. Serialize
      const content = serializeArtifact(artifact)

      // 9. Sanitize filename, ensure folder, validate write path
      const safeFilename = sanitizeFilename(ghostTitle)
      const filePath = join(folderPath, `${safeFilename}.md`)
      guard.assertWithinVault(filePath)

      const folderCreated = !existsSync(folderPath)
      if (!existsSync(folderPath)) {
        mkdirSync(folderPath, { recursive: true })
      }

      const fd = openSync(filePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY)
      try {
        writeSync(fd, content)
      } finally {
        closeSync(fd)
      }

      // 10. Return result
      return { filePath, folderCreated, folderPath }
    } finally {
      _emerging = false
    }
  })
}
