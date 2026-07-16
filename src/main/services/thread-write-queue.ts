// Per-thread serialized write queue (P3 step 4, contracts §4 v1.3.3), cloned
// from the canvas-write-queue precedent. Main-side appends are read-modify-
// write over sentinel-delimited markdown, so an append racing a renderer
// meta-save or an archive/delete rename could interleave (clobber) or
// resurrect a file the user just deleted. Every ThreadStorage mutation for
// one (vaultPath, threadId) runs through this queue.
//
// Module-level on purpose: thread-ipc.ts constructs a fresh ThreadStorage per
// IPC call, so instance-level state would serialize nothing.

const threadWriteQueues = new Map<string, Promise<unknown>>()

export function enqueueThreadWrite<T>(
  vaultPath: string,
  threadId: string,
  task: () => Promise<T>
): Promise<T> {
  const key = `${vaultPath}::${threadId}`
  const prev = threadWriteQueues.get(key) ?? Promise.resolve()
  const next = prev.then(task, task)
  // The map holds a SETTLED shadow of `next`: a rejecting task surfaces to
  // its own caller via the returned promise, never as a second, unhandled
  // rejection from the queue's tail (delta from the canvas clone).
  const entry: Promise<void> = next
    .then(
      () => undefined,
      () => undefined
    )
    .then(() => {
      if (threadWriteQueues.get(key) === entry) threadWriteQueues.delete(key)
    })
  threadWriteQueues.set(key, entry)
  return next
}

/**
 * Await every in-flight thread write (coordinated quit, P3 step 4): the
 * assistant-final append at onTurnComplete is detached from any IPC response,
 * so quit must drain the queues or a turn completing at quit time loses its
 * transcript line after display. Loops because a draining write can enqueue
 * successors (entries are settled shadows — this never rejects).
 */
export async function drainThreadWrites(): Promise<void> {
  while (threadWriteQueues.size > 0) {
    await Promise.all([...threadWriteQueues.values()])
  }
}
