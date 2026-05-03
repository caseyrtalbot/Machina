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

export const SEARCH_VAULT_TOOL: NativeToolSpec = {
  name: 'search_vault',
  description:
    'Search vault notes for a literal or regex string (ripgrep). Returns up to 200 hits with path, line number, and a trimmed snippet. Always ignores ".machina/**".',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'String to search for. Case-sensitive; ripgrep regex syntax.'
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional sub-paths within the vault to scope the search. Defaults to the whole vault.'
      }
    },
    required: ['query']
  }
}

export const WRITE_NOTE_TOOL: NativeToolSpec = {
  name: 'write_note',
  description:
    'Create or overwrite a vault note. The user is shown a diff and must accept before the file is written, unless the thread is in auto-accept mode. Returns whether the note was newly created and the byte count written.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path relative to vault root (e.g. "ideas/spark.md").'
      },
      content: {
        type: 'string',
        description: 'Full file contents. Existing files are overwritten in their entirety.'
      }
    },
    required: ['path', 'content']
  }
}

export const EDIT_NOTE_TOOL: NativeToolSpec = {
  name: 'edit_note',
  description:
    'Edit a vault note by literal find/replace. The find string must appear exactly once in the file or the call fails loudly. The user is shown a diff and must accept before the file is written, unless the thread is in auto-accept mode. Returns the edited path and added/removed line counts.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path relative to vault root (e.g. "ideas/spark.md").'
      },
      find: {
        type: 'string',
        description:
          'Literal text to find. Must appear exactly once in the file. Include surrounding context to disambiguate.'
      },
      replace: {
        type: 'string',
        description: 'Replacement text. Empty string removes the matched span.'
      }
    },
    required: ['path', 'find', 'replace']
  }
}

export const READ_CANVAS_TOOL: NativeToolSpec = {
  name: 'read_canvas',
  description:
    'Read a canvas by id. Use canvasId "default" for the visible main canvas; other ids map to the app canvas directory. Returns pinned cards and edges. Errors with CANVAS_NOT_FOUND if the canvas does not exist.',
  input_schema: {
    type: 'object',
    properties: {
      canvasId: { type: 'string', description: 'Canvas id (basename without extension).' }
    },
    required: ['canvasId']
  }
}

export const PIN_TO_CANVAS_TOOL: NativeToolSpec = {
  name: 'pin_to_canvas',
  description:
    'Pin a card to a canvas. Use canvasId "default" for the visible main canvas; other ids map to the app canvas directory. Returns the new card id. Not subject to the approval gate; pinning is reversible.',
  input_schema: {
    type: 'object',
    properties: {
      canvasId: { type: 'string', description: 'Canvas id (basename without extension).' },
      card: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          position: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' }
            },
            required: ['x', 'y']
          },
          refs: { type: 'array', items: { type: 'string' } }
        },
        required: ['title']
      }
    },
    required: ['canvasId', 'card']
  }
}

export const NATIVE_TOOLS_V0: readonly NativeToolSpec[] = [
  READ_NOTE_TOOL,
  LIST_VAULT_TOOL,
  SEARCH_VAULT_TOOL,
  WRITE_NOTE_TOOL,
  EDIT_NOTE_TOOL,
  READ_CANVAS_TOOL,
  PIN_TO_CANVAS_TOOL
]
