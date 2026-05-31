/**
 * Rewrite [[wikilink]] references when a file is renamed.
 * Replaces [[oldStem]] and [[oldStem|display]] with [[newStem]] and [[newStem|display]].
 * Case-insensitive: matches [[OldStem]], [[oldStem]], [[OLDSTEM]], etc.
 * Also handles path-prefixed links: [[path/oldStem]] → [[path/newStem]].
 * Preserves heading/block-ref anchors: [[oldStem#Heading]] and [[oldStem#^block]]
 * are first-class link targets (parser.ts, wikilink-resolver.ts), so the anchor
 * must survive the rename or the link silently dangles.
 */
export function rewriteWikilinks(content: string, oldStem: string, newStem: string): string {
  const escaped = oldStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Optional `#heading`/`#^block` anchor, then optional `|alias`, in Obsidian order.
  const tail = `((?:#[^\\]|]*)?)(\\|[^\\]]*)?`
  // Match [[oldStem]], [[oldStem#anchor]], [[oldStem|alias]], [[oldStem#anchor|alias]]
  const bareRegex = new RegExp(`\\[\\[${escaped}${tail}\\]\\]`, 'gi')
  // Same, with a preserved path prefix: [[path/oldStem#anchor|alias]]
  const pathRegex = new RegExp(`\\[\\[([^\\]|]*/)${escaped}${tail}\\]\\]`, 'gi')
  const withPathReplaced = content.replace(
    pathRegex,
    (_match, pathPrefix: string, anchor: string, alias?: string) =>
      `[[${pathPrefix}${newStem}${anchor}${alias ?? ''}]]`
  )
  return withPathReplaced.replace(
    bareRegex,
    (_match, anchor: string, alias?: string) => `[[${newStem}${anchor}${alias ?? ''}]]`
  )
}
