import { useCallback } from 'react'
import { useSettingsStore } from '../../store/settings-store'
import { useVaultStore } from '../../store/vault-store'
import type { CanvasStoreApi } from '../../store/canvas-store'
import { useCanvasApi } from './canvas-store-context'
import { slugifyFilename, resolveNewPath, appendToExisting, hashContent } from './text-card-save'

type SaveResult =
  | { readonly ok: true; readonly relativePath: string }
  | { readonly ok: false; readonly error: string }

interface SaveAsNewParams {
  readonly folder: string
  readonly filename: string
}

interface UseSaveTextCardApi {
  readonly saveQuick: (nodeId: string) => Promise<SaveResult>
  readonly saveAsNew: (nodeId: string, params: SaveAsNewParams) => Promise<SaveResult>
  readonly saveAppend: (nodeId: string, relativeFilePath: string) => Promise<SaveResult>
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

function getNode(store: CanvasStoreApi, nodeId: string) {
  return store.getState().nodes.find((n) => n.id === nodeId)
}

function recordSaved(store: CanvasStoreApi, nodeId: string, relativePath: string, content: string) {
  const updateMeta = store.getState().updateNodeMetadata
  updateMeta(nodeId, {
    savedToPath: relativePath,
    savedContentHash: hashContent(content)
  })
}

export function useSaveTextCard(): UseSaveTextCardApi {
  const canvas = useCanvasApi()
  const saveQuick = useCallback(
    async (nodeId: string): Promise<SaveResult> => {
      try {
        const vaultPath = useVaultStore.getState().vaultPath
        if (!vaultPath) return { ok: false, error: 'No vault open' }
        const node = getNode(canvas, nodeId)
        if (!node) return { ok: false, error: 'Node not found' }

        const folder = useSettingsStore.getState().canvasTextSaveFolder || 'Inbox'
        const dirAbs = joinPath(vaultPath, folder)
        await window.api.fs.mkdir(dirAbs)

        const slug = slugifyFilename(node.content, new Date())
        const existing = await window.api.fs.listFiles(dirAbs, '*.md')
        const filenames = existing.map((p) => p.split('/').pop() || p)
        const absPath = resolveNewPath(dirAbs, slug, filenames)

        await window.api.fs.writeFile(absPath, node.content)
        const rel = relativize(absPath, vaultPath)
        recordSaved(canvas, nodeId, rel, node.content)
        return { ok: true, relativePath: rel }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [canvas]
  )

  const saveAsNew = useCallback(
    async (nodeId: string, params: SaveAsNewParams): Promise<SaveResult> => {
      try {
        const vaultPath = useVaultStore.getState().vaultPath
        if (!vaultPath) return { ok: false, error: 'No vault open' }
        const node = getNode(canvas, nodeId)
        if (!node) return { ok: false, error: 'Node not found' }

        const dirAbs = joinPath(vaultPath, params.folder)
        await window.api.fs.mkdir(dirAbs)

        const filename = params.filename.endsWith('.md') ? params.filename : `${params.filename}.md`
        const absPath = joinPath(dirAbs, filename)

        await window.api.fs.writeFile(absPath, node.content)
        const rel = relativize(absPath, vaultPath)
        recordSaved(canvas, nodeId, rel, node.content)
        return { ok: true, relativePath: rel }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [canvas]
  )

  const saveAppend = useCallback(
    async (nodeId: string, relativeFilePath: string): Promise<SaveResult> => {
      try {
        const vaultPath = useVaultStore.getState().vaultPath
        if (!vaultPath) return { ok: false, error: 'No vault open' }
        const node = getNode(canvas, nodeId)
        if (!node) return { ok: false, error: 'Node not found' }

        const absPath = joinPath(vaultPath, relativeFilePath)
        const exists = await window.api.fs.fileExists(absPath)
        if (!exists) return { ok: false, error: 'File no longer exists' }

        const existing = await window.api.fs.readFile(absPath)
        const merged = appendToExisting(existing, node.content)
        await window.api.fs.writeFile(absPath, merged)

        recordSaved(canvas, nodeId, relativeFilePath, node.content)
        return { ok: true, relativePath: relativeFilePath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    [canvas]
  )

  return { saveQuick, saveAsNew, saveAppend }
}
