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

type SystemArtifactFrontmatter =
  | SessionArtifactFrontmatter
  | PatternArtifactFrontmatter
  | TensionArtifactFrontmatter

export interface SystemArtifactSection {
  readonly heading: string
  readonly body?: string
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
