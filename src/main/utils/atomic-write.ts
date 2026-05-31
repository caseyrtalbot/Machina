import { writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

/**
 * Crash-safe write: stage content to a temp file, then atomically rename it
 * into place so `path` is never observed half-written. Falls back to a
 * same-directory temp on EXDEV (cross-device rename) so the swap stays atomic.
 *
 * Electron-free and dependency-light so every writer (FileService,
 * ArtifactMaterializer, ThreadStorage, VaultQueryFacade, native tools) can
 * share one durability contract.
 */
export async function atomicWrite(path: string, content: string): Promise<void> {
  const tmpPath = join(tmpdir(), `te-write-${randomUUID()}.tmp`)
  try {
    await writeFile(tmpPath, content, 'utf-8')
    await rename(tmpPath, path)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      const localTmp = path + '.tmp'
      await writeFile(localTmp, content, 'utf-8')
      await rename(localTmp, path)
    } else {
      throw err
    }
  }
}
