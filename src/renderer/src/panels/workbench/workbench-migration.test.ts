import { describe, expect, it, vi } from 'vitest'
import { migrateWorkbenchFile, type WorkbenchFs } from './workbench-migration'

function createMockFs(files: Record<string, boolean>): WorkbenchFs & {
  readonly renames: Array<{ oldPath: string; newPath: string }>
} {
  const renames: Array<{ oldPath: string; newPath: string }> = []
  return {
    renames,
    fileExists: vi.fn(async (path: string) => files[path] ?? false),
    renameFile: vi.fn(async (oldPath: string, newPath: string) => {
      renames.push({ oldPath, newPath })
    })
  }
}

const PROJECT = '/Users/test/project'
const NEW_FILE = `${PROJECT}/.machina-workbench.json`
const LEGACY_FILE = `${PROJECT}/.thought-engine-workbench.json`

describe('migrateWorkbenchFile', () => {
  it('renames legacy file when new file does not exist', async () => {
    const fs = createMockFs({ [LEGACY_FILE]: true, [NEW_FILE]: false })

    await migrateWorkbenchFile(PROJECT, fs)

    expect(fs.renames).toEqual([{ oldPath: LEGACY_FILE, newPath: NEW_FILE }])
  })

  it('does nothing when new file already exists', async () => {
    const fs = createMockFs({ [NEW_FILE]: true, [LEGACY_FILE]: true })

    await migrateWorkbenchFile(PROJECT, fs)

    expect(fs.renames).toEqual([])
  })

  it('does nothing when neither file exists', async () => {
    const fs = createMockFs({})

    await migrateWorkbenchFile(PROJECT, fs)

    expect(fs.renames).toEqual([])
    expect(fs.fileExists).toHaveBeenCalledTimes(2)
  })

  it('does nothing when only new file exists', async () => {
    const fs = createMockFs({ [NEW_FILE]: true })

    await migrateWorkbenchFile(PROJECT, fs)

    expect(fs.renames).toEqual([])
    // Short-circuits after first check
    expect(fs.fileExists).toHaveBeenCalledTimes(1)
  })
})
