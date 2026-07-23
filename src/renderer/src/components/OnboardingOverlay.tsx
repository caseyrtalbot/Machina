import { useEffect, useCallback, useState } from 'react'
import {
  Terminal,
  CircleUser,
  CircleCheck,
  Copy,
  KeyRound,
  SquareArrowOutUpRight
} from 'lucide-react'
import { useClaudeStatus } from '../hooks/use-claude-status'
import { useClaudeStatusStore } from '../store/claude-status-store'
import { colors } from '../design/tokens'
import { Modal } from './overlay/Modal'

const RECHECK_INTERVAL_MS = 5_000
const AUTO_DISMISS_MS = 2_000

function StatusDot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      className={`onboarding__status-dot${pulse ? ' onboarding__status-dot--pulse' : ''}`}
      style={{ backgroundColor: color }}
    />
  )
}

function CodeSnippet({ code }: { code: string }) {
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(code)
  }, [code])

  return (
    <div className="onboarding__code">
      <code className="onboarding__code-text">{code}</code>
      <button
        onClick={handleCopy}
        className="te-onboarding-icon-btn"
        title="Copy to clipboard"
        aria-label="Copy to clipboard"
      >
        <Copy size={14} />
      </button>
    </div>
  )
}

function InstallStep() {
  const handleOpenDocs = useCallback(() => {
    void window.api.shell.openExternal('https://docs.anthropic.com/en/docs/claude-code/overview')
  }, [])

  return (
    <div className="onboarding__step">
      <Terminal size={24} className="onboarding__icon" />
      <h2 className="onboarding__title">Install Claude Code</h2>
      <p className="onboarding__body">
        The CLI powers AI features. Install it to unlock the full experience.
      </p>
      <button onClick={handleOpenDocs} className="te-onboarding-cta">
        Open Install Guide
        <SquareArrowOutUpRight size={12} />
      </button>
      <div className="onboarding__status">
        <StatusDot color={colors.text.muted} pulse />
        Waiting for installation…
      </div>
    </div>
  )
}

function AuthStep() {
  return (
    <div className="onboarding__step">
      <CircleUser size={24} className="onboarding__icon" />
      <h2 className="onboarding__title">Sign In to Claude</h2>
      <p className="onboarding__body">Run this command in your terminal to authenticate:</p>
      <CodeSnippet code="claude auth login" />
      <div className="onboarding__status">
        <StatusDot color={colors.text.muted} pulse />
        Waiting for authentication…
      </div>
    </div>
  )
}

function ReadyStep({
  email,
  subscriptionType
}: {
  email: string | null
  subscriptionType: string | null
}) {
  return (
    <div className="onboarding__step">
      <CircleCheck size={24} className="onboarding__icon--ready" />
      <h2 className="onboarding__title">Connected</h2>
      <p className="onboarding__body">
        AI features are ready.
        {email && (
          <span className="onboarding__body-muted">
            {' '}
            Signed in as {email}
            {subscriptionType ? ` (${subscriptionType})` : ''}.
          </span>
        )}
      </p>
    </div>
  )
}

/**
 * API-key-first onboarding step. The Anthropic API key drives the in-app
 * machina-native agent, which is the default agent path. Save/clear go
 * through the same `window.api.agentNative` IPC the SettingsModal uses —
 * the key only ever lives in transient input state here, never logged or
 * persisted anywhere else.
 */
function ApiKeyStep({ onSaved }: { onSaved: () => void }) {
  const keyConfigured = useClaudeStatusStore((s) => s.nativeKeyConfigured)
  const setNativeKeyConfigured = useClaudeStatusStore((s) => s.setNativeKeyConfigured)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(async () => {
    const key = draft.trim()
    if (!key) return
    try {
      await window.api.agentNative.setKey(key)
      setDraft('')
      setError(null)
      setNativeKeyConfigured(true)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [draft, onSaved, setNativeKeyConfigured])

  const clear = useCallback(async () => {
    await window.api.agentNative.clearKey()
    setNativeKeyConfigured(false)
  }, [setNativeKeyConfigured])

  if (keyConfigured) {
    return (
      <div className="onboarding__step">
        <CircleCheck size={24} className="onboarding__icon--ready" />
        <h2 className="onboarding__title">API Key Configured</h2>
        <p className="onboarding__body">
          The in-app agent is ready. Open a thread and start asking about your vault.
        </p>
        <button
          onClick={() => void clear()}
          className="te-onboarding-cta te-onboarding-cta--secondary"
        >
          Clear Key
        </button>
      </div>
    )
  }

  return (
    <div className="onboarding__step">
      <KeyRound size={24} className="onboarding__icon" />
      <h2 className="onboarding__title">Connect Your Anthropic API Key</h2>
      <p className="onboarding__body">
        Powers the in-app agent — the fastest way to start working with your vault.
      </p>
      <input
        type="password"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
        }}
        placeholder="sk-ant-..."
        aria-label="Anthropic API key"
        className="onboarding__input"
      />
      {error && <span className="onboarding__error">{error}</span>}
      <button
        onClick={() => void save()}
        disabled={!draft.trim()}
        className="te-onboarding-cta te-onboarding-cta--tight"
        style={{
          color: draft.trim() ? colors.text.primary : colors.text.muted,
          opacity: draft.trim() ? 1 : 0.5
        }}
      >
        Save Key
      </button>
      <p className="onboarding__hint">Stored encrypted via Electron safeStorage.</p>
    </div>
  )
}

export function OnboardingOverlay() {
  const status = useClaudeStatus()
  const showOnboarding = useClaudeStatusStore((s) => s.showOnboarding)
  const dismissOnboarding = useClaudeStatusStore((s) => s.dismissOnboarding)
  // API key is the default agent path; CLI install is the alternative.
  const [mode, setMode] = useState<'api-key' | 'cli'>('api-key')
  const [justSaved, setJustSaved] = useState(false)

  // Reset to the default step each time the walkthrough is (re)opened.
  // State-during-render adjustment (React's recommended pattern for state
  // derived from a changing value), mirroring SurfaceDock's snapshot sync.
  const [prevShow, setPrevShow] = useState(showOnboarding)
  if (prevShow !== showOnboarding) {
    setPrevShow(showOnboarding)
    if (showOnboarding) {
      setMode('api-key')
      setJustSaved(false)
    }
  }

  // Poll for CLI status changes while the CLI step is visible
  useEffect(() => {
    if (!showOnboarding || mode !== 'cli') return
    const timer = setInterval(() => {
      void window.api.claude.recheck()
    }, RECHECK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [showOnboarding, mode])

  // Auto-dismiss the CLI "Ready" step after a delay
  useEffect(() => {
    if (!showOnboarding || mode !== 'cli' || !status.installed || !status.authenticated) return
    const timer = setTimeout(dismissOnboarding, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [showOnboarding, mode, status.installed, status.authenticated, dismissOnboarding])

  // Auto-dismiss after a fresh API key save (not on a pre-existing key, so
  // re-running setup from Settings or the palette stays inspectable).
  useEffect(() => {
    if (!showOnboarding || !justSaved) return
    const timer = setTimeout(dismissOnboarding, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [showOnboarding, justSaved, dismissOnboarding])

  const isReady = status.installed && status.authenticated

  return (
    <Modal open={showOnboarding} onClose={dismissOnboarding} panelClassName="onboarding__panel">
      <div className="onboarding__content">
        {mode === 'api-key' && <ApiKeyStep onSaved={() => setJustSaved(true)} />}
        {mode === 'cli' && !status.installed && <InstallStep />}
        {mode === 'cli' && status.installed && !status.authenticated && <AuthStep />}
        {mode === 'cli' && isReady && (
          <ReadyStep email={status.email} subscriptionType={status.subscriptionType} />
        )}
      </div>

      {!(mode === 'cli' && isReady) && (
        <div className="onboarding__footer">
          <button
            onClick={() => setMode(mode === 'api-key' ? 'cli' : 'api-key')}
            className="te-onboarding-skip"
          >
            {mode === 'api-key' ? 'Install the Claude CLI instead' : 'Use an API key instead'}
          </button>
          <button onClick={dismissOnboarding} className="te-onboarding-skip">
            Skip for now
          </button>
        </div>
      )}
    </Modal>
  )
}
