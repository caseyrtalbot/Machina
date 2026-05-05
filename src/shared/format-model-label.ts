/**
 * Render a model id (e.g. `claude-sonnet-4-6`) as a human label (`Sonnet 4.6`).
 *
 * The provider prefix (`claude-`) is stripped, hyphens before the version
 * become spaces, and hyphens between version digit groups become dots so the
 * label reads as a version string rather than a date.
 */
export function formatModelLabel(model: string): string {
  const stripped = model.replace(/^claude-?/i, '')
  const firstDigit = stripped.search(/\d/)
  const namePart = firstDigit === -1 ? stripped : stripped.slice(0, firstDigit)
  const versionPart = firstDigit === -1 ? '' : stripped.slice(firstDigit)
  const name = namePart.replace(/-+$/, '').replace(/-/g, ' ').trim()
  const version = versionPart.replace(/-/g, '.')
  const joined = [name, version].filter(Boolean).join(' ')
  return joined.replace(/\b\w/g, (c) => c.toUpperCase())
}
