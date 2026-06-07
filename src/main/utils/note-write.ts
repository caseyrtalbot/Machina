import matter from 'gray-matter'
import { atomicWrite } from './atomic-write'

/** Structural slice of DocumentManager used to suppress vault-watcher echo. */
export interface ExternalWriteRegistrar {
  registerExternalWrite(path: string): void
}

/**
 * Inject modified_by / modified_at provenance into a note's frontmatter,
 * preserving the body byte-for-byte. A note with no frontmatter gains one.
 *
 * The body is never round-tripped through matter.stringify: that re-parses its
 * argument, so a body whose first line is `---` (a thematic break, or content
 * the agent legitimately wrote) would be shattered into a YAML char map and the
 * real text dropped. Instead we serialize ONLY the frontmatter (an empty body
 * can't be misparsed) and concatenate the original body verbatim.
 */
export function stampProvenance(content: string, agentId: string): string {
  const provenance = { modified_by: agentId, modified_at: new Date().toISOString() }
  const parsed = matter(content)
  // Genuine frontmatter parses to a plain object. gray-matter otherwise misreads
  // a leading `---` body line as frontmatter and yields a scalar/array — in that
  // case treat the whole input as body so nothing is lost.
  const hasFrontmatter =
    parsed.data != null && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
  const data = hasFrontmatter ? { ...parsed.data, ...provenance } : provenance
  const body = hasFrontmatter ? parsed.content : content
  // matter.stringify('', data) emits `---\n<yaml>---\n\n`; drop the empty body's
  // trailing newline, then append the real body verbatim.
  return matter.stringify('', data).replace(/\n$/, '') + body
}

/**
 * Single safe-write path shared by VaultQueryFacade (MCP) and the native agent
 * tools: stamp provenance, register the write so the vault watcher suppresses
 * the self-echo (no spurious doc:external-change for an open note), then write
 * atomically so an interrupted write never truncates the file.
 *
 * Callers own PathGuard resolution (pass an already-canonical `abs`) and audit
 * logging, so this stays a pure mechanics primitive with one implementation.
 */
export async function writeStampedNote(
  abs: string,
  content: string,
  agentId: string,
  registrar?: ExternalWriteRegistrar
): Promise<void> {
  const stamped = stampProvenance(content, agentId)
  registrar?.registerExternalWrite(abs)
  await atomicWrite(abs, stamped)
}
