import { typedHandle, typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'
import { ThreadStorage } from '../services/thread-storage'
import type { Thread } from '../../shared/thread-types'

function newThreadId(title: string | undefined): string {
  const date = new Date().toISOString().slice(0, 10)
  const slug =
    (title ?? 'thread')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'thread'
  const suffix = Math.random().toString(36).slice(2, 6)
  return `${date}-${slug}-${suffix}`
}

export function registerThreadIpc(): void {
  typedHandle('thread:list', async ({ vaultPath }) => {
    return new ThreadStorage(vaultPath).listThreads()
  })

  typedHandle('thread:list-archived', async ({ vaultPath }) => {
    return new ThreadStorage(vaultPath).listArchived()
  })

  typedHandle('thread:save', async ({ vaultPath, thread }) => {
    // Persistence-authority cutover (P3 step 4, contracts §4 v1.3.3): the
    // renderer never writes MESSAGES for cli threads — main appends them, so
    // a renderer save is a metadata merge and a stale in-memory messages
    // array can neither double-append nor clobber a main-appended reply.
    // The cli-vs-native branch keys off the ON-DISK agent inside the write
    // queue (never the payload — see saveThreadFromRenderer).
    await new ThreadStorage(vaultPath).saveThreadFromRenderer(thread)
  })

  // Main-owned status-message persistence (P3 step 4, contracts §4 v1.3.3):
  // renderer-minted dispatch-refusal / start-status system messages ride this
  // serialized append instead of thread:save (whose cli meta-merge drops
  // messages by design). Main mints the record — role is 'system' by
  // construction, so the assistant/user exactly-once authority stays intact.
  typedHandle('thread:append-system', async ({ vaultPath, threadId, body }) => {
    const appended = await new ThreadStorage(vaultPath).appendMessage(threadId, {
      role: 'system',
      body,
      sentAt: new Date().toISOString()
    })
    if (appended) {
      const window = getMainWindow()
      if (window) typedSend(window, 'thread:changed', { root: vaultPath, threadId })
    }
    return { ok: appended }
  })

  typedHandle('thread:read', async ({ vaultPath, id }) => {
    try {
      return await new ThreadStorage(vaultPath).readThread(id)
    } catch {
      return null
    }
  })

  typedHandle('thread:create', async ({ vaultPath, agent, model, title }) => {
    const now = new Date().toISOString()
    const t: Thread = {
      id: newThreadId(title),
      agent,
      model,
      started: now,
      lastMessage: now,
      title: title ?? 'New thread',
      // New threads open with the canvas surface so the dock is never blank
      // on first use (onboarding journey, plan item 3.5).
      dockState: { tabs: [{ kind: 'canvas', id: 'default' }] },
      messages: []
    }
    await new ThreadStorage(vaultPath).saveThread(t)
    return t
  })

  typedHandle('thread:archive', async ({ vaultPath, id }) => {
    await new ThreadStorage(vaultPath).archiveThread(id)
  })

  typedHandle('thread:unarchive', async ({ vaultPath, id }) => {
    await new ThreadStorage(vaultPath).unarchiveThread(id)
  })

  typedHandle('thread:delete', async ({ vaultPath, id }) => {
    await new ThreadStorage(vaultPath).deleteThread(id)
  })

  typedHandle('thread:read-config', async ({ vaultPath }) => {
    return new ThreadStorage(vaultPath).readConfig()
  })

  typedHandle('thread:write-config', async ({ vaultPath, config }) => {
    await new ThreadStorage(vaultPath).writeConfig(config)
  })
}
