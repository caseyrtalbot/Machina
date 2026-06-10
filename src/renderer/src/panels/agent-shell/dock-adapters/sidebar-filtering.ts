import type { Artifact } from '@shared/types'
import { filterArtifactsByTags } from '@engine/tag-index'

export interface SidebarFilterOptions {
  readonly vaultPath: string | null
  /** Active workspace folder name (top-level vault folder), or null for all. */
  readonly activeWorkspace: string | null
  readonly selectedTags: readonly string[]
  readonly tagOperator: 'and' | 'or'
  readonly artifacts: readonly Artifact[]
  readonly fileToId: Readonly<Record<string, string>>
}

/**
 * Apply the sidebar's workspace and tag filters to the vault file list
 * before the tree is built. Pure: used by FilesDockAdapter and tests.
 *
 * - Workspace: keep files under `<vaultPath>/<workspace>/`.
 * - Tags: keep files whose artifact matches the selected tags under the
 *   operator (AND = all tags, OR = any; nested tags match by prefix).
 *   Files without a parsed artifact are excluded while a tag filter is active.
 */
export function filterSidebarFiles<F extends { readonly path: string }>(
  files: readonly F[],
  options: SidebarFilterOptions
): readonly F[] {
  const { vaultPath, activeWorkspace, selectedTags, tagOperator, artifacts, fileToId } = options

  let result = files

  if (activeWorkspace && vaultPath) {
    const prefix = `${vaultPath}/${activeWorkspace}/`
    result = result.filter((f) => f.path.startsWith(prefix))
  }

  if (selectedTags.length > 0) {
    const matchingIds = new Set(
      filterArtifactsByTags(artifacts, selectedTags, tagOperator).map((a) => a.id)
    )
    result = result.filter((f) => {
      const id = fileToId[f.path]
      return id !== undefined && matchingIds.has(id)
    })
  }

  return result
}
