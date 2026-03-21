const WORKBENCH_FILENAME = '.thought-engine-workbench.json'
const LEGACY_WORKBENCH_FILENAME = '.thought-engine-project-canvas.json'

export interface WorkbenchFs {
  readonly fileExists: (path: string) => Promise<boolean>
  readonly renameFile: (oldPath: string, newPath: string) => Promise<void>
}

/**
 * If the new workbench file doesn't exist but the legacy project-canvas file does,
 * rename it so future saves go to the right location.
 */
export async function migrateWorkbenchFile(
  projectPath: string,
  fs: WorkbenchFs = window.api.fs
): Promise<void> {
  const newPath = projectPath + '/' + WORKBENCH_FILENAME
  const legacyPath = projectPath + '/' + LEGACY_WORKBENCH_FILENAME

  const newExists = await fs.fileExists(newPath)
  if (newExists) return

  const legacyExists = await fs.fileExists(legacyPath)
  if (!legacyExists) return

  await fs.renameFile(legacyPath, newPath)
}
