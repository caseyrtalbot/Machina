import { FileService } from './file-service'

const AUTOSAVE_DELAY_MS = 1000
const PENDING_WRITE_TIMEOUT_MS = 2000

interface Document {
  readonly path: string
  content: string
  lastSavedContent: string
  mtime: string | null
  version: number
  lastSavedVersion: number
  refCount: number
  saveTimeout: ReturnType<typeof setTimeout> | null
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

    const [content, mtime] = await Promise.all([this.fs.readFile(path), this.fs.getFileMtime(path)])

    const doc: Document = {
      path,
      content,
      lastSavedContent: content,
      mtime,
      version: 0,
      lastSavedVersion: 0,
      refCount: 1,
      saveTimeout: null
    }

    this.documents.set(path, doc)
    return { content, version: 0 }
  }

  async close(path: string): Promise<void> {
    const doc = this.documents.get(path)
    if (!doc) return

    doc.refCount--
    if (doc.refCount > 0) return

    // Flush if dirty before removing
    if (this.isDirty(doc)) {
      this.clearAutosave(doc)
      await this.saveToDisk(doc)
    }

    this.documents.delete(path)
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

    doc.content = content
    doc.version++
    this.clearAutosave(doc)
    await this.saveToDisk(doc)
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
      throw err
    }

    const newMtime = await this.fs.getFileMtime(doc.path)
    doc.mtime = newMtime
    doc.lastSavedContent = doc.content
    doc.lastSavedVersion = doc.version

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
