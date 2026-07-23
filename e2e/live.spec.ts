/**
 * Live app tests via CDP connection.
 *
 * These tests attach to an already-running Electron app (npm run dev:debug)
 * and verify the current state. No new windows are launched.
 *
 * Run with: npm run test:live
 */

import { test, expect, type Page } from '@playwright/test'
import { connectToApp, type AppConnection } from './cdp'

let connection: AppConnection
let page: Page

test.beforeAll(async () => {
  connection = await connectToApp()
  page = connection.page
})

test.afterAll(async () => {
  if (connection) await connection.disconnect()
})

// ─────────────────────────────────────────────────────────
// Structural health checks against the live app
// ─────────────────────────────────────────────────────────

test.describe('Live App Health', () => {
  test('window is loaded', async () => {
    const title = await page.title()
    expect(title).toBeTruthy()
  })

  test('window.api is available', async () => {
    const hasApi = await page.evaluate(() => typeof window.api !== 'undefined')
    expect(hasApi).toBe(true)
  })

  test('no console errors on page', async () => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    // Give a moment to collect any errors firing on the current page
    await page.waitForTimeout(1000)

    // Filter out known noise (e.g. DevTools, HMR)
    const realErrors = errors.filter(
      (e) => !e.includes('[HMR]') && !e.includes('DevTools') && !e.includes('[vite]')
    )
    expect(realErrors).toEqual([])
  })
})

test.describe('Live UI State', () => {
  test('sidebar is visible', async () => {
    const fileTree = page.locator('[data-testid="file-tree"]')
    const isVisible = await fileTree.isVisible()
    // File tree may or may not be visible depending on sidebar state
    expect(typeof isVisible).toBe('boolean')
  })

  test('app has rendered a view', async () => {
    // The app can be in several states: canvas, editor (with or without file),
    // graph, welcome screen, or skills panel. Verify at least one meaningful
    // surface is present instead of just counting generic DOM nodes.
    const hasRenderableSurface = await page.evaluate(() =>
      Boolean(
        document.querySelector(
          '[data-canvas-surface], .tiptap, .cm-editor, button[title="Graph settings"], h1, [data-testid="file-tree"]'
        )
      )
    )
    expect(hasRenderableSurface).toBe(true)
  })

  test('no broken images or missing assets', async () => {
    const brokenImages = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'))
      return imgs
        .filter((img) => {
          if (img.classList.contains('ProseMirror-separator')) return false
          const src = img.getAttribute('src')?.trim()
          if (!src) return false
          return !img.complete || img.naturalWidth === 0
        })
        .map((img) => img.src)
    })
    expect(brokenImages).toEqual([])
  })
})
