/**
 * Utility for progressive/chunked file loading.
 *
 * Splits a list of paths into fixed-size chunks so the first batch of files
 * can be sent to the vault worker immediately, making the UI interactive
 * while remaining chunks load in the background.
 */

export const DEFAULT_CHUNK_SIZE = 50

/** Split an array into chunks of `size`. Returns at least one (possibly empty) chunk. */
export function chunkArray<T>(items: readonly T[], size: number = DEFAULT_CHUNK_SIZE): T[][] {
  if (size < 1) throw new Error('Chunk size must be >= 1')
  if (items.length === 0) return [[]]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

interface FileWithContent {
  readonly path: string
  readonly content: string
}

/**
 * Read a chunk of file paths into FileWithContent objects using the provided
 * reader function, with concurrency controlled by a p-limit instance.
 */
export async function readChunk(
  paths: readonly string[],
  reader: (path: string) => Promise<string>,
  limit: <T>(fn: () => Promise<T>) => Promise<T>
): Promise<FileWithContent[]> {
  return Promise.all(
    paths.map((p) =>
      limit(async () => ({
        path: p,
        content: await reader(p)
      }))
    )
  )
}

/**
 * Delay that yields to the event loop so the UI can paint between chunks.
 * Uses setTimeout to guarantee a macro-task boundary (requestIdleCallback
 * is not available in all Electron renderer configurations).
 */
export function yieldToEventLoop(delayMs: number = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}
