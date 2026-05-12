import { TE_DIR } from './constants'

export const SYSTEM_ARTIFACT_KINDS = ['session', 'pattern', 'tension'] as const
export type SystemArtifactKind = (typeof SYSTEM_ARTIFACT_KINDS)[number]

export const SYSTEM_ARTIFACT_DIRECTORIES = {
  session: 'sessions',
  pattern: 'patterns',
  tension: 'tensions'
} as const satisfies Record<SystemArtifactKind, string>

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
