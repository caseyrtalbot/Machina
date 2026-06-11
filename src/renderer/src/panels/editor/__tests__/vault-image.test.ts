import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { VaultImage } from '../extensions/vault-image'
import { WikilinkNode } from '../extensions/wikilink-node'

let editor: Editor

beforeEach(() => {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit.configure({ codeBlock: false }), Markdown, VaultImage, WikilinkNode]
  })
})

afterEach(() => {
  editor.destroy()
})

/** Parse markdown into the editor, then serialize back — the edit-save path. */
function roundTrip(markdown: string): string {
  const manager = editor.storage.markdown.manager
  editor.commands.setContent(manager.parse(markdown))
  return (manager.serialize(editor.getJSON()) as string).trim()
}

function firstParagraphContent(): JSONContent[] {
  const doc = editor.getJSON()
  return doc.content?.[0]?.content ?? []
}

describe('image markdown round-trip', () => {
  it('![alt](src) with a vault-relative path survives edit-save', () => {
    expect(roundTrip('![diagram](assets/pic.png)')).toBe('![diagram](assets/pic.png)')
  })

  it('remote image with title round-trips', () => {
    const md = '![alt](https://example.com/i.png "The Title")'
    expect(roundTrip(md)).toBe(md)
  })

  it('image with empty alt round-trips', () => {
    expect(roundTrip('![](assets/pic.png)')).toBe('![](assets/pic.png)')
  })

  it('parses to an image node with the original src untouched', () => {
    roundTrip('![diagram](assets/pic.png)')
    const inline = firstParagraphContent()
    expect(inline).toHaveLength(1)
    expect(inline[0].type).toBe('image')
    expect(inline[0].attrs?.src).toBe('assets/pic.png')
  })
})

describe('![[file]] embeds', () => {
  it('image embed parses to an image node and serializes back to ![[file]]', () => {
    expect(roundTrip('![[pic.png]]')).toBe('![[pic.png]]')
    const inline = firstParagraphContent()
    expect(inline).toHaveLength(1)
    expect(inline[0].type).toBe('image')
    expect(inline[0].attrs?.src).toBe('pic.png')
    expect(inline[0].attrs?.embedTarget).toBe('pic.png')
  })

  it('image embed with alias round-trips', () => {
    expect(roundTrip('![[pic.png|Figure 1]]')).toBe('![[pic.png|Figure 1]]')
  })

  it('no stray ! text node is left behind (the old tokenizer bug)', () => {
    roundTrip('![[pic.png]]')
    const inline = firstParagraphContent()
    expect(inline.some((n) => n.type === 'text' && n.text?.includes('!'))).toBe(false)
  })

  it('non-image embed (pdf) falls back to an embed-flagged wikilink', () => {
    expect(roundTrip('![[paper.pdf]]')).toBe('![[paper.pdf]]')
    const inline = firstParagraphContent()
    expect(inline).toHaveLength(1)
    expect(inline[0].type).toBe('wikilink')
    expect(inline[0].attrs?.target).toBe('paper.pdf')
    expect(inline[0].attrs?.embed).toBe(true)
  })

  it('plain [[wikilink]] still round-trips without a bang', () => {
    expect(roundTrip('[[Some Note]]')).toBe('[[Some Note]]')
    const inline = firstParagraphContent()
    expect(inline[0].type).toBe('wikilink')
    expect(inline[0].attrs?.embed).toBe(false)
  })

  it('embed surrounded by text round-trips in place', () => {
    expect(roundTrip('before ![[pic.png]] after')).toBe('before ![[pic.png]] after')
  })
})
