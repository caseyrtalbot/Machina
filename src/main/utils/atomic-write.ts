import { open, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

/**
 * Crash-safe write: stage content to a temp file, fsync it, then atomically
 * rename it into place so `path` is never observed half-written. After the
 * rename, the destination's parent directory is fsynced (best-effort) so the
 * directory entry itself survives a power loss. The temp file is unlinked on
 * failure. Falls back to a same-directory temp on EXDEV (cross-device rename)
 * so the swap stays atomic.
 *
 * Electron-free and dependency-light so every writer (FileService,
 * ThreadStorage, VaultQueryFacade, native tools, canvas IPC) can share one
 * durability contract.
 */
export async function atomicWrite(path: string, content: string): Promise<void> {
  const tmpPath = join(tmpdir(), `te-write-${randomUUID()}.tmp`)
  try {
    await stageAndSwap(tmpPath, path, content)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
    await stageAndSwap(`${path}.tmp`, path, content)
  }
  await syncParentDir(path)
}

async function stageAndSwap(tmpPath: string, path: string, content: string): Promise<void> {
  try {
    await writeFileSynced(tmpPath, content)
    await rename(tmpPath, path)
  } catch (err) {
    await unlink(tmpPath).catch(() => {})
    throw err
  }
}

async function writeFileSynced(path: string, content: string): Promise<void> {
  const handle = await open(path, 'w')
  try {
    await handle.writeFile(content, 'utf-8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncParentDir(path: string): Promise<void> {
  // Best-effort: directory fsync is not supported on every platform or
  // filesystem; failure here never invalidates the completed write.
  try {
    const handle = await open(dirname(path), 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch {
    // ignore
  }
}
