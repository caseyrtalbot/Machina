import MiniSearch from 'minisearch'
import type { Thread } from '@shared/thread-types'
import type { DockTab } from '@shared/dock-types'
import type { SearchHit } from '@shared/engine/search-engine'
import { useThreadStore } from '../../store/thread-store'
import { useVaultStore } from '../../store/vault-store'
import { useClaudeStatusStore } from '../../store/claude-status-store'

export type PaletteItemKind = 'thread' | 'file' | 'surface' | 'action' | 'note'

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

interface PaletteSourcesOptions {
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

  // Real per-canvasId stores landed with 3.8: every discovered canvas id gets
  // an entry, each opening a dock tab backed by its own store instance.
  for (const canvasId of vaultStore.canvasIds) {
    items.push({
      id: `surface:canvas:${canvasId}`,
      kind: 'surface',
      title: canvasId === 'default' ? 'Open canvas' : `Open canvas: ${canvasId}`,
      subtitle: 'dock surface',
      run: () => {
        opts.closePalette()
        useThreadStore.getState().openOrFocusDockTab({ kind: 'canvas', id: canvasId })
      }
    })
  }

  const otherSurfaces: ReadonlyArray<{ kind: DockTab['kind']; title: string; tab: DockTab }> = [
    { kind: 'graph', title: 'Open graph view', tab: { kind: 'graph' } },
    { kind: 'ghosts', title: 'Open ghosts', tab: { kind: 'ghosts' } },
    { kind: 'health', title: 'Open health', tab: { kind: 'health' } }
  ]
  for (const s of otherSurfaces) {
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
      id: 'action:toggle-threads',
      kind: 'action',
      title: 'Toggle thread sidebar',
      subtitle: 'cmd+shift+b',
      run: () => {
        opts.closePalette()
        useThreadStore.getState().toggleSidebarCollapsed()
      }
    },
    {
      id: 'action:toggle-chat',
      kind: 'action',
      title: 'Toggle chat panel',
      subtitle: 'cmd+shift+c',
      run: () => {
        opts.closePalette()
        useThreadStore.getState().toggleChatCollapsed()
      }
    },
    {
      id: 'action:toggle-files',
      kind: 'action',
      title: 'Toggle files panel',
      subtitle: 'cmd+shift+v',
      run: () => {
        opts.closePalette()
        useThreadStore.getState().toggleFilesPanel()
      }
    },
    {
      id: 'action:focus-mode',
      kind: 'action',
      title: 'Toggle focus mode',
      subtitle: 'cmd+shift+f · dock only',
      run: () => {
        opts.closePalette()
        useThreadStore.getState().toggleFocusMode()
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
        if (id) useThreadStore.getState().toggleAutoAccept(id)
      }
    },
    {
      id: 'action:run-setup',
      kind: 'action',
      title: 'Run setup',
      subtitle: 'agent onboarding walkthrough',
      run: () => {
        opts.closePalette()
        useClaudeStatusStore.getState().openOnboarding()
      }
    }
  )

  return items
}

/**
 * Map full-text SearchHits (vault-worker SearchEngine) onto palette items.
 * Skips hits whose path already appears among `shownIds` as a `file:` item so
 * a note matched by both filename and body shows once (the filename row wins).
 */
export function noteHitItems(
  hits: readonly SearchHit[],
  shownIds: ReadonlySet<string>,
  opts: PaletteSourcesOptions
): PaletteItem[] {
  return hits
    .filter((hit) => !shownIds.has(`file:${hit.path}`))
    .map((hit) => ({
      // PDF hits (3.10a) arrive one per page for the same path — the page
      // suffix keeps palette/MiniSearch ids unique. Note hits are unchanged.
      id: hit.page !== undefined ? `note:${hit.path}#p${hit.page}` : `note:${hit.path}`,
      kind: 'note' as const,
      title: hit.page !== undefined ? `${hit.title} · p.${hit.page}` : hit.title,
      // Embedding-sourced hits (3.11) are prefixed so the palette hints why a
      // result without a literal match is here.
      subtitle: `${hit.semantic === true ? 'semantic · ' : ''}${hit.snippet || hit.path}`,
      run: () => {
        opts.closePalette()
        useThreadStore.getState().openOrFocusDockTab({ kind: 'editor', path: hit.path })
      }
    }))
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
