import { describe, it, expect, beforeEach } from 'vitest'
import { GlowSpriteCache } from '../../src/renderer/src/panels/graph/glowSprites'

class MockContext2D {
  arc() {}
  fill() {}
  beginPath() {}
  set shadowColor(_: string) {}
  set shadowBlur(_: number) {}
  set globalAlpha(_: number) {}
  set fillStyle(_: string) {}
}

class MockOffscreenCanvas {
  width: number
  height: number
  constructor(w: number, h: number) {
    this.width = w
    this.height = h
  }
  getContext() {
    return new MockContext2D()
  }
  transferToImageBitmap() {
    return { width: this.width, height: this.height, close: () => {} }
  }
}

beforeEach(() => {
  globalThis.OffscreenCanvas = MockOffscreenCanvas as any
})

describe('GlowSpriteCache', () => {
  it('creates a sprite for a given color and radius', () => {
    const cache = new GlowSpriteCache()
    const sprite = cache.get('#ff0000', 10)

    expect(sprite).toBeDefined()
    expect(sprite.bitmap).toBeDefined()
    expect(typeof sprite.width).toBe('number')
    expect(typeof sprite.height).toBe('number')
    expect(sprite.width).toBeGreaterThan(0)
    expect(sprite.height).toBeGreaterThan(0)
  })

  it('returns the same sprite for repeated calls with same params', () => {
    const cache = new GlowSpriteCache()
    const first = cache.get('#00ff00', 8)
    const second = cache.get('#00ff00', 8)

    expect(first).toBe(second)
  })

  it('returns different sprites for different colors', () => {
    const cache = new GlowSpriteCache()
    const red = cache.get('#ff0000', 10)
    const blue = cache.get('#0000ff', 10)

    expect(red).not.toBe(blue)
  })

  it('returns different sprites for different radii', () => {
    const cache = new GlowSpriteCache()
    const small = cache.get('#ffffff', 5)
    const large = cache.get('#ffffff', 20)

    expect(small).not.toBe(large)
    expect(small.width).not.toBe(large.width)
  })

  it('clears all cached sprites', () => {
    const cache = new GlowSpriteCache()
    const before = cache.get('#ff0000', 10)
    cache.clear()
    const after = cache.get('#ff0000', 10)

    expect(before).not.toBe(after)
  })
})
