import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, basename } from 'path'
import matter from 'gray-matter'
import { typedHandle } from '../typed-ipc'
import { TE_DIR } from '@shared/constants'
import type { ActionDefinition } from '@shared/action-types'

let vaultRoot: string | null = null

export function setActionsVaultRoot(path: string | null): void {
  vaultRoot = path
}

export function registerActionsIpc(): void {
  typedHandle('actions:list', async () => {
    if (!vaultRoot) return []
    const actionsDir = join(vaultRoot, TE_DIR, 'actions')
    if (!existsSync(actionsDir)) return []
    const files = readdirSync(actionsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => join(actionsDir, f))
    return files.map((f): ActionDefinition => {
      const content = readFileSync(f, 'utf-8')
      const { data } = matter(content)
      return {
        id: basename(f, '.md'),
        name: (data.name as string) ?? basename(f, '.md'),
        description: (data.description as string) ?? '',
        icon: data.icon as string | undefined,
        scope: ['any', 'files', 'vault'].includes(data.scope as string)
          ? (data.scope as 'any' | 'files' | 'vault')
          : 'any',
        custom: (data.custom as boolean) ?? undefined
      }
    })
  })

  typedHandle('actions:read', async ({ id }) => {
    if (!vaultRoot) return { error: 'No vault open' }
    const file = join(vaultRoot, TE_DIR, 'actions', `${id}.md`)
    if (!existsSync(file)) return { error: `Action not found: ${id}` }
    const raw = readFileSync(file, 'utf-8')
    const { data, content } = matter(raw)
    return {
      definition: {
        id,
        name: (data.name as string) ?? id,
        description: (data.description as string) ?? '',
        icon: data.icon as string | undefined,
        scope: ['any', 'files', 'vault'].includes(data.scope as string)
          ? (data.scope as 'any' | 'files' | 'vault')
          : 'any',
        custom: (data.custom as boolean) ?? undefined
      },
      body: content.trim()
    }
  })
}
