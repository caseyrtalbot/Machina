// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, readdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { FileService } from '../../../src/main/services/file-service'

describe('FileService.initVault – bundled actions seeding', () => {
  let vaultPath: string
  let svc: FileService

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'te-test-vault-'))
    svc = new FileService()
  })

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true })
  })

  it('creates .machina/actions/ directory on fresh vault init', async () => {
    await svc.initVault(vaultPath)
    const actionsDir = join(vaultPath, '.machina', 'actions')
    expect(existsSync(actionsDir)).toBe(true)
  })

  it('writes skill.md to .machina/ on fresh vault init', async () => {
    await svc.initVault(vaultPath)
    const skillPath = join(vaultPath, '.machina', 'skill.md')
    expect(existsSync(skillPath)).toBe(true)
    const content = await readFile(skillPath, 'utf-8')
    expect(content).toContain('# Machina Vault Agent')
    expect(content).toContain('ADDITIVE ONLY')
  })

  it('writes all 6 bundled action files to .machina/actions/', async () => {
    await svc.initVault(vaultPath)
    const actionsDir = join(vaultPath, '.machina', 'actions')
    const files = await readdir(actionsDir)
    const expected = [
      'librarian.md',
      'curator.md',
      'emerge.md',
      'challenge.md',
      'steelman.md',
      'red-team.md'
    ]
    for (const filename of expected) {
      expect(files).toContain(filename)
    }
  })

  it('bundled action files contain correct frontmatter', async () => {
    await svc.initVault(vaultPath)
    const actionsDir = join(vaultPath, '.machina', 'actions')

    const librarian = await readFile(join(actionsDir, 'librarian.md'), 'utf-8')
    expect(librarian).toContain('name: Librarian')
    expect(librarian).toContain('scope: any')

    const curator = await readFile(join(actionsDir, 'curator.md'), 'utf-8')
    expect(curator).toContain('name: Curator')

    const emerge = await readFile(join(actionsDir, 'emerge.md'), 'utf-8')
    expect(emerge).toContain('name: Emerge')
    expect(emerge).toContain('icon: emerge')

    const challenge = await readFile(join(actionsDir, 'challenge.md'), 'utf-8')
    expect(challenge).toContain('name: Challenge')

    const steelman = await readFile(join(actionsDir, 'steelman.md'), 'utf-8')
    expect(steelman).toContain('name: Steelman')
    expect(steelman).toContain('scope: files')

    const redTeam = await readFile(join(actionsDir, 'red-team.md'), 'utf-8')
    expect(redTeam).toContain('name: Red Team')
  })

  it('does not overwrite existing action files on re-init', async () => {
    await svc.initVault(vaultPath)

    // Overwrite an action file with custom content
    const emergePath = join(vaultPath, '.machina', 'actions', 'emerge.md')
    const { writeFile } = await import('fs/promises')
    await writeFile(emergePath, 'user-customized content', 'utf-8')

    // Re-init should not overwrite
    await svc.initVault(vaultPath)
    const content = await readFile(emergePath, 'utf-8')
    expect(content).toBe('user-customized content')
  })

  it('does not overwrite existing skill.md on re-init', async () => {
    await svc.initVault(vaultPath)

    const skillPath = join(vaultPath, '.machina', 'skill.md')
    const { writeFile } = await import('fs/promises')
    await writeFile(skillPath, 'custom skill content', 'utf-8')

    await svc.initVault(vaultPath)
    const content = await readFile(skillPath, 'utf-8')
    expect(content).toBe('custom skill content')
  })

  it('curator.md contains flexible mode instructions instead of template variables', async () => {
    await svc.initVault(vaultPath)
    const curatorPath = join(vaultPath, '.machina', 'actions', 'curator.md')
    const content = await readFile(curatorPath, 'utf-8')
    // Must NOT contain the old template variables
    expect(content).not.toContain('{{MODE}}')
    expect(content).not.toContain('{{MODE_DESCRIPTION}}')
    // Must contain flexible mode instructions
    expect(content).toContain('Choose your approach based on what the vault needs most')
  })

  it('librarian.md body contains the audit report passes', async () => {
    await svc.initVault(vaultPath)
    const libPath = join(vaultPath, '.machina', 'actions', 'librarian.md')
    const content = await readFile(libPath, 'utf-8')
    expect(content).toContain('Pass 1: Contradictions')
    expect(content).toContain('Pass 5: Forward Questions')
  })
})
