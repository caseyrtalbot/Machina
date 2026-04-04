/** Metadata from an action file's YAML frontmatter. */
export interface ActionDefinition {
  /** Filename stem, e.g. 'emerge' from emerge.md */
  readonly id: string
  readonly name: string
  readonly description: string
  readonly icon?: string
  readonly scope: 'any' | 'files' | 'vault'
  readonly custom?: boolean
}

/** Scope context serialized into terminal card metadata at spawn time. */
export interface ActionScope {
  readonly type: 'vault' | 'files'
  readonly paths?: readonly string[]
  readonly vaultPath: string
}

/**
 * Build the scope section of the system prompt from sidebar selection state.
 * Pure function -- no IPC, no side effects.
 */
export function buildScopeContext(selectedPaths: ReadonlySet<string>, vaultPath: string): string {
  if (selectedPaths.size === 0) {
    return [
      '## Scope',
      `Operate on the entire vault at: ${vaultPath}`,
      'Read _index.md if it exists, then Glob **/*.md to survey the vault.'
    ].join('\n')
  }
  const relativePaths = [...selectedPaths].map((p) =>
    p.startsWith(vaultPath) ? p.slice(vaultPath.length + 1) : p
  )
  return [
    '## Scope',
    'Operate on these files:',
    ...relativePaths.map((p) => `- ${p}`),
    '',
    'Read each file, then proceed with the action.'
  ].join('\n')
}
