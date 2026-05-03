import { useEditorStore } from '../store/editor-store'
import { useThreadStore } from '../store/thread-store'
import { useVaultStore } from '../store/vault-store'
import { parseArtifact } from '../engine/parser'
import { buildGraph } from '../engine/graph-builder'
import type { ParseError } from '../engine/types'
import type { Artifact } from '@shared/types'
import { defaultSystemArtifactFilename } from '@shared/system-artifacts'
import type { SystemArtifactKind } from '@shared/system-artifacts'

interface SyncArtifactResult {
  readonly artifactId: string | null
  readonly title: string
  readonly path: string
}

function filenameTitle(path: string): string {
  const filename = path.split('/').pop() ?? path
  return filename.replace(/\.md$/, '')
}

function currentDateString(): string {
  return new Date().toISOString().split('T')[0]
}

function ensureUniqueArtifactId(
  baseId: string,
  path: string,
  artifactPathById: Readonly<Record<string, string>>
): string {
  if (!artifactPathById[baseId] || artifactPathById[baseId] === path) return baseId

  let suffix = 2
  while (
    artifactPathById[`${baseId}-${suffix}`] &&
    artifactPathById[`${baseId}-${suffix}`] !== path
  ) {
    suffix++
  }
  return `${baseId}-${suffix}`
}

function replaceArtifact(
  artifacts: readonly Artifact[],
  previousId: string | undefined,
  nextArtifact: Artifact
): Artifact[] {
  const filtered = previousId
    ? artifacts.filter((artifact) => artifact.id !== previousId)
    : [...artifacts]
  const nextIndex = filtered.findIndex((artifact) => artifact.id === nextArtifact.id)
  if (nextIndex >= 0) {
    const updated = [...filtered]
    updated[nextIndex] = nextArtifact
    return updated
  }
  return [...filtered, nextArtifact]
}

function upsertSystemFile(
  files: readonly {
    readonly path: string
    readonly filename: string
    readonly title: string
    readonly modified: string
    readonly source: 'vault' | 'system'
  }[],
  path: string,
  title: string
) {
  const filename = path.split('/').pop() ?? path
  const nextEntry = {
    path,
    filename,
    title,
    modified: currentDateString(),
    source: 'system' as const
  }
  const index = files.findIndex((file) => file.path === path)
  if (index < 0) return [...files, nextEntry]

  const updated = [...files]
  updated[index] = nextEntry
  return updated
}

export function openArtifactInEditor(path: string, title?: string): void {
  useEditorStore.getState().openTab(path, title)
  useThreadStore.getState().openOrFocusDockTab({ kind: 'editor', path })
}

export async function syncSystemArtifactFromDisk(path: string): Promise<SyncArtifactResult> {
  const content = await window.api.fs.readFile(path)
  const parseResult = parseArtifact(content, path)
  const state = useVaultStore.getState()
  const nextSystemFiles = upsertSystemFile(
    state.systemFiles,
    path,
    parseResult.ok ? parseResult.value.title : filenameTitle(path)
  )
  const nextErrors = state.parseErrors.filter((error) => error.filename !== path)
  const previousId = state.fileToId[path]

  if (!parseResult.ok) {
    const parseError: ParseError = { filename: path, error: parseResult.error }
    useVaultStore.setState({
      systemFiles: nextSystemFiles,
      parseErrors: [...nextErrors, parseError]
    })
    return {
      artifactId: null,
      title: filenameTitle(path),
      path
    }
  }

  const uniqueId = ensureUniqueArtifactId(parseResult.value.id, path, state.artifactPathById)
  const artifact =
    uniqueId === parseResult.value.id ? parseResult.value : { ...parseResult.value, id: uniqueId }
  const nextArtifacts = replaceArtifact(state.artifacts, previousId, artifact)
  const nextFileToId = { ...state.fileToId, [path]: artifact.id }
  const nextArtifactPathById = { ...state.artifactPathById, [artifact.id]: path }

  if (previousId && previousId !== artifact.id) {
    delete nextArtifactPathById[previousId]
  }

  const graph = buildGraph(nextArtifacts)
  const discoveredTypes = [...new Set(nextArtifacts.map((item) => item.type))].sort()

  useVaultStore.setState({
    systemFiles: nextSystemFiles,
    artifacts: nextArtifacts,
    graph,
    parseErrors: nextErrors,
    fileToId: nextFileToId,
    artifactPathById: nextArtifactPathById,
    discoveredTypes
  })

  return {
    artifactId: artifact.id,
    title: artifact.title,
    path
  }
}

export async function createAndOpenSystemArtifact(options: {
  readonly kind: SystemArtifactKind
  readonly filename: string
  readonly content: string
  readonly vaultPath: string
}): Promise<SyncArtifactResult> {
  const path = await window.api.vault.createSystemArtifact(
    options.vaultPath,
    options.kind,
    defaultSystemArtifactFilename(options.filename),
    options.content
  )
  const synced = await syncSystemArtifactFromDisk(path)
  openArtifactInEditor(path, synced.title)
  return synced
}
