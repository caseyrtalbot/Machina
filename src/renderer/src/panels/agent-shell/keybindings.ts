import { useEffect } from 'react'
import { useThreadStore } from '../../store/thread-store'

export interface AgentShellKeybindingOptions {
  readonly toggleDock: () => void
  readonly openPalette: () => void
  readonly closePalette: () => void
}

export function useAgentShellKeybindings(opts: AgentShellKeybindingOptions): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const cmd = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') {
        opts.closePalette()
        return
      }
      if (!cmd) return
      const key = e.key.toLowerCase()
      if (key === '/') {
        e.preventDefault()
        opts.toggleDock()
      } else if (key === 'k') {
        e.preventDefault()
        opts.openPalette()
      } else if (key === 'w') {
        e.preventDefault()
        // TODO Phase 6+: close the focused dock tab; for now drop the active tab.
        const tabs =
          useThreadStore.getState().dockTabsByThreadId[
            useThreadStore.getState().activeThreadId ?? ''
          ] ?? []
        if (tabs.length > 0) useThreadStore.getState().removeDockTab(tabs.length - 1)
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const n = Number(e.key)
        const ids = Object.keys(useThreadStore.getState().threadsById)
        if (ids[n - 1]) void useThreadStore.getState().selectThread(ids[n - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [opts])
}
