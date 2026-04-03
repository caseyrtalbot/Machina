import { useEffect, useCallback, useRef } from 'react'
import { Terminal, UserCircle, CheckCircle, Copy, ArrowSquareOut } from '@phosphor-icons/react'
import { useClaudeStatus } from '../hooks/use-claude-status'
import { useClaudeStatusStore } from '../store/claude-status-store'
import { colors } from '../design/tokens'
import { useCanvasStore } from '../store/canvas-store'
import { useVaultStore } from '../store/vault-store'
import { createCanvasNode } from '@shared/canvas-types'

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
        style={{ color: colors.text.muted }}
      >
        <Copy size={14} />
      </button>
    </div>
  )
}

function InstallStep() {
  const handleOpenDocs = useCallback(() => {
    void window.api.shell.openPath('https://docs.anthropic.com/en/docs/claude-code/overview')
  }, [])

  return (
    <div className="flex flex-col items-center text-center">
      <Terminal size={32} weight="duotone" style={{ color: colors.text.secondary }} />
      <h2 className="mt-4 text-base font-medium" style={{ color: colors.text.primary }}>
        Install Claude Code
      </h2>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: colors.text.secondary }}>
        Thought Engine uses the Claude Code CLI for AI features. Install it to unlock the full
        experience.
      </p>
      <button
        onClick={handleOpenDocs}
        className="mt-5 flex items-center gap-2 rounded px-4 py-2 text-sm font-medium transition-colors hover:brightness-110"
        style={{
          backgroundColor: colors.claude.ready,
          color: '#000'
        }}
      >
        Open Install Guide
        <ArrowSquareOut size={14} />
      </button>
      <div className="mt-5 flex items-center gap-2 text-xs" style={{ color: colors.text.muted }}>
        <StatusDot color={colors.claude.warning} pulse />
        Waiting for installation...
      </div>
    </div>
  )
}

function AuthStep() {
  const handleOpenTerminal = useCallback(() => {
    const vaultPath = useVaultStore.getState().vaultPath
    if (!vaultPath) return

    const vp = useCanvasStore.getState().viewport
    const node = createCanvasNode(
      'terminal',
      { x: -vp.x + 200, y: -vp.y + 100 },
      { metadata: { initialCommand: 'claude auth login' } }
    )
    useCanvasStore.getState().addNode(node)
    useClaudeStatusStore.getState().dismissOnboarding()
  }, [])

  return (
    <div className="flex flex-col items-center text-center">
      <UserCircle size={32} weight="duotone" style={{ color: colors.text.secondary }} />
      <h2 className="mt-4 text-base font-medium" style={{ color: colors.text.primary }}>
        Sign In to Claude
      </h2>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: colors.text.secondary }}>
        Run this command in your terminal to authenticate:
      </p>
      <CodeSnippet code="claude auth login" />
      <button
        onClick={handleOpenTerminal}
        className="mt-4 flex items-center gap-2 rounded px-4 py-2 text-sm font-medium transition-colors hover:brightness-110"
        style={{
          backgroundColor: colors.claude.ready,
          color: '#000'
        }}
      >
        <Terminal size={14} />
        Open Terminal
      </button>
      <div className="mt-5 flex items-center gap-2 text-xs" style={{ color: colors.text.muted }}>
        <StatusDot color={colors.claude.warning} pulse />
        Waiting for authentication...
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
      <CheckCircle size={32} weight="fill" style={{ color: colors.claude.ready }} />
      <h2 className="mt-4 text-base font-medium" style={{ color: colors.text.primary }}>
        Claude is connected
      </h2>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: colors.text.secondary }}>
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
          width: 420,
          backgroundColor: 'rgba(8, 8, 12, 0.88)',
          backdropFilter: 'blur(24px) saturate(1.3)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.3)',
          border: `1px solid ${colors.border.default}`,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)'
        }}
      >
        <div className="px-8 py-8">
          {!status.installed && <InstallStep />}
          {status.installed && !status.authenticated && <AuthStep />}
          {isReady && <ReadyStep email={status.email} subscriptionType={status.subscriptionType} />}
        </div>

        {!isReady && (
          <div
            className="flex justify-center py-3 text-xs"
            style={{
              borderTop: `1px solid ${colors.border.subtle}`,
              color: colors.text.muted
            }}
          >
            <button onClick={dismissOnboarding} className="hover:underline">
              Skip for now
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
