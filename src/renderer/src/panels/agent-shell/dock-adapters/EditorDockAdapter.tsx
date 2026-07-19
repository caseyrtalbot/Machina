import { useCallback } from 'react'
import { useEditorStore } from '../../../store/editor-store'
import { useVaultStore } from '../../../store/vault-store'
import { EditorSplitView } from '../../editor/EditorSplitView'

/**
 * The singleton editor dock surface. Takes no path: note identity lives only
 * in editor-store (openTabs / activeNotePath); the dock tab is a pure surface
 * reference. Open notes via openNoteInEditor (dock-store), never by mounting
 * this with a path.
 */
export function EditorDockAdapter() {
  const handleNavigate = useCallback((id: string) => {
    const fileToId = useVaultStore.getState().fileToId
    const path = Object.entries(fileToId).find(([, v]) => v === id)?.[0] ?? null
    useEditorStore.getState().setActiveNote(path)
  }, [])

  return <EditorSplitView onNavigate={handleNavigate} />
}
