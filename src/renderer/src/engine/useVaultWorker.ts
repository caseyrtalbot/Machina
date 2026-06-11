import { useRef, useCallback, useEffect } from 'react'
import { registerSearchWorker, deliverSearchResults } from './vault-search'
import type { WorkerResult } from './types'

interface VaultWorkerActions {
  loadFiles: (files: Array<{ path: string; content: string }>) => void
  appendFiles: (files: Array<{ path: string; content: string }>) => void
  /** Apply one watcher batch (updates + removes) in a single worker message — one graph rebuild. */
  updateMany: (updates: Array<{ path: string; content: string }>, removes: string[]) => void
}

export function useVaultWorker(onResult: (result: WorkerResult) => void): VaultWorkerActions {
  const workerRef = useRef<Worker | null>(null)
  const onResultRef = useRef(onResult)

  useEffect(() => {
    onResultRef.current = onResult
  }, [onResult])

  useEffect(() => {
    const worker = new Worker(new URL('./vault-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      // Search responses go to the vault-search client; everything else is a
      // WorkerResult destined for vault-store.
      if (e.data?.type === 'search-results') {
        deliverSearchResults(e.data)
        return
      }
      onResultRef.current(e.data)
    }
    worker.onerror = (err) => console.error('[VaultWorker] Error:', err)
    workerRef.current = worker
    registerSearchWorker(worker)
    return () => {
      registerSearchWorker(null)
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const loadFiles = useCallback((files: Array<{ path: string; content: string }>) => {
    workerRef.current?.postMessage({ type: 'load', files })
  }, [])

  const appendFiles = useCallback((files: Array<{ path: string; content: string }>) => {
    workerRef.current?.postMessage({ type: 'append', files })
  }, [])

  const updateMany = useCallback(
    (updates: Array<{ path: string; content: string }>, removes: string[]) => {
      workerRef.current?.postMessage({ type: 'update-many', updates, removes })
    },
    []
  )

  return { loadFiles, appendFiles, updateMany }
}
