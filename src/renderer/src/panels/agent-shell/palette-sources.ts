import MiniSearch from 'minisearch'
import type { Thread } from '@shared/thread-types'
import type { DockTab } from '@shared/dock-types'
import { useThreadStore } from '../../store/thread-store'
import { useVaultStore } from '../../store/vault-store'

export type PaletteItemKind = 'thread' | 'file' | 'surface' | 'action'

export interface PaletteItem {
  readonly id: string
  readonly kind: PaletteItemKind
  readonly title: string
  readonly subtitle?: string
  readonly run: () => void | Promise<void>
}

interface IndexDoc {
  readonly id: string
  readonly kind: PaletteItemKind
  readonly title: string
  readonly subtitle: string
  readonly haystack: string
}

export interface PaletteSourcesOptions {
  readonly closePalette: () => void
}

export function buildPaletteItems(opts: PaletteSourcesOptions): PaletteItem[] {
  const threadStore = useThreadStore.getState()
  const vaultStore = useVaultStore.getState()
  const items: PaletteItem[] = []

  for (const t of Object.values(threadStore.threadsById) as Thread[]) {
    items.push({
      id: `thread:${t.id}`,
      kind: 'thread',
      title: t.title,
      subtitle: `thread · ${t.agent} · ${t.model}`,
      run: () => {
        opts.closePalette()
        void useThreadStore.getState().selectThread(t.id)
      }
    })
  }

  for (const f of vaultStore.files) {
    items.push({
      id: `file:${f.path}`,
      kind: 'file',
      title: f.title,
      subtitle: f.path,
      run: () => {
        opts.closePalette()
        useThreadStore.getState().openOrFocusDockTab({ kind: 'editor', path: f.path })
      }
    })
  }

  const surfaces: ReadonlyArray<{ kind: DockTab['kind']; title: string; tab: DockTab }> = [
    { kind: 'canvas', title: 'Open canvas', tab: { kind: 'canvas', id: 'default' } },
    { kind: 'graph', title: 'Open graph view', tab: { kind: 'graph' } },
    { kind: 'ghosts', title: 'Open ghosts', tab: { kind: 'ghosts' } },
    { kind: 'health', title: 'Open health', tab: { kind: 'health' } }
  ]
  for (const s of surfaces) {
    items.push({
      id: `surface:${s.kind}`,
      kind: 'surface',
      title: s.title,
      subtitle: 'dock surface',
      run: () => {
        opts.closePalette()
        useThreadStore.getState().openOrFocusDockTab(s.tab)
      }
    })
  }

  items.push(
    {
      id: 'action:toggle-dock',
      kind: 'action',
      title: 'Toggle surface dock',
      subtitle: 'cmd+/',
      run: () => {
        opts.closePalette()
        useThreadStore.getState().toggleDock()
      }
    },
    {
      id: 'action:toggle-auto-accept',
      kind: 'action',
      title: 'Toggle auto-accept on active thread',
      subtitle: 'machina-native only',
      run: () => {
        opts.closePalette()
        const id = useThreadStore.getState().activeThreadId
        if (id) void useThreadStore.getState().toggleAutoAccept(id)
      }
    }
  )

  return items
}

export function buildIndex(items: readonly PaletteItem[]): MiniSearch<IndexDoc> {
  const search = new MiniSearch<IndexDoc>({
    fields: ['title', 'subtitle', 'haystack'],
    storeFields: ['id', 'kind', 'title', 'subtitle'],
    searchOptions: {
      boost: { title: 3, subtitle: 1 },
      prefix: true,
      fuzzy: 0.2
    }
  })
  search.addAll(
    items.map((it) => ({
      id: it.id,
      kind: it.kind,
      title: it.title,
      subtitle: it.subtitle ?? '',
      haystack: `${it.title} ${it.subtitle ?? ''}`.toLowerCase()
    }))
  )
  return search
}

export function searchPalette(
  index: MiniSearch<IndexDoc>,
  items: readonly PaletteItem[],
  query: string,
  limit = 20
): PaletteItem[] {
  const trimmed = query.trim()
  if (!trimmed) return items.slice(0, limit)
  const byId = new Map(items.map((it) => [it.id, it]))
  const hits = index.search(trimmed)
  const out: PaletteItem[] = []
  for (const h of hits) {
    const it = byId.get(String(h.id))
    if (it) out.push(it)
    if (out.length >= limit) break
  }
  return out
}
