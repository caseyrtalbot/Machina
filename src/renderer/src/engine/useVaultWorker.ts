import { useRef, useCallback, useEffect } from 'react'
import { registerSearchWorker, deliverSearchResults } from './vault-search'
import type { WorkerResult } from './types'
import type { VaultIndexEntry } from '@shared/index-delta'

interface VaultWorkerActions {
  loadEntries: (entries: VaultIndexEntry[]) => void
  appendEntries: (entries: VaultIndexEntry[]) => void
  /** Apply one parsed watcher delta (upserts + removes) in a single worker message — one graph rebuild. */
  applyDelta: (upserts: VaultIndexEntry[], removes: string[]) => void
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

  const loadEntries = useCallback((entries: VaultIndexEntry[]) => {
    workerRef.current?.postMessage({ type: 'load', entries })
  }, [])

  const appendEntries = useCallback((entries: VaultIndexEntry[]) => {
    workerRef.current?.postMessage({ type: 'append', entries })
  }, [])

  const applyDelta = useCallback((upserts: VaultIndexEntry[], removes: string[]) => {
    workerRef.current?.postMessage({ type: 'apply-delta', upserts, removes })
  }, [])

  return { loadEntries, appendEntries, applyDelta }
}
