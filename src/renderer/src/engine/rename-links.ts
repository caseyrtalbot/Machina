/**
 * Rewrite [[wikilink]] references when a file is renamed.
 * Replaces [[oldStem]] and [[oldStem|display]] with [[newStem]] and [[newStem|display]].
 */
export function rewriteWikilinks(content: string, oldStem: string, newStem: string): string {
  const escaped = oldStem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`\\[\\[${escaped}(\\|[^\\]]*)?\\]\\]`, 'g')
  return content.replace(regex, (_match, alias?: string) => `[[${newStem}${alias ?? ''}]]`)
}
