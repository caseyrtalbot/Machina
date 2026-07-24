import { useRef, useState } from 'react'
import { TE_DIR } from '@shared/constants'
import {
  HARNESS_TASK_BRIEF_MAX_LENGTH,
  validateHarnessTaskBrief,
  type HarnessSummary
} from '@shared/harness-types'
import { floatingPanel } from '../../design/tokens'
import { Modal } from '../../components/overlay/Modal'
import { runHarness } from '../../store/harness-run'
import { useAgentDispatchStore } from '../../store/agent-dispatch-store'
import { useThreadStore } from '../../store/thread-store'

interface HarnessTaskBriefDialogProps {
  readonly summary: HarnessSummary
  readonly onClose: () => void
}

export function HarnessTaskBriefDialog({ summary, onClose }: HarnessTaskBriefDialogProps) {
  const [taskBrief, setTaskBrief] = useState('')
  const [starting, setStarting] = useState(false)
  const [launchRefused, setLaunchRefused] = useState(false)
  const workspacePath = useThreadStore((state) => state.vaultPath)
  const persistedLaunch = useAgentDispatchStore((state) =>
    workspacePath ? state.harnessLaunchByWorkspace[workspacePath]?.[summary.slug] : undefined
  )
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const startingRef = useRef(false)
  const validation = validateHarnessTaskBrief(taskBrief)
  const normalizedCount = taskBrief.trim().length
  const persistedBlock =
    persistedLaunch?.status === 'indeterminate' ||
    (!starting && persistedLaunch?.status === 'starting')
  const launchStatus = launchRefused ? 'refused' : persistedBlock ? 'indeterminate' : null

  async function startRun(): Promise<void> {
    const checked = validateHarnessTaskBrief(taskBrief)
    if (!checked.ok || startingRef.current || launchStatus === 'indeterminate') return
    startingRef.current = true
    setStarting(true)
    setLaunchRefused(false)
    try {
      const status = await runHarness(summary, checked.value)
      if (status !== 'accepted') {
        const dispatch = useAgentDispatchStore.getState()
        if (
          status === 'indeterminate' &&
          workspacePath &&
          dispatch.harnessLaunchByWorkspace[workspacePath]?.[summary.slug] === undefined
        )
          dispatch.setHarnessLaunch(workspacePath, summary.slug, { status: 'indeterminate' })
        setLaunchRefused(status === 'refused')
        setStarting(false)
        startingRef.current = false
        return
      }
      setStarting(false)
      startingRef.current = false
      onClose()
    } catch {
      const dispatch = useAgentDispatchStore.getState()
      if (
        workspacePath &&
        dispatch.harnessLaunchByWorkspace[workspacePath]?.[summary.slug] === undefined
      )
        dispatch.setHarnessLaunch(workspacePath, summary.slug, { status: 'indeterminate' })
      setLaunchRefused(false)
      setStarting(false)
      startingRef.current = false
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      canDismiss={!starting}
      scrimBlur="blur(4px)"
      className="harness-gallery-backdrop"
      ariaLabelledBy="harness-task-title"
      ariaBusy={starting}
      initialFocusRef={textareaRef}
      panelClassName="harness-task-dialog"
      panelStyle={{
        background: floatingPanel.glass.bg,
        backdropFilter: floatingPanel.glass.blur,
        WebkitBackdropFilter: floatingPanel.glass.blur,
        boxShadow: floatingPanel.shadow
      }}
    >
      <header className="harness-gallery-header">
        <div>
          <div className="harness-gallery-eyebrow">Mandatory run context</div>
          <h1 id="harness-task-title" className="harness-gallery-title">
            Brief {summary.name}
          </h1>
          <p className="harness-gallery-lede">
            Give this role one concrete task. Rules and scope remain authoritative.
          </p>
        </div>
        <button
          type="button"
          className="harness-gallery-close"
          aria-label="Close task brief"
          disabled={starting}
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <form
        className="harness-task-body"
        onSubmit={(event) => {
          event.preventDefault()
          void startRun()
        }}
      >
        <section
          className="harness-task-panel harness-task-role-columns"
          aria-labelledby="harness-task-role-heading"
        >
          <div>
            <h2 id="harness-task-role-heading" className="harness-task-panel-heading">
              Selected role
            </h2>
            <strong className="harness-task-role-name">{summary.name}</strong>
            <p className="harness-task-panel-text">{summary.description}</p>
          </div>
          <dl className="harness-task-role-facts">
            <div className="harness-task-role-fact-row">
              <dt className="harness-task-fact-term">Adapter</dt>
              <dd className="harness-task-fact-value">{summary.adapter}</dd>
            </div>
            {summary.budgets !== undefined && (
              <div className="harness-task-role-fact-row">
                <dt className="harness-task-fact-term">Budget</dt>
                <dd className="harness-task-fact-value">
                  {summary.budgets.maxTurns} turns · {summary.budgets.maxWritesPerMinute} writes/min
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="harness-task-panel" aria-labelledby="harness-task-scope-heading">
          <h2 id="harness-task-scope-heading" className="harness-task-panel-heading">
            Declared scope
          </h2>
          <p className="harness-task-scope-boundary">
            These globs guide the agent; they are not a sandbox. Writes reach disk before the
            approvals review.
          </p>
          {summary.scope === undefined ? (
            <p className="harness-task-panel-text">
              The installed contract at{' '}
              <code>
                {TE_DIR}/agents/{summary.slug}/scope.json
              </code>{' '}
              declares allowed and forbidden paths.
            </p>
          ) : (
            <>
              <p className="harness-task-panel-text">{summary.scope.goal}</p>
              <div className="harness-task-scope-row">
                <strong className="harness-task-fact-term">Allowed</strong>
                <code className="harness-task-scope-code">
                  {summary.scope.allowedGlobs.join(', ') || 'No writable paths'}
                </code>
              </div>
              <div className="harness-task-scope-row">
                <strong className="harness-task-fact-term">Forbidden</strong>
                <code className="harness-task-scope-code">
                  {summary.scope.forbiddenGlobs.join(', ')}
                </code>
              </div>
            </>
          )}
        </section>

        <label className="harness-task-field">
          <span className="harness-task-field-label">Task brief · required</span>
          <textarea
            ref={textareaRef}
            className="harness-task-field-textarea"
            aria-label="Task brief"
            aria-describedby="harness-task-validation harness-task-count"
            rows={7}
            value={taskBrief}
            readOnly={starting || launchStatus === 'indeterminate'}
            onChange={(event) => setTaskBrief(event.target.value)}
            placeholder="Name the target, desired outcome, and evidence or validation expected."
          />
        </label>
        <div className="harness-task-validation-row" aria-live="polite">
          <span id="harness-task-validation" data-valid={validation.ok ? 'true' : 'false'}>
            {validation.ok ? 'Task brief ready.' : validation.error}
          </span>
          <span
            id="harness-task-count"
            data-over-limit={normalizedCount > HARNESS_TASK_BRIEF_MAX_LENGTH ? 'true' : 'false'}
          >
            {normalizedCount.toLocaleString()} / {HARNESS_TASK_BRIEF_MAX_LENGTH.toLocaleString()}
          </span>
        </div>

        <div className="harness-task-progress" role="status" aria-live="polite">
          {starting ? 'Starting harness. The task brief will stay here if launch fails.' : ''}
        </div>

        {launchStatus !== null && (
          <div role="alert" className="harness-create-error">
            <strong>
              {launchStatus === 'indeterminate'
                ? 'Launch status is unknown.'
                : 'Run could not start.'}
            </strong>
            <span>
              {launchStatus === 'indeterminate'
                ? 'The original request may still execute. Do not retry this brief. Stop or Kill cannot prove the pending request was cancelled; close this dialog, inspect Threads and the terminal, and wait for settlement.'
                : 'Run did not start. Your task brief is preserved; resolve the reported issue and try again.'}
            </span>
          </div>
        )}

        <div className="harness-task-actions">
          <button
            type="button"
            className="harness-button harness-button-secondary"
            disabled={starting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="harness-button harness-button-primary"
            disabled={!validation.ok || launchStatus === 'indeterminate'}
            aria-disabled={!validation.ok || starting || launchStatus === 'indeterminate'}
          >
            {starting
              ? 'Starting…'
              : launchStatus === 'indeterminate'
                ? 'Do not retry'
                : 'Start harness'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
