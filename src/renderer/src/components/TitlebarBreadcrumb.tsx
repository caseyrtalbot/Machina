import { useMemo } from 'react'
import { useVaultStore } from '../store/vault-store'
import { useEditorStore } from '../store/editor-store'
import { useThreadStore } from '../store/thread-store'

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

function shortAgent(model: string): string {
  return model
    .replace(/^claude-?/i, '')
    .replace(/-/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Titlebar breadcrumb.
 *
 * Renders inside the WindowDragRegion: vault accent dot → vault name → "/"
 * → active note title → optional live indicator → agent label on the right.
 * Mirrors the Console direction titlebar from the design package: 12px
 * sans for the breadcrumb, 10.5px mono uppercase 0.12em for the agent label.
 *
 * The whole strip stays inside the OS drag region so users can grab any
 * empty area to move the window; only future interactive children would
 * need to opt out of `-webkit-app-region: drag`.
 */
export function TitlebarBreadcrumb() {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const fileToTitle = useVaultStore((s) => s.artifactById)
  const fileToId = useVaultStore((s) => s.fileToId)
  const activeThread = useThreadStore((s) =>
    s.activeThreadId ? (s.threadsById[s.activeThreadId] ?? null) : null
  )
  const inFlight = useThreadStore((s) =>
    s.activeThreadId ? Boolean(s.inFlightByThreadId[s.activeThreadId]) : false
  )

  const crumb = useMemo(() => {
    if (activeThread && !activeNotePath) {
      return activeThread.title || 'Thread'
    }
    if (activeNotePath) {
      const id = fileToId[activeNotePath]
      const artifact = id ? fileToTitle[id] : undefined
      return artifact?.title ?? basenameNoExt(activeNotePath)
    }
    return null
  }, [activeNotePath, fileToId, fileToTitle, activeThread])

  const agentLabel = activeThread?.model ? shortAgent(activeThread.model) : null

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
