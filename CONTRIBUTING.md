# Contributing to Machina

Issues and pull requests are welcome. Machina is a macOS Electron app (Apple Silicon supported and tested), so you will need a Mac to run it.

## Dev setup

Requires Node.js and npm.

```bash
npm install
npm run dev        # Electron app with HMR
```

Other useful commands:

```bash
npm run test       # all unit/integration tests (vitest)
npm run check      # quality gate: lint + typecheck + tests
npm run build:mac  # build and package for macOS
```

Run a single test file with `npx vitest run path/to/file.test.ts`.

## Repo layout

| Path | What it is |
|---|---|
| `src/main/` | Electron main process: IPC handlers (`ipc/`), services (`services/`) |
| `src/preload/` | Bridge: exposes `window.api` with typed namespaces |
| `src/renderer/` | React app: `panels/`, `hooks/`, `store/`, `design/` |
| `src/shared/` | Types, IPC contracts, and the pure engine kernel (`src/shared/engine/`) |
| `tests/` | Mirrors `src/` for pure-logic tests |
| `e2e/` | Playwright end-to-end tests |

The engine kernel (`src/shared/engine/`) has zero Electron or React dependencies. Both the main process and renderer Web Workers import from it, and it must stay dependency-free.

## Quality gate

`npm run check` must pass clean before a PR: zero lint errors, zero type errors (both the node and web tsconfigs), and all vitest suites green.

## Tests

- **Pure logic**: put tests in `tests/`, mirroring the `src/` path.
- **Components**: colocate in `src/**/__tests__/` (vitest + happy-dom).
- **Node APIs**: add `// @vitest-environment node` at the top of the file.
- **Zustand stores**: reset with `store.setState(store.getInitialState())` in `beforeEach`.
- **Bug fixes**: write a failing test that reproduces the bug first, then fix it.

## Code style

- Prettier: single quotes, no semicolons, 100 char width. Run `npm run format`.
- TypeScript strict mode. Names prefixed with `_` are exempt from unused-vars lint.
- Immutable data: return new copies, never mutate in place.
- Files under 800 lines, organized by feature or domain.
- Validate external input at the boundary (Zod). No secrets in code, env vars only.
- Design tokens come from `src/renderer/src/design/tokens.ts`; never hardcode hex or px.

## Commits

Format: `<type>: <description>` where type is one of `feat | fix | refactor | docs | test | chore | perf | ci`.

```
fix: suppress vault-watcher echo on agent writes
```

## Adding a new IPC channel

All four sites bind to the same generic map, so TypeScript catches mismatches at every step:

1. Declare the channel in `IpcChannels` (or `IpcEvents`) in `src/shared/ipc-channels.ts`
2. Register `typedHandle(...)` in the appropriate `src/main/ipc/*.ts` file
3. Expose it in `src/preload/index.ts` under the right namespace
4. Call it via `window.api.namespace.method()` in the renderer

## Pull requests

- Keep changes surgical: every changed line should trace to the stated purpose. No drive-by refactors or restyling of adjacent code.
- Include tests for new behavior and bug fixes.
- Show evidence that `npm run check` passes in the PR description.
- Small, focused PRs review faster than large ones.
