import { useState, useCallback, useRef } from 'react'
import { useVaultHealthStore } from '../../store/vault-health-store'
import { useVaultStore } from '../../store/vault-store'
import { computeDerivedHealth } from '@shared/engine/vault-health'
import { colors, typography } from '../../design/tokens'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimeAgo(ts: number): string {
  const delta = Math.floor((Date.now() - ts) / 1000)
  if (delta < 5) return 'just now'
  if (delta < 60) return `${delta}s ago`
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  return `${Math.floor(delta / 3600)}h ago`
}

// ---------------------------------------------------------------------------
// Centered message (no-vault / empty states)
// ---------------------------------------------------------------------------

function CenteredMessage({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      className="h-full flex items-center justify-center"
      style={{
        color: colors.text.muted,
        backgroundColor: colors.bg.base,
        fontFamily: typography.fontFamily.body,
        fontSize: 14
      }}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Refresh button
// ---------------------------------------------------------------------------

const REFRESH_COOLDOWN_MS = 500

function RefreshButton() {
  const [disabled, setDisabled] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleRefresh = useCallback(() => {
    if (disabled) return

    const vaultState = useVaultStore.getState()
    const derived = computeDerivedHealth({
      workerResult: {
        artifacts: vaultState.artifacts,
        errors: vaultState.parseErrors,
        fileToId: vaultState.fileToId,
        artifactPathById: vaultState.artifactPathById,
        graph: vaultState.graph
      },
      files: vaultState.files
    })
    useVaultHealthStore.getState().setDerived(derived)

    setDisabled(true)
    timerRef.current = setTimeout(() => setDisabled(false), REFRESH_COOLDOWN_MS)
  }, [disabled])

  return (
    <button
      type="button"
      aria-label="Refresh health checks"
      disabled={disabled}
      onClick={handleRefresh}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        borderRadius: 5,
        border: 'none',
        background: 'transparent',
        color: colors.text.muted,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'opacity 150ms ease-out'
      }}
    >
      <svg
        width={14}
        height={14}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M1 2v5h5" />
        <path d="M3.5 10a5.5 5.5 0 1 0 1-7.5L1 6" />
      </svg>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Green state
// ---------------------------------------------------------------------------

function GreenState({ totalRuns }: { readonly totalRuns: number }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2"
      style={{ padding: '4rem 2rem', textAlign: 'center' }}
    >
      <svg
        width={32}
        height={32}
        viewBox="0 0 24 24"
        fill="none"
        stroke={colors.claude.ready}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ opacity: 0.7 }}
      >
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
      <div
        style={{
          fontSize: 15,
          fontWeight: 400,
          color: colors.text.primary,
          marginTop: 4
        }}
      >
        Vault healthy
      </div>
      <div style={{ fontSize: 12, color: colors.text.muted }}>
        {totalRuns}/{totalRuns} checks passing
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Unknown state
// ---------------------------------------------------------------------------

function UnknownState() {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2"
      style={{ padding: '4rem 2rem', textAlign: 'center' }}
    >
      <div
        className="te-pulse"
        style={{
          fontSize: 14,
          color: colors.text.muted,
          animation: 'te-pulse 600ms ease-in-out infinite alternate'
        }}
      >
        Checking vault health...
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HealthPanel (main export)
// ---------------------------------------------------------------------------

export function HealthPanel() {
  const status = useVaultHealthStore((s) => s.status)
  const issues = useVaultHealthStore((s) => s.issues)
  const runs = useVaultHealthStore((s) => s.runs)
  const lastDerivedAt = useVaultHealthStore((s) => s.lastDerivedAt)
  const lastInfraAt = useVaultHealthStore((s) => s.lastInfraAt)
  const vaultPath = useVaultStore((s) => s.vaultPath)

  // No vault state
  if (!vaultPath) {
    return <CenteredMessage>Open a vault to see health</CenteredMessage>
  }

  const lastChecked = lastDerivedAt ?? lastInfraAt
  const totalRuns = runs.length
  const failedRuns = runs.filter((r) => !r.passed).length
  const passingRuns = totalRuns - failedRuns

  return (
    <div
      className="h-full overflow-y-auto"
      style={{
        fontFamily: typography.fontFamily.body,
        backgroundColor: colors.bg.base
      }}
    >
      <div
        style={{
          maxWidth: '52rem',
          margin: '0 auto',
          padding: '2rem 2rem 3rem'
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 24
          }}
        >
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 300,
                color: colors.text.primary,
                marginBottom: 2
              }}
            >
              Vault Health
            </div>
            {lastChecked && (
              <div style={{ fontSize: 11, color: colors.text.muted }}>
                {status === 'degraded'
                  ? `${issues.length} issue${issues.length !== 1 ? 's' : ''}`
                  : `${passingRuns}/${totalRuns} checks passing`}
                {' \u00B7 last checked '}
                {formatTimeAgo(lastChecked)}
              </div>
            )}
          </div>
          <RefreshButton />
        </div>

        {/* Body */}
        {status === 'green' && <GreenState totalRuns={totalRuns} />}
        {status === 'unknown' && <UnknownState />}
      </div>
    </div>
  )
}
