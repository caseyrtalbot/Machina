import { TE_DIR } from './constants'

export const SYSTEM_ARTIFACT_KINDS = ['session', 'pattern', 'tension'] as const
export type SystemArtifactKind = (typeof SYSTEM_ARTIFACT_KINDS)[number]

export const SYSTEM_ARTIFACT_DIRECTORIES = {
  session: 'sessions',
  pattern: 'patterns',
  tension: 'tensions'
} as const satisfies Record<SystemArtifactKind, string>

export type SessionArtifactStatus = 'active' | 'completed' | 'archived'
export type PatternArtifactStatus = 'draft' | 'active' | 'archived'
export type TensionArtifactStatus = 'open' | 'resolved' | 'deferred'

export interface LaunchTerminalSpec {
  readonly cwd: string
  readonly command?: string
  readonly title?: string
}

interface BaseSystemArtifactFrontmatter {
  readonly id: string
  readonly title: string
  readonly type: SystemArtifactKind
  readonly created: string
  readonly modified: string
  readonly signal: 'untested' | 'emerging' | 'validated' | 'core'
  readonly tags: readonly string[]
  readonly connections: readonly string[]
  readonly tensions_with: readonly string[]
  readonly summary?: string
}

export interface SessionArtifactFrontmatter extends BaseSystemArtifactFrontmatter {
  readonly type: 'session'
  readonly status: SessionArtifactStatus
  readonly started_at: string
  readonly ended_at?: string
  readonly project_root: string
  readonly claude_session_ids: readonly string[]
  readonly file_refs: readonly string[]
  readonly opened_tensions: readonly string[]
  readonly resolved_tensions: readonly string[]
  readonly pattern_refs: readonly string[]
  readonly command_count: number
  readonly file_touch_count: number
}

export interface PatternArtifactFrontmatter extends BaseSystemArtifactFrontmatter {
  readonly type: 'pattern'
  readonly status: PatternArtifactStatus
  readonly origin_session?: string
  readonly project_root: string
  readonly file_refs: readonly string[]
  readonly note_refs: readonly string[]
  readonly tension_refs: readonly string[]
  readonly canvas_snapshot?: string
  readonly launch: {
    readonly terminals: readonly LaunchTerminalSpec[]
  }
}

export interface TensionArtifactFrontmatter extends BaseSystemArtifactFrontmatter {
  readonly type: 'tension'
  readonly status: TensionArtifactStatus
  readonly opened_at: string
  readonly resolved_at?: string
  readonly opened_in?: string
  readonly resolved_in?: string
  readonly file_refs: readonly string[]
  readonly pattern_refs: readonly string[]
  readonly question: string
  readonly hypothesis?: string
  readonly evidence_refs: readonly string[]
}

export type SystemArtifactFrontmatter =
  | SessionArtifactFrontmatter
  | PatternArtifactFrontmatter
  | TensionArtifactFrontmatter

export interface SystemArtifactSection {
  readonly heading: string
  readonly body?: string
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function slugifyArtifactPart(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'artifact'
}

function renderFrontmatter(frontmatter: object): string {
  const lines = ['---']

  for (const [key, value] of Object.entries(frontmatter)) {
    if (value == null || value === '') continue

    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`)
        continue
      }
      lines.push(`${key}:`)
      for (const item of value) {
        lines.push(`  - ${String(item)}`)
      }
      continue
    }

    if (typeof value === 'object') {
      lines.push(`${key}:`)
      for (const [childKey, childValue] of Object.entries(value)) {
        if (Array.isArray(childValue)) {
          lines.push(`  ${childKey}:`)
          for (const item of childValue) {
            if (typeof item === 'object' && item != null) {
              lines.push('    -')
              for (const [nestedKey, nestedValue] of Object.entries(item)) {
                if (nestedValue == null || nestedValue === '') continue
                lines.push(`        ${nestedKey}: ${String(nestedValue)}`)
              }
            } else {
              lines.push(`    - ${String(item)}`)
            }
          }
        } else if (childValue != null && childValue !== '') {
          lines.push(`  ${childKey}: ${String(childValue)}`)
        }
      }
      continue
    }

    lines.push(`${key}: ${String(value)}`)
  }

  lines.push('---')
  return lines.join('\n')
}

export function renderSystemArtifactDocument(
  frontmatter: SystemArtifactFrontmatter,
  sections: readonly SystemArtifactSection[]
): string {
  const body = sections
    .map((section) => {
      const trimmedBody = section.body?.trim()
      return trimmedBody ? `## ${section.heading}\n\n${trimmedBody}` : `## ${section.heading}\n`
    })
    .join('\n\n')

  return `${renderFrontmatter(frontmatter)}\n${body}\n`
}

export function isSystemArtifactKind(value: string): value is SystemArtifactKind {
  return (SYSTEM_ARTIFACT_KINDS as readonly string[]).includes(value)
}

export function isSystemArtifactPath(path: string): boolean {
  return SYSTEM_ARTIFACT_KINDS.some((kind) =>
    path.includes(`/${TE_DIR}/artifacts/${SYSTEM_ARTIFACT_DIRECTORIES[kind]}/`)
  )
}

export function defaultSystemArtifactFilename(id: string): string {
  return id.endsWith('.md') ? id : `${id}.md`
}

export function parseSystemArtifactFrontmatter(
  frontmatter: Readonly<Record<string, unknown>>,
  kind: 'session'
): SessionArtifactFrontmatter | null
export function parseSystemArtifactFrontmatter(
  frontmatter: Readonly<Record<string, unknown>>,
  kind: 'pattern'
): PatternArtifactFrontmatter | null
export function parseSystemArtifactFrontmatter(
  frontmatter: Readonly<Record<string, unknown>>,
  kind: 'tension'
): TensionArtifactFrontmatter | null
export function parseSystemArtifactFrontmatter(
  frontmatter: Readonly<Record<string, unknown>>,
  kind: SystemArtifactKind
): SystemArtifactFrontmatter | null {
  const id = asString(frontmatter.id)
  const title = asString(frontmatter.title)
  const created = asString(frontmatter.created)
  const modified = asString(frontmatter.modified)
  const signal = asString(frontmatter.signal)
  const summary = asString(frontmatter.summary) ?? undefined

  if (!id || !title || !created || !modified) return null
  if (
    signal !== 'untested' &&
    signal !== 'emerging' &&
    signal !== 'validated' &&
    signal !== 'core'
  ) {
    return null
  }

  const base = {
    id,
    title,
    type: kind,
    created,
    modified,
    signal,
    tags: asStringArray(frontmatter.tags),
    connections: asStringArray(frontmatter.connections),
    tensions_with: asStringArray(frontmatter.tensions_with),
    summary
  } as const

  switch (kind) {
    case 'session': {
      const status = asString(frontmatter.status)
      const startedAt = asString(frontmatter.started_at)
      const projectRoot = asString(frontmatter.project_root)
      if (!status || !startedAt || !projectRoot) return null
      if (
        !(['active', 'completed', 'archived'] as const).includes(status as SessionArtifactStatus)
      ) {
        return null
      }
      return {
        ...base,
        type: 'session',
        status: status as SessionArtifactStatus,
        started_at: startedAt,
        ended_at: asString(frontmatter.ended_at) ?? undefined,
        project_root: projectRoot,
        claude_session_ids: asStringArray(frontmatter.claude_session_ids),
        file_refs: asStringArray(frontmatter.file_refs),
        opened_tensions: asStringArray(frontmatter.opened_tensions),
        resolved_tensions: asStringArray(frontmatter.resolved_tensions),
        pattern_refs: asStringArray(frontmatter.pattern_refs),
        command_count: asNumber(frontmatter.command_count),
        file_touch_count: asNumber(frontmatter.file_touch_count)
      }
    }
    case 'pattern': {
      const status = asString(frontmatter.status)
      const projectRoot = asString(frontmatter.project_root)
      if (!status || !projectRoot) return null
      if (!(['draft', 'active', 'archived'] as const).includes(status as PatternArtifactStatus)) {
        return null
      }

      const launch = frontmatter.launch
      const launchTerminals: LaunchTerminalSpec[] = []
      if (Array.isArray((launch as { terminals?: unknown } | null)?.terminals)) {
        for (const terminal of (launch as { terminals: unknown[] }).terminals) {
          if (typeof terminal !== 'object' || terminal == null) continue
          const terminalRecord = terminal as Record<string, unknown>
          const cwd = asString(terminalRecord.cwd)
          if (!cwd) continue
          launchTerminals.push({
            cwd,
            command: asString(terminalRecord.command) ?? undefined,
            title: asString(terminalRecord.title) ?? undefined
          })
        }
      }

      return {
        ...base,
        type: 'pattern',
        status: status as PatternArtifactStatus,
        origin_session: asString(frontmatter.origin_session) ?? undefined,
        project_root: projectRoot,
        file_refs: asStringArray(frontmatter.file_refs),
        note_refs: asStringArray(frontmatter.note_refs),
        tension_refs: asStringArray(frontmatter.tension_refs),
        canvas_snapshot: asString(frontmatter.canvas_snapshot) ?? undefined,
        launch: { terminals: launchTerminals }
      }
    }
    case 'tension': {
      const status = asString(frontmatter.status)
      const openedAt = asString(frontmatter.opened_at)
      const question = asString(frontmatter.question)
      if (!status || !openedAt || !question) return null
      if (!(['open', 'resolved', 'deferred'] as const).includes(status as TensionArtifactStatus)) {
        return null
      }
      return {
        ...base,
        type: 'tension',
        status: status as TensionArtifactStatus,
        opened_at: openedAt,
        resolved_at: asString(frontmatter.resolved_at) ?? undefined,
        opened_in: asString(frontmatter.opened_in) ?? undefined,
        resolved_in: asString(frontmatter.resolved_in) ?? undefined,
        file_refs: asStringArray(frontmatter.file_refs),
        pattern_refs: asStringArray(frontmatter.pattern_refs),
        question,
        hypothesis: asString(frontmatter.hypothesis) ?? undefined,
        evidence_refs: asStringArray(frontmatter.evidence_refs)
      }
    }
  }
}
