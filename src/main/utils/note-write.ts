import matter from 'gray-matter'
import { open } from 'fs/promises'
import { atomicWrite } from './atomic-write'

/** Structural slice of DocumentManager used to suppress vault-watcher echo. */
export interface ExternalWriteRegistrar {
  registerExternalWrite(path: string): void
}

/**
 * Inject provenance keys into a note's frontmatter, preserving the body
 * byte-for-byte. A note with no frontmatter gains one.
 *
 * The body is never round-tripped through matter.stringify: that re-parses its
 * argument, so a body whose first line is `---` (a thematic break, or content
 * the agent legitimately wrote) would be shattered into a YAML char map and the
 * real text dropped. Instead we serialize ONLY the frontmatter (an empty body
 * can't be misparsed) and concatenate the original body verbatim.
 */
function stampFrontmatter(content: string, provenance: Record<string, string>): string {
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

/** Stamp modified_by / modified_at (an agent overwriting an existing note). */
export function stampProvenance(content: string, agentId: string): string {
  return stampFrontmatter(content, { modified_by: agentId, modified_at: new Date().toISOString() })
}

/** Stamp created_by / created_at (an agent creating a new note). */
export function stampCreateProvenance(content: string, agentId: string): string {
  return stampFrontmatter(content, { created_by: agentId, created_at: new Date().toISOString() })
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

/**
 * Create-only sibling of writeStampedNote: stamp creation provenance, register
 * the write for watcher-echo suppression, then exclusive-create (`wx`) so an
 * existing file is never silently overwritten (EEXIST propagates to the
 * caller). Returns the stamped content so callers can refresh live indexes
 * without re-reading the file. Same ownership split: callers own PathGuard
 * resolution and audit logging.
 */
export async function createStampedNote(
  abs: string,
  content: string,
  agentId: string,
  registrar?: ExternalWriteRegistrar
): Promise<string> {
  const stamped = stampCreateProvenance(content, agentId)
  registrar?.registerExternalWrite(abs)
  const fh = await open(abs, 'wx')
  try {
    await fh.writeFile(stamped, 'utf-8')
  } finally {
    await fh.close()
  }
  return stamped
}
