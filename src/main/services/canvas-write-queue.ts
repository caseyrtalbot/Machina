// Per-canvas-file serialized write queue. Both agent-side tools
// (pin_to_canvas, unpin_from_canvas, focus_canvas) and the renderer's
// autosave path route writes through this queue so a read-modify-write
// from one side can never interleave with a write from the other.
//
// Without this shared mutex, the agent's read-disk → mutate → write-disk
// can race with the renderer's debounced autosave (writes in-memory
// state to disk via fs:write-file), and either side can clobber the
// other's changes silently.

const canvasWriteQueues = new Map<string, Promise<unknown>>()

export function enqueueCanvasWrite<T>(file: string, task: () => Promise<T>): Promise<T> {
  const prev = canvasWriteQueues.get(file) ?? Promise.resolve()
  const next = prev.then(task, task)
  canvasWriteQueues.set(
    file,
    next.finally(() => {
      if (canvasWriteQueues.get(file) === next) canvasWriteQueues.delete(file)
    })
  )
  return next
}
