import { basename, extname, join } from 'node:path'
import { constants as fsConstants } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { canonicalizePath } from './paths'
import type { PathGuard } from '../services/path-guard'

/** Folder (under the vault root) that imported media lands in. */
export const VAULT_ASSETS_DIR = 'assets'

/** Strip path separators and control characters; keep the name readable. */
function sanitizeBaseName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || 'asset'
}

/**
 * Bring an externally-referenced file (Finder drag, file picker) inside the
 * vault boundary so every later read passes PathGuard.
 *
 * - Source already inside the vault: returned as-is (canonicalized), no copy.
 * - Source outside the vault: copied into `<vault>/assets/` with a
 *   collision-safe name ("photo.png", "photo 2.png", ...).
 *
 * Returns the absolute vault-resident path to store in card metadata.
 */
export async function importAssetIntoVault(
  sourcePath: string,
  vaultRoot: string,
  guard: PathGuard
): Promise<string> {
  const source = canonicalizePath(sourcePath)
  const st = await stat(source)
  if (!st.isFile()) {
    throw new Error('import-asset: source is not a regular file')
  }

  try {
    return guard.assertWithinVault(source)
  } catch {
    // Outside the vault — fall through to the copy path.
  }

  const assetsDir = join(vaultRoot, VAULT_ASSETS_DIR)
  await mkdir(assetsDir, { recursive: true })

  const base = sanitizeBaseName(basename(source))
  const ext = extname(base)
  const stem = ext ? base.slice(0, -ext.length) : base

  for (let i = 0; i < 1000; i++) {
    const candidate = join(assetsDir, i === 0 ? base : `${stem} ${i + 1}${ext}`)
    const dest = guard.assertWithinVault(candidate)
    try {
      // EXCL makes the existence check and the copy one atomic step — two
      // concurrent imports of the same filename can't clobber each other.
      await copyFile(source, dest, fsConstants.COPYFILE_EXCL)
      return dest
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw err
    }
  }
  throw new Error('import-asset: could not find a free filename in assets/')
}
