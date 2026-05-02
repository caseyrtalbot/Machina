import { useCallback, useEffect } from 'react'
import { useEditorStore } from '../../../store/editor-store'
import { useVaultStore } from '../../../store/vault-store'
import { EditorSplitView } from '../../editor/EditorSplitView'

export function EditorDockAdapter({ initialPath }: { readonly initialPath: string }) {
  const setActiveNote = useEditorStore((s) => s.setActiveNote)

  useEffect(() => {
    if (initialPath) setActiveNote(initialPath)
  }, [initialPath, setActiveNote])

  const handleNavigate = useCallback((id: string) => {
    const fileToId = useVaultStore.getState().fileToId
    const path = Object.entries(fileToId).find(([, v]) => v === id)?.[0] ?? null
    useEditorStore.getState().setActiveNote(path)
  }, [])

  return <EditorSplitView onNavigate={handleNavigate} />
}
