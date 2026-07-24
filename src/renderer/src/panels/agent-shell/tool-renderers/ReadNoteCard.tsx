import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ToolCall, ToolResult } from '@shared/thread-types'
import { openNoteInEditor } from '../../../store/dock-store'
import { useVaultStore } from '../../../store/vault-store'
import { copyText, useToolCardMenu } from './useToolCardMenu'
import { ToolCardShell } from './ToolCardShell'

type ReadNoteCall = Extract<ToolCall, { kind: 'read_note' }>

const PREVIEW_OPEN_DELAY_MS = 280
const PREVIEW_CLOSE_DELAY_MS = 80
const PREVIEW_MAX_LINES = 24
const PREVIEW_WIDTH = 360
const PREVIEW_MAX_HEIGHT = 320
const PREVIEW_GUTTER = 6
const VIEWPORT_MARGIN = 12

function extractContent(result: ToolResult | undefined): string | null {
  if (!result || !result.ok) return null
  if (typeof result.output !== 'object' || result.output === null) return null
  const c = (result.output as { content?: unknown }).content
  return typeof c === 'string' ? c : null
}

export function ReadNoteCard({
  call,
  result
}: {
  readonly call: ReadNoteCall
  readonly result?: ToolResult
}) {
  const settled = result !== undefined
  const lines =
    settled && result.ok && typeof result.output === 'object' && result.output !== null
      ? ((result.output as { lines?: string }).lines ?? '')
      : ''
  const content = extractContent(result)
  const { onContextMenu, menu } = useToolCardMenu([
    {
      id: 'copy-path',
      label: 'Copy path',
      onSelect: () => void copyText(call.args.path)
    }
  ])

  function handleClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (!settled) return
    e.preventDefault()
    const vault = useVaultStore.getState().vaultPath
    if (!vault) return
    const fullPath = call.args.path.startsWith('/') ? call.args.path : `${vault}/${call.args.path}`
    openNoteInEditor(fullPath)
  }

  const cardRef = useRef<HTMLDivElement | null>(null)
  const previewEnabled = settled && content !== null
  const { previewVisible, onMouseEnter, onMouseLeave } = useHoverIntent(previewEnabled)

  return (
    <>
      <ToolCardShell
        variant="pill"
        inline
        pending={!settled}
        innerRef={cardRef}
        onContextMenu={onContextMenu}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        className="te-tool-read"
      >
        <div
          role="button"
          tabIndex={settled ? 0 : -1}
          onClick={handleClick}
          onKeyDown={(e) => {
            if (!settled) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleClick(e as unknown as ReactMouseEvent<HTMLDivElement>)
            }
          }}
          className="te-tool-read-body"
        >
          <FileGlyph />
          <span>{call.args.path}</span>
          {!settled ? (
            <span className="te-tool-muted">· reading…</span>
          ) : (
            lines && <span className="te-tool-muted">· {lines}</span>
          )}
        </div>
      </ToolCardShell>
      {menu}
      {previewVisible && content !== null && (
        <ReadNotePreview anchorRef={cardRef} path={call.args.path} content={content} />
      )}
    </>
  )
}

function useHoverIntent(enabled: boolean) {
  const [internalVisible, setInternalVisible] = useState(false)
  const openTimer = useRef<number | null>(null)
  const closeTimer = useRef<number | null>(null)

  function clearTimers() {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  // Cancel pending timers when `enabled` flips. The visible flag itself is
  // gated on `enabled` at the return site, so no setState is needed here —
  // which keeps this effect free of cascading-render risk.
  useEffect(() => {
    if (!enabled) clearTimers()
    return clearTimers
  }, [enabled])

  function onMouseEnter() {
    if (!enabled) return
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    if (internalVisible || openTimer.current !== null) return
    openTimer.current = window.setTimeout(() => {
      openTimer.current = null
      setInternalVisible(true)
    }, PREVIEW_OPEN_DELAY_MS)
  }
  function onMouseLeave() {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (!internalVisible) return
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null
      setInternalVisible(false)
    }, PREVIEW_CLOSE_DELAY_MS)
  }

  return { previewVisible: enabled && internalVisible, onMouseEnter, onMouseLeave }
}

function ReadNotePreview({
  anchorRef,
  path,
  content
}: {
  readonly anchorRef: React.RefObject<HTMLDivElement | null>
  readonly path: string
  readonly content: string
}) {
  const previewRef = useRef<HTMLDivElement | null>(null)

  // Position via direct DOM mutation in useLayoutEffect: reads the anchor +
  // own measured height before paint and writes back top/left/visibility on
  // the portal element. Avoids a setState round-trip in the effect (which
  // the React-hooks lint rule rejects) and removes one render cycle of the
  // off-screen sentinel.
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const preview = previewRef.current
    if (!anchor || !preview) return
    const rect = anchor.getBoundingClientRect()
    const previewHeight = Math.min(
      preview.getBoundingClientRect().height || PREVIEW_MAX_HEIGHT,
      PREVIEW_MAX_HEIGHT
    )
    const vw = window.innerWidth
    const vh = window.innerHeight

    const spaceAbove = rect.top
    const spaceBelow = vh - rect.bottom
    const placeAbove = spaceAbove >= previewHeight + PREVIEW_GUTTER || spaceAbove >= spaceBelow
    const top = placeAbove
      ? Math.max(VIEWPORT_MARGIN, rect.top - previewHeight - PREVIEW_GUTTER)
      : Math.min(vh - previewHeight - VIEWPORT_MARGIN, rect.bottom + PREVIEW_GUTTER)

    let left = rect.left
    if (left + PREVIEW_WIDTH + VIEWPORT_MARGIN > vw) {
      left = vw - PREVIEW_WIDTH - VIEWPORT_MARGIN
    }
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN

    preview.style.top = `${top}px`
    preview.style.left = `${left}px`
    preview.style.visibility = 'visible'
  }, [anchorRef, content])

  const lines = content.length === 0 ? [] : content.split('\n').slice(0, PREVIEW_MAX_LINES)
  const truncated = content.split('\n').length > PREVIEW_MAX_LINES
  const isEmpty = content.trim().length === 0

  return createPortal(
    // top/left/visibility are set imperatively in useLayoutEffect (measured
    // placement); the static surface lives in .te-tool-note-preview.
    <div
      ref={previewRef}
      className="te-popover-enter te-tool-note-preview"
      style={{ top: -9999, left: -9999, visibility: 'hidden' }}
      role="tooltip"
    >
      <div className="te-tool-note-preview-path">{path}</div>
      <div className="te-tool-note-preview-body">
        {isEmpty ? (
          <span className="te-tool-note-preview-empty">(empty file)</span>
        ) : (
          <>
            {lines.join('\n')}
            {truncated && (
              <span className="te-tool-muted">{`\n…(+${
                content.split('\n').length - PREVIEW_MAX_LINES
              } more lines)`}</span>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

function FileGlyph() {
  return (
    <svg
      aria-hidden
      width={11}
      height={13}
      viewBox="0 0 11 13"
      className="te-tool-glyph te-tool-glyph--dim"
    >
      <path
        d="M1 1.5A1 1 0 0 1 2 .5h4.5L10 4v7.5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V1.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
      <path d="M6.5 .5V4H10" fill="none" stroke="currentColor" strokeWidth={1} />
    </svg>
  )
}
