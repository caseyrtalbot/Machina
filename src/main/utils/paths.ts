import { join, resolve, normalize } from 'path'
import { SYSTEM_ARTIFACT_DIRECTORIES, type SystemArtifactKind } from '@shared/system-artifacts'
export { TE_DIR } from '@shared/constants'
import { TE_DIR } from '@shared/constants'
export const CONFIG_FILE = 'config.json'
export const STATE_FILE = 'state.json'
export const ARTIFACTS_DIR = 'artifacts'

export function teConfigPath(vaultPath: string): string {
  return join(vaultPath, TE_DIR, CONFIG_FILE)
}

export function teStatePath(vaultPath: string): string {
  return join(vaultPath, TE_DIR, STATE_FILE)
}

export function teDirPath(vaultPath: string): string {
  return join(vaultPath, TE_DIR)
}

export function teArtifactsDirPath(vaultPath: string): string {
  return join(vaultPath, TE_DIR, ARTIFACTS_DIR)
}

export function teArtifactKindDirPath(vaultPath: string, kind: SystemArtifactKind): string {
  return join(vaultPath, TE_DIR, ARTIFACTS_DIR, SYSTEM_ARTIFACT_DIRECTORIES[kind])
}

export function teArtifactPath(
  vaultPath: string,
  kind: SystemArtifactKind,
  filename: string
): string {
  return join(teArtifactKindDirPath(vaultPath, kind), filename)
}

export function assertWithinVault(vaultPath: string, targetPath: string): void {
  const normalizedTarget = resolve(normalize(targetPath))
  const normalizedVault = resolve(normalize(vaultPath))
  if (!normalizedTarget.startsWith(normalizedVault + '/') && normalizedTarget !== normalizedVault) {
    throw new Error(`Path is outside vault boundary`)
  }
}
