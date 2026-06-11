import { typedHandle } from '../typed-ipc'
import type { SearchEngine } from '@shared/engine/search-engine'

/**
 * vault:index-pdf-content (3.10a): the renderer extracts per-page PDF text
 * (pdfjs lives there) and hands it to the main process so the SearchEngine
 * behind MCP search.query covers PDF content too. In-memory only — re-pointed
 * at the fresh engine on every vault switch, like the live markdown index.
 */

let target: SearchEngine | null = null

/** Point the handler at the active vault's SearchEngine (null detaches). */
export function setPdfIndexSearchEngine(engine: SearchEngine | null): void {
  target = engine
}

export function registerPdfIndexIpc(): void {
  typedHandle('vault:index-pdf-content', ({ pdfPath, pages }) => {
    target?.indexPdfPages(pdfPath, pages)
  })
}
