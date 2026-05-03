import { createCanvasNode } from '@shared/canvas-types'
import { useCanvasStore } from '../../store/canvas-store'
import { useSettingsStore } from '../../store/settings-store'
import { useVaultStore } from '../../store/vault-store'
import { resolveNewPath, slugifyFilename } from './text-card-save'

interface CreateResult {
  readonly ok: boolean
  readonly error?: string
}

function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, '') : p.replace(/^\/+|\/+$/g, '')))
    .filter((p) => p.length > 0)
    .join('/')
}

function relativize(absolutePath: string, vaultPath: string): string {
  const prefix = vaultPath.endsWith('/') ? vaultPath : `${vaultPath}/`
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : absolutePath
}

/**
 * Create a real .md note on disk at the given canvas position, add it to the
 * canvas as a `note` card bound to that path, and select+lock it for editing.
 * Bypasses the three-step text-card → save-as-new dialog flow.
 */
export async function createNoteAtCursor(position: {
  x: number
  y: number
}): Promise<CreateResult> {
  try {
    const vaultPath = useVaultStore.getState().vaultPath
    if (!vaultPath) return { ok: false, error: 'No vault open' }

    const folder = useSettingsStore.getState().canvasTextSaveFolder || 'Inbox'
    const dirAbs = joinPath(vaultPath, folder)
    await window.api.fs.mkdir(dirAbs)

    const slug = slugifyFilename('', new Date())
    const existing = await window.api.fs.listFiles(dirAbs, '*.md')
    const filenames = existing.map((p) => p.split('/').pop() || p)
    const absPath = resolveNewPath(dirAbs, slug, filenames)

    await window.api.fs.writeFile(absPath, '')
    const rel = relativize(absPath, vaultPath)

    const node = createCanvasNode('note', position, { content: rel })
    const store = useCanvasStore.getState()
    store.addNode(node)
    store.setSelection(new Set([node.id]))
    store.setFocusedCard(node.id)
    store.lockCard(node.id)
    store.centerOnNode?.(node.id)

    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
