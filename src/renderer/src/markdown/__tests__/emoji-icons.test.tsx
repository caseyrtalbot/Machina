import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { rehypeEmojiIcons } from '../rehype-emoji-icons'
import { LucideInline } from '../LucideInline'

const components: Components = {
  span(props) {
    const rest = props as unknown as Record<string, unknown>
    const name = rest['data-lucide-icon'] ?? rest['dataLucideIcon']
    if (typeof name === 'string') return <LucideInline name={name} />
    const {
      node: _n,
      children,
      ...others
    } = props as unknown as {
      node?: unknown
      children?: unknown
      [key: string]: unknown
    }
    return <span {...(others as object)}>{children as never}</span>
  }
}

function renderMd(body: string) {
  return render(
    <ReactMarkdown rehypePlugins={[rehypeEmojiIcons]} components={components}>
      {body}
    </ReactMarkdown>
  )
}

describe('rehypeEmojiIcons', () => {
  it('replaces a mapped emoji with a Lucide svg', () => {
    const { container } = renderMd('## 📄 Standalone Notes')
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toContain('Standalone Notes')
    expect(container.textContent).not.toContain('📄')
  })

  it('handles multiple emojis in a paragraph', () => {
    const { container } = renderMd('⚠️ warning and ✅ ok')
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(2)
  })

  it('leaves unmapped emojis as text', () => {
    const { container } = renderMd('Hello 🦄')
    expect(container.textContent).toContain('🦄')
  })

  it('skips emojis inside code spans', () => {
    const { container } = renderMd('`📄 raw` and 📄 mapped')
    const codeText = container.querySelector('code')?.textContent ?? ''
    expect(codeText).toContain('📄')
    expect(container.querySelectorAll('svg').length).toBe(1)
  })
})
