/**
 * Template engine — variable substitution for note templates.
 *
 * Templates are regular .md files with {{variable}} placeholders.
 * Substitution happens at creation time (not runtime rendering).
 */

interface TemplateContext {
  readonly title: string
  readonly date: string // YYYY-MM-DD (local time)
  readonly time: string // HH:mm (local time)
  /** Source Date for custom format substitution. Internal — use buildTemplateContext(). */
  readonly _moment: Date
}

/** Simple date formatting. Supports YYYY, MM, DD, MMMM, M, D, HH, mm. */
function formatDate(date: Date, format: string): string {
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ]
  const pad = (n: number): string => String(n).padStart(2, '0')

  return format
    .replace('YYYY', String(date.getFullYear()))
    .replace('MMMM', months[date.getMonth()])
    .replace('MM', pad(date.getMonth() + 1))
    .replace(/\bM\b/, String(date.getMonth() + 1))
    .replace('DD', pad(date.getDate()))
    .replace(/\bD\b/, String(date.getDate()))
    .replace('HH', pad(date.getHours()))
    .replace('mm', pad(date.getMinutes()))
}

/**
 * Expand template variables in content.
 *
 * Supported variables:
 * - {{date}} — today's date (YYYY-MM-DD)
 * - {{time}} — current time (HH:mm)
 * - {{title}} — the note's title
 * - {{date:FORMAT}} — date with custom format (e.g., {{date:MMMM D, YYYY}})
 */
export function expandTemplateVariables(content: string, ctx: TemplateContext): string {
  return content
    .replace(/\{\{date:([^}]+)\}\}/g, (_match, fmt: string) => formatDate(ctx._moment, fmt))
    .replace(/\{\{date\}\}/g, ctx.date)
    .replace(/\{\{time\}\}/g, ctx.time)
    .replace(/\{\{title\}\}/g, ctx.title)
}

/** Build a TemplateContext for the current moment (or a provided Date). Uses local time. */
export function buildTemplateContext(title: string, date: Date = new Date()): TemplateContext {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return {
    title,
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    _moment: date
  }
}

/** Generate default frontmatter for a new note. Uses local date for 'created'. */
export function defaultNoteFrontmatter(
  title: string,
  tags: readonly string[] = [],
  date: Date = new Date()
): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const created = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const tagList = tags.length > 0 ? `[${tags.join(', ')}]` : '[]'
  return `---\ntitle: ${title}\ncreated: ${created}\ntags: ${tagList}\n---\n\n`
}
