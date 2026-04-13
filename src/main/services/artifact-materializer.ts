import { writeFile, unlink, mkdir, rename } from 'fs/promises'
import { existsSync } from 'fs'
import { join, relative } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import {
  AgentArtifactDraftSchema,
  type AgentArtifactDraft,
  type MaterializeResult
} from '@shared/agent-artifact-types'
import { serializeDraft } from '@shared/engine/parser'

const SLUG_MAX_LENGTH = 80

interface MaterializerDeps {
  registerExternalWrite: (path: string) => void
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
}

export class ArtifactMaterializer {
  private readonly deps: MaterializerDeps
  private readonly sessionPaths = new Set<string>()

  constructor(deps: MaterializerDeps) {
    this.deps = deps
  }

  async materialize(
    draft: AgentArtifactDraft,
    vaultRoot: string,
    outputDir: string
  ): Promise<MaterializeResult> {
    AgentArtifactDraftSchema.parse(draft)

    const id = randomUUID()
    const slug = slugify(draft.suggestedFilename ?? draft.title) || 'artifact'
    const dir = outputDir ? join(vaultRoot, outputDir) : vaultRoot

    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    const resolvedPath = await this._allocateFilename(dir, slug)
    const content = serializeDraft(draft, id)

    this.deps.registerExternalWrite(resolvedPath)
    await this._atomicWrite(resolvedPath, content)
    this.sessionPaths.add(resolvedPath)

    const vaultRelativePath = relative(vaultRoot, resolvedPath)
    return { vaultRelativePath, absolutePath: resolvedPath, artifactId: id }
  }

  async rematerialize(draft: AgentArtifactDraft, atPath: string): Promise<MaterializeResult> {
    AgentArtifactDraftSchema.parse(draft)

    const id = randomUUID()
    const content = serializeDraft(draft, id)

    this.deps.registerExternalWrite(atPath)
    await this._atomicWrite(atPath, content)
    this.sessionPaths.add(atPath)

    return { vaultRelativePath: '', absolutePath: atPath, artifactId: id }
  }

  async unmaterialize(paths: readonly string[]): Promise<void> {
    for (const path of paths) {
      if (!this.sessionPaths.has(path)) {
        throw new Error(`Cannot unmaterialize: session ownership check failed for ${path}`)
      }
      if (existsSync(path)) {
        await unlink(path)
      }
      this.sessionPaths.delete(path)
    }
  }

  async materializeBatch(
    drafts: readonly AgentArtifactDraft[],
    vaultRoot: string,
    outputDir: string
  ): Promise<readonly MaterializeResult[]> {
    const rollbackLog: string[] = []
    const results: MaterializeResult[] = []

    try {
      for (const draft of drafts) {
        const result = await this.materialize(draft, vaultRoot, outputDir)
        rollbackLog.push(result.absolutePath)
        results.push(result)
      }
      return results
    } catch (err) {
      // Rollback: delete all files written so far in this batch
      for (const path of rollbackLog) {
        try {
          if (existsSync(path)) await unlink(path)
          this.sessionPaths.delete(path)
        } catch {
          // Best-effort cleanup
        }
      }
      throw err
    }
  }

  private async _allocateFilename(dir: string, slug: string): Promise<string> {
    const base = join(dir, `${slug}.md`)
    if (!existsSync(base)) return base

    let suffix = 1
    while (true) {
      const candidate = join(dir, `${slug}-${suffix}.md`)
      if (!existsSync(candidate)) return candidate
      suffix++
    }
  }

  private async _atomicWrite(path: string, content: string): Promise<void> {
    const tmpPath = join(tmpdir(), `te-mat-${randomUUID()}.tmp`)
    try {
      await writeFile(tmpPath, content, 'utf-8')
      await rename(tmpPath, path)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        const localTmp = path + '.tmp'
        await writeFile(localTmp, content, 'utf-8')
        await rename(localTmp, path)
      } else {
        throw err
      }
    }
  }
}
