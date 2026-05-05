import { useMemo } from 'react'
import { useVaultStore } from '../store/vault-store'
import { useThreadStore } from '../store/thread-store'
import { formatModelLabel } from '@shared/format-model-label'
import type { DockTab } from '@shared/dock-types'

function basenameNoExt(path: string): string {
  const file = path.split('/').pop() ?? path
  const dot = file.lastIndexOf('.')
  return dot > 0 ? file.slice(0, dot) : file
}

function vaultName(vaultPath: string | null): string {
  if (!vaultPath) return 'No vault'
  const last = vaultPath.split('/').filter(Boolean).pop()
  return last ?? vaultPath
}

/**
 * Titlebar breadcrumb.
 *
 * Renders inside the WindowDragRegion: vault accent dot → vault name → "/"
 * → active surface title → optional live indicator → agent label on the right.
 *
 * The crumb tracks the *active dock surface* for the active thread, not the
 * editor-store's `activeNotePath`. When the dock holds an editor, the note's
 * title appears; when the dock is empty or shows a non-editor surface, the
 * crumb falls back to the active thread's title. This avoids leaving a stale
 * note title in the chrome after the editor surface is closed.
 */
export function TitlebarBreadcrumb() {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const fileToTitle = useVaultStore((s) => s.artifactById)
  const fileToId = useVaultStore((s) => s.fileToId)
  const activeThread = useThreadStore((s) =>
    s.activeThreadId ? (s.threadsById[s.activeThreadId] ?? null) : null
  )
  const activeDockTab = useThreadStore<DockTab | null>((s) => {
    const id = s.activeThreadId
    if (!id) return null
    const tabs = s.dockTabsByThreadId[id] ?? []
    if (tabs.length === 0) return null
    const idx = s.dockActiveIndexByThreadId[id] ?? 0
    const safeIdx = idx < tabs.length ? idx : 0
    return tabs[safeIdx] ?? null
  })
  const inFlight = useThreadStore((s) =>
    s.activeThreadId ? Boolean(s.inFlightByThreadId[s.activeThreadId]) : false
  )

  const crumb = useMemo(() => {
    if (activeDockTab?.kind === 'editor') {
      const path = activeDockTab.path
      const id = fileToId[path]
      const artifact = id ? fileToTitle[id] : undefined
      return artifact?.title ?? basenameNoExt(path)
    }
    if (activeThread) {
      return activeThread.title || 'Thread'
    }
    return null
  }, [activeDockTab, activeThread, fileToId, fileToTitle])

  const agentLabel = activeThread?.model ? formatModelLabel(activeThread.model) : null

  return (
    <>
      <div
        className="te-titlebar-breadcrumb"
        data-testid="titlebar-breadcrumb"
        aria-label="Workspace breadcrumb"
      >
        <span className="te-titlebar-breadcrumb__dot" aria-hidden />
        <span className="te-titlebar-breadcrumb__vault">{vaultName(vaultPath)}</span>
        {crumb ? (
          <>
            <span className="te-titlebar-breadcrumb__sep" aria-hidden>
              /
            </span>
            <span className="te-titlebar-breadcrumb__crumb" title={crumb}>
              {crumb}
            </span>
          </>
        ) : null}
        {inFlight ? (
          <>
            <span className="te-titlebar-breadcrumb__sep" aria-hidden>
              ·
            </span>
            <span className="te-titlebar-breadcrumb__live">
              <span className="te-live-dot" aria-hidden />
              Live
            </span>
          </>
        ) : null}
      </div>
      {agentLabel ? <span className="te-titlebar-agent">{agentLabel}</span> : null}
    </>
  )
}
