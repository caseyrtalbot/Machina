import { describe, it, expect } from 'vitest'
import { inferCardType, inferLanguage, TE_FILE_MIME } from '../../src/renderer/src/panels/canvas/file-drop-utils'

describe('file-drop-utils', () => {
  describe('inferCardType', () => {
    it('infers note for .md files', () => {
      expect(inferCardType('/vault/notes/ideas.md')).toBe('note')
    })

    it('infers code for source files', () => {
      expect(inferCardType('/src/app.ts')).toBe('code')
      expect(inferCardType('/src/app.tsx')).toBe('code')
      expect(inferCardType('/src/main.js')).toBe('code')
      expect(inferCardType('/src/script.py')).toBe('code')
      expect(inferCardType('/config.json')).toBe('code')
      expect(inferCardType('/index.html')).toBe('code')
      expect(inferCardType('/styles.css')).toBe('code')
      expect(inferCardType('/main.go')).toBe('code')
      expect(inferCardType('/lib.rs')).toBe('code')
    })

    it('infers image for image files', () => {
      expect(inferCardType('/img/photo.png')).toBe('image')
      expect(inferCardType('/img/photo.jpg')).toBe('image')
      expect(inferCardType('/img/photo.jpeg')).toBe('image')
      expect(inferCardType('/img/logo.svg')).toBe('image')
      expect(inferCardType('/img/anim.gif')).toBe('image')
      expect(inferCardType('/img/photo.webp')).toBe('image')
    })

    it('falls back to text for unknown extensions', () => {
      expect(inferCardType('/readme.txt')).toBe('text')
      expect(inferCardType('/data.csv')).toBe('text')
      expect(inferCardType('/something')).toBe('text')
    })

    it('is case-insensitive on extensions', () => {
      expect(inferCardType('/photo.PNG')).toBe('image')
      expect(inferCardType('/app.TS')).toBe('code')
    })
  })

  describe('inferLanguage', () => {
    it('infers typescript for .ts/.tsx', () => {
      expect(inferLanguage('/app.ts')).toBe('typescript')
      expect(inferLanguage('/app.tsx')).toBe('typescript')
    })

    it('infers javascript for .js/.jsx', () => {
      expect(inferLanguage('/app.js')).toBe('javascript')
      expect(inferLanguage('/app.jsx')).toBe('javascript')
    })

    it('infers python for .py', () => {
      expect(inferLanguage('/script.py')).toBe('python')
    })

    it('infers json for .json', () => {
      expect(inferLanguage('/config.json')).toBe('json')
    })

    it('infers html for .html', () => {
      expect(inferLanguage('/index.html')).toBe('html')
    })

    it('infers css for .css/.scss', () => {
      expect(inferLanguage('/styles.css')).toBe('css')
      expect(inferLanguage('/styles.scss')).toBe('css')
    })

    it('falls back to plaintext for unknown', () => {
      expect(inferLanguage('/main.rs')).toBe('plaintext')
      expect(inferLanguage('/go.mod')).toBe('plaintext')
    })
  })

  describe('TE_FILE_MIME', () => {
    it('is a custom MIME type', () => {
      expect(TE_FILE_MIME).toBe('application/x-te-file')
    })
  })
})
