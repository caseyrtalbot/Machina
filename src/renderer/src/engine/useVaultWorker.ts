import { useRef, useCallback, useEffect } from 'react'
import type { Artifact, KnowledgeGraph } from '@shared/types'

interface ParseError { filename: string; error: string }

interface WorkerResult {
  artifacts: Artifact[]
  graph: KnowledgeGraph
  errors: ParseError[]
  fileToId: Record<string, string>
}

export function useVaultWorker(onResult: (result: WorkerResult) => void) {
  const workerRef = useRef<Worker | null>(null)
  const onResultRef = useRef(onResult)

  useEffect(() => { onResultRef.current = onResult }, [onResult])

  useEffect(() => {
    const worker = new Worker(
      new URL('./vault-worker.ts', import.meta.url),
      { type: 'module' }
    )
    worker.onmessage = (e: MessageEvent) => onResultRef.current(e.data)
    worker.onerror = (err) => console.error('[VaultWorker] Error:', err)
    workerRef.current = worker
    return () => { worker.terminate(); workerRef.current = null }
  }, [])

  const loadFiles = useCallback((files: Array<{ path: string; content: string }>) => {
    workerRef.current?.postMessage({ type: 'load', files })
  }, [])

  const updateFile = useCallback((path: string, content: string) => {
    workerRef.current?.postMessage({ type: 'update', path, content })
  }, [])

  const removeFile = useCallback((path: string) => {
    workerRef.current?.postMessage({ type: 'remove', path })
  }, [])

  return { loadFiles, updateFile, removeFile }
}
