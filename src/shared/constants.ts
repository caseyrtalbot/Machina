// Dev/prod config directory separation.
// In dev mode (npm run dev), state goes to .machina-dev/ so development
// never corrupts production vault state. Tests use the production name to match fixtures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isDevRuntime = import.meta.env.DEV && !(import.meta.env as any).VITEST
export const TE_DIR = isDevRuntime ? '.machina-dev' : '.machina'

export const THREADS_DIR = 'threads'
export const THREADS_ARCHIVE_DIR = 'threads/archive'
export const THREADS_CONFIG_FILE = 'config.json'

/**
 * Paths an agent must never touch: the harness verification gate and rules
 * (workstation contracts §5). Deliberately carries BOTH `.machina` and
 * `.machina-dev` variants — TE_DIR flips per runtime, but the on-disk
 * contract (scope.json forbiddenGlobs) must not. This is the single
 * sanctioned exception to the "always use TE_DIR" rule.
 */
export const HARNESS_PROTECTED_GLOBS = [
  '.machina/agents/*/verify.sh',
  '.machina/agents/*/rules.md',
  '.machina-dev/agents/*/verify.sh',
  '.machina-dev/agents/*/rules.md'
] as const

/**
 * True when a workspace-root-relative path matches HARNESS_PROTECTED_GLOBS.
 * Hand-rolled (single `*` segment, fixed filenames) so the shared kernel
 * stays dependency-free — no glob library.
 */
export function isHarnessProtectedPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/')
  return /^\.machina(-dev)?\/agents\/[^/]+\/(verify\.sh|rules\.md)$/.test(normalized)
}
