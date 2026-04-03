import { create } from 'zustand'
import type { ClaudeStatus } from '@shared/claude-status-types'
import { CLAUDE_STATUS_INITIAL } from '@shared/claude-status-types'

interface ClaudeStatusStore {
  readonly status: ClaudeStatus
  readonly onboardingDismissed: boolean
  readonly showOnboarding: boolean
  setStatus: (status: ClaudeStatus) => void
  dismissOnboarding: () => void
  openOnboarding: () => void
}

export const useClaudeStatusStore = create<ClaudeStatusStore>((set) => ({
  status: { ...CLAUDE_STATUS_INITIAL },
  onboardingDismissed: false,
  showOnboarding: false,
  setStatus: (status) =>
    set((state) => {
      // Auto-dismiss onboarding when Claude becomes ready
      if (status.installed && status.authenticated && state.showOnboarding) {
        return { status, showOnboarding: false, onboardingDismissed: true }
      }
      // Auto-show onboarding on first status if not ready and not dismissed
      if (
        status.lastChecked > 0 &&
        (!status.installed || !status.authenticated) &&
        !state.onboardingDismissed &&
        !state.showOnboarding
      ) {
        return { status, showOnboarding: true }
      }
      return { status }
    }),
  dismissOnboarding: () => set({ showOnboarding: false, onboardingDismissed: true }),
  openOnboarding: () => set({ showOnboarding: true })
}))
