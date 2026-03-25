# Environment Settings Refactor

## Summary

Replace the 6 hardcoded theme presets with 3 themes (Dark, Light, System) and expose granular environment sliders so users can dial in their workspace aesthetic. Canvas translucency, card opacity, blur intensity, panel darkness, font sizes, and grid visibility become user-controllable with live preview.

## Themes

Three themes replace the current six (Midnight, Slate, Obsidian, Nord, Evergreen, Light):

- **Dark**: Deep dark mode (current tuned values)
- **Light**: Clean light mode (existing light theme, adapted)
- **System**: Reads `prefers-color-scheme` media query, maps to Dark or Light, updates live when OS appearance changes

Accent colors remain as 8 preset neon swatches (Matrix, Laser, Synthwave, Hot Pink, Arcade, Phosphor, Plasma, Neon Mint).

## Environment Sliders

New "Environment" tab in the Settings modal with real-time CSS variable updates.

### Canvas Section

| Setting | Key | Range | Dark Default | Light Default |
|---------|-----|-------|-------------|---------------|
| Canvas translucency | `canvasTranslucency` | 0-100 | 40 | 45 |
| Card opacity | `cardOpacity` | 50-100 | 94 | 90 |
| Card header darkness | `cardHeaderDarkness` | 0-60 | 45 | 4 |
| Card blur intensity | `cardBlur` | 0-24 | 12 | 8 |
| Grid dot visibility | `gridDotVisibility` | 0-50 | 20 | 15 |

### Panels Section

| Setting | Key | Range | Dark Default | Light Default |
|---------|-----|-------|-------------|---------------|
| Panel lightness | `panelLightness` | 0-100 | 5 | 98 |
| Activity bar opacity | `activityBarOpacity` | 20-80 | 55 | 12 |

### Typography Section

| Setting | Key | Range | Default |
|---------|-----|-------|---------|
| Card title font size | `cardTitleFontSize` | 10-15 | 12 |
| Sidebar font size | `sidebarFontSize` | 11-16 | 13 |

## Behavior

- Sliders update CSS variables in real-time (live preview as user drags)
- Values persist to localStorage via Zustand persist middleware
- Switching themes resets all environment sliders to that theme's defaults
- System theme listens to `window.matchMedia('(prefers-color-scheme: dark)')` change events
- When theme is System and OS appearance changes, env values are NOT auto-reset. The user's slider customizations persist. Only an explicit theme switch (clicking Dark, Light, or System) triggers a reset.

## Architecture

### Base Colors Per Theme

Sliders that produce `rgba()` output operate on theme-specific base RGB values:

```typescript
const DARK_BASE = {
  canvasSurface: { r: 18, g: 18, b: 20 },
  cardBody: { r: 16, g: 16, b: 20 },
  panelSurface: { r: 14, g: 14, b: 14 },   // derived from panelLightness
  panelElevated: { r: 34, g: 34, b: 34 }    // base + 20 lightness offset
}

const LIGHT_BASE = {
  canvasSurface: { r: 232, g: 236, b: 240 },
  cardBody: { r: 255, g: 255, b: 255 },
  panelSurface: { r: 250, g: 250, b: 250 }, // derived from panelLightness
  panelElevated: { r: 241, g: 245, b: 249 } // base - 4 lightness offset
}
```

### Data Flow

```
settings-store (Zustand + localStorage)
  +-- theme: 'dark' | 'light' | 'system'
  +-- accentColor: AccentColorId
  +-- env: EnvironmentSettings (all slider values)
  +-- setEnv(key, value): updates a single env value
  +-- resetEnv(): resets env to current resolved theme's defaults
  +-- (existing editor/terminal/vault settings unchanged)

ThemeProvider
  +-- resolves theme to Dark or Light (System reads prefers-color-scheme)
  +-- reads env values from store
  +-- converts env numbers to CSS values using theme-specific base colors
  +-- applies all as CSS variables on document.documentElement
  +-- exports env values via ThemeContext for direct consumption
```

### Conversion Logic (centralized in ThemeProvider)

Environment values are stored as simple numbers. ThemeProvider converts them using the resolved theme's base colors:

- `canvasTranslucency: 40` + Dark base `(18,18,20)` becomes `--canvas-surface-bg: rgba(18, 18, 20, 0.60)` (opacity = (100 - translucency) / 100)
- `cardOpacity: 94` + Dark base `(16,16,20)` becomes `--canvas-card-bg: rgba(16, 16, 20, 0.94)` (opacity = value / 100)
- `cardHeaderDarkness: 45` becomes `--canvas-card-title-bg: rgba(0, 0, 0, 0.45)` (same for both themes: black overlay at slider %)
- `cardBlur: 12` becomes backdrop-filter CSS value (consumed by CardShell via ThemeContext, not a CSS var)
- `gridDotVisibility: 20` becomes dot opacity (consumed by CanvasSurface via ThemeContext, not a CSS var)
- `panelLightness: 5` becomes `--color-bg-base: hsl(0, 0%, 5%)` (dark), `panelLightness: 98` becomes `hsl(0, 0%, 98%)` (light). Same formula, different defaults.
- `activityBarOpacity: 55` becomes `rgba(0, 0, 0, 0.55)` for dark, `rgba(0, 0, 0, 0.12)` for light (consumed by ActivityBar via ThemeContext, not a CSS var). Different defaults per theme handle the asymmetry.
- Font sizes applied directly as pixel values via ThemeContext

### Files Modified

| File | Change |
|------|--------|
| `design/themes.ts` | Strip to 2 structural themes (dark/light). Add `ENV_DEFAULTS` per theme with all slider default values. Add `BASE_COLORS` per theme. Remove old 6-theme ThemeId type. |
| `store/settings-store.ts` | Add `env: EnvironmentSettings` object. Add `setEnv(key, value)` and `resetEnv()` actions. Replace top-level `fontSize` with `env.sidebarFontSize`. Delete old `fontSize`/`setFontSize`. Bump persist version to 3. |
| `design/Theme.tsx` | Read env values from store. Add `prefers-color-scheme` listener for System mode. Compute and apply env-derived CSS vars using base colors. Expand ThemeContext to export env values (blur, grid dots, font sizes, activity bar opacity) for components that consume them directly. |
| `design/tokens.ts` | No changes needed. `canvasTokens` continues to reference CSS variables that ThemeProvider sets. Confirmed no-op. |
| `components/SettingsModal.tsx` | Replace 6-theme grid with 3-theme selector (Dark/Light/System). Add Environment tab with grouped sliders. Update tab list. |
| `assets/index.css` | Remove hardcoded canvas CSS variable defaults (now set dynamically by ThemeProvider on mount). |
| `components/ActivityBar.tsx` | Read `activityBarOpacity` from ThemeContext instead of hardcoded `rgba(0,0,0,0.55)`. |
| `panels/canvas/CardShell.tsx` | Read `cardBlur` from ThemeContext for backdrop-filter value. Add `cardTitleFontSize` from ThemeContext to the title bar text span (net-new: title bar currently uses hardcoded 12px at line ~279). |
| `panels/canvas/CanvasSurface.tsx` | Read `gridDotVisibility` from ThemeContext to replace hardcoded `MINOR_OPACITY` constant (line 20). |
| `panels/sidebar/FileTree.tsx` | Read `sidebarFontSize` from settings store. Currently reads `fontSize` from `useSettingsStore`, rename to `env.sidebarFontSize`. |

### Settings Store Shape

```typescript
interface EnvironmentSettings {
  readonly canvasTranslucency: number  // 0-100
  readonly cardOpacity: number         // 50-100
  readonly cardHeaderDarkness: number  // 0-60
  readonly cardBlur: number            // 0-24 (px)
  readonly gridDotVisibility: number   // 0-50
  readonly panelLightness: number      // 0-100 (HSL lightness %)
  readonly activityBarOpacity: number  // 20-80
  readonly cardTitleFontSize: number   // 10-15 (px)
  readonly sidebarFontSize: number     // 11-16 (px)
}

type ThemeId = 'dark' | 'light' | 'system'
```

### Migration

Settings store version bumps from 2 to 3. Migration function:

- Map old `theme` values to new: `midnight | slate | obsidian | nord | evergreen` map to `'dark'`, `light` maps to `'light'`
- Initialize `env` with dark defaults (or light defaults if theme mapped to light)
- Move `state.fontSize ?? 13` to `env.sidebarFontSize`
- Delete old top-level `fontSize` field from persisted state
- If `accentColor` is not in the valid set, default to `'matrix'` (existing behavior, preserve)
