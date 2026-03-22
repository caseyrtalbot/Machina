import type { Extension } from '@codemirror/state'

export const LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'json',
  'html',
  'css',
  'plaintext'
] as const

export type SupportedLanguage = (typeof LANGUAGES)[number]

export async function loadLanguageExtension(lang: SupportedLanguage): Promise<Extension | null> {
  switch (lang) {
    case 'typescript': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({ typescript: true })
    }
    case 'javascript': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript()
    }
    case 'python': {
      const { python } = await import('@codemirror/lang-python')
      return python()
    }
    case 'json': {
      const { json } = await import('@codemirror/lang-json')
      return json()
    }
    case 'html': {
      const { html } = await import('@codemirror/lang-html')
      return html()
    }
    case 'css': {
      const { css } = await import('@codemirror/lang-css')
      return css()
    }
    default:
      return null
  }
}
