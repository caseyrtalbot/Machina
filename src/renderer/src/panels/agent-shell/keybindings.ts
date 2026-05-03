import { useEffect } from 'react'
import { useThreadStore } from '../../store/thread-store'

export interface AgentShellKeybindingOptions {
  readonly toggleDock: () => void
  readonly openPalette: () => void
  readonly closePalette: () => void
}

const PALETTE_DIALOG_SELECTOR = '[role="dialog"][aria-label="command palette"]'

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if (el.isContentEditable) return true
  return false
}

function isInsidePalette(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return Boolean(el.closest(PALETTE_DIALOG_SELECTOR))
}

export function useAgentShellKeybindings(opts: AgentShellKeybindingOptions): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const editable = isEditableTarget(e.target)
      const inPalette = isInsidePalette(e.target)

      // Escape closes the palette globally, but inside other editable surfaces
      // (message composer, side inputs) we leave Escape alone so the user can
      // clear suggestion popups or exit IME without trampling local UI.
      if (e.key === 'Escape') {
        if (inPalette || !editable) opts.closePalette()
        return
      }

      const cmd = e.metaKey || e.ctrlKey

      // Cmd+. cancels the active agent run from anywhere, including text
      // inputs. Mirrors the macOS convention (Terminal, browsers) where
      // Cmd+. is "stop". A 60-second vault search is exactly the case
      // where the user must be able to bail out without the mouse.
      if (cmd && e.key === '.') {
        e.preventDefault()
        const state = useThreadStore.getState()
        const tid = state.activeThreadId
        if (tid && state.inFlightByThreadId[tid]) void state.cancelActive(tid)
        return
      }

      if (!cmd) return

      // Suppress global cmd-shortcuts from inside text inputs so typing Cmd-W
      // in the message composer doesn't quietly close a dock tab. The palette
      // input is editable but its shortcuts are intentionally global.
      if (editable && !inPalette) return

      const key = e.key.toLowerCase()
      if (key === '/' || (key === 'd' && e.shiftKey)) {
        e.preventDefault()
        opts.toggleDock()
      } else if (key === 'k') {
        e.preventDefault()
        opts.openPalette()
      } else if (key === 'n') {
        e.preventDefault()
        void useThreadStore.getState().createThread('machina-native', 'claude-sonnet-4-6')
      } else if (key === 'w') {
        e.preventDefault()
        const state = useThreadStore.getState()
        const tid = state.activeThreadId
        if (!tid) return
        const tabs = state.dockTabsByThreadId[tid] ?? []
        if (tabs.length === 0) return
        const stored = state.dockActiveIndexByThreadId[tid] ?? 0
        const target = Math.min(Math.max(0, stored), tabs.length - 1)
        state.removeDockTab(target)
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
