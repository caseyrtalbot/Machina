import { FileService } from './file-service'

const AUTOSAVE_DELAY_MS = 1000
const PENDING_WRITE_TIMEOUT_MS = 2000

/** How many leading bytes to scan when deciding if a file is binary. */
const BINARY_SNIFF_BYTES = 8000

/**
 * Git's binary heuristic: a NUL byte in the leading window means non-text.
 * Valid UTF-8 text never contains U+0000, so false positives on real notes are
 * effectively nil. Scanning bytes (not a decoded string) avoids fully decoding
 * a large binary just to reject it, and avoids the destructive UTF-8 decode
 * entirely for the reject path.
 */
function isBinaryContent(bytes: Buffer): boolean {
  const limit = Math.min(bytes.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) return true
  }
  return false
}

interface Document {
  readonly path: string
  content: string
  lastSavedContent: string
  mtime: string | null
  version: number
  lastSavedVersion: number
  refCount: number
  saveTimeout: ReturnType<typeof setTimeout> | null
  /**
   * True between conflict detection and resolution. While set, close() skips
   * the dirty flush so "reload from disk" (close → open) doesn't overwrite
   * the external change with stale local content.
   */
  conflicted: boolean
}

interface DocumentOpenResult {
  readonly content: string
  readonly version: number
}

interface DocumentContentResult {
  readonly content: string
  readonly version: number
  readonly dirty: boolean
}

type DocumentEventCallback = (
  event:
    | { type: 'external-change'; path: string; content: string }
    | { type: 'conflict'; path: string; diskContent: string }
    | { type: 'saved'; path: string }
    | { type: 'save-failed'; path: string; message: string }
) => void

export class DocumentManager {
  readonly documents = new Map<string, Document>()
  private readonly _pendingWrites = new Set<string>()
  private readonly _pendingWriteTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private _eventCallback: DocumentEventCallback | null = null

  hasPendingWrite(path: string): boolean {
    return this._pendingWrites.has(path)
  }

  constructor(private readonly fs: FileService) {}

  onEvent(callback: DocumentEventCallback): void {
    this._eventCallback = callback
  }

  async open(path: string): Promise<DocumentOpenResult> {
    const existing = this.documents.get(path)
    if (existing) {
      existing.refCount++
      return { content: existing.content, version: existing.version }
    }

    const [bytes, mtime] = await Promise.all([
      this.fs.readFileBytes(path),
      this.fs.getFileMtime(path)
    ])

    // A binary file must never become an editable, autosave-eligible Document:
    // decoding it as UTF-8 mangles it (U+FFFD for every undecodable byte) and
    // the first autosave writes that garbage back, destroying the file. Reject
    // here — the single chokepoint every editor write funnels through — so no
    // update()/saveToDisk() path can ever touch a binary file.
    if (isBinaryContent(bytes)) {
      throw new Error(`Refusing to open binary file as text: ${path}`)
    }
    const content = bytes.toString('utf-8')

    const doc: Document = {
      path,
      content,
      lastSavedContent: content,
      mtime,
      version: 0,
      lastSavedVersion: 0,
      refCount: 1,
      saveTimeout: null,
      conflicted: false
    }

    this.documents.set(path, doc)
    return { content, version: 0 }
  }

  async close(path: string): Promise<void> {
    const doc = this.documents.get(path)
    if (!doc) return

    doc.refCount--
    if (doc.refCount > 0) return

    // Flush if dirty before removing — unless a conflict is unresolved, in
    // which case flushing would overwrite the external change on disk.
    if (this.isDirty(doc) && !doc.conflicted) {
      this.clearAutosave(doc)
      await this.saveToDisk(doc)
    } else {
      this.clearAutosave(doc)
    }

    this.documents.delete(path)
  }

  /**
   * Re-key open documents after a file or folder rename/move so autosaves
   * target the new path instead of resurrecting the old file. Handles both
   * an exact file path and any open documents under a renamed folder.
   */
  rename(oldPath: string, newPath: string): void {
    const prefix = `${oldPath}/`
    for (const [path, doc] of Array.from(this.documents.entries())) {
      if (path !== oldPath && !path.startsWith(prefix)) continue
      const mapped = path === oldPath ? newPath : newPath + path.slice(oldPath.length)
      this.clearAutosave(doc)
      this.documents.delete(path)
      const renamed: Document = { ...doc, path: mapped, saveTimeout: null }
      this.documents.set(mapped, renamed)
      if (this.isDirty(renamed)) this.scheduleAutosave(renamed)
    }
  }

  update(path: string, content: string): number {
    const doc = this.documents.get(path)
    if (!doc) throw new Error(`Document not open: ${path}`)

    doc.content = content
    doc.version++
    this.scheduleAutosave(doc)
    return doc.version
  }

  async save(path: string): Promise<void> {
    const doc = this.documents.get(path)
    if (!doc) throw new Error(`Document not open: ${path}`)

    this.clearAutosave(doc)
    await this.saveToDisk(doc)
  }

  async saveContent(path: string, content: string): Promise<void> {
    const doc = this.documents.get(path)
    if (!doc) {
      await this.fs.writeFile(path, content)
      this._eventCallback?.({ type: 'saved', path })
      return
    }

    const replaced = content !== doc.content
    doc.content = content
    doc.version++
    this.clearAutosave(doc)
    await this.saveToDisk(doc)
    // An out-of-band rewrite (e.g. backlink rename) replaced an open doc's
    // content: notify renderer views so they re-parse instead of pushing
    // their stale copy back on the next keystroke.
    if (replaced) {
      this._eventCallback?.({ type: 'external-change', path, content })
    }
  }

  getContent(path: string): DocumentContentResult | null {
    const doc = this.documents.get(path)
    if (!doc) return null
    return {
      content: doc.content,
      version: doc.version,
      dirty: this.isDirty(doc)
    }
  }

  async handleExternalChange(path: string): Promise<void> {
    // Self-write suppression: if we just wrote this file, ignore the watcher event
    if (this._pendingWrites.has(path)) {
      this.clearPendingWrite(path)
      return
    }

    const doc = this.documents.get(path)
    if (!doc) return

    // Step 1: Modtime guard
    const newMtime = await this.fs.getFileMtime(path)
    if (newMtime && doc.mtime && newMtime === doc.mtime) return

    // Step 2: Content identity check (handles cloud sync false positives)
    const diskContent = await this.fs.readFile(path)
    if (diskContent === doc.lastSavedContent) {
      doc.mtime = newMtime
      return
    }

    // Step 3: Genuine external change
    doc.mtime = newMtime

    if (this.isDirty(doc)) {
      // Conflict: disk differs from our unsaved content
      doc.conflicted = true
      this._eventCallback?.({ type: 'conflict', path, diskContent })
    } else {
      // Clean: silently reload
      doc.content = diskContent
      doc.lastSavedContent = diskContent
      doc.lastSavedVersion = doc.version
      this._eventCallback?.({ type: 'external-change', path, content: diskContent })
    }
  }

  async flushAll(): Promise<void> {
    const dirtyDocs = Array.from(this.documents.values()).filter((d) => this.isDirty(d))
    for (const doc of dirtyDocs) {
      this.clearAutosave(doc)
      await this.saveToDisk(doc)
    }
  }

  /**
   * Drop all pending-write suppression flags and cancel their safety timers.
   * Must be called on vault switch: otherwise an inflight write against the
   * old vault could leak suppression into the new vault and swallow a
   * legitimate external-change notification for a same-pathed file.
   */
  clearPendingWrites(): void {
    for (const timer of this._pendingWriteTimers.values()) {
      clearTimeout(timer)
    }
    this._pendingWriteTimers.clear()
    this._pendingWrites.clear()
  }

  /**
   * Register a path as about to be written by an external source (e.g., MCP agent).
   * Prevents the vault watcher from triggering a reload for this write.
   * The flag auto-clears after PENDING_WRITE_TIMEOUT_MS as a safety net.
   */
  registerExternalWrite(path: string): void {
    this.clearPendingWrite(path)
    this._pendingWrites.add(path)

    const timeoutId = setTimeout(() => {
      this._pendingWrites.delete(path)
      this._pendingWriteTimers.delete(path)
    }, PENDING_WRITE_TIMEOUT_MS)
    this._pendingWriteTimers.set(path, timeoutId)
  }

  // --- Internal ---

  private isDirty(doc: Document): boolean {
    return doc.version !== doc.lastSavedVersion
  }

  private scheduleAutosave(doc: Document): void {
    this.clearAutosave(doc)
    doc.saveTimeout = setTimeout(() => {
      doc.saveTimeout = null
      void this.saveToDisk(doc).catch((err) => {
        this.clearPendingWrite(doc.path)
        console.error(`[DocumentManager] Autosave failed for ${doc.path}:`, err)
      })
    }, AUTOSAVE_DELAY_MS)
  }

  private clearAutosave(doc: Document): void {
    if (doc.saveTimeout) {
      clearTimeout(doc.saveTimeout)
      doc.saveTimeout = null
    }
  }

  private async saveToDisk(doc: Document): Promise<void> {
    if (!this.isDirty(doc)) return

    // Mark as pending write before starting (self-write suppression)
    this.clearPendingWrite(doc.path)
    this._pendingWrites.add(doc.path)

    // Safety timeout: clear pending write flag even if watcher never fires
    const timeoutId = setTimeout(() => {
      this._pendingWrites.delete(doc.path)
      this._pendingWriteTimers.delete(doc.path)
    }, PENDING_WRITE_TIMEOUT_MS)
    this._pendingWriteTimers.set(doc.path, timeoutId)

    try {
      await this.fs.writeFile(doc.path, doc.content)
    } catch (err) {
      this.clearPendingWrite(doc.path)
      // Surface to the renderer: the document stays dirty and the user must
      // know their work is not on disk (full disk, permissions, etc.).
      this._eventCallback?.({
        type: 'save-failed',
        path: doc.path,
        message: err instanceof Error ? err.message : String(err)
      })
      throw err
    }

    const newMtime = await this.fs.getFileMtime(doc.path)
    doc.mtime = newMtime
    doc.lastSavedContent = doc.content
    doc.lastSavedVersion = doc.version
    // A successful save resolves any outstanding conflict (keep-mine path)
    doc.conflicted = false

    this._eventCallback?.({ type: 'saved', path: doc.path })
  }

  private clearPendingWrite(path: string): void {
    this._pendingWrites.delete(path)
    const timer = this._pendingWriteTimers.get(path)
    if (timer) {
      clearTimeout(timer)
      this._pendingWriteTimers.delete(path)
    }
  }
}
