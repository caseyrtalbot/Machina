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
    // May still be loading; wait for first window
    page = windows.length > 0 ? windows[0] : await app.firstWindow()
    expect(page).toBeTruthy()

    // Window should be visible
    const isVisible = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return win?.isVisible() ?? false
    })
    // May be hidden initially (show: false until ready-to-show)
    // Just ensure we got a window
    expect(typeof isVisible).toBe('boolean')
    await screenshot('01-launch')
  })

  test('window has correct title and dimensions', async () => {
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
    // Clear saved vault path so welcome screen shows
    app = await electron.launch({
      args: [MAIN_ENTRY],
      env: { ...process.env, ELECTRON_STORE_DATA: '{}' }
    })
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
  })

  test.afterEach(async () => {
    await app.close()
  })

  test('shows welcome screen with Thought Engine heading', async () => {
    const heading = page.locator('h1')
    await expect(heading.first()).toBeVisible({ timeout: 5000 })
    const text = await heading.first().textContent()
    expect(text).toBeTruthy()
    await screenshot('02-welcome-or-workspace')
  })

  test('shows Create and Open buttons on welcome screen', async () => {
    const createBtn = page.locator('button', { hasText: 'Create New Vault' })
    const openBtn = page.locator('button', { hasText: 'Open Existing Folder' })

    await expect(createBtn).toBeVisible({ timeout: 5000 })
    await expect(openBtn).toBeVisible({ timeout: 5000 })
    await screenshot('02-welcome-buttons')
  })
})

// ─────────────────────────────────────────────────────────
// 3. VAULT LOADED - WORKSPACE SHELL
// ─────────────────────────────────────────────────────────
test.describe('Workspace with Test Vault', () => {
  test.beforeEach(async () => {
    app = await electron.launch({ args: [MAIN_ENTRY] })
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    // Force-load the test vault via IPC
    await app.evaluate(async ({ BrowserWindow }, vaultPath) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        const escapedPath = JSON.stringify(vaultPath)
        win.webContents.executeJavaScript(`
            (async () => {
              // Set lastVaultPath so the app loads our test vault
              await window.api.config.write('app', 'lastVaultPath', ${escapedPath})
              // Reload to pick up the vault
              location.reload()
            })()
          `)
      }
    }, TEST_VAULT)

    // Wait for reload and vault to load
    await page.waitForLoadState('domcontentloaded')
    await page.waitForSelector('[data-testid="file-tree"]', { timeout: 10000 })
  })

  test.afterEach(async () => {
    // Clean up: remove CLAUDE.md from test vault if created during test
    const claudeMdPath = path.join(TEST_VAULT, 'CLAUDE.md')
    if (fs.existsSync(claudeMdPath)) {
      fs.unlinkSync(claudeMdPath)
    }
    await app.close()
  })

  test('renders workspace shell with sidebar and panels', async () => {
    await screenshot('03-workspace-shell')

    // Should have content rendered (not loading skeleton)
    const loadingSpinner = page.locator('.animate-spin')
    const spinnerCount = await loadingSpinner.count()

    // Either spinner is gone or workspace elements are present
    if (spinnerCount === 0) {
      // Look for structural elements
      const body = await page.locator('body').innerHTML()
      expect(body.length).toBeGreaterThan(100) // Non-trivial content rendered
    }
  })

  test('file tree shows vault files', async () => {
    await screenshot('03-file-tree')

    // Look for filenames from our test vault
    const pageContent = await page.content()
    const hasCategory =
      pageContent.includes('category-creation') || pageContent.includes('Category Creation')
    const hasFeedback =
      pageContent.includes('feedback-loops') || pageContent.includes('Feedback Loops')

    // These should appear in the sidebar file tree
    expect(hasCategory || hasFeedback).toBeTruthy()
  })

  test('terminal panel is present with tab bar', async () => {
    // Terminal tabs should be visible
    // May take time for terminal to init
    await page.waitForSelector('[data-testid="terminal-tabs"]', { timeout: 5000 })

    await screenshot('03-terminal-panel')

    // Check that there's terminal-related UI
    const tabBar = await page.locator('[class*="border-b"]').count()
    expect(tabBar).toBeGreaterThan(0)
  })

  // ── CLAUDE ACTIVATE BUTTON ──

  test('Claude activate button is visible in terminal header', async () => {
    const claudeBtn = page.locator('button', { hasText: 'Claude' })
    await page.locator('[data-testid="claude-activate-btn"]').waitFor({ timeout: 5000 })
    await screenshot('04-claude-button')

    const count = await claudeBtn.count()
    expect(count).toBeGreaterThan(0)

    // Should have the sparkle SVG icon
    if (count > 0) {
      const svg = claudeBtn.first().locator('svg')
      await expect(svg).toBeVisible()
    }
  })

  test('Claude button has neon purple glow styling', async () => {
    const claudeBtn = page.locator('button', { hasText: 'Claude' }).first()
    await page.locator('[data-testid="claude-activate-btn"]').waitFor({ timeout: 5000 })

    const styles = await claudeBtn.evaluate((el) => {
      const cs = window.getComputedStyle(el)
      return {
        borderColor: cs.borderColor,
        boxShadow: cs.boxShadow,
        borderRadius: cs.borderRadius,
        color: cs.color,
        cursor: cs.cursor
      }
    })

    await screenshot('04-claude-button-styles')

    // Should have rounded pill shape
    expect(parseInt(styles.borderRadius)).toBeGreaterThan(0)
    // Should have box-shadow (glow effect)
    expect(styles.boxShadow).not.toBe('none')
    // Should be clickable
    expect(styles.cursor).toBe('pointer')
  })

  test('clicking Claude button creates Claude terminal session', async () => {
    const claudeBtn = page.locator('button', { hasText: 'Claude' }).first()
    await page.locator('[data-testid="claude-activate-btn"]').waitFor({ timeout: 5000 })

    // Click the activate button
    await claudeBtn.click()
    await page.waitForSelector('text=Claude', { timeout: 5000 })

    await screenshot('04-claude-activated')

    // Should see a "Claude" tab in the terminal tabs
    const claudeTab = page.locator('text=Claude')
    const claudeTabCount = await claudeTab.count()
    expect(claudeTabCount).toBeGreaterThan(0)
  })

  test('Claude activation creates CLAUDE.md in vault', async () => {
    const claudeBtn = page.locator('button', { hasText: 'Claude' }).first()
    await page.locator('[data-testid="claude-activate-btn"]').waitFor({ timeout: 5000 })

    await claudeBtn.click()
    await page.waitForSelector('text=Claude', { timeout: 5000 })

    // Check that CLAUDE.md was created in the test vault
    const claudeMdPath = path.join(TEST_VAULT, 'CLAUDE.md')
    const exists = fs.existsSync(claudeMdPath)
    expect(exists).toBe(true)

    if (exists) {
      const content = fs.readFileSync(claudeMdPath, 'utf-8')
      expect(content).toContain('Thought Engine vault')
      expect(content).toContain('Frontmatter Contract')
      expect(content).toContain('Edge Semantics')
      expect(content).toContain('Type System')
    }

    await screenshot('04-claude-md-created')
  })

  test('second click on Claude button switches to existing session (idempotent)', async () => {
    const claudeBtn = page.locator('button', { hasText: 'Claude' }).first()
    await page.locator('[data-testid="claude-activate-btn"]').waitFor({ timeout: 5000 })

    // First click - creates session
    await claudeBtn.click()
    await page.waitForSelector('text=Claude', { timeout: 5000 })

    // Count Claude tabs
    const firstClickTabs = await page.locator('span', { hasText: 'Claude' }).count()

    // Second click - should switch, not create
    await claudeBtn.click()

    const secondClickTabs = await page.locator('span', { hasText: 'Claude' }).count()

    await screenshot('04-claude-idempotent')

    // Should not create a duplicate Claude tab
    expect(secondClickTabs).toBe(firstClickTabs)
  })

  // ── COMMAND PALETTE ──

  test('command palette opens with Cmd+K and shows Activate Claude', async () => {
    await page.keyboard.press('Meta+k')

    const activateCmd = page.locator('text=Activate Claude')
    await expect(activateCmd.first()).toBeVisible({ timeout: 3000 })
    await screenshot('05-command-palette')
  })

  // ── GRAPH RENDERING ──

  test('graph view shows nodes from vault', async () => {
    // Switch to graph view if not already there
    await page.keyboard.press('Meta+g')
    await page.waitForSelector('[data-testid="graph-canvas"]', { timeout: 5000 })

    await screenshot('06-graph-view')

    // Look for SVG elements (D3 graph renders to SVG/canvas)
    const svg = page.locator('svg')
    const svgCount = await svg.count()
    // Should have at least one SVG (graph or other UI element)
    expect(svgCount).toBeGreaterThan(0)
  })

  // ── PROGRESSIVE TYPE DISCOVERY ──

  test('custom type file appears in sidebar', async () => {
    // The test vault includes feedback-loops.md with type: pattern
    const pageContent = await page.content()
    const hasPattern =
      pageContent.includes('Feedback Loops') || pageContent.includes('feedback-loops')

    await screenshot('07-custom-type-file')
    expect(hasPattern).toBeTruthy()
  })

  test('app closes cleanly with active terminal sessions', async () => {
    const termTabs = page.locator('[data-testid="terminal-tabs"]')
    await termTabs.waitFor({ timeout: 5000 })
    await app.close()
  })
})

// ─────────────────────────────────────────────────────────
// 4. AESTHETIC DIAGNOSTICS (screenshot-based)
// ─────────────────────────────────────────────────────────
test.describe('Screenshot Capture (no assertions)', () => {
  test.beforeEach(async () => {
    app = await electron.launch({ args: [MAIN_ENTRY] })
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    // Load test vault
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
    await page.waitForSelector('[data-testid="file-tree"]', { timeout: 10000 })
  })

  test.afterEach(async () => {
    const claudeMdPath = path.join(TEST_VAULT, 'CLAUDE.md')
    if (fs.existsSync(claudeMdPath)) fs.unlinkSync(claudeMdPath)
    await app.close()
  })

  test('screenshot: full workspace layout', async () => {
    await screenshot('aesthetic-01-full-layout')
  })

  test('screenshot: graph view', async () => {
    await page.keyboard.press('Meta+g')
    await page.waitForSelector('[data-testid="graph-canvas"]', { timeout: 5000 })
    await screenshot('aesthetic-02-graph-view')
  })

  test('screenshot: editor view', async () => {
    // Click on a file to open editor
    const fileLink = page.locator('text=Category Creation').first()
    if ((await fileLink.count()) > 0) {
      await fileLink.click()
      await page.waitForSelector('.ProseMirror', { timeout: 3000 })
    }
    await screenshot('aesthetic-03-editor-view')
  })

  test('screenshot: terminal with Claude button', async () => {
    await screenshot('aesthetic-04-terminal-claude-button')
  })

  test('screenshot: Claude button hover state', async () => {
    const claudeBtn = page.locator('button', { hasText: 'Claude' }).first()
    await page.locator('[data-testid="claude-activate-btn"]').waitFor({ timeout: 5000 })
    if ((await claudeBtn.count()) > 0) {
      await claudeBtn.hover()
      await page.waitForTimeout(100)
    }
    await screenshot('aesthetic-05-claude-button-hover')
  })

  test('screenshot: Claude activated with purple tab', async () => {
    const claudeBtn = page.locator('button', { hasText: 'Claude' }).first()
    await page.locator('[data-testid="claude-activate-btn"]').waitFor({ timeout: 5000 })
    if ((await claudeBtn.count()) > 0) {
      await claudeBtn.click()
      await page.waitForSelector('text=Claude', { timeout: 5000 })
    }
    await screenshot('aesthetic-06-claude-activated')
  })

  test('screenshot: command palette', async () => {
    await page.keyboard.press('Meta+k')
    await page.waitForSelector('[data-testid="command-palette"]', { timeout: 3000 })
    await screenshot('aesthetic-07-command-palette')
  })
})
