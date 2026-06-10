/**
 * DocumentManager conflict-resolution and rename re-keying.
 *
 * - Resolving a conflict with "reload from disk" (close → open) must not
 *   flush the stale local content over the external change.
 * - rename() must re-key open documents so autosaves target the new path
 *   instead of resurrecting the old file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentManager } from '../document-manager'

function flushAsyncWork(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve())
}

const path = '/vault/note.md'

const createFs = () => ({
  readFile: vi.fn().mockResolvedValue('# Note'),
  getFileMtime: vi.fn().mockResolvedValue('2026-06-01T00:00:00.000Z'),
  writeFile: vi.fn().mockResolvedValue(undefined)
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('conflict resolution', () => {
  it("resolve 'disk' (close → open) leaves the disk content untouched and reloads it", async () => {
    const fs = createFs()
    const manager = new DocumentManager(fs as never)
    const events: string[] = []
    manager.onEvent((e) => events.push(e.type))

    await manager.open(path)
    manager.update(path, '# Mine (unsaved)')

    // External change lands while we're dirty → conflict
    fs.getFileMtime.mockResolvedValue('2026-06-01T00:01:00.000Z')
    fs.readFile.mockResolvedValue('# Theirs (external)')
    await manager.handleExternalChange(path)
    expect(events).toContain('conflict')

    // Reload from disk: close must NOT flush our dirty content over theirs
    await manager.close(path)
    expect(fs.writeFile).not.toHaveBeenCalled()

    const reopened = await manager.open(path)
    expect(reopened.content).toBe('# Theirs (external)')
  })

  it("conflicted close also cancels the pending autosave so it can't fire post-close", async () => {
    const fs = createFs()
    const manager = new DocumentManager(fs as never)

    await manager.open(path)
    manager.update(path, '# Mine')

    fs.getFileMtime.mockResolvedValue('2026-06-01T00:01:00.000Z')
    fs.readFile.mockResolvedValue('# Theirs')
    await manager.handleExternalChange(path)
    await manager.close(path)

    await vi.advanceTimersByTimeAsync(2000)
    await flushAsyncWork()
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it("resolve 'mine' (save) writes local content and clears the conflict for later closes", async () => {
    const fs = createFs()
    const manager = new DocumentManager(fs as never)

    await manager.open(path)
    manager.update(path, '# Mine')

    fs.getFileMtime.mockResolvedValue('2026-06-01T00:01:00.000Z')
    fs.readFile.mockResolvedValue('# Theirs')
    await manager.handleExternalChange(path)

    await manager.save(path)
    expect(fs.writeFile).toHaveBeenCalledWith(path, '# Mine')

    // Conflict resolved: a later dirty close flushes normally again
    manager.update(path, '# Mine v2')
    await manager.close(path)
    expect(fs.writeFile).toHaveBeenCalledWith(path, '# Mine v2')
  })
})

describe('rename re-keying', () => {
  it('re-keys an open dirty document so the autosave writes to the new path', async () => {
    const fs = createFs()
    const manager = new DocumentManager(fs as never)
    const newPath = '/vault/renamed.md'

    await manager.open(path)
    manager.update(path, '# Edited')
    manager.rename(path, newPath)

    expect(manager.getContent(path)).toBeNull()
    expect(manager.getContent(newPath)?.content).toBe('# Edited')

    await vi.advanceTimersByTimeAsync(1000)
    await flushAsyncWork()

    expect(fs.writeFile).toHaveBeenCalledTimes(1)
    expect(fs.writeFile).toHaveBeenCalledWith(newPath, '# Edited')
  })

  it('re-keys open documents under a renamed folder', async () => {
    const fs = createFs()
    const manager = new DocumentManager(fs as never)
    const child = '/vault/folder/nested/note.md'

    await manager.open(child)
    manager.rename('/vault/folder', '/vault/moved')

    expect(manager.getContent(child)).toBeNull()
    expect(manager.getContent('/vault/moved/nested/note.md')).not.toBeNull()
  })

  it('leaves unrelated documents alone', async () => {
    const fs = createFs()
    const manager = new DocumentManager(fs as never)
    const other = '/vault/folderish.md'

    await manager.open(other)
    manager.rename('/vault/folder', '/vault/moved')

    expect(manager.getContent(other)).not.toBeNull()
  })
})
