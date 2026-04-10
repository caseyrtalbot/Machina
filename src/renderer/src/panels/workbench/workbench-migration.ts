const WORKBENCH_FILENAME = '.machina-workbench.json'
// Ordered newest → oldest. First match wins.
const LEGACY_WORKBENCH_FILENAMES = [
  '.thought-engine-workbench.json',
  '.thought-engine-project-canvas.json'
] as const

export interface WorkbenchFs {
  readonly fileExists: (path: string) => Promise<boolean>
  readonly renameFile: (oldPath: string, newPath: string) => Promise<void>
}

export async function migrateWorkbenchFile(
  projectPath: string,
  fs: WorkbenchFs = window.api.fs
): Promise<void> {
  const newPath = projectPath + '/' + WORKBENCH_FILENAME

  const newExists = await fs.fileExists(newPath)
  if (newExists) return

  for (const legacyName of LEGACY_WORKBENCH_FILENAMES) {
    const legacyPath = projectPath + '/' + legacyName
    if (await fs.fileExists(legacyPath)) {
      await fs.renameFile(legacyPath, newPath)
      return
    }
  }
}
