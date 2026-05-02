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

export const NATIVE_TOOLS_V0: readonly NativeToolSpec[] = [READ_NOTE_TOOL]
