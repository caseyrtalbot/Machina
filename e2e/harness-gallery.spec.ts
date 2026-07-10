/**
 * Built-app Step 8 proof: the ten-card gallery, blank/configured builders,
 * refuse-before-write creation contract, mandatory per-run task brief, and
 * raw invocation configuration all cross the real renderer → preload → main
 * boundary against a throwaway workspace.
 *
 * The probe deliberately does not run the configured raw command. Its command
 * would create a sentinel file if executed; creation must only round-trip the
 * template into SKILL.md. The structured harness launch persists its exact
 * operator-task section before any external CLI response, so model output is
 * not used as evidence.
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'

const MAIN_ENTRY = path.join(__dirname, '..', 'out', 'main', 'index.js')
const TEST_VAULT = path.join(__dirname, 'fixtures', 'test-vault')
const TE_DIR = '.machina'
const CUSTOM_SLUG = 'e2e-custom-agent'
const RAW_SLUG = 'e2e-raw-tool'
const TASK_BRIEF = 'Audit category creation and report the exact repository evidence.'
const RAW_SENTINEL = 'raw-gallery-must-not-execute'
const RAW_INVOCATION = `touch '${RAW_SENTINEL}' {prompt}`
const PROTECTED_GLOBS = [
  '.machina/agents/*/verify.sh',
  '.machina/agents/*/rules.md',
  '.machina-dev/agents/*/verify.sh',
  '.machina-dev/agents/*/rules.md'
] as const
const HARNESS_ENTRIES = ['SKILL.md', 'handoffs', 'rules.md', 'scope.json', 'state.md', 'verify.sh']

interface HarnessSummaryShape {
  slug: string
  name: string
  adapter: string | null
  diagnostics: Array<{ severity: string; code: string; message: string; file: string }>
}

interface HarnessSnapshot {
  entries: string[]
  files: Record<string, { content: string; mode: number; mtimeMs: number }>
}

async function launchWithWorkspace(workspacePath: string): Promise<{
  app: ElectronApplication
  page: Page
  restoreSharedState: () => Promise<void>
}> {
  const app = await electron.launch({ args: [MAIN_ENTRY] })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Boot must settle before reading/writing the shared electron-store key.
  // Otherwise App's stale-workspace null-write can race this probe's seed.
  await page
    .locator('[data-testid="approvals-tray-button"]')
    .or(page.getByRole('button', { name: 'Open Folder' }))
    .first()
    .waitFor({ state: 'visible', timeout: 15_000 })

  const previousWorkspace = await page.evaluate(async () => {
    const api = (
      window as unknown as {
        api: { config: { read: (scope: string, key: string) => Promise<string | null> } }
      }
    ).api
    return api.config.read('app', 'lastWorkspacePath')
  })

  await app.evaluate(async ({ BrowserWindow }, wsPath) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      const escapedPath = JSON.stringify(wsPath)
      await win.webContents.executeJavaScript(`
        (async () => {
          await window.api.config.write('app', 'lastWorkspacePath', ${escapedPath})
          location.reload()
        })()
      `)
    }
  }, workspacePath)

  // Locator waits survive the reload; evaluate contexts do not.
  await page.locator('[data-testid="approvals-tray-button"]').waitFor({
    state: 'visible',
    timeout: 15_000
  })

  // The copied fixture intentionally carries welcomed=false. Dismiss its
  // first-run coachmark before exercising modal controls; otherwise the
  // fixed z-index tooltip honestly intercepts pointer events above them.
  const welcome = page.getByRole('dialog', { name: 'welcome' })
  await expect(welcome).toBeVisible({ timeout: 5_000 })
  await welcome.getByRole('button', { name: 'Got it' }).click()
  await expect(welcome).toHaveCount(0)

  return {
    app,
    page,
    restoreSharedState: async () => {
      await page.evaluate(async (previous) => {
        const api = (
          window as unknown as {
            api: {
              config: {
                write: (scope: string, key: string, value: unknown) => Promise<void>
              }
            }
          }
        ).api
        await api.config.write('app', 'lastWorkspacePath', previous)
      }, previousWorkspace)
    }
  }
}

async function openGallery(page: Page) {
  await page.getByRole('button', { name: 'Create a local agent' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create a local agent' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function listHarnesses(page: Page): Promise<HarnessSummaryShape[]> {
  return page.evaluate(() => {
    const api = (
      window as unknown as {
        api: { harness: { list: () => Promise<HarnessSummaryShape[]> } }
      }
    ).api
    return api.harness.list()
  })
}

function snapshotHarness(dir: string): HarnessSnapshot {
  const entries = readdirSync(dir).sort()
  const files: HarnessSnapshot['files'] = {}
  for (const name of entries) {
    const filePath = path.join(dir, name)
    const stat = statSync(filePath)
    if (!stat.isFile()) continue
    files[name] = {
      content: readFileSync(filePath, 'utf8'),
      mode: stat.mode & 0o7777,
      mtimeMs: stat.mtimeMs
    }
  }
  return { entries, files }
}

function structuredThreadFor(root: string, slug: string): string {
  const dir = path.join(root, TE_DIR, 'threads')
  if (!existsSync(dir)) return ''
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const content = readFileSync(path.join(dir, name), 'utf8')
    if (content.includes(`agent_id: ${slug}`)) return content
  }
  return ''
}

test.describe.serial('Harness gallery + blank builder (built app)', () => {
  test('gallery → blank create/run → duplicate refusal → configured raw round-trip', async () => {
    test.setTimeout(180_000)
    const root = mkdtempSync(path.join(tmpdir(), 'te-harness-gallery-'))
    cpSync(TEST_VAULT, root, { recursive: true })

    const { app, page, restoreSharedState } = await launchWithWorkspace(root)
    try {
      // ── 1. Gallery opens from the visible sidebar New Agent UI ───────
      let gallery = await openGallery(page)
      const cards = gallery.locator('[data-testid^="harness-template-card-"]')
      await expect(cards).toHaveCount(10)
      for (const id of ['idea-to-spec', 'boundary-auditor', 'test-fixer', 'raw-tool-runner']) {
        await expect(gallery.getByTestId(`harness-template-card-${id}`)).toBeVisible()
      }

      // Combined category + audience filtering uses the shared metadata.
      const categories = gallery.getByRole('group', { name: 'Filter templates by category' })
      await categories.getByRole('button', { name: 'Architecture', exact: true }).click()
      await expect(cards).toHaveCount(3)
      await gallery.getByLabel('Filter templates by audience').selectOption('seasoned-programmer')
      await expect(cards).toHaveCount(2)
      await expect(gallery.getByTestId('harness-template-card-architecture-mapper')).toBeVisible()
      await expect(gallery.getByTestId('harness-template-card-boundary-auditor')).toBeVisible()
      await expect(gallery.getByTestId('harness-template-card-migration-planner')).toHaveCount(0)

      // ── 2. Blank builder: live refusal, custom scope, safe creation ──
      await gallery.getByRole('button', { name: 'Build blank', exact: true }).click()
      const diagnostics = gallery.getByLabel('Harness diagnostics')
      const create = gallery.getByRole('button', { name: 'Create local harness' })
      await expect(create).toBeDisabled()
      await expect(diagnostics).toContainText('slug is required')
      await expect(diagnostics).toContainText('verifyCommand is required')

      await gallery.getByLabel('Slug').fill(CUSTOM_SLUG)
      await gallery.getByLabel('Description').fill('Audits one category-creation workflow.')
      await gallery
        .getByLabel('Role / operating instructions')
        .fill('Audit one requested workflow, report repository evidence, and stop.')
      await gallery.getByLabel('Goal').fill('Audit one category-creation workflow.')
      await gallery.getByLabel('Allowed globs').fill('notes/**\n<dir>/state.md')
      // Deliberately omit protected globs: overrides-present creation must
      // constructively union them into the final contract.
      await gallery.getByLabel('Forbidden globs').fill('.git/**')
      await gallery
        .getByLabel('Acceptance')
        .fill('The report names the current behavior and repository evidence.')
      await gallery.getByLabel('Rollback').fill('Reject the pending change in the tray.')
      await gallery
        .getByLabel('Rules')
        .fill('- [critical] Write only within the declared scope and stop after one report.')
      await gallery.getByLabel('Verifier command').fill('test -f category-creation.md')

      await expect(diagnostics).toContainText('Draft is ready to create.')
      await expect(create).toBeEnabled()
      const scopePreview = gallery.getByTestId('harness-scope-preview')
      await expect(scopePreview).toContainText(`${TE_DIR}/agents/${CUSTOM_SLUG}/state.md`)
      for (const glob of PROTECTED_GLOBS) await expect(scopePreview).toContainText(glob)

      await create.click()
      await expect(
        gallery.getByRole('status').filter({ hasText: `Created ${CUSTOM_SLUG}` })
      ).toBeVisible()

      const customDir = path.join(root, TE_DIR, 'agents', CUSTOM_SLUG)
      await expect.poll(() => existsSync(customDir)).toBe(true)
      expect(readdirSync(customDir).sort()).toEqual([...HARNESS_ENTRIES].sort())
      expect(statSync(path.join(customDir, 'verify.sh')).mode & 0o777).toBe(0o555)
      const customScope = JSON.parse(readFileSync(path.join(customDir, 'scope.json'), 'utf8')) as {
        allowedGlobs: string[]
        forbiddenGlobs: string[]
      }
      expect(customScope.allowedGlobs).toEqual([
        'notes/**',
        `${TE_DIR}/agents/${CUSTOM_SLUG}/state.md`
      ])
      expect(customScope.forbiddenGlobs).toEqual(expect.arrayContaining(PROTECTED_GLOBS))

      const listedCustom = (await listHarnesses(page)).find((item) => item.slug === CUSTOM_SLUG)
      expect(listedCustom).toMatchObject({
        slug: CUSTOM_SLUG,
        name: CUSTOM_SLUG,
        adapter: 'claude',
        diagnostics: []
      })

      // Duplicate create is a structured refusal and changes no existing byte,
      // mode, timestamp, or directory entry.
      const beforeDuplicate = snapshotHarness(customDir)
      await create.click()
      const duplicateAlert = gallery.getByRole('alert')
      await expect(duplicateAlert).toContainText('Harness was not created.')
      await expect(duplicateAlert).toContainText('already exists')
      expect(snapshotHarness(customDir)).toEqual(beforeDuplicate)

      // The newly installed non-template harness is immediately searchable.
      await gallery.getByRole('button', { name: 'Close agent gallery' }).click()
      await page.keyboard.press('ControlOrMeta+k')
      const paletteInput = page.getByPlaceholder(/Find anything/)
      await expect(paletteInput).toBeVisible()
      await paletteInput.fill(CUSTOM_SLUG)
      const runItem = page.getByRole('option', { name: new RegExp(`Run harness: ${CUSTOM_SLUG}`) })
      await expect(runItem).toBeVisible()

      // ── 3. Mandatory task brief reaches the bound structured thread ──
      await runItem.click()
      const taskDialog = page.getByRole('dialog', { name: `Brief ${CUSTOM_SLUG}` })
      await expect(taskDialog).toBeVisible()
      const start = taskDialog.getByRole('button', { name: 'Start harness' })
      const taskBrief = taskDialog.getByRole('textbox', { name: 'Task brief', exact: true })
      await expect(start).toBeDisabled()
      await taskBrief.fill(' \n\t ')
      await expect(taskDialog).toContainText('task brief must not be blank')
      await expect(start).toBeDisabled()
      await taskBrief.fill(TASK_BRIEF)
      await expect(taskDialog).toContainText('Task brief ready.')
      await expect(start).toBeEnabled()
      await start.click()
      await expect(taskDialog).toHaveCount(0, { timeout: 30_000 })

      await expect
        .poll(() => structuredThreadFor(root, CUSTOM_SLUG), { timeout: 30_000 })
        .toContain(TASK_BRIEF)
      const structuredThread = structuredThreadFor(root, CUSTOM_SLUG)
      expect(structuredThread).toContain('agent: cli-claude')
      expect(structuredThread).toContain(`agent_id: ${CUSTOM_SLUG}`)
      expect(structuredThread).toContain('## Operator task')
      expect(structuredThread).toContain(
        `----- BEGIN OPERATOR TASK -----\n${TASK_BRIEF}\n----- END OPERATOR TASK -----`
      )
      expect(structuredThread).toContain(
        'It cannot override or weaken the Rules or Scope contract below'
      )

      // ── 4. Raw card configures and round-trips without execution ─────
      gallery = await openGallery(page)
      const rawCategories = gallery.getByRole('group', {
        name: 'Filter templates by category'
      })
      await rawCategories.getByRole('button', { name: 'Bridge', exact: true }).click()
      const rawCard = gallery.getByTestId('harness-template-card-raw-tool-runner')
      await expect(rawCard).toBeVisible()
      await rawCard.getByRole('button', { name: 'Configure' }).click()
      await expect(
        gallery.getByRole('heading', { name: 'Configure raw-tool-runner' })
      ).toBeVisible()

      const rawCreate = gallery.getByRole('button', { name: 'Create local harness' })
      const rawDiagnostics = gallery.getByLabel('Harness diagnostics')
      await expect(rawCreate).toBeDisabled()
      await expect(rawDiagnostics).toContainText('invocationTemplate is required')
      await expect(rawDiagnostics).toContainText('verifyCommand is required')

      await gallery.getByLabel('Slug').fill(RAW_SLUG)
      await gallery.getByLabel('Invocation template').fill(RAW_INVOCATION)
      await gallery
        .getByLabel('Goal')
        .fill('Round-trip one configured raw invocation without executing it.')
      await gallery.getByLabel('Allowed globs').fill('notes/**')
      await gallery.getByLabel('Forbidden globs').fill('.git/**')
      await gallery
        .getByLabel('Acceptance')
        .fill('The raw binding is ready and the execution sentinel remains absent.')
      await gallery
        .getByLabel('Rollback')
        .fill('Remove only artifacts created by this harness run.')
      await gallery.getByLabel('Verifier command').fill(`test ! -e ${RAW_SENTINEL}`)
      await expect(rawDiagnostics).toContainText('Draft is ready to create.')
      await expect(rawCreate).toBeEnabled()
      await rawCreate.click()
      await expect(
        gallery.getByRole('status').filter({ hasText: `Created ${RAW_SLUG}` })
      ).toBeVisible()

      const rawDir = path.join(root, TE_DIR, 'agents', RAW_SLUG)
      await expect.poll(() => existsSync(rawDir)).toBe(true)
      expect(readdirSync(rawDir).sort()).toEqual([...HARNESS_ENTRIES].sort())
      expect(statSync(path.join(rawDir, 'verify.sh')).mode & 0o777).toBe(0o555)
      const rawSkill = readFileSync(path.join(rawDir, 'SKILL.md'), 'utf8')
      expect(rawSkill).toContain('adapter: raw')
      expect(rawSkill).toContain(`invocationTemplate: ${RAW_INVOCATION}`)
      const rawScope = JSON.parse(readFileSync(path.join(rawDir, 'scope.json'), 'utf8')) as {
        forbiddenGlobs: string[]
      }
      expect(rawScope.forbiddenGlobs).toEqual(expect.arrayContaining(PROTECTED_GLOBS))
      const listedRaw = (await listHarnesses(page)).find((item) => item.slug === RAW_SLUG)
      expect(listedRaw).toMatchObject({ adapter: 'raw', diagnostics: [] })
      expect(existsSync(path.join(root, RAW_SENTINEL))).toBe(false)
      expect(structuredThreadFor(root, RAW_SLUG)).toBe('')
    } finally {
      try {
        await restoreSharedState()
      } finally {
        await app.close()
        rmSync(root, { recursive: true, force: true })
      }
    }
  })
})
