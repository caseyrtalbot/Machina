import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'
import { colors } from '../../../design/tokens'

/**
 * Machina's code editor theme. Replaces `@codemirror/theme-one-dark`, whose
 * washed grey-blue background and off-system palette clashed with the app's
 * near-black void. This theme:
 *   - runs on a transparent background so the surface beneath (base void or a
 *     canvas card) shows through, matching the app's dark material,
 *   - draws every syntax color from `colors.syntax` (the OKLCH uniform-weight
 *     palette in tokens.ts), so highlighting reads calm and consistent,
 *   - ties chrome (cursor, selection, active line) to the user's accent via
 *     CSS vars, so it follows accent changes at runtime.
 */

const chrome = EditorView.theme(
  {
    '&': {
      color: 'var(--color-text-primary)',
      backgroundColor: 'transparent'
    },
    '.cm-content': {
      caretColor: 'var(--color-accent-default)'
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--color-accent-default)'
    },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      {
        backgroundColor: 'var(--color-accent-soft)'
      },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--color-text-primary) 3%, transparent)'
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: 'var(--color-text-muted)',
      border: 'none'
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'color-mix(in srgb, var(--color-text-primary) 3%, transparent)',
      color: 'var(--color-text-secondary)'
    },
    '.cm-selectionMatch': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent-default) 18%, transparent)'
    },
    '.cm-searchMatch': {
      backgroundColor: 'color-mix(in srgb, var(--color-accent-default) 22%, transparent)',
      outline: '1px solid var(--color-accent-muted)'
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'var(--color-accent-soft)'
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'var(--color-text-muted)'
    }
  },
  { dark: true }
)

const highlightStyle = HighlightStyle.define([
  // Keywords and control flow
  {
    tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword],
    color: colors.syntax.keyword
  },
  { tag: [t.definitionKeyword, t.self], color: colors.syntax.keyword },
  // Strings
  { tag: [t.string, t.special(t.string), t.escape], color: colors.syntax.string },
  // Numbers
  { tag: [t.number, t.integer, t.float], color: colors.syntax.number },
  // Constants / literals
  { tag: [t.bool, t.null, t.atom, t.constant(t.name)], color: colors.syntax.constant },
  // Functions and methods
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName],
    color: colors.syntax.function
  },
  // Types, classes, namespaces
  {
    tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName)],
    color: colors.syntax.type
  },
  // Properties and attributes
  { tag: [t.propertyName, t.attributeName], color: colors.syntax.property },
  // Regular expressions
  { tag: [t.regexp], color: colors.syntax.regexp },
  // Markup tags (html/jsx)
  { tag: [t.tagName, t.angleBracket], color: colors.syntax.tag },
  // Operators and punctuation recede
  {
    tag: [t.operator, t.punctuation, t.separator, t.bracket, t.derefOperator, t.typeOperator],
    color: colors.syntax.operator
  },
  // Comments recede, italic
  {
    tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
    color: colors.syntax.comment,
    fontStyle: 'italic'
  },
  // Decorators / annotations pick up the accent
  { tag: [t.meta, t.annotation, t.processingInstruction], color: colors.syntax.meta },
  // Markdown-ish niceties (canvas CodeCard can hold markdown snippets)
  { tag: [t.heading], color: colors.syntax.meta, fontWeight: 'bold' },
  { tag: [t.link, t.url], color: colors.syntax.function, textDecoration: 'underline' },
  { tag: [t.strong], fontWeight: 'bold' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strikethrough], textDecoration: 'line-through' },
  // Invalid / error tokens
  { tag: [t.invalid], color: colors.claude.error }
])

/** Full theme extension: transparent chrome + token-driven syntax highlighting. */
export const machinaCodeTheme: Extension = [chrome, syntaxHighlighting(highlightStyle)]
