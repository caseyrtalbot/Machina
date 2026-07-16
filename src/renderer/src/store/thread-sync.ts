/**
 * thread:changed subscription (P3 step 4, contracts §4/§6 v1.3.3).
 *
 * Main is the persistence authority for CLI-thread MESSAGES: it appends the
 * user message at dispatch and the assistant final at turn end, then pushes
 * thread:changed. This module re-reads the one thread from disk and replaces
 * only `messages` + `lastMessage` in the store — renderer-held metadata
 * (title/model/dockState) is kept, since disk can only be equal or older for
 * those. Lives outside thread-store.ts on purpose (hard 800-line cap).
 */
import { useThreadStore } from './thread-store'

export async function handleThreadChanged(evt: { root: string; threadId: string }): Promise<void> {
  const s = useThreadStore.getState()
  // Foreign-root pushes never enter the active workspace's threadsById; a
  // thread the renderer has not loaded is ignored (disk is truth on reload).
  if (evt.root !== s.vaultPath || s.threadsById[evt.threadId] === undefined) return
  const fresh = await window.api.thread.read(evt.root, evt.threadId)
  // Re-check after the await: a workspace switch mid-read drops the refresh.
  const now = useThreadStore.getState()
  if (fresh === null || now.vaultPath !== evt.root) return
  const current = now.threadsById[evt.threadId]
  if (current === undefined) return
  useThreadStore.setState((st) => ({
    threadsById: {
      ...st.threadsById,
      [evt.threadId]: { ...current, messages: fresh.messages, lastMessage: fresh.lastMessage }
    }
  }))
}

// Module-level guarded subscription (block-store.ts precedent) so plain unit
// tests can import this module without a preload bridge.
if (typeof window !== 'undefined' && window.api?.on?.threadChanged) {
  window.api.on.threadChanged((evt) => void handleThreadChanged(evt))
}
