import { typedHandle } from '../typed-ipc'
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

  typedHandle('thread:read', async ({ vaultPath, id }) => {
    return new ThreadStorage(vaultPath).readThread(id)
  })

  typedHandle('thread:save', async ({ vaultPath, thread }) => {
    await new ThreadStorage(vaultPath).saveThread(thread)
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
      dockState: { tabs: [] },
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
