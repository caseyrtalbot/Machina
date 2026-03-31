import { describe, it, expect } from 'vitest'
import { extractImportSpecifiers } from '@shared/engine/project-map-analyzers'

describe('extractImportSpecifiers', () => {
  it('extracts named import', () => {
    const code = `import { foo } from './bar'`
    expect(extractImportSpecifiers(code)).toEqual(['./bar'])
  })

  it('extracts default import', () => {
    const code = `import Foo from './Foo'`
    expect(extractImportSpecifiers(code)).toEqual(['./Foo'])
  })

  it('extracts star import', () => {
    const code = `import * as utils from '../utils'`
    expect(extractImportSpecifiers(code)).toEqual(['../utils'])
  })

  it('extracts re-export', () => {
    const code = `export { thing } from './thing'`
    expect(extractImportSpecifiers(code)).toEqual(['./thing'])
  })

  it('extracts dynamic import', () => {
    const code = `const mod = await import('./lazy')`
    expect(extractImportSpecifiers(code)).toEqual(['./lazy'])
  })

  it('extracts require', () => {
    const code = `const x = require('./cjs-mod')`
    expect(extractImportSpecifiers(code)).toEqual(['./cjs-mod'])
  })

  it('extracts multiple imports', () => {
    const code = [
      `import { a } from './a'`,
      `import b from './b'`,
      `const c = require('./c')`
    ].join('\n')
    expect(extractImportSpecifiers(code)).toEqual(['./a', './b', './c'])
  })

  it('skips bare package specifiers', () => {
    const code = `import React from 'react'\nimport { join } from 'path'`
    expect(extractImportSpecifiers(code)).toEqual([])
  })

  it('skips URL imports', () => {
    const code = `import 'https://cdn.example.com/lib.js'`
    expect(extractImportSpecifiers(code)).toEqual([])
  })

  it('skips alias imports (non-relative)', () => {
    const code = `import { foo } from '@shared/types'`
    expect(extractImportSpecifiers(code)).toEqual([])
  })
})
