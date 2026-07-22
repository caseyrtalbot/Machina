# ADR 0005: Design constitution — constants over configuration

**Status:** Accepted (2026-07-22)

## Context

The 2026-07-22 cold review found the token substrate genuinely strong (OKLCH artifact
palette, CSS-var tokens, near-zero stray hexes) but the layer above it incoherent:
eight user-adjustable appearance axes in settings (accent presets + custom hex,
opacity, blur, font sizes, density, radii, background tint, canvas grid), three
coexisting styling mechanisms (~889 inline `style={{}}` objects, a 3,200+-line `te-`
CSS layer, vestigial Tailwind), hand-rolled `useState` hover states, and era-seam
inconsistencies across panels.

Diagnosis: the "cheap, plastic, bolt-on" feel is not in the pixels; it is in shipping
the configuration space instead of a curated point in it. Product-grade apps (Linear,
Claude Desktop, Codex, Raycast) ship one meticulously tuned design and delete every
knob that would let a user leave it. Eight axes means thousands of combinations no
designing eye ever saw.

## Decision

Appearance is a set of **ratified constants, not preferences**.

1. **All appearance settings are removed.** Accent picking (including custom hex),
   opacity, blur, font sizes, density, radii, background tint, and canvas grid are
   deleted from settings UI and `settings-store`; each becomes a fixed, deliberately
   chosen token value. Single accent: ember.
2. **One styling mechanism.** `design/tokens.ts` CSS vars + the `te-` class vocabulary
   are the mechanism. Tailwind is removed. Static inline style objects migrate to
   classes; dynamic values (canvas transforms, computed positions) are exempt.
3. **Typography.** System stack (`system-ui`, SF Pro on macOS) for UI; one mono face
   for terminals/code. Fixed modular scale (~5–6 sizes, 13px UI base), tokenized line
   heights, `font-variant-numeric: tabular-nums` on all numeric UI (spend, counts,
   timestamps, exit codes), antialiased smoothing, per-size letter-spacing.
4. **Color.** The full neutral ramp is generated in OKLCH: constant hue with a slight
   warm cast under ember, chroma 0.005–0.015, ~10 steps, never pure black or white.
   Exactly three text levels and two border levels derive from it.
5. **Material.** Four elevation levels — void, surface, raised, overlay — each a fixed
   tuple of background, border, shadow, blur. The former opacity/blur user axes
   dissolve into these constants.
6. **Motion.** Three duration tokens (~100/180/280ms), two easing tokens (ease-out
   enter, ease-in exit), transform/opacity only, `prefers-reduced-motion` respected.
   Every transition draws from this vocabulary.
7. **Interaction states.** Tokenized CSS `:hover`/`:active`/`:focus-visible`/disabled
   on every primitive; one focus-ring token everywhere; no `useState` hover handlers.

## Enforcement (permanent invariants once landed)

- **Contrast as a unit test**: WCAG contrast ratios for token pairs asserted in
  vitest; a palette change that breaks readability fails CI.
- **Dev-only component gallery route** enumerating every primitive in every state
  (hover, focus, disabled, loading, empty, error).
- **Visual regression**: Playwright screenshot assertions over the gallery route and
  the main shell (`workers:1` already gives stable rendering).
- **Greppable gates**: zero static inline `style={{}}` (dynamic exemptions
  documented), zero hex literals outside palette definitions, zero `useState` hover
  handlers, zero `transition` declarations not drawn from motion tokens, zero
  Tailwind references, no appearance axes in `settings-store`.

## Consequences

- The old Phase 4 ("micro-polish", open-ended) is replaced by a bounded retune
  program with the gates above as its definition of done (Plan of record, Layer 4).
- The "local-first fonts" backlog item is superseded: system stack + one bundled mono
  means no font downloads and no user font picks.
- New surfaces built after the enforcement machinery lands (fleet surface, projection
  canvas) inherit first-class rendering by construction.
- Reintroducing a user-facing appearance control, a second styling mechanism, or an
  off-vocabulary transition is a regression against this ADR.

Plan of record: `docs/PLAN.md`.
