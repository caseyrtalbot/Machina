import { useEffect } from 'react'
import { useBlockStore } from '../store/block-store'

/**
 * Bridge `block:update` IPC events into the renderer block-store.
 * Mount once at app boot.
 */
export function useBlockUpdates(): void {
  useEffect(() => {
    const unsubscribe = window.api.on.blockUpdate(({ sessionId, block }) => {
      useBlockStore.getState().applyUpdate(sessionId, block)
    })
    return unsubscribe
  }, [])
}
