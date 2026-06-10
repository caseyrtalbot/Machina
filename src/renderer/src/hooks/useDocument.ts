import { useState, useEffect, useCallback, useRef } from 'react'
import { logError, notifyError } from '../utils/error-logger'
import { withTimeout } from '../utils/ipc-timeout'

interface UseDocumentResult {
  /** Current file content (null while loading) */
  readonly content: string | null
  /** Whether the document has unsaved changes */
  readonly isDirty: boolean
  /** Whether an external edit conflicts with unsaved local changes */
  readonly isConflict: boolean
  /** Disk content when a conflict is detected (null if no conflict) */
  readonly diskContent: string | null
  /**
   * Last save failure message, or null. Set when DocumentManager reports a
   * failed autosave/save (full disk, permissions); cleared by the next
   * successful save. While set, the document is dirty and NOT on disk.
   */
  readonly saveError: string | null
  /** Whether the initial load is in progress */
  readonly loading: boolean
  /** Update the document content (triggers autosave in DocumentManager) */
  update: (content: string) => void
  /** Force an immediate save */
  save: () => Promise<void>
  /** Resolve a conflict by keeping local changes or reloading from disk */
  resolveConflict: (keep: 'mine' | 'disk') => Promise<void>
}

/**
 * React hook for managing a document through the main-process DocumentManager.
 *
 * Opens the document on mount, closes on unmount. All file I/O goes through
 * the DocumentManager via IPC. The renderer never touches disk directly.
 *
 * Multiple components can useDocument() for the same path simultaneously.
 * DocumentManager tracks refCount and keeps the document open until all
 * consumers close.
 */
export function useDocument(path: string | null): UseDocumentResult {
  const [content, setContent] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [isConflict, setIsConflict] = useState(false)
  const [diskContent, setDiskContent] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(path))
  const openedPathRef = useRef<string | null>(null)

  // Track previous path to detect changes inline (not in effect)
  const [prevPath, setPrevPath] = useState(path)
  if (prevPath !== path) {
    setPrevPath(path)
    // Always reset state when path changes to prevent old content leaking
    setContent(null)
    setLoading(Boolean(path))
    setIsDirty(false)
    setIsConflict(false)
    setDiskContent(null)
    setSaveError(null)
  }

  // Open document on mount / path change
  useEffect(() => {
    if (!path) return

    let cancelled = false
    setLoading(true) // eslint-disable-line react-hooks/set-state-in-effect -- loading gate before async IPC

    withTimeout(window.api.document.open(path), 5000, `doc:open ${path}`)
      .then((result: { content: string; version: number }) => {
        if (cancelled) return
        openedPathRef.current = path
        setContent(result.content)
        setIsDirty(false)
        setIsConflict(false)
        setDiskContent(null)
        setLoading(false)
      })
      .catch((err) => {
        logError('doc-open', err)
        if (cancelled) return
        setContent(null)
        setLoading(false)
      })

    return () => {
      cancelled = true
      // Close document when path changes or component unmounts
      if (openedPathRef.current) {
        window.api.document.close(openedPathRef.current)
        openedPathRef.current = null
      }
    }
  }, [path])

  // Subscribe to DocumentManager events
  useEffect(() => {
    if (!path) return

    const unsubExternalChange = window.api.on.docExternalChange((data) => {
      if (data.path !== path) return
      setContent(data.content)
      setIsDirty(false)
    })

    const unsubConflict = window.api.on.docConflict((data) => {
      if (data.path !== path) return
      setIsConflict(true)
      setDiskContent(data.diskContent)
    })

    const unsubSaved = window.api.on.docSaved((data) => {
      if (data.path !== path) return
      setIsDirty(false)
      setSaveError(null)
    })

    const unsubSaveFailed = window.api.on.docSaveFailed((data) => {
      if (data.path !== path) return
      // Stay dirty: the content is NOT on disk. Persist the error until a
      // save succeeds, and toast so the user stops trusting autosave.
      setSaveError(data.message)
      notifyError('doc-save', data.message, `Save failed: changes not on disk (${data.message})`)
    })

    return () => {
      unsubExternalChange()
      unsubConflict()
      unsubSaved()
      unsubSaveFailed()
    }
  }, [path])

  const update = useCallback(
    (newContent: string) => {
      if (!path) return
      setContent(newContent)
      setIsDirty(true)
      window.api.document.update(path, newContent)
    },
    [path]
  )

  const save = useCallback(async () => {
    if (!path) return
    await window.api.document.save(path)
    setIsDirty(false)
    setSaveError(null)
  }, [path])

  const resolveConflict = useCallback(
    async (keep: 'mine' | 'disk') => {
      if (!path) return

      if (keep === 'mine') {
        // Force save our version to disk
        await window.api.document.save(path)
      } else {
        // Reload from disk: close and reopen to get fresh content
        await window.api.document.close(path)
        const result = await window.api.document.open(path)
        setContent(result.content)
      }

      setIsConflict(false)
      setDiskContent(null)
      setIsDirty(false)
    },
    [path]
  )

  return {
    content,
    isDirty,
    isConflict,
    diskContent,
    saveError,
    loading,
    update,
    save,
    resolveConflict
  }
}
