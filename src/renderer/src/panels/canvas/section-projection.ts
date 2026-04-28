import matter from 'gray-matter'
import { replaceSection } from '@shared/engine/section-rewriter'

interface SectionEditDeps {
  readonly readFile: (path: string) => Promise<string>
  readonly writeDocument: (path: string, content: string) => Promise<void>
}

/**
 * Read the file, rewrite only the body of the target section, write it back.
 * Returns an error Result when the section can't be found (the card should
 * then prompt the user to detach or re-attach).
 */
export async function commitSectionEdit(
  filePath: string,
  sectionId: string,
  newBody: string,
  deps: SectionEditDeps
): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }> {
  const content = await deps.readFile(filePath)
  const parsed = matter(content)
  const sectionMap = (parsed.data.sections as Record<string, string> | undefined) ?? {}
  const result = replaceSection(parsed.content, sectionId, newBody, sectionMap)
  if (!result.ok) return { ok: false, error: result.error }
  const nextFile = matter.stringify(result.value, parsed.data)
  await deps.writeDocument(filePath, nextFile)
  return { ok: true }
}
