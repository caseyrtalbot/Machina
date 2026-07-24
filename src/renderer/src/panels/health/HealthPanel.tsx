import { useState, useCallback, useMemo, useRef } from 'react'
import { CheckCircleIcon, EmptyState } from '../../components/emptystate/EmptyState'
import { PanelHeader } from '../../components/panelheader/PanelHeader'
import { useVaultHealthStore } from '../../store/vault-health-store'
import { useVaultStore } from '../../store/vault-store'
import { openNoteInEditor } from '../../store/dock-store'
import { computeDerivedHealth } from '@shared/engine/vault-health'
import type { HealthIssue } from '@shared/engine/vault-health'
import { colors } from '../../design/tokens'
import { SectionLabel } from '../../design/components/SectionLabel'

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
    <div className="te-health-centered">
      <EmptyState body={children} />
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

    if (window.api?.health) {
      window.api.health.requestTick()
    }

    setDisabled(true)
    timerRef.current = setTimeout(() => setDisabled(false), REFRESH_COOLDOWN_MS)
  }, [disabled])

  return (
    <button
      type="button"
      aria-label="Refresh health checks"
      disabled={disabled}
      onClick={handleRefresh}
      className="te-health-refresh"
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
    <EmptyState
      height="content"
      icon={<CheckCircleIcon stroke={colors.claude.ready} opacity={0.7} />}
      title="Vault healthy"
      body={`${totalRuns}/${totalRuns} checks passing`}
    />
  )
}

// ---------------------------------------------------------------------------
// Unknown state
// ---------------------------------------------------------------------------

function UnknownState() {
  return (
    <div className="te-health-unknown">
      <div className="te-health-unknown-text">Checking vault health...</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Degraded state
// ---------------------------------------------------------------------------

interface IssueGroup {
  readonly severity: string
  readonly label: string
  readonly issues: readonly HealthIssue[]
}

function groupIssuesBySeverity(issues: readonly HealthIssue[]): readonly IssueGroup[] {
  const hard = issues.filter((i) => i.severity === 'hard')
  const integrity = issues.filter((i) => i.severity === 'integrity')
  const groups: IssueGroup[] = []
  if (hard.length > 0) groups.push({ severity: 'hard', label: 'HARD FAILURES', issues: hard })
  if (integrity.length > 0)
    groups.push({ severity: 'integrity', label: 'INTEGRITY', issues: integrity })
  return groups
}

function IssueRow({ issue }: { readonly issue: HealthIssue }) {
  const handleFileClick = useCallback(() => {
    if (!issue.filePath) return
    openNoteInEditor(issue.filePath)
  }, [issue.filePath])

  const fileName = issue.filePath?.split('/').pop() ?? null

  return (
    <div className="health-issue-row te-health-issue">
      <div className="te-health-issue-header">
        <span className="te-health-issue-title">{issue.title}</span>
      </div>
      <div className="te-health-issue-detail">{issue.detail}</div>
      {fileName && (
        <button type="button" onClick={handleFileClick} className="te-health-issue-file">
          {fileName}
        </button>
      )}
    </div>
  )
}

function DegradedState({ issues }: { readonly issues: readonly HealthIssue[] }) {
  const groups = useMemo(() => groupIssuesBySeverity(issues), [issues])

  return (
    <div>
      {groups.map((group) => (
        <div key={group.severity}>
          <SectionLabel as="h3" className="te-health-section-head">
            {group.label}
          </SectionLabel>
          {group.issues.map((issue, i) => (
            <IssueRow key={`${issue.checkId}-${i}`} issue={issue} />
          ))}
        </div>
      ))}
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
  const passingRuns = runs.filter((r) => r.passed).length

  return (
    <div className="te-health-scroll">
      <div className="te-health-container">
        <PanelHeader
          variant="masthead"
          title="Vault Health"
          subtitle={
            lastChecked ? (
              <>
                {status === 'degraded'
                  ? `${issues.length} issue${issues.length !== 1 ? 's' : ''}`
                  : `${passingRuns}/${totalRuns} checks passing`}
                {' \u00B7 last checked '}
                {formatTimeAgo(lastChecked)}
              </>
            ) : undefined
          }
          trailing={<RefreshButton />}
        />

        {/* Body */}
        {status === 'green' && <GreenState totalRuns={totalRuns} />}
        {status === 'degraded' && <DegradedState issues={issues} />}
        {status === 'unknown' && <UnknownState />}
      </div>
    </div>
  )
}
