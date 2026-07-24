/**
 * Visual regression (ADR 0005 §Enforcement). Two surfaces:
 *
 *  (a) The dev-only component gallery (`?gallery=1`, opted into here via
 *      TE_GALLERY=1). Per-section screenshots — one baseline per primitive
 *      cluster keeps a regression's blast radius to a single section rather
 *      than one 4K page shot. The gallery is a determinism contract by
 *      construction (no timers, network, IPC, random data, or dates); its
 *      ONLY animated element is the ring spinner, whose section we skip.
 *
 *  (b) The main shell against the test-vault fixture. We shoot the stable
 *      fixture-driven sidebar file tree rather than the whole window, which
 *      keeps timestamps and the accent-tinted canvas empty state (both
 *      nondeterministic) out of frame.
 *
 * Determinism levers: a fixed content size so wrapping never drifts, and
 * `animations: 'disabled'`. Baselines are per-section (small), committed
 * artifacts.
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import path from 'path'

const MAIN_ENTRY = path.join(__dirname, '..', 'out', 'main', 'index.js')
const TEST_VAULT = path.join(__dirname, 'fixtures', 'test-vault')

// Fixed content size so gallery wrapping and the sidebar layout are stable
// across runs. Applied to the web contents area (not the outer window) so the
// renderer viewport is exactly these dimensions.
const CONTENT = { width: 1280, height: 900 } as const

/** Pin the BrowserWindow content size so screenshots are layout-stable. */
async function pinContentSize(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.unmaximize()
      win.setContentSize(size.width, size.height)
    }
  }, CONTENT)
}

// Gallery Section ids (src/renderer/src/design/Gallery.tsx), minus `spinner`
// which is the sole animated element.
const GALLERY_SECTIONS = [
  'color-ramp',
  'signals',
  'text-levels',
  'type-scale',
  'elevation',
  'tabbar',
  'contextmenu',
  'emptystate',
  'loadingstate',
  'panelheader',
  'buttons',
  'inputs'
] as const

// ─────────────────────────────────────────────────────────
// (a) GALLERY — TE_GALLERY=1 renders the enumeration route
// ─────────────────────────────────────────────────────────
test.describe.serial('Visual · gallery', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    app = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, TE_GALLERY: '1' }
    })
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await pinContentSize(app)
    await page.setViewportSize(CONTENT)
    await page.waitForSelector('[data-testid="gallery-root"]', { timeout: 15000 })
    // Fonts drive glyph metrics in every section; wait so the first
    // comparison isn't against a fallback-font paint.
    await page.evaluate(() => document.fonts.ready)
  })

  test.afterAll(async () => {
    if (app) await app.close()
  })

  for (const id of GALLERY_SECTIONS) {
    test(`section ${id}`, async () => {
      const section = page.locator(`[data-testid="gallery-${id}"]`)
      await expect(section).toBeVisible()
      await expect(section).toHaveScreenshot(`gallery-${id}.png`, {
        animations: 'disabled'
      })
    })
  }
})

// ─────────────────────────────────────────────────────────
// (b) MAIN SHELL — test vault, stable sidebar file tree
// ─────────────────────────────────────────────────────────
test.describe.serial('Visual · main shell', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    app = await electron.launch({ args: [MAIN_ENTRY] })
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    // Pin the size BEFORE the reload so the resize can't race the navigation.
    await pinContentSize(app)

    // Point the app at the fixture vault and reload (same pattern as app.spec).
    await app.evaluate(async ({ BrowserWindow }, vaultPath) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        const escapedPath = JSON.stringify(vaultPath)
        await win.webContents.executeJavaScript(`
          (async () => {
            await window.api.config.write('app', 'lastWorkspacePath', ${escapedPath})
            location.reload()
          })()
        `)
      }
    }, TEST_VAULT)

    await page.waitForLoadState('domcontentloaded')

    // Open the right-edge Files side panel (closed by default post agent-shell
    // rework) so the file tree mounts.
    const toggle = page.locator('button[aria-controls="header-files-side-panel"]')
    await toggle.waitFor({ state: 'visible', timeout: 15000 })
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click()
    }
    await page.waitForSelector('[data-testid="file-tree"]', { timeout: 15000 })
    await page.evaluate(() => document.fonts.ready)
  })

  test.afterAll(async () => {
    if (app) await app.close()
  })

  test('sidebar file tree', async () => {
    const fileTree = page.locator('[data-testid="file-tree"]')
    await expect(fileTree).toBeVisible()
    // Guard the cold-start race: wait until the vault's rows have painted so
    // the comparison never catches a mid-populate frame.
    await expect(fileTree.locator('[data-node-name]').first()).toBeVisible()
    await expect(fileTree).toHaveScreenshot('main-shell-file-tree.png', {
      animations: 'disabled'
    })
  })
})
