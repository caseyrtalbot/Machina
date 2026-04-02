import { useCallback, useState } from 'react'
import { useEditorStore } from '../store/editor-store'
import { useVaultStore } from '../store/vault-store'

interface UseGhostEmergeResult {
  readonly emerge: (
    ghostId: string,
    ghostTitle: string,
    referencePaths: readonly string[]
  ) => Promise<void>
  readonly isEmerging: boolean
}

export function useGhostEmerge(): UseGhostEmergeResult {
  const [isEmerging, setIsEmerging] = useState(false)
  const setActiveNote = useEditorStore((s) => s.setActiveNote)

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
        setActiveNote(result.filePath)
      } catch (err) {
        console.error('[useGhostEmerge] emergence failed:', err)
      } finally {
        setIsEmerging(false)
      }
    },
    [isEmerging, setActiveNote]
  )

  return { emerge, isEmerging }
}
