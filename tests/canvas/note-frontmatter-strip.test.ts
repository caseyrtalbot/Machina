import { describe, it, expect } from 'vitest'
import { stripFrontmatterForDisplay } from '../../src/renderer/src/panels/canvas/NoteCard'

describe('stripFrontmatterForDisplay', () => {
  it('strips a leading frontmatter block', () => {
    const content = '---\ntitle: Test\ntags: [a, b]\n---\n\n# Heading\n\nBody text'
    expect(stripFrontmatterForDisplay(content)).toBe('# Heading\n\nBody text')
  })

  it('leaves a --- horizontal rule mid-document alone', () => {
    const content = '# Heading\n\nAbove the rule\n\n---\n\nBelow the rule'
    expect(stripFrontmatterForDisplay(content)).toBe(content.trim())
  })

  it('does not strip when the document merely contains --- later', () => {
    const content = 'Intro paragraph\n---\nmore text\n---\nend'
    expect(stripFrontmatterForDisplay(content)).toBe(content.trim())
  })

  it('requires the closing delimiter at line start', () => {
    // The only `---` after the opener is embedded mid-line, so nothing closes
    // the block and nothing should be stripped.
    const content = '---\ntitle: dash --- in value\nno closer here'
    expect(stripFrontmatterForDisplay(content)).toBe(content.trim())
  })

  it('strips frontmatter when the file ends right after the closer', () => {
    const content = '---\ntitle: Only FM\n---'
    expect(stripFrontmatterForDisplay(content)).toBe('')
  })

  it('handles a note with an hr immediately after frontmatter', () => {
    const content = '---\ntitle: T\n---\n---\nbody'
    expect(stripFrontmatterForDisplay(content)).toBe('---\nbody')
  })

  it('strips empty frontmatter (no lines between delimiters)', () => {
    expect(stripFrontmatterForDisplay('---\n---\nbody')).toBe('body')
  })

  it('returns plain content unchanged', () => {
    expect(stripFrontmatterForDisplay('just text\n')).toBe('just text')
  })
})
