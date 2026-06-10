// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { buildEmergePrompt, parseEmergeResponse } from '../../src/main/ipc/ghost-emerge'
import type { ReferenceNote } from '../../src/main/ipc/ghost-emerge'

// ---------------------------------------------------------------------------
// buildEmergePrompt
// ---------------------------------------------------------------------------

describe('buildEmergePrompt', () => {
  it('truncates reference bodies to 500 chars', () => {
    const longBody = 'x'.repeat(800)
    const refs: ReferenceNote[] = [{ title: 'Ref One', tags: ['tag-a'], body: longBody }]

    const prompt = buildEmergePrompt('Test Concept', refs)

    // Should contain truncated body (500 chars) not full 800
    expect(prompt).not.toContain('x'.repeat(800))
    expect(prompt).toContain('x'.repeat(500))
  })

  it('includes ghost title and all reference titles', () => {
    const refs: ReferenceNote[] = [
      { title: 'Alpha Note', tags: ['a'], body: 'Alpha content' },
      { title: 'Beta Note', tags: ['b'], body: 'Beta content' }
    ]

    const prompt = buildEmergePrompt('Emergent Concept', refs)

    expect(prompt).toContain('Emergent Concept')
    expect(prompt).toContain('Alpha Note')
    expect(prompt).toContain('Beta Note')
    // Should reference the count of notes
    expect(prompt).toContain('2 notes')
  })

  it('handles empty refs array', () => {
    const prompt = buildEmergePrompt('Orphan Ghost', [])

    expect(prompt).toContain('Orphan Ghost')
    expect(prompt).toContain('0 notes')
  })

  it('includes tags from reference notes', () => {
    const refs: ReferenceNote[] = [
      { title: 'Tagged', tags: ['philosophy', 'science'], body: 'Some body' }
    ]

    const prompt = buildEmergePrompt('Tagged Concept', refs)

    expect(prompt).toContain('philosophy')
    expect(prompt).toContain('science')
  })

  it('does not truncate bodies under 500 chars', () => {
    const shortBody = 'Short body content'
    const refs: ReferenceNote[] = [{ title: 'Short', tags: [], body: shortBody }]

    const prompt = buildEmergePrompt('Short Concept', refs)

    expect(prompt).toContain(shortBody)
  })
})

// ---------------------------------------------------------------------------
// parseEmergeResponse
// ---------------------------------------------------------------------------

describe('parseEmergeResponse', () => {
  it('parses valid JSON response', () => {
    const raw = JSON.stringify({
      tags: ['knowledge', 'synthesis'],
      body: '# Concept\n\nThis is synthesized content.'
    })

    const result = parseEmergeResponse(raw)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.tags).toEqual(['knowledge', 'synthesis'])
      expect(result.value.body).toContain('synthesized content')
    }
  })

  it('parses JSON inside a code fence', () => {
    const raw = `Here is your note:
\`\`\`json
{
  "tags": ["test"],
  "body": "Fenced body content"
}
\`\`\`
Done.`

    const result = parseEmergeResponse(raw)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.tags).toEqual(['test'])
      expect(result.value.body).toBe('Fenced body content')
    }
  })

  it('rejects response missing body field', () => {
    const raw = JSON.stringify({
      tags: ['a']
      // no body
    })

    const result = parseEmergeResponse(raw)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('body')
    }
  })

  it('rejects non-JSON text', () => {
    const raw = 'This is just plain text with no JSON at all'

    const result = parseEmergeResponse(raw)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeTruthy()
    }
  })

  it('rejects when tags is not an array', () => {
    const raw = JSON.stringify({
      tags: 'not-an-array',
      body: 'Some body'
    })

    const result = parseEmergeResponse(raw)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('tags')
    }
  })
})
