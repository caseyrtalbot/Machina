interface GlowSprite {
  bitmap: ImageBitmap | { width: number; height: number; close: () => void }
  width: number
  height: number
}

const GLOW_PADDING = 16
const AMBIENT_BLUR = 8

function createGlowSprite(color: string, radius: number): GlowSprite {
  const size = (radius + GLOW_PADDING) * 2
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
  const center = size / 2

  // Ambient glow layer
  ctx.shadowColor = color
  ctx.shadowBlur = AMBIENT_BLUR
  ctx.globalAlpha = 0.3
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(center, center, radius, 0, Math.PI * 2)
  ctx.fill()

  // Solid core layer
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.globalAlpha = 1
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(center, center, radius, 0, Math.PI * 2)
  ctx.fill()

  return { bitmap: canvas.transferToImageBitmap(), width: size, height: size }
}

export class GlowSpriteCache {
  private cache = new Map<string, GlowSprite>()

  get(color: string, radius: number): GlowSprite {
    const key = `${color}:${radius}`
    const cached = this.cache.get(key)
    if (cached !== undefined) {
      return cached
    }
    const sprite = createGlowSprite(color, radius)
    this.cache.set(key, sprite)
    return sprite
  }

  clear(): void {
    for (const sprite of this.cache.values()) {
      sprite.bitmap.close()
    }
    this.cache.clear()
  }
}

export function drawGlowSprite(
  ctx: CanvasRenderingContext2D,
  sprite: GlowSprite,
  x: number,
  y: number,
  alpha: number
): void {
  const previousAlpha = ctx.globalAlpha
  ctx.globalAlpha = alpha
  ctx.drawImage(
    sprite.bitmap as CanvasImageSource,
    x - sprite.width / 2,
    y - sprite.height / 2
  )
  ctx.globalAlpha = previousAlpha
}
