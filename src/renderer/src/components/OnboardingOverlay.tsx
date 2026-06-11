import { useEffect, useCallback, useRef, useState } from 'react'
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
import { colors, floatingPanel, typography, zIndex } from '../design/tokens'

const RECHECK_INTERVAL_MS = 5_000
const AUTO_DISMISS_MS = 2_000

function StatusDot({ color, pulse }: { color: string; pulse?: boolean }) {
  return (
    <span
      className={`inline-block rounded-full ${pulse ? 'animate-pulse' : ''}`}
      style={{ width: 8, height: 8, backgroundColor: color, flexShrink: 0 }}
    />
  )
}

function CodeSnippet({ code }: { code: string }) {
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(code)
  }, [code])

  return (
    <div
      className="flex items-center justify-between px-3 py-2 mt-3"
      style={{
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        border: `1px solid ${colors.border.subtle}`,
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: 13
      }}
    >
      <code style={{ color: colors.text.primary }}>{code}</code>
      <button
        onClick={handleCopy}
        className="ml-3 p-1 transition-colors te-onboarding-icon-btn"
        title="Copy to clipboard"
        aria-label="Copy to clipboard"
        style={{ color: colors.text.muted }}
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
    <div className="flex flex-col items-center text-center">
      <Terminal size={24} style={{ color: colors.text.muted }} />
      <h2 className="mt-3 text-sm font-medium" style={{ color: colors.text.primary }}>
        Install Claude Code
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed" style={{ color: colors.text.secondary }}>
        The CLI powers AI features. Install it to unlock the full experience.
      </p>
      <button
        onClick={handleOpenDocs}
        className="mt-4 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors te-onboarding-cta"
        style={{
          border: `1px solid ${colors.border.subtle}`,
          color: colors.text.primary
        }}
      >
        Open Install Guide
        <SquareArrowOutUpRight size={12} />
      </button>
      <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: colors.text.muted }}>
        <StatusDot color={colors.text.muted} pulse />
        Waiting for installation…
      </div>
    </div>
  )
}

function AuthStep() {
  return (
    <div className="flex flex-col items-center text-center">
      <CircleUser size={24} style={{ color: colors.text.muted }} />
      <h2 className="mt-3 text-sm font-medium" style={{ color: colors.text.primary }}>
        Sign In to Claude
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed" style={{ color: colors.text.secondary }}>
        Run this command in your terminal to authenticate:
      </p>
      <CodeSnippet code="claude auth login" />
      <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: colors.text.muted }}>
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
    <div className="flex flex-col items-center text-center">
      <CircleCheck size={24} style={{ color: colors.claude.ready }} />
      <h2 className="mt-3 text-sm font-medium" style={{ color: colors.text.primary }}>
        Connected
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed" style={{ color: colors.text.secondary }}>
        AI features are ready.
        {email && (
          <span style={{ color: colors.text.muted }}>
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
      <div className="flex flex-col items-center text-center">
        <CircleCheck size={24} style={{ color: colors.claude.ready }} />
        <h2 className="mt-3 text-sm font-medium" style={{ color: colors.text.primary }}>
          API Key Configured
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: colors.text.secondary }}>
          The in-app agent is ready. Open a thread and start asking about your vault.
        </p>
        <button
          onClick={() => void clear()}
          className="mt-4 px-3 py-1.5 text-xs font-medium transition-colors te-onboarding-cta"
          style={{ border: `1px solid ${colors.border.subtle}`, color: colors.text.secondary }}
        >
          Clear Key
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center text-center">
      <KeyRound size={24} style={{ color: colors.text.muted }} />
      <h2 className="mt-3 text-sm font-medium" style={{ color: colors.text.primary }}>
        Connect Your Anthropic API Key
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed" style={{ color: colors.text.secondary }}>
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
        className="mt-4 px-3 py-2 w-full"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.04)',
          border: `1px solid ${colors.border.subtle}`,
          color: colors.text.primary,
          fontFamily: typography.fontFamily.mono,
          fontSize: 12,
          outline: 'none'
        }}
      />
      {error && (
        <span
          className="mt-2 text-xs"
          style={{ color: colors.claude.error, fontFamily: typography.fontFamily.mono }}
        >
          {error}
        </span>
      )}
      <button
        onClick={() => void save()}
        disabled={!draft.trim()}
        className="mt-3 px-3 py-1.5 text-xs font-medium transition-colors te-onboarding-cta"
        style={{
          border: `1px solid ${colors.border.subtle}`,
          color: draft.trim() ? colors.text.primary : colors.text.muted,
          opacity: draft.trim() ? 1 : 0.5
        }}
      >
        Save Key
      </button>
      <p className="mt-3 text-xs" style={{ color: colors.text.muted }}>
        Stored encrypted via Electron safeStorage.
      </p>
    </div>
  )
}

export function OnboardingOverlay() {
  const status = useClaudeStatus()
  const showOnboarding = useClaudeStatusStore((s) => s.showOnboarding)
  const dismissOnboarding = useClaudeStatusStore((s) => s.dismissOnboarding)
  const panelRef = useRef<HTMLDivElement>(null)
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

  // ESC to dismiss
  useEffect(() => {
    if (!showOnboarding) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        dismissOnboarding()
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [showOnboarding, dismissOnboarding])

  if (!showOnboarding) return null

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) dismissOnboarding()
  }

  const isReady = status.installed && status.authenticated

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: zIndex.modal, backgroundColor: colors.scrim.modal }}
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        className="te-popover-enter overflow-hidden"
        style={{
          width: 340,
          backgroundColor: floatingPanel.glass.bg,
          backdropFilter: floatingPanel.glass.blur,
          WebkitBackdropFilter: floatingPanel.glass.blur,
          border: `1px solid ${colors.border.subtle}`,
          boxShadow: floatingPanel.shadow
        }}
      >
        <div className="px-6 py-6">
          {mode === 'api-key' && <ApiKeyStep onSaved={() => setJustSaved(true)} />}
          {mode === 'cli' && !status.installed && <InstallStep />}
          {mode === 'cli' && status.installed && !status.authenticated && <AuthStep />}
          {mode === 'cli' && isReady && (
            <ReadyStep email={status.email} subscriptionType={status.subscriptionType} />
          )}
        </div>

        {!(mode === 'cli' && isReady) && (
          <div
            className="flex items-center justify-center gap-4 py-2.5 text-xs"
            style={{
              borderTop: `1px solid var(--line-faint)`,
              color: colors.text.muted
            }}
          >
            <button
              onClick={() => setMode(mode === 'api-key' ? 'cli' : 'api-key')}
              className="transition-colors te-onboarding-skip"
            >
              {mode === 'api-key' ? 'Install the Claude CLI instead' : 'Use an API key instead'}
            </button>
            <button onClick={dismissOnboarding} className="transition-colors te-onboarding-skip">
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
