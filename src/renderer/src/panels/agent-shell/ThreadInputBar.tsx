import { useState, useRef, useLayoutEffect } from 'react'
import type { KeyboardEvent } from 'react'
import { useThreadStore } from '../../store/thread-store'
import { threadStartIsBlocked, useAgentDispatchStore } from '../../store/agent-dispatch-store'
import { AgentPicker } from './AgentPicker'
import type { AgentIdentity } from '@shared/agent-identity'
import type { Thread } from '@shared/thread-types'
import type { AdapterId, AgentAdapter } from '@shared/session-types'
import { ADAPTERS, identityForAdapter } from '@shared/agent-adapters'
import { DEFAULT_NATIVE_MODEL, NATIVE_MODEL_OPTIONS } from '@shared/machina-native-tools'
import { formatModelLabel } from '@shared/format-model-label'
import { borderRadius, colors, transitions, typography } from '../../design/tokens'
import { useHarnessBinding } from './use-harness-binding'

const MIN_INPUT_HEIGHT = 22
const MAX_INPUT_HEIGHT = 200

/** Honest copy for ad-hoc raw threads. Bound raw harnesses have a validated
 * invocation template and may use the structured send path. */
const AD_HOC_RAW_INPUT_COPY =
  'No structured view for ad-hoc raw sessions. Interact via the terminal.'
const RAW_BINDING_PENDING_COPY = 'Checking the main-owned raw harness binding…'
const RAW_BINDING_UNAVAILABLE_COPY =
  'Unable to verify the raw harness binding. Switch threads and return to retry.'
const RAW_INVOCATION_NOT_READY_COPY =
  'Raw harness input is not ready. Configure a valid invocation template, then reopen it.'
const SESSION_STARTING_COPY = 'Starting the agent session…'
const SESSION_START_UNKNOWN_COPY =
  'Session start status is unknown. Wait for it to settle before sending.'

/** Reverse of identityForAdapter: the registry adapter behind a CLI thread
 * identity; null for 'machina-native' (no adapter runs the native agent). */
function cliAdapterFor(agent: AgentIdentity): AgentAdapter | null {
  const id = (Object.keys(ADAPTERS) as readonly AdapterId[]).find(
    (a) => identityForAdapter(a) === agent
  )
  return id === undefined ? null : ADAPTERS[id]
}

interface ModelChoices {
  readonly value: string
  readonly choices: ReadonlyArray<{ readonly value: string; readonly label: string }>
}

/**
 * Model-picker contents per thread kind. Native threads keep the fixed
 * NATIVE_MODEL_OPTIONS. CLI threads offer the adapter's spike-verified roster
 * behind a 'default' entry: the persisted DEFAULT_NATIVE_MODEL filler (and
 * any off-roster value) displays as 'default' because the main-side trust
 * rule runs the adapter default for it — showing the filler's own name would
 * lie about the model actually used. Adapters with an empty/absent roster
 * (gemini — no auth to verify ids; raw — no model concept) get no picker.
 */
function modelChoicesFor(thread: Thread): ModelChoices | null {
  if (thread.agent === 'machina-native') {
    const known = (NATIVE_MODEL_OPTIONS as readonly string[]).includes(thread.model)
    return {
      value: thread.model,
      choices: [
        ...(known ? [] : [{ value: thread.model, label: formatModelLabel(thread.model) }]),
        ...NATIVE_MODEL_OPTIONS.map((m) => ({ value: m, label: formatModelLabel(m) }))
      ]
    }
  }
  const models = cliAdapterFor(thread.agent)?.models ?? []
  if (models.length === 0) return null
  const explicit = (models as readonly string[]).includes(thread.model)
  return {
    value: explicit ? thread.model : DEFAULT_NATIVE_MODEL,
    choices: [
      // Picking 'default' persists the filler, which the IPC boundary maps
      // to "no flag, adapter default" — the supported revert path.
      { value: DEFAULT_NATIVE_MODEL, label: 'default' },
      // CLI rosters are the aliases/ids the user would type at the CLI
      // (fable, gpt-5.5) — shown verbatim, not through formatModelLabel.
      ...models.map((m) => ({ value: m, label: m }))
    ]
  }
}

export function ThreadInputBar() {
  const activeId = useThreadStore((s) => s.activeThreadId)
  const appendUser = useThreadStore((s) => s.appendUserMessage)
  const createThread = useThreadStore((s) => s.createThread)
  const cancelActive = useThreadStore((s) => s.cancelActive)
  const setThreadModel = useThreadStore((s) => s.setThreadModel)
  const activeThread = useThreadStore((s) =>
    s.activeThreadId ? s.threadsById[s.activeThreadId] : undefined
  )
  const inFlight = useThreadStore((s) =>
    activeId ? Boolean(s.inFlightByThreadId[activeId]) : false
  )
  const threadStart = useAgentDispatchStore((state) =>
    activeId ? state.threadStartById[activeId] : undefined
  )
  const [text, setText] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  // Step 8 gives MAIN-bound raw threads a validated invocation template.
  // Persisted agentId is display-only, so it can invalidate this read but can
  // never enable input by itself.
  const isRaw = activeThread?.agent === 'cli-raw'
  const rawBinding = useHarnessBinding(isRaw ? activeThread?.id : undefined, activeThread?.agentId)
  const hasMatchingRawBinding =
    isRaw &&
    rawBinding.status === 'bound' &&
    rawBinding.binding.slug === activeThread.agentId &&
    rawBinding.binding.adapter === 'raw' &&
    rawBinding.binding.rawInvocationReady
  const isRawInputDisabled = isRaw && !hasMatchingRawBinding
  const isSessionStartBlocked = threadStartIsBlocked(threadStart)
  const rawInputCopy =
    rawBinding.status === 'loading'
      ? RAW_BINDING_PENDING_COPY
      : rawBinding.status === 'unavailable'
        ? RAW_BINDING_UNAVAILABLE_COPY
        : rawBinding.status === 'bound' &&
            (rawBinding.binding.adapter !== 'raw' || !rawBinding.binding.rawInvocationReady)
          ? RAW_INVOCATION_NOT_READY_COPY
          : AD_HOC_RAW_INPUT_COPY
  const modelChoices = activeThread !== undefined ? modelChoicesFor(activeThread) : null

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const next = Math.min(MAX_INPUT_HEIGHT, Math.max(MIN_INPUT_HEIGHT, el.scrollHeight))
    el.style.height = `${next}px`
  }, [text])

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Belt-and-braces with the disabled textarea: ad-hoc raw never sends.
    if (isRawInputDisabled || isSessionStartBlocked) return
    if (text === '' && e.key === '/') {
      e.preventDefault()
      setPickerOpen(true)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // One run per thread: ignore sends while a turn is in flight (Stop first).
      if (inFlight) return
      if (text.trim().length === 0) return
      void appendUser(text)
      setText('')
    }
  }

  async function pickAgent(a: AgentIdentity) {
    setPickerOpen(false)
    await createThread(a, DEFAULT_NATIVE_MODEL)
    ref.current?.focus()
  }

  return (
    <div
      style={{
        position: 'relative',
        background: colors.bg.base
      }}
    >
      {pickerOpen && <AgentPicker onPick={pickAgent} onCancel={() => setPickerOpen(false)} />}
      <div
        className="thread-input-box"
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 8,
          padding: '12px 20px 16px',
          background: colors.bg.base,
          borderTop: `1px solid ${colors.border.subtle}`,
          transition: `background ${transitions.fast}, border-color ${transitions.fast}`
        }}
      >
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            color: colors.text.muted,
            fontFamily: typography.fontFamily.mono,
            fontSize: 13,
            lineHeight: '22px',
            userSelect: 'none'
          }}
        >
          ›
        </span>
        <textarea
          ref={ref}
          value={text}
          rows={1}
          disabled={isRawInputDisabled || isSessionStartBlocked}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={
            isSessionStartBlocked
              ? threadStart === 'starting'
                ? SESSION_STARTING_COPY
                : SESSION_START_UNKNOWN_COPY
              : isRawInputDisabled
                ? rawInputCopy
                : 'Ask anything about your vault…'
          }
          className="thread-input-textarea"
          style={{
            flex: 1,
            resize: 'none',
            minHeight: MIN_INPUT_HEIGHT,
            maxHeight: MAX_INPUT_HEIGHT,
            background: 'transparent',
            color: colors.text.primary,
            border: 'none',
            outline: 'none',
            padding: 0,
            fontFamily: typography.fontFamily.body,
            fontSize: 14,
            lineHeight: 1.55
          }}
        />
        {modelChoices !== null && activeId && (
          <select
            data-testid="thread-model-select"
            aria-label="Model"
            title="Model for this thread's next turn"
            value={modelChoices.value}
            disabled={inFlight || isSessionStartBlocked}
            onChange={(e) => void setThreadModel(activeId, e.target.value)}
            style={{
              flexShrink: 0,
              appearance: 'none',
              WebkitAppearance: 'none',
              padding: '3px 8px',
              background: 'transparent',
              border: `1px solid ${colors.border.subtle}`,
              borderRadius: borderRadius.inline,
              color: colors.text.muted,
              cursor: inFlight ? 'default' : 'pointer',
              fontFamily: typography.fontFamily.mono,
              fontSize: 10,
              letterSpacing: '0.04em',
              lineHeight: '16px'
            }}
          >
            {modelChoices.choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        )}
        {inFlight && activeId ? (
          <button
            type="button"
            data-testid="thread-input-stop"
            aria-label="Stop"
            title="Request stop; sending stays blocked until the run settles"
            onClick={() => void cancelActive(activeId)}
            style={{
              flexShrink: 0,
              padding: '4px 10px',
              background: 'transparent',
              border: `1px solid ${colors.border.default}`,
              borderRadius: borderRadius.inline,
              color: colors.text.secondary,
              cursor: 'pointer',
              fontFamily: typography.fontFamily.mono,
              fontSize: typography.metadata.size,
              letterSpacing: typography.metadata.letterSpacing,
              textTransform: typography.metadata.textTransform,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                background: colors.claude.error,
                borderRadius: borderRadius.round
              }}
            />
            Stop
          </button>
        ) : (
          <KeyHint visible={!focused && text.length === 0} />
        )}
      </div>
    </div>
  )
}

function KeyHint({ visible }: { readonly visible: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        opacity: visible ? 1 : 0,
        transition: `opacity ${transitions.fast}`,
        fontFamily: typography.fontFamily.mono,
        fontSize: 10,
        letterSpacing: '0.08em',
        color: colors.text.disabled,
        lineHeight: '22px',
        userSelect: 'none'
      }}
    >
      <Kbd>⌘K</Kbd>
      <span style={{ color: colors.text.disabled }}>·</span>
      <Kbd>/</Kbd>
    </span>
  )
}

function Kbd({ children }: { readonly children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 16,
        height: 16,
        padding: '0 4px',
        border: `1px solid ${colors.border.subtle}`,
        borderRadius: borderRadius.inline,
        fontFamily: typography.fontFamily.mono,
        fontSize: 10,
        color: colors.text.muted,
        background: 'transparent'
      }}
    >
      {children}
    </span>
  )
}
