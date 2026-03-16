import { Mark, mergeAttributes } from '@tiptap/core'

export interface ConceptNodeMarkOptions {
  HTMLAttributes: Record<string, unknown>
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    conceptNodeMark: {
      setConceptNode: () => ReturnType
      unsetConceptNode: () => ReturnType
      toggleConceptNode: () => ReturnType
    }
  }
}

export const ConceptNodeMark = Mark.create<ConceptNodeMarkOptions>({
  name: 'conceptNode',

  addOptions() {
    return {
      HTMLAttributes: {}
    }
  },

  parseHTML() {
    return [{ tag: 'node' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['node', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },

  addCommands() {
    return {
      setConceptNode:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      unsetConceptNode:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
      toggleConceptNode:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name)
    }
  },

  addStorage() {
    return {
      markdown: {
        serialize: { open: '<node>', close: '</node>' },
        parse: {}
      }
    }
  }
})
