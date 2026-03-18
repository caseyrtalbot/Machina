import { useCallback, useEffect, useRef, useState } from 'react'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { useCodeMirrorEditor } from '../canvas/shared/use-codemirror'
import { colors, typography } from '../../design/tokens'

interface ConfigInspectorProps {
  readonly path: string
  readonly title: string
  readonly onClose: () => void
}

export function ConfigInspector({ path, title, onClose }: ConfigInspectorProps) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Escape key closes inspector
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const isJson = path.endsWith('.json')
  const language = isJson ? json() : markdown()

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset when path changes
    setContent(null)
    setError(null)
    setSaveStatus('saved')

    window.api.fs
      .readFile(path)
      .then((text: string) => {
        if (!cancelled) setContent(text)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err))
      })

    return () => {
      cancelled = true
    }
  }, [path])

  const handleChange = useCallback(
    (newContent: string) => {
      setSaveStatus('unsaved')
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        setSaveStatus('saving')
        window.api.fs
          .writeFile(path, newContent)
          .then(() => setSaveStatus('saved'))
          .catch(() => setSaveStatus('unsaved'))
      }, 1000)
    },
    [path]
  )

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  if (error) {
    return (
      <div className="h-full flex flex-col" style={{ backgroundColor: colors.bg.base }}>
        <InspectorHeader title={title} path={path} saveStatus="saved" onClose={onClose} />
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-sm" style={{ color: colors.text.muted }}>
            Failed to load file: {error}
          </p>
        </div>
      </div>
    )
  }

  if (content === null) {
    return (
      <div className="h-full flex flex-col" style={{ backgroundColor: colors.bg.base }}>
        <InspectorHeader title={title} path={path} saveStatus="saved" onClose={onClose} />
        <div className="flex-1 flex items-center justify-center">
          <span className="text-sm" style={{ color: colors.text.muted }}>
            Loading...
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: colors.bg.base }}>
      <InspectorHeader title={title} path={path} saveStatus={saveStatus} onClose={onClose} />
      <div className="flex-1 overflow-hidden">
        <InspectorEditor initialContent={content} language={language} onChange={handleChange} />
      </div>
    </div>
  )
}

function InspectorHeader({
  title,
  path,
  saveStatus,
  onClose
}: {
  readonly title: string
  readonly path: string
  readonly saveStatus: 'saved' | 'saving' | 'unsaved'
  readonly onClose: () => void
}) {
  const fileName = path.split('/').pop() ?? path

  return (
    <div
      className="flex items-center justify-between px-3 py-2 shrink-0"
      style={{
        backgroundColor: colors.bg.elevated,
        borderBottom: `1px solid ${colors.border.default}`
      }}
    >
      <div className="flex flex-col min-w-0">
        <span className="text-sm font-medium truncate" style={{ color: colors.text.primary }}>
          {title}
        </span>
        <span
          className="text-xs truncate"
          style={{ color: colors.text.muted, fontFamily: typography.fontFamily.mono }}
        >
          {fileName}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        <span
          className="text-xs"
          style={{
            color:
              saveStatus === 'saved'
                ? colors.text.muted
                : saveStatus === 'saving'
                  ? '#f59e0b'
                  : colors.text.secondary
          }}
        >
          {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Unsaved'}
        </span>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded hover:opacity-80"
          style={{ color: colors.text.secondary }}
          title="Close inspector (Esc)"
        >
          &times;
        </button>
      </div>
    </div>
  )
}

function InspectorEditor({
  initialContent,
  language,
  onChange
}: {
  readonly initialContent: string
  readonly language: ReturnType<typeof json> | ReturnType<typeof markdown>
  readonly onChange: (content: string) => void
}) {
  const { containerRef } = useCodeMirrorEditor({
    initialContent,
    language,
    onChange
  })

  return <div ref={containerRef} className="h-full" />
}
