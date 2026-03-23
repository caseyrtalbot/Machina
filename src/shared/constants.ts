// Dev/prod config directory separation.
// In dev mode (npm run dev), state goes to .thought-engine-dev/ so development
// never corrupts production vault state. Tests use the production name to match fixtures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isDevRuntime = import.meta.env.DEV && !(import.meta.env as any).VITEST
export const TE_DIR = isDevRuntime ? '.thought-engine-dev' : '.thought-engine'
