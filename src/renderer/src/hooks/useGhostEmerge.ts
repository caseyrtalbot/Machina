import { useCallback, useState } from 'react'
import { useVaultStore } from '../store/vault-store'
import { openArtifactInEditor } from '../system-artifacts/system-artifact-runtime'
import { notifyError } from '../utils/error-logger'

interface UseGhostEmergeResult {
  readonly emerge: (
    ghostId: string,
    ghostTitle: string,
    referencePaths: readonly string[]
  ) => Promise<void>
  readonly isEmerging: boolean
}

/**
 * Detect the main-process fallback: when the Claude CLI is unavailable the
 * handler still writes a note, but with an empty body after the frontmatter.
 */
function hasEmptyBody(content: string): boolean {
  const fmEnd = content.indexOf('\n---', 3)
  const body = content.startsWith('---') && fmEnd >= 0 ? content.slice(fmEnd + 4) : content
  return body.trim().length === 0
}

export function useGhostEmerge(): UseGhostEmergeResult {
  const [isEmerging, setIsEmerging] = useState(false)

  const emerge = useCallback(
    async (ghostId: string, ghostTitle: string, referencePaths: readonly string[]) => {
      const vaultPath = useVaultStore.getState().vaultPath
      if (!vaultPath || isEmerging) return

      setIsEmerging(true)
      try {
        const result = await window.api.vault.emergeGhost(
          ghostId,
          ghostTitle,
          referencePaths,
          vaultPath
        )

        // Denied at the approval gate: no note was written, so nothing to open.
        if (result.status === 'denied') {
          notifyError(
            'ghost-emerge',
            new Error('synthesis not approved'),
            `Ghost synthesis for "${ghostTitle}" was not approved.`
          )
          return
        }

        openArtifactInEditor(result.filePath, ghostTitle)

        // Surface the silent empty-body fallback (Claude CLI missing/timeout).
        try {
          const content = await window.api.fs.readFile(result.filePath)
          if (hasEmptyBody(content)) {
            notifyError(
              'ghost-emerge',
              new Error('synthesis unavailable'),
              `Claude was unavailable — created an empty note for "${ghostTitle}". Fill it in manually or retry later.`
            )
          }
        } catch {
          /* read-back is best-effort; the note opened either way */
        }
      } catch (err) {
        notifyError('ghost-emerge', err, `Failed to create a note for "${ghostTitle}".`)
      } finally {
        setIsEmerging(false)
      }
    },
    [isEmerging]
  )

  return { emerge, isEmerging }
}
