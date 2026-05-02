export interface NativeToolSpec {
  readonly name: string
  readonly description: string
  readonly input_schema: {
    readonly type: 'object'
    readonly properties: Record<string, unknown>
    readonly required: readonly string[]
  }
}

export const READ_NOTE_TOOL: NativeToolSpec = {
  name: 'read_note',
  description:
    'Read a vault note by path relative to the vault root. Returns the file content and the line range that was read.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path relative to vault root (e.g. "notes/ideas.md").'
      }
    },
    required: ['path']
  }
}

export const LIST_VAULT_TOOL: NativeToolSpec = {
  name: 'list_vault',
  description:
    'List notes in the vault matching one or more glob patterns. Returns matched paths relative to the vault root. Defaults to "**/*.md" when globs is omitted. Always ignores ".machina/**".',
  input_schema: {
    type: 'object',
    properties: {
      globs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Glob patterns relative to vault root. Defaults to ["**/*.md"].'
      }
    },
    required: []
  }
}

export const NATIVE_TOOLS_V0: readonly NativeToolSpec[] = [READ_NOTE_TOOL, LIST_VAULT_TOOL]
