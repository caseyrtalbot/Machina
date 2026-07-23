# Block Protocol

> Wire format for prompt/command/output boundaries between the user's shell
> and Machina's terminal substrate. Concept-borrowed from Warp's
> DProtoHook; uses the iTerm2 OSC namespace for portability.

## Goals

- Let the engine convert a stream of PTY bytes into structured `Block` records
  (prompt + command + output + exit code + cwd). See `src/shared/engine/block-model.ts`.
- Coexist with iTerm2's existing `OSC 1337;` integrations — same namespace,
  unique payload prefix.
- Survive without the hook installed: no markers means no blocks — the
  detector never emits fake blocks (see Degraded mode).

## Wire format

Markers are OSC sequences using the iTerm2 namespace (`OSC 1337;`). Every
payload begins with the literal prefix `te-` to disambiguate from iTerm's
own commands. Each marker is terminated by `BEL` (`\x07`).

```
ESC ]  1337  ;  te-<verb>  [ ; key=value ]*  BEL
^^^                                          ^^^
\x1b]                                        \x07
```

### Verbs (v1)

| Verb               | Emitted on         | Required keys           | Optional keys |
|--------------------|--------------------|-------------------------|---------------|
| `te-prompt-start`  | Before each prompt | —                       | —             |
| `te-command-start` | After Enter        | `cwd=<abs>` `ts=<ms>`   | `cmd`, `user`, `host`, `shell` |
| `te-command-end`   | After command      | `exit=<int>` `ts=<ms>`  | —             |

`ts` is Unix epoch milliseconds. `cwd` is absolute. `cmd` is the typed
command line; hooks percent-encode `%`, `;`, ESC, BEL, CR, and LF so values
survive as a single kv segment, and the detector percent-decodes `cwd` and
`cmd`. When `cmd` is absent (older hook), the watcher derives the command
from the echoed first output line at command-end.

### Examples

```
\x1b]1337;te-prompt-start\x07
\x1b]1337;te-command-start;cwd=/Users/casey/Projects/thought-engine;ts=1714512345012;shell=zsh;cmd=ls -la\x07
\x1b]1337;te-command-end;exit=0;ts=1714512347820\x07
```

## Detector contract

`src/shared/engine/block-detector.ts` holds the parser as a pure state
machine:

```ts
consume(bytes: Uint8Array | string): readonly BlockEvent[]
```

`BlockEvent` is a discriminated union:

```ts
type BlockEvent =
  | { kind: 'prompt-start' }
  | {
      kind: 'command-start'
      cwd: string
      ts: number
      command: string | null
      meta: Readonly<Record<string, string>>
    }
  | { kind: 'command-end'; exit: number; ts: number }
  | { kind: 'output-chunk'; text: string }
```

Required behavior:

- **Pure**: no I/O, no globals. Carries a small partial-OSC buffer between
  calls.
- **Robust to splits**: an OSC marker arriving across two `consume` calls
  is buffered, not dropped.
- **Pass-through**: bytes that are not part of a `te-` marker pass through
  verbatim as `output-chunk` events. iTerm2's own `OSC 1337;` payloads (no
  `te-` prefix) pass through unchanged.
- **Resilient**: malformed markers (missing required keys, bad numbers) are
  logged once and dropped — they must not stall the byte stream.

## Pipeline bounds

The watcher (`src/main/services/block-watcher.ts`) bounds the stream in two
ways:

- **Output cap**: `appendOutput` keeps the first 64 KB and most recent
  256 KB of a block's output; the middle is replaced with a
  `…[output truncated]…` marker and secret offsets are remapped across the
  cut (`src/shared/engine/block-model.ts`).
- **Emit throttle**: output-chunk snapshots emit at most once per 100 ms per
  session (~10 Hz) with a trailing emit for the latest snapshot; state
  transitions (pending/running/completed) always emit immediately.

## Degraded mode

Structured mode is purely marker-driven — there is no timer and no explicit
legacy flag. Without the hook installed (or when `TE_SESSION_ID` is unset)
no `te-` markers appear, the watcher never forms blocks, the terminal works
as a dumb pipe, and the canvas simply has no block cards to project.

To enter structured mode, source the matching hook from
`resources/shell-hooks/` (e.g. append `[ -f ~/.te.zsh ] && source ~/.te.zsh`
to `~/.zshrc`).

## Reserved namespace

All future Machina markers MUST be prefixed `te-`. The reserved
prefix range is `te-`, `te2-`, `te-canvas-`, `te-agent-`. Anything else
inside `OSC 1337;` belongs to iTerm2 or other tools.
