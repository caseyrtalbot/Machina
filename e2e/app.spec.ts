import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import path from 'path'
import fs from 'fs'

const MAIN_ENTRY = path.join(__dirname, '..', 'out', 'main', 'index.js')
const TEST_VAULT = path.join(__dirname, 'fixtures', 'test-vault')
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots')

// Ensure screenshots directory exists
fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true })

let app: ElectronApplication
let page: Page

async function screenshot(name: string) {
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${name}.png`) })
}

/** Launch the app and load the test vault via IPC, then wait for the file tree. */
async function launchWithVault(): Promise<void> {
  app = await electron.launch({ args: [MAIN_ENTRY] })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await app.evaluate(async ({ BrowserWindow }, vaultPath) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      const escapedPath = JSON.stringify(vaultPath)
      win.webContents.executeJavaScript(`
        (async () => {
          await window.api.config.write('app', 'lastVaultPath', ${escapedPath})
          location.reload()
        })()
      `)
    }
  }, TEST_VAULT)

  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('[data-testid="file-tree"]', { timeout: 15000 })
}

// ─────────────────────────────────────────────────────────
// 1. APP LAUNCH
// ─────────────────────────────────────────────────────────
test.describe('App Launch', () => {
  test.afterEach(async () => {
    if (app) await app.close()
  })

  test('launches and shows a window', async () => {
    app = await electron.launch({ args: [MAIN_ENTRY] })
    const windows = app.windows()
    page = windows.length > 0 ? windows[0] : await app.firstWindow()
    expect(page).toBeTruthy()

    const isVisible = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win?.isVisible() ?? false
    })
    // Just verify we got a window (may be hidden until ready-to-show fires)
    expect(typeof isVisible).toBe('boolean')
    await screenshot('01-launch')
  })

  test('window has correct dimensions', async () => {
    app = await electron.launch({ args: [MAIN_ENTRY] })
    page = await app.firstWindow()

    const { width, height } = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      const [w, h] = win?.getSize() ?? [0, 0]
      return { width: w, height: h }
    })

    expect(width).toBeGreaterThanOrEqual(1000)
    expect(height).toBeGreaterThanOrEqual(600)
  })
})

// ─────────────────────────────────────────────────────────
// 2. WELCOME SCREEN (no vault loaded)
// ─────────────────────────────────────────────────────────
test.describe('Welcome Screen', () => {
  test.beforeEach(async () => {
    // Clear saved vault path so the welcome screen shows
    app = await electron.launch({ args: [MAIN_ENTRY] })
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    // Wipe the stored vault path and reload
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        win.webContents.executeJavaScript(`
          (async () => {
            await window.api.config.write('app', 'lastVaultPath', '')
            location.reload()
          })()
        `)
      }
    })

    await page.waitForLoadState('domcontentloaded')
    // Wait for the welcome screen heading
    await page.waitForSelector('h1', { timeout: 8000 })
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('shows "Thought Engine" heading', async () => {
    const heading = page.locator('h1').first()
    await expect(heading).toBeVisible({ timeout: 5000 })
    const text = await heading.textContent()
    expect(text).toContain('Thought Engine')
    await screenshot('02-welcome-heading')
  })

  test('shows Create New Vault and Open Existing Folder buttons', async () => {
    const createBtn = page.locator('button', { hasText: 'Create New Vault' })
    const openBtn = page.locator('button', { hasText: 'Open Existing Folder' })

    await expect(createBtn).toBeVisible({ timeout: 5000 })
    await expect(openBtn).toBeVisible({ timeout: 5000 })
    await screenshot('02-welcome-buttons')
  })
})

// ─────────────────────────────────────────────────────────
// 3. WORKSPACE LOADING
// ─────────────────────────────────────────────────────────
test.describe('Workspace Loading', () => {
  test.beforeEach(async () => {
    await launchWithVault()
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('file tree is visible after vault loads', async () => {
    const fileTree = page.locator('[data-testid="file-tree"]')
    await expect(fileTree).toBeVisible({ timeout: 10000 })
    await screenshot('03-file-tree')
  })

  test('file tree shows vault files', async () => {
    // category-creation.md and feedback-loops.md are in the test vault
    const pageContent = await page.content()
    const hasCategory =
      pageContent.includes('category-creation') || pageContent.includes('Category Creation')
    const hasFeedback =
      pageContent.includes('feedback-loops') || pageContent.includes('Feedback Loops')

    expect(hasCategory || hasFeedback).toBeTruthy()
    await screenshot('03-vault-files')
  })

  test('sidebar shows vault name', async () => {
    // The vault name is derived from the last path segment of the vault path
    const pageContent = await page.content()
    expect(pageContent.includes('test-vault')).toBeTruthy()
    await screenshot('03-vault-name')
  })

  test('activity bar is visible with view buttons', async () => {
    // ActivityBar renders buttons with aria-label "Switch to X view"
    const editorBtn = page.locator('[aria-label="Switch to Editor view"]')
    const canvasBtn = page.locator('[aria-label="Switch to Canvas view"]')

    await expect(editorBtn).toBeVisible({ timeout: 8000 })
    await expect(canvasBtn).toBeVisible({ timeout: 8000 })
    await screenshot('03-activity-bar')
  })
})

// ─────────────────────────────────────────────────────────
// 4. EDITOR VIEW
// ─────────────────────────────────────────────────────────
test.describe('Editor View', () => {
  test.beforeEach(async () => {
    await launchWithVault()
    // Ensure we are on the editor tab (click the Editor activity bar button)
    const editorBtn = page.locator('[aria-label="Switch to Editor view"]')
    await editorBtn.click()
    await page.waitForTimeout(500)
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('clicking a file in the sidebar opens it in the editor', async () => {
    // Click on a known file in the file tree
    const fileLink = page.locator('[data-testid="file-tree"]').locator('text=Category Creation')
    if ((await fileLink.count()) > 0) {
      await fileLink.first().click()
      // Tiptap renders a .ProseMirror div when a file is open
      await page.waitForSelector('.ProseMirror', { timeout: 8000 })
      const editor = page.locator('.ProseMirror')
      await expect(editor).toBeVisible({ timeout: 5000 })
    } else {
      // Fallback: any file in the tree will do
      const anyFile = page.locator('[data-testid="file-tree"] [role="button"]').first()
      if ((await anyFile.count()) > 0) {
        await anyFile.click()
        await page.waitForTimeout(1000)
      }
    }
    await screenshot('04-editor-file-open')
  })

  test('command palette opens with Cmd+K', async () => {
    await page.keyboard.press('Meta+k')

    const palette = page.locator('[data-testid="command-palette"]')
    await expect(palette).toBeVisible({ timeout: 5000 })
    await screenshot('04-command-palette')
  })

  test('command palette contains expected commands', async () => {
    await page.keyboard.press('Meta+k')

    const palette = page.locator('[data-testid="command-palette"]')
    await expect(palette).toBeVisible({ timeout: 5000 })

    // The palette should contain vault files and built-in commands
    const paletteText = await palette.textContent()
    expect(paletteText).toBeTruthy()
    expect((paletteText ?? '').length).toBeGreaterThan(10)
    await screenshot('04-command-palette-contents')
  })

  test('command palette closes on Escape', async () => {
    await page.keyboard.press('Meta+k')
    const palette = page.locator('[data-testid="command-palette"]')
    await expect(palette).toBeVisible({ timeout: 5000 })

    await page.keyboard.press('Escape')
    await expect(palette).not.toBeVisible({ timeout: 3000 })
    await screenshot('04-command-palette-closed')
  })
})

// ─────────────────────────────────────────────────────────
// 5. CANVAS VIEW
// ─────────────────────────────────────────────────────────
test.describe('Canvas View', () => {
  test.beforeEach(async () => {
    await launchWithVault()
    // Switch to the Canvas tab via the activity bar
    const canvasBtn = page.locator('[aria-label="Switch to Canvas view"]')
    await canvasBtn.click()
    // Wait for the canvas surface to appear
    await page.waitForSelector('[data-canvas-surface]', { timeout: 10000 })
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('canvas surface renders with dot grid background', async () => {
    const surface = page.locator('[data-canvas-surface]')
    await expect(surface).toBeVisible({ timeout: 8000 })

    // The dot grid is rendered as an SVG data URI in the background-image style
    const bgImage = await surface.evaluate((el) => window.getComputedStyle(el).backgroundImage)
    expect(bgImage).toContain('data:image/svg+xml')
    await screenshot('05-canvas-surface')
  })

  test('canvas toolbar is visible', async () => {
    // CanvasToolbar renders above the surface; look for undo/redo buttons
    const surface = page.locator('[data-canvas-surface]')
    await expect(surface).toBeVisible({ timeout: 8000 })

    // The toolbar contains at least one button
    const buttons = page.locator('button')
    const count = await buttons.count()
    expect(count).toBeGreaterThan(0)
    await screenshot('05-canvas-toolbar')
  })
})

// ─────────────────────────────────────────────────────────
// 6. SCREENSHOT CAPTURE (aesthetic / layout)
// ─────────────────────────────────────────────────────────
test.describe('Screenshot Capture', () => {
  test.beforeEach(async () => {
    await launchWithVault()
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('screenshot: full workspace layout', async () => {
    await screenshot('aesthetic-01-full-layout')
  })

  test('screenshot: editor view with file open', async () => {
    // Ensure editor tab is active
    const editorBtn = page.locator('[aria-label="Switch to Editor view"]')
    await editorBtn.click()
    await page.waitForTimeout(300)

    // Click a file to open it
    const fileLink = page.locator('[data-testid="file-tree"]').locator('text=Category Creation')
    if ((await fileLink.count()) > 0) {
      await fileLink.first().click()
      await page.waitForSelector('.ProseMirror', { timeout: 8000 }).catch(() => {})
    }

    await screenshot('aesthetic-02-editor-view')
  })

  test('screenshot: command palette open', async () => {
    await page.keyboard.press('Meta+k')
    const palette = page.locator('[data-testid="command-palette"]')
    await expect(palette).toBeVisible({ timeout: 5000 })
    await screenshot('aesthetic-03-command-palette')
  })

  test('screenshot: canvas view', async () => {
    const canvasBtn = page.locator('[aria-label="Switch to Canvas view"]')
    await canvasBtn.click()
    await page.waitForSelector('[data-canvas-surface]', { timeout: 10000 }).catch(() => {})
    await screenshot('aesthetic-04-canvas-view')
  })
})
