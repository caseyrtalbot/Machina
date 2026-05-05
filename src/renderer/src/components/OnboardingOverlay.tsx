import { useEffect, useCallback, useRef } from 'react'
import { Terminal, UserCircle, CheckCircle, Copy, ArrowSquareOut } from '@phosphor-icons/react'
import { useClaudeStatus } from '../hooks/use-claude-status'
import { useClaudeStatusStore } from '../store/claude-status-store'
import { colors } from '../design/tokens'

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
      className="flex items-center justify-between rounded px-3 py-2 mt-3"
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
        className="ml-3 p-1 rounded hover:bg-white/10 transition-colors"
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
      <Terminal size={24} weight="regular" style={{ color: colors.text.muted }} />
      <h2 className="mt-3 text-sm font-medium" style={{ color: colors.text.primary }}>
        Install Claude Code
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed" style={{ color: colors.text.secondary }}>
        The CLI powers AI features. Install it to unlock the full experience.
      </p>
      <button
        onClick={handleOpenDocs}
        className="mt-4 flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors"
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.06)',
          border: `1px solid ${colors.border.subtle}`,
          color: colors.text.primary
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)'
        }}
      >
        Open Install Guide
        <ArrowSquareOut size={12} />
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
      <UserCircle size={24} weight="regular" style={{ color: colors.text.muted }} />
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
      <CheckCircle size={24} weight="regular" style={{ color: colors.claude.ready }} />
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

export function OnboardingOverlay() {
  const status = useClaudeStatus()
  const showOnboarding = useClaudeStatusStore((s) => s.showOnboarding)
  const dismissOnboarding = useClaudeStatusStore((s) => s.dismissOnboarding)
  const panelRef = useRef<HTMLDivElement>(null)

  // Poll for status changes more frequently while onboarding is visible
  useEffect(() => {
    if (!showOnboarding) return
    const timer = setInterval(() => {
      void window.api.claude.recheck()
    }, RECHECK_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [showOnboarding])

  // Auto-dismiss the "Ready" step after a delay
  useEffect(() => {
    if (!showOnboarding || !status.installed || !status.authenticated) return
    const timer = setTimeout(dismissOnboarding, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [showOnboarding, status.installed, status.authenticated, dismissOnboarding])

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
      style={{ zIndex: 45, backgroundColor: 'rgba(0, 0, 0, 0.4)' }}
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        className="te-popover-enter rounded-md overflow-hidden"
        style={{
          width: 340,
          backgroundColor: 'rgba(8, 8, 12, 0.88)',
          backdropFilter: 'blur(24px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.3)',
          border: `1px solid ${colors.border.subtle}`,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)'
        }}
      >
        <div className="px-6 py-6">
          {!status.installed && <InstallStep />}
          {status.installed && !status.authenticated && <AuthStep />}
          {isReady && <ReadyStep email={status.email} subscriptionType={status.subscriptionType} />}
        </div>

        {!isReady && (
          <div
            className="flex justify-center py-2.5 text-xs"
            style={{
              borderTop: `1px solid var(--line-faint)`,
              color: colors.text.muted
            }}
          >
            <button
              onClick={dismissOnboarding}
              className="transition-colors"
              style={{ color: colors.text.muted }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = colors.text.secondary
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = colors.text.muted
              }}
            >
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
