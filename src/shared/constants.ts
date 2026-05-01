// Dev/prod config directory separation.
// In dev mode (npm run dev), state goes to .machina-dev/ so development
// never corrupts production vault state. Tests use the production name to match fixtures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isDevRuntime = import.meta.env.DEV && !(import.meta.env as any).VITEST
export const TE_DIR = isDevRuntime ? '.machina-dev' : '.machina'

export const THREADS_DIR = 'threads'
export const THREADS_ARCHIVE_DIR = 'threads/archive'
export const THREADS_CONFIG_FILE = 'config.json'

export const AGENT_SHELL_FEATURE_FLAG = 'TE_AGENT_SHELL_V1'
