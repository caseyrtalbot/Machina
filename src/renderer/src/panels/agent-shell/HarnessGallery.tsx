import { useEffect, useRef, useState } from 'react'
import type { HarnessCreateRequest, HarnessSummary, HarnessTemplate } from '@shared/harness-types'
import { colors, floatingPanel, zIndex } from '../../design/tokens'
import { showToast } from '../../components/Toast'
import { notifyError } from '../../utils/error-logger'
import { IpcTimeoutError, withTimeout } from '../../utils/ipc-timeout'
import { useHarnessStore } from '../../store/harness-store'
import { HarnessBuilderForm } from './HarnessBuilderForm'
import { HarnessTemplateCatalog } from './HarnessTemplateCatalog'
import {
  HARNESS_CATALOG,
  seedHarnessBuilderState,
  type HarnessBuilderState
} from './harness-gallery-model'
import './HarnessGallery.css'

interface HarnessGalleryProps {
  readonly open: boolean
  readonly initialTemplateId?: string
  readonly onClose: () => void
  readonly onRequestRun?: (summary: HarnessSummary) => void
}

interface CreatedHarness {
  readonly slug: string
  readonly root: string
  readonly summary: HarnessSummary | null
}

interface CreationError {
  readonly message: string
  readonly uncertain: boolean
}

const HARNESS_CREATE_TIMEOUT_MS = 15_000
const HARNESS_REFRESH_TIMEOUT_MS = 5_000

function initialTemplate(templateId?: string): HarnessTemplate | undefined {
  return templateId === undefined
    ? undefined
    : HARNESS_CATALOG.find((template) => template.id === templateId)
}

export function HarnessGallery({
  open,
  initialTemplateId,
  onClose,
  onRequestRun
}: HarnessGalleryProps) {
  const seededTemplate = initialTemplate(initialTemplateId)
  const [mode, setMode] = useState<'templates' | 'builder'>(() =>
    seededTemplate === undefined ? 'templates' : 'builder'
  )
  const [builder, setBuilder] = useState<HarnessBuilderState>(() =>
    seedHarnessBuilderState(seededTemplate)
  )
  const [creatingSlug, setCreatingSlug] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<CreationError | null>(null)
  const [created, setCreated] = useState<CreatedHarness | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const submittingRef = useRef(false)

  useEffect(() => {
    if (!open) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeButtonRef.current?.focus()

    function onWindowKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape' && !submittingRef.current) {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }

    window.addEventListener('keydown', onWindowKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown, true)
      previouslyFocused?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  function openBuilder(template?: HarnessTemplate): void {
    if (submittingRef.current) return
    setBuilder(seedHarnessBuilderState(template))
    setSubmitError(null)
    setCreated(null)
    setMode('builder')
  }

  async function createHarness(request: HarnessCreateRequest): Promise<void> {
    if (submittingRef.current) return
    submittingRef.current = true
    setCreatingSlug(request.slug)
    setSubmitError(null)
    setCreated(null)
    try {
      const result = await withTimeout(
        window.api.harness.create(request),
        HARNESS_CREATE_TIMEOUT_MS,
        `harness:create ${request.slug}`
      )
      if (!result.ok) {
        setSubmitError({ message: result.error, uncertain: false })
        notifyError(
          'harness-create',
          new Error(result.error),
          `Harness create failed: ${result.error}`
        )
        return
      }
      let summary: HarnessSummary | null = null
      try {
        await withTimeout(
          useHarnessStore.getState().refresh(),
          HARNESS_REFRESH_TIMEOUT_MS,
          `harness:list after ${request.slug}`
        )
        summary =
          useHarnessStore
            .getState()
            .summaries.find((candidate) => candidate.slug === request.slug) ?? null
      } catch (error) {
        notifyError(
          'harness-list',
          error,
          'Harness created, but the installed-agent list did not refresh. Reopen the gallery.'
        )
      }
      setCreated({ slug: request.slug, root: result.root, summary })
      showToast(`Harness created: ${result.root}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setSubmitError({ message, uncertain: error instanceof IpcTimeoutError })
      notifyError('harness-create', error, `Harness create failed: ${message}`)
    } finally {
      submittingRef.current = false
      setCreatingSlug(null)
    }
  }

  function trapFocus(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      ) ?? []
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className="harness-gallery-backdrop"
      style={{ background: colors.scrim.modal, zIndex: zIndex.modal }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !submittingRef.current) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-busy={creatingSlug !== null}
        aria-labelledby="harness-gallery-title"
        className="harness-gallery-dialog"
        style={{
          background: floatingPanel.glass.bg,
          backdropFilter: floatingPanel.glass.blur,
          WebkitBackdropFilter: floatingPanel.glass.blur,
          boxShadow: floatingPanel.shadow
        }}
        onKeyDown={trapFocus}
      >
        <header className="harness-gallery-header">
          <div>
            <div className="harness-gallery-eyebrow">Workspace agents</div>
            <h1 id="harness-gallery-title">Create a local agent</h1>
            <p>Templates are generated locally, linted before creation, and never overwrite.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="harness-gallery-close"
            aria-label="Close agent gallery"
            disabled={creatingSlug !== null}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <nav className="harness-gallery-mode-tabs" aria-label="Harness gallery mode">
          <button
            type="button"
            aria-current={mode === 'templates' ? 'page' : undefined}
            disabled={creatingSlug !== null}
            onClick={() => setMode('templates')}
          >
            Templates
          </button>
          <button
            type="button"
            aria-current={mode === 'builder' ? 'page' : undefined}
            disabled={creatingSlug !== null}
            onClick={() => openBuilder()}
          >
            Build blank
          </button>
        </nav>

        <main className="harness-gallery-body">
          {submitError !== null && (
            <div role="alert" className="harness-create-error">
              <strong>
                {submitError.uncertain ? 'Creation status is unknown.' : 'Harness was not created.'}
              </strong>
              <span>
                {submitError.message}
                {submitError.uncertain
                  ? ' Check installed agents before retrying; main may still finish.'
                  : ''}
              </span>
            </div>
          )}
          {created !== null && (
            <div role="status" className="harness-create-success">
              <div>
                <strong>Created {created.slug}</strong>
                <span>{created.root}</span>
                <small>A concrete task brief is required before this harness can start.</small>
              </div>
              {created.summary !== null && (
                <button
                  type="button"
                  className="harness-button harness-button-primary"
                  onClick={() => {
                    onClose()
                    onRequestRun?.(created.summary as HarnessSummary)
                  }}
                >
                  Set task &amp; run
                </button>
              )}
            </div>
          )}

          {mode === 'templates' ? (
            <HarnessTemplateCatalog
              creatingSlug={creatingSlug}
              onConfigure={openBuilder}
              onCreate={(request) => void createHarness(request)}
            />
          ) : (
            <HarnessBuilderForm
              value={builder}
              submitting={creatingSlug !== null}
              onChange={setBuilder}
              onCreate={(request) => void createHarness(request)}
            />
          )}
        </main>
      </div>
    </div>
  )
}
