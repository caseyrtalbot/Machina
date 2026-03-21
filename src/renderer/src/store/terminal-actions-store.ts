import { create } from 'zustand'

type ActivateClaudeHandler = (() => void | Promise<void>) | null

interface TerminalActionStore {
  readonly activateClaude: ActivateClaudeHandler
  readonly pendingActivation: boolean
  setHandler: (handler: ActivateClaudeHandler) => void
  requestActivateClaude: () => void
  clearRequest: () => void
  reset: () => void
}

export const useTerminalActionStore = create<TerminalActionStore>((set, get) => ({
  activateClaude: null,
  pendingActivation: false,

  setHandler: (handler) => set({ activateClaude: handler }),

  requestActivateClaude: () => {
    const { activateClaude } = get()
    if (activateClaude) {
      // Handler is registered (terminal is mounted), call immediately
      activateClaude()
      set({ pendingActivation: false })
    } else {
      // Terminal not mounted yet, set pending flag
      set({ pendingActivation: true })
    }
  },

  clearRequest: () => set({ pendingActivation: false }),

  reset: () => set({ activateClaude: null, pendingActivation: false })
}))
