import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface FindMatch {
  readonly from: number
  readonly to: number
}

export interface FindDecorationSpec {
  readonly from: number
  readonly to: number
  readonly active: boolean
}

/**
 * Case-insensitive, non-overlapping substring search over every textblock.
 * Concatenates inline children per block (padding non-text leaves with a
 * non-matchable placeholder to keep offsets position-accurate), so matches
 * spanning mark boundaries (e.g. `he**llo**`) are still found.
 */
export function findMatches(doc: ProseMirrorNode, query: string): readonly FindMatch[] {
  if (!query) return []
  const needle = query.toLowerCase()
  const matches: FindMatch[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    let text = ''
    node.forEach((child) => {
      // Non-text inline leaves (wikilinks, etc.) occupy nodeSize positions;
      // pad with U+FFFC so later offsets stay aligned and never match.
      text += child.isText ? (child.text ?? '') : '￼'.repeat(child.nodeSize)
    })
    const haystack = text.toLowerCase()
    let idx = haystack.indexOf(needle)
    while (idx !== -1) {
      const from = pos + 1 + idx
      matches.push({ from, to: from + needle.length })
      idx = haystack.indexOf(needle, idx + needle.length)
    }
    return false
  })
  return matches
}

/** Pure mapping of matches to decoration specs with the active match flagged. */
export function buildDecorationSpecs(
  matches: readonly FindMatch[],
  activeIndex: number
): readonly FindDecorationSpec[] {
  return matches.map((m, i) => ({ from: m.from, to: m.to, active: i === activeIndex }))
}

// Theme CSS vars so highlights track the user's accent at runtime.
const MATCH_STYLE =
  'background: color-mix(in srgb, var(--color-accent-default) 22%, transparent); border-radius: 2px'
const ACTIVE_MATCH_STYLE =
  'background: color-mix(in srgb, var(--color-accent-default) 50%, transparent); border-radius: 2px; outline: 1px solid var(--color-accent-default)'

function buildDecorationSet(
  doc: ProseMirrorNode,
  matches: readonly FindMatch[],
  activeIndex: number
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty
  const decorations = buildDecorationSpecs(matches, activeIndex).map((spec) =>
    Decoration.inline(spec.from, spec.to, {
      style: spec.active ? ACTIVE_MATCH_STYLE : MATCH_STYLE
    })
  )
  return DecorationSet.create(doc, decorations)
}

export interface FindPluginState {
  readonly query: string
  readonly activeIndex: number
  readonly matches: readonly FindMatch[]
  readonly decorations: DecorationSet
}

export interface FindPluginMeta {
  readonly query: string
  readonly activeIndex: number
}

const EMPTY_STATE: FindPluginState = {
  query: '',
  activeIndex: 0,
  matches: [],
  decorations: DecorationSet.empty
}

export const findPluginKey = new PluginKey<FindPluginState>('findInNote')

function nextState(doc: ProseMirrorNode, query: string, requestedIndex: number): FindPluginState {
  if (!query) return EMPTY_STATE
  const matches = findMatches(doc, query)
  const activeIndex =
    matches.length === 0 ? 0 : Math.min(Math.max(requestedIndex, 0), matches.length - 1)
  return { query, activeIndex, matches, decorations: buildDecorationSet(doc, matches, activeIndex) }
}

export interface FindInNoteOptions {
  /** Called when the user presses Mod-f with the rich editor focused. */
  onOpen: () => void
}

export const FindInNote = Extension.create<FindInNoteOptions>({
  name: 'findInNote',

  addOptions() {
    return { onOpen: () => {} }
  },

  addKeyboardShortcuts() {
    // ProseMirror shortcuts only fire while the editor has focus, so this
    // never shadows source-mode CodeMirror search or other panels.
    return {
      'Mod-f': () => {
        this.options.onOpen()
        return true
      }
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindPluginState>({
        key: findPluginKey,
        state: {
          init: () => EMPTY_STATE,
          apply(tr, prev) {
            const meta = tr.getMeta(findPluginKey) as FindPluginMeta | undefined
            if (meta) return nextState(tr.doc, meta.query, meta.activeIndex)
            if (tr.docChanged && prev.query) {
              return nextState(tr.doc, prev.query, prev.activeIndex)
            }
            return prev
          }
        },
        props: {
          decorations(state) {
            return findPluginKey.getState(state)?.decorations ?? null
          }
        }
      })
    ]
  }
})
