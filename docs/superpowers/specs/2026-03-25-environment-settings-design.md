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
| Panel darkness | `panelDarkness` | 0-30 | 5 | 252 |
| Activity bar opacity | `activityBarOpacity` | 20-80 | 55 | 30 |

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

## Architecture

### Data Flow

```
settings-store (Zustand + localStorage)
  +-- theme: 'dark' | 'light' | 'system'
  +-- accentColor: AccentColorId
  +-- env: EnvironmentSettings (all slider values)
  +-- resetEnv(): resets env to current theme's defaults
  +-- (existing editor/terminal/vault settings unchanged)

ThemeProvider
  +-- resolves theme to Dark or Light (System reads prefers-color-scheme)
  +-- merges env overrides into resolved colors
  +-- converts env numbers to CSS values
  +-- applies all as CSS variables on document.documentElement
```

### Conversion Logic (centralized in ThemeProvider)

Environment values are stored as simple numbers. ThemeProvider converts:

- `canvasTranslucency: 40` becomes `--canvas-surface-bg: rgba(18, 18, 20, 0.60)` (100 - 40 = 60% opacity)
- `cardOpacity: 94` becomes `--canvas-card-bg: rgba(16, 16, 20, 0.94)`
- `cardHeaderDarkness: 45` becomes `--canvas-card-title-bg: rgba(0, 0, 0, 0.45)`
- `cardBlur: 12` becomes backdrop-filter value (consumed by CardShell)
- `gridDotVisibility: 20` becomes dot opacity (consumed by CanvasSurface)
- `panelDarkness: 5` becomes `--color-bg-base: hsl(0, 0%, 5%)`
- `activityBarOpacity: 55` becomes `rgba(0, 0, 0, 0.55)` (consumed by ActivityBar)
- Font sizes applied directly as pixel values

### Files Modified

| File | Change |
|------|--------|
| `design/themes.ts` | Strip to 2 structural themes (dark/light). Add `ENV_DEFAULTS` per theme. Remove old ThemeId/ThemeDefinition for 6 themes. |
| `store/settings-store.ts` | Add `env: EnvironmentSettings` object. Add `setEnv(key, value)` and `resetEnv()` actions. Replace `fontSize` with `env.sidebarFontSize`. Bump persist version. |
| `design/Theme.tsx` | Read env values from store. Add `prefers-color-scheme` listener for System mode. Compute and apply env-derived CSS vars. Export env values via context for components that read them directly (blur, grid dots, font sizes). |
| `components/SettingsModal.tsx` | Replace 6-theme grid with 3-theme selector (Dark/Light/System). Add Environment tab with grouped sliders. Update tab list. |
| `assets/index.css` | Remove hardcoded canvas CSS variable defaults (now set dynamically). |
| `components/ActivityBar.tsx` | Read `activityBarOpacity` from theme context instead of hardcoded value. |
| `panels/canvas/CardShell.tsx` | Read `cardBlur` and `cardTitleFontSize` from theme context instead of hardcoded values. |
| `panels/canvas/CanvasSurface.tsx` | Read `gridDotVisibility` from theme context instead of hardcoded `MINOR_OPACITY`. |
| `panels/sidebar/FileTree.tsx` | Read `sidebarFontSize` from settings store (replaces existing `fontSize` usage). |

### Settings Store Shape

```typescript
interface EnvironmentSettings {
  readonly canvasTranslucency: number
  readonly cardOpacity: number
  readonly cardHeaderDarkness: number
  readonly cardBlur: number
  readonly gridDotVisibility: number
  readonly panelDarkness: number
  readonly activityBarOpacity: number
  readonly cardTitleFontSize: number
  readonly sidebarFontSize: number
}

type ThemeId = 'dark' | 'light' | 'system'
```

### Migration

Settings store version bumps from 2 to 3. Migration:
- Map old `theme` values to new: midnight/slate/obsidian/nord/evergreen map to `'dark'`, light maps to `'light'`
- Initialize `env` with dark defaults
- Move old `fontSize` to `env.sidebarFontSize`
