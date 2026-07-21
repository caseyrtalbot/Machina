import type { HarnessAdapter, HarnessCreateRequest } from '@shared/harness-types'
import { TE_DIR } from '@shared/constants'
import {
  evaluateHarnessBuilder,
  showsRawInvocationField,
  type HarnessBuilderState
} from './harness-gallery-model'
import { harnessUi } from './harness-styles'

interface HarnessBuilderFormProps {
  readonly value: HarnessBuilderState
  readonly submitting: boolean
  readonly onChange: (value: HarnessBuilderState) => void
  readonly onCreate: (request: HarnessCreateRequest) => void
}

export function HarnessBuilderForm({
  value,
  submitting,
  onChange,
  onCreate
}: HarnessBuilderFormProps) {
  const evaluation = evaluateHarnessBuilder(value)

  function update<K extends keyof HarnessBuilderState>(
    field: K,
    next: HarnessBuilderState[K]
  ): void {
    onChange({ ...value, [field]: next })
  }

  const previewDraft = evaluation.preview?.draft

  return (
    <form
      className={harnessUi.builder}
      aria-labelledby="harness-builder-heading"
      onSubmit={(event) => {
        event.preventDefault()
        if (evaluation.request !== null && !evaluation.createDisabled && !submitting) {
          onCreate(evaluation.request)
        }
      }}
    >
      <div className={harnessUi.sectionHeading}>
        <div>
          <h2 id="harness-builder-heading" className={harnessUi.sectionHeadingTitle}>
            {value.templateId === undefined
              ? 'Build a blank harness'
              : `Configure ${value.templateId}`}
          </h2>
          <p className={harnessUi.sectionHeadingLede}>
            The preview below is built by the same shared draft logic used by main.
          </p>
        </div>
      </div>

      <div className={harnessUi.formGrid}>
        <Field label="Slug" error={fieldError(evaluation.errors, 'slug')}>
          <input
            aria-label="Slug"
            className={harnessUi.fieldInput}
            value={value.slug}
            onChange={(event) => update('slug', event.target.value)}
            placeholder="my-local-agent"
          />
        </Field>
        <Field label="Adapter">
          <select
            aria-label="Adapter"
            className={harnessUi.fieldInput}
            value={value.adapter}
            onChange={(event) => update('adapter', event.target.value as HarnessAdapter)}
          >
            <option value="claude">Claude</option>
            <option value="codex">Codex</option>
            <option value="gemini">Gemini</option>
            <option value="raw">Raw command</option>
          </select>
        </Field>
        <Field label="Description" wide error={fieldError(evaluation.errors, 'description')}>
          <input
            aria-label="Description"
            className={harnessUi.fieldInput}
            value={value.description}
            onChange={(event) => update('description', event.target.value)}
            placeholder="What this harness does"
          />
        </Field>
        <Field
          label="Role / operating instructions"
          wide
          error={fieldError(evaluation.errors, 'skillBody')}
        >
          <textarea
            aria-label="Role / operating instructions"
            className={`${harnessUi.fieldInput} ${harnessUi.fieldTextarea}`}
            rows={5}
            value={value.skillBody}
            onChange={(event) => update('skillBody', event.target.value)}
            placeholder="You are responsible for…"
          />
        </Field>
        <Field label="Maximum turns" error={fieldError(evaluation.errors, 'maxTurns')}>
          <input
            aria-label="Maximum turns"
            className={harnessUi.fieldInput}
            inputMode="numeric"
            value={value.maxTurns}
            onChange={(event) => update('maxTurns', event.target.value)}
          />
        </Field>
        <Field
          label="Maximum writes per minute"
          error={fieldError(evaluation.errors, 'maxWritesPerMinute')}
        >
          <input
            aria-label="Maximum writes per minute"
            className={harnessUi.fieldInput}
            inputMode="numeric"
            value={value.maxWritesPerMinute}
            onChange={(event) => update('maxWritesPerMinute', event.target.value)}
          />
        </Field>
        <Field label="Permission mode">
          <output aria-label="Permission mode" className={harnessUi.fixedValue}>
            queue-all-writes · fixed
          </output>
        </Field>
      </div>

      {showsRawInvocationField(value) && (
        <section className={harnessUi.rawWarning} aria-labelledby="harness-raw-heading">
          <h3 id="harness-raw-heading" className={harnessUi.rawWarningTitle}>
            Raw command boundary
          </h3>
          <p className={harnessUi.rawWarningText}>
            This template executes in your shell. Leave <code>{'{prompt}'}</code> unquoted; Thought
            Engine inserts it with safe single quoting. Use one simple command—no pipes,
            redirection, substitutions, or command lists. The command runs with your user
            permissions, and shell writes are already persisted before Thought Engine can queue or
            review them.
          </p>
          <Field
            label="Invocation template"
            error={fieldError(evaluation.errors, 'invocationTemplate')}
          >
            <input
              aria-label="Invocation template"
              className={harnessUi.fieldInput}
              value={value.invocationTemplate}
              onChange={(event) => update('invocationTemplate', event.target.value)}
              placeholder={'tool --prompt {prompt}'}
            />
          </Field>
        </section>
      )}

      <details className={harnessUi.disclosure} open>
        <summary className={harnessUi.disclosureSummary}>Scope contract</summary>
        <div className={harnessUi.formGrid}>
          <Field label="Goal" wide error={fieldError(evaluation.errors, 'goal')}>
            <textarea
              aria-label="Goal"
              className={`${harnessUi.fieldInput} ${harnessUi.fieldTextarea}`}
              rows={3}
              value={value.goal}
              onChange={(event) => update('goal', event.target.value)}
            />
          </Field>
          <Field label="Allowed globs">
            <textarea
              aria-label="Allowed globs"
              className={`${harnessUi.fieldInput} ${harnessUi.fieldTextarea}`}
              rows={4}
              value={value.allowedGlobs}
              onChange={(event) => update('allowedGlobs', event.target.value)}
              placeholder="src/**"
            />
          </Field>
          <Field label="Forbidden globs">
            <textarea
              aria-label="Forbidden globs"
              className={`${harnessUi.fieldInput} ${harnessUi.fieldTextarea}`}
              rows={4}
              value={value.forbiddenGlobs}
              onChange={(event) => update('forbiddenGlobs', event.target.value)}
              placeholder="secrets/**"
            />
          </Field>
          <Field label="Acceptance" wide error={fieldError(evaluation.errors, 'acceptance')}>
            <textarea
              aria-label="Acceptance"
              className={`${harnessUi.fieldInput} ${harnessUi.fieldTextarea}`}
              rows={3}
              value={value.acceptance}
              onChange={(event) => update('acceptance', event.target.value)}
            />
          </Field>
          <Field label="Rollback" wide error={fieldError(evaluation.errors, 'rollback')}>
            <textarea
              aria-label="Rollback"
              className={`${harnessUi.fieldInput} ${harnessUi.fieldTextarea}`}
              rows={3}
              value={value.rollback}
              onChange={(event) => update('rollback', event.target.value)}
            />
          </Field>
        </div>
      </details>

      <details className={harnessUi.disclosure} open>
        <summary className={harnessUi.disclosureSummary}>Rules and verification</summary>
        <div className={harnessUi.formGrid}>
          <Field label="Rules" wide error={fieldError(evaluation.errors, 'rules')}>
            <textarea
              aria-label="Rules"
              className={`${harnessUi.fieldInput} ${harnessUi.fieldTextarea}`}
              rows={6}
              value={value.rules}
              onChange={(event) => update('rules', event.target.value)}
              placeholder="[SCOPE] Only edit allowed globs."
            />
          </Field>
          <Field
            label="Verifier command"
            wide
            error={fieldError(evaluation.errors, 'verifyCommand')}
          >
            <input
              aria-label="Verifier command"
              className={harnessUi.fieldInput}
              value={value.verifyCommand}
              onChange={(event) => update('verifyCommand', event.target.value)}
              placeholder="npm test -- --runInBand"
            />
            <div className={harnessUi.shellWarning} role="note">
              Arbitrary shell warning: this command runs with your user permissions. Use only a
              deterministic command you trust.
            </div>
          </Field>
        </div>
      </details>

      <section
        className={harnessUi.diagnostics}
        aria-live="polite"
        aria-label="Harness diagnostics"
      >
        <h3 className={harnessUi.diagnosticsTitle}>Live diagnostics</h3>
        {evaluation.errors.length === 0 && evaluation.warnings.length === 0 ? (
          <p className={harnessUi.diagnosticOk}>Draft is ready to create.</p>
        ) : (
          <ul className={harnessUi.diagnosticsList}>
            {evaluation.errors.map((diagnostic) => (
              <li
                key={`${diagnostic.code}-${diagnostic.message}`}
                className={harnessUi.diagnosticsItem}
                data-severity="error"
              >
                Error · {diagnostic.message}
              </li>
            ))}
            {evaluation.warnings.map((diagnostic) => (
              <li
                key={`${diagnostic.code}-${diagnostic.message}`}
                className={harnessUi.diagnosticsItem}
                data-severity="warning"
              >
                Warning · {diagnostic.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      {previewDraft !== undefined && (
        <details className={harnessUi.disclosure} open>
          <summary className={harnessUi.disclosureSummary}>
            Exact draft preview · {TE_DIR}/agents/{previewDraft.slug}
          </summary>
          <dl className={harnessUi.factList}>
            <div className={harnessUi.factRow}>
              <dt className={harnessUi.factTerm}>Adapter</dt>
              <dd className={harnessUi.factValue}>{previewDraft.adapter}</dd>
            </div>
            <div className={harnessUi.factRow}>
              <dt className={harnessUi.factTerm}>Budget</dt>
              <dd className={harnessUi.factValue}>
                {previewDraft.budgets.maxTurns} turns · {previewDraft.budgets.maxWritesPerMinute}{' '}
                writes/min
              </dd>
            </div>
          </dl>
          <pre className={harnessUi.pre} data-testid="harness-scope-preview">
            {JSON.stringify(previewDraft.scope, null, 2)}
          </pre>
        </details>
      )}

      <div className={harnessUi.builderActions}>
        <span>
          {evaluation.errors.length} errors · {evaluation.warnings.length} warnings
        </span>
        <button
          type="submit"
          className={`${harnessUi.button} ${harnessUi.buttonPrimary}`}
          disabled={submitting || evaluation.createDisabled}
        >
          {submitting ? 'Creating…' : 'Create local harness'}
        </button>
      </div>
    </form>
  )
}

function fieldError(
  errors: ReturnType<typeof evaluateHarnessBuilder>['errors'],
  field: string
): string | undefined {
  return errors.find((error) => error.field === field)?.message
}

function Field({
  label,
  error,
  wide = false,
  children
}: {
  readonly label: string
  readonly error?: string
  readonly wide?: boolean
  readonly children: React.ReactNode
}) {
  return (
    <label className={wide ? `${harnessUi.field} ${harnessUi.fieldWide}` : harnessUi.field}>
      <span className={harnessUi.fieldLabel}>{label}</span>
      {children}
      {error !== undefined && <small className={harnessUi.fieldError}>{error}</small>}
    </label>
  )
}
