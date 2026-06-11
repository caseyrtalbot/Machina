import { useCallback } from 'react'
import { useVaultStore } from '@renderer/store/vault-store'
import { useThreadStore } from '@renderer/store/thread-store'
import { useEnrichmentRunStore } from '@renderer/store/enrichment-run-store'
import { floatingPanel, typography } from '@renderer/design/tokens'
import { DEFAULT_NATIVE_MODEL } from '@shared/machina-native-tools'
import {
  MAX_ENRICHMENT_TARGETS,
  buildEnrichmentPrompt,
  selectEnrichmentTargets
} from './enrichment-targets'

type EnrichPhase = 'idle' | 'starting' | 'running' | 'stopped' | 'done'

/**
 * Graph enrichment pill (3.9): one-click agent pass over unconnected files.
 * Runs on the native-agent lane so every write carries PathGuard, per-write
 * HITL approval, write-velocity limiting, and audit logging. Creates a fresh
 * native thread (approvals render in its thread panel), keeps the graph dock
 * tab open in that thread, and mirrors run progress here via the thread's
 * in-flight flag. Run state lives in useEnrichmentRunStore — creating the
 * thread switches the active thread and remounts this component, so local
 * state would not survive the run it started.
 */
export function EnrichmentPill({ rawFileCount }: { readonly rawFileCount: number }) {
  const threadId = useEnrichmentRunStore((s) => s.threadId)
  const batchSize = useEnrichmentRunStore((s) => s.batchSize)
  const starting = useEnrichmentRunStore((s) => s.starting)
  const stoppedAtLimit = useEnrichmentRunStore((s) => s.stoppedAtLimit)
  const inFlight = useThreadStore((s) =>
    threadId !== null ? (s.inFlightByThreadId[threadId] ?? false) : false
  )

  const phase: EnrichPhase = starting
    ? 'starting'
    : threadId === null
      ? 'idle'
      : inFlight
        ? 'running'
        : stoppedAtLimit
          ? 'stopped'
          : 'done'

  const handleEnrich = useCallback(async () => {
    // Re-derive phase from the stores: a stale closure (or a second pill
    // instance after a remount) must never start a concurrent run.
    const run = useEnrichmentRunStore.getState()
    if (run.starting) return
    if (
      run.threadId !== null &&
      (useThreadStore.getState().inFlightByThreadId[run.threadId] ?? false)
    )
      return
    const { artifacts, artifactPathById, vaultPath } = useVaultStore.getState()
    if (!vaultPath) return
    const targets = selectEnrichmentTargets(artifacts, artifactPathById, vaultPath).slice(
      0,
      MAX_ENRICHMENT_TARGETS
    )
    if (targets.length === 0) return
    run.beginStart()
    try {
      const thread = await useThreadStore
        .getState()
        .createThread('machina-native', DEFAULT_NATIVE_MODEL, 'Enrich vault')
      // Keep the graph on screen in the new thread's dock so this pill keeps
      // reporting progress while write approvals land in the thread panel.
      useThreadStore.getState().openOrFocusDockTab({ kind: 'graph' })
      useEnrichmentRunStore.getState().bindThread(thread.id, targets.length)
      await useThreadStore.getState().appendUserMessage(buildEnrichmentPrompt(targets))
    } finally {
      useEnrichmentRunStore.getState().endStart()
    }
  }, [])

  const busy = phase === 'starting' || phase === 'running'
  const status =
    phase === 'running' || phase === 'starting'
      ? `Enriching ${batchSize > 0 ? batchSize : ''} file${batchSize === 1 ? '' : 's'} — approve writes in the thread`
      : phase === 'stopped'
        ? 'Run hit its tool budget mid-batch — enrich again to finish'
        : phase === 'done'
          ? 'Enrichment pass finished — review the thread'
          : `${rawFileCount} file${rawFileCount !== 1 ? 's' : ''} still need metadata`

  return (
    <div className="absolute inset-0 flex items-end justify-center z-10 pointer-events-none pb-14">
      <div
        className="flex items-center gap-2 px-4 py-2 pointer-events-auto"
        style={{
          backgroundColor: floatingPanel.glass.bg,
          backdropFilter: floatingPanel.glass.blur,
          border: '1px solid color-mix(in srgb, var(--canvas-link-cyan) 18%, transparent)',
          boxShadow: floatingPanel.shadowCompact
        }}
      >
        <span
          className="text-[10px] uppercase tracking-[0.16em]"
          style={{
            color: 'color-mix(in srgb, var(--canvas-link-cyan) 82%, transparent)',
            fontFamily: typography.fontFamily.mono
          }}
        >
          Enrichment
        </span>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: 0.25 }}>
          |
        </span>
        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {status}
        </span>
        {!busy && rawFileCount > 0 && (
          <button
            type="button"
            onClick={() => void handleEnrich()}
            className="text-xs px-3 py-1 transition-all cursor-pointer"
            style={{
              backgroundColor: 'var(--color-accent-default)',
              border: '1px solid var(--color-accent-default)',
              color: 'var(--color-accent-fg)'
            }}
            title={`Run the in-app agent over up to ${MAX_ENRICHMENT_TARGETS} unconnected files. Every write asks for your approval.`}
          >
            {phase === 'idle' ? 'Enrich vault' : 'Enrich again'}
          </button>
        )}
      </div>
    </div>
  )
}
