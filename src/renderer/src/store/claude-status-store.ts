import { create } from 'zustand'
import type { ClaudeStatus } from '@shared/claude-status-types'
import { CLAUDE_STATUS_INITIAL } from '@shared/claude-status-types'

interface ClaudeStatusStore {
  readonly status: ClaudeStatus
  readonly onboardingDismissed: boolean
  readonly showOnboarding: boolean
  /**
   * True when the user has a machina-native Anthropic API key configured.
   * When true, the Claude CLI is optional, so we suppress the auto-show of
   * the install/auth onboarding overlay (post Phase 7 cutover machina-native
   * is the default agent path).
   */
  readonly nativeKeyConfigured: boolean
  setStatus: (status: ClaudeStatus) => void
  setNativeKeyConfigured: (configured: boolean) => void
  dismissOnboarding: () => void
  openOnboarding: () => void
}

export const useClaudeStatusStore = create<ClaudeStatusStore>((set) => ({
  status: { ...CLAUDE_STATUS_INITIAL },
  onboardingDismissed: false,
  showOnboarding: false,
  nativeKeyConfigured: false,
  setStatus: (status) =>
    set((state) => {
      // Auto-dismiss onboarding when Claude becomes ready
      if (status.installed && status.authenticated && state.showOnboarding) {
        return { status, showOnboarding: false, onboardingDismissed: true }
      }
      // Auto-show onboarding on first status if not ready, not dismissed, and
      // there's no machina-native key (without a key the user has no working
      // agent, so we should walk them through CLI setup).
      if (
        status.lastChecked > 0 &&
        (!status.installed || !status.authenticated) &&
        !state.onboardingDismissed &&
        !state.showOnboarding &&
        !state.nativeKeyConfigured
      ) {
        return { status, showOnboarding: true }
      }
      return { status }
    }),
  setNativeKeyConfigured: (configured) => set({ nativeKeyConfigured: configured }),
  dismissOnboarding: () => set({ showOnboarding: false, onboardingDismissed: true }),
  openOnboarding: () => set({ showOnboarding: true })
}))
