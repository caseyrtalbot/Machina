/**
 * OKLCH → Hex conversion script.
 *
 * Computes sRGB hex equivalents for the perceptually uniform OKLCH palette
 * used by Machina's design tokens. Run once to generate hex values,
 * then copy them into tokens.ts.
 *
 * Math: OKLCH → OKLab → linear sRGB → sRGB (gamma) → hex
 * Reference: Björn Ottosson, "A perceptual color space for image processing"
 *
 * Usage: node scripts/oklch-to-hex.mjs
 */

// OKLCH → OKLab
function oklchToOklab(L, C, H) {
  const hRad = (H * Math.PI) / 180
  return { L, a: C * Math.cos(hRad), b: C * Math.sin(hRad) }
}

// OKLab → linear sRGB (via LMS intermediate)
function oklabToLinearSrgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b

  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_

  return {
    r: +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  }
}

// Linear sRGB → sRGB (gamma correction)
function linearToSrgb(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}

// Full pipeline: OKLCH → hex with gamut clamping
function oklchToHex(L, C, H) {
  const lab = oklchToOklab(L, C, H)
  const linear = oklabToLinearSrgb(lab.L, lab.a, lab.b)

  let clamped = false
  const clamp = (v) => {
    if (v < 0 || v > 1) clamped = true
    return Math.max(0, Math.min(1, v))
  }

  const r = Math.round(linearToSrgb(clamp(linear.r)) * 255)
  const g = Math.round(linearToSrgb(clamp(linear.g)) * 255)
  const b = Math.round(linearToSrgb(clamp(linear.b)) * 255)

  const hex = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')

  return { hex, clamped }
}

// ── Palette definitions ─────────────────────────────────────────────────

const artifactTypes = [
  { name: 'gene', L: 0.75, C: 0.15, H: 175 },
  { name: 'constraint', L: 0.75, C: 0.15, H: 25 },
  { name: 'research', L: 0.75, C: 0.15, H: 290 },
  { name: 'output', L: 0.75, C: 0.15, H: 340 },
  { name: 'note', L: 0.75, C: 0.03, H: 260 },
  { name: 'index', L: 0.75, C: 0.15, H: 230 },
  { name: 'session', L: 0.75, C: 0.15, H: 155 },
  { name: 'pattern', L: 0.75, C: 0.15, H: 80 },
  { name: 'tension', L: 0.75, C: 0.15, H: 15 }
]

const edgeKinds = [
  { name: 'connection', L: 0.55, C: 0.03, H: 255 },
  { name: 'cluster', L: 0.75, C: 0.15, H: 160 },
  { name: 'tension', L: 0.78, C: 0.16, H: 80 },
  { name: 'related', L: 0.68, C: 0.14, H: 290 },
  { name: 'co_occurrence', L: 0.45, C: 0.02, H: 255 },
  { name: 'appears_in', L: 0.55, C: 0.03, H: 255 },
  { name: 'causal', L: 0.7, C: 0.15, H: 340 }
]

// Custom type palette: 9 evenly spaced hues avoiding built-in collisions
const customHues = [45, 100, 135, 195, 215, 250, 275, 310, 355]
const customPalette = customHues.map((H, i) => ({
  name: `custom_${i}`,
  L: 0.75,
  C: 0.15,
  H
}))

// ── Output ──────────────────────────────────────────────────────────────

function printSection(title, items) {
  console.log(`\n── ${title} ${'─'.repeat(60 - title.length)}`)
  for (const item of items) {
    const { hex, clamped } = oklchToHex(item.L, item.C, item.H)
    const warn = clamped ? ' ⚠ CLAMPED' : ''
    console.log(`  ${item.name.padEnd(16)} ${hex}  // oklch(${item.L} ${item.C} ${item.H})${warn}`)
  }
}

printSection('Artifact Types', artifactTypes)
printSection('Edge Kinds', edgeKinds)
printSection('Custom Type Palette', customPalette)

// Semantic colors (cluster + tension from edge kinds)
console.log('\n── Semantic Colors ─────────────────────────────────────────')
const cluster = edgeKinds.find((e) => e.name === 'cluster')
const tension = edgeKinds.find((e) => e.name === 'tension')
console.log(`  cluster          ${oklchToHex(cluster.L, cluster.C, cluster.H).hex}`)
console.log(`  tension          ${oklchToHex(tension.L, tension.C, tension.H).hex}`)
