import { openNoteInEditor } from '../store/dock-store'

export function openArtifactInEditor(path: string, title?: string): void {
  openNoteInEditor(path, { title })
}
