import { describe, it, expect, beforeEach } from 'vitest'
import { useClaudeStatusStore } from '../claude-status-store'
import type { ClaudeStatus } from '@shared/claude-status-types'

const unreadyStatus: ClaudeStatus = {
  installed: false,
  authenticated: false,
  version: null,
  email: null,
  subscriptionType: null,
  lastChecked: 1,
  error: null
}

beforeEach(() => {
  useClaudeStatusStore.setState(useClaudeStatusStore.getInitialState())
})

describe('claude-status-store auto-show gate', () => {
  it('auto-shows the onboarding overlay when CLI is not ready and no machina-native key is set', () => {
    useClaudeStatusStore.getState().setStatus(unreadyStatus)
    expect(useClaudeStatusStore.getState().showOnboarding).toBe(true)
  })

  it('does NOT auto-show when CLI is not ready but the user has a machina-native key', () => {
    useClaudeStatusStore.getState().setNativeKeyConfigured(true)
    useClaudeStatusStore.getState().setStatus(unreadyStatus)
    expect(useClaudeStatusStore.getState().showOnboarding).toBe(false)
  })

  it('flipping the native-key flag mid-session prevents future auto-show', () => {
    useClaudeStatusStore.getState().setNativeKeyConfigured(true)
    useClaudeStatusStore.getState().setStatus(unreadyStatus)
    expect(useClaudeStatusStore.getState().showOnboarding).toBe(false)
    // dismiss + clear key should still not re-show on next status update
    useClaudeStatusStore.getState().setNativeKeyConfigured(false)
    useClaudeStatusStore.setState({ onboardingDismissed: false })
    useClaudeStatusStore.getState().setStatus({ ...unreadyStatus, lastChecked: 2 })
    expect(useClaudeStatusStore.getState().showOnboarding).toBe(true)
  })

  it('still auto-dismisses when status becomes ready', () => {
    useClaudeStatusStore.setState({ showOnboarding: true })
    useClaudeStatusStore.getState().setStatus({
      ...unreadyStatus,
      installed: true,
      authenticated: true
    })
    expect(useClaudeStatusStore.getState().showOnboarding).toBe(false)
    expect(useClaudeStatusStore.getState().onboardingDismissed).toBe(true)
  })
})
