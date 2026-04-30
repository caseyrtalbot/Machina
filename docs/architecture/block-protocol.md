# Block Protocol

> Wire format for prompt/command/output boundaries between the user's shell
> and thought-engine's terminal substrate. Concept-borrowed from Warp's
> DProtoHook; uses the iTerm2 OSC namespace for portability.

## Goals

- Let the engine convert a stream of PTY bytes into structured `Block` records
  (prompt + command + output + exit code + cwd). See `src/shared/engine/block-model.ts`.
- Coexist with iTerm2's existing `OSC 1337;` integrations — same namespace,
  unique payload prefix.
- Survive without the hook installed: the detector treats absence of markers
  as **legacy mode** and emits no fake blocks.

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
| `te-command-start` | After Enter        | `cwd=<abs>` `ts=<ms>`   | `user`, `host`, `shell` |
| `te-command-end`   | After command      | `exit=<int>` `ts=<ms>`  | —             |

`ts` is Unix epoch milliseconds. `cwd` is absolute, percent-decoded.

### Examples

```
\x1b]1337;te-prompt-start\x07
\x1b]1337;te-command-start;cwd=/Users/casey/Projects/thought-engine;ts=1714512345012;shell=zsh\x07
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
  | { kind: 'command-start'; cwd: string; ts: number; meta: Readonly<Record<string, string>> }
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

## Degraded mode

If a session has been running for ≥ 5 seconds without a `te-prompt-start`,
the watcher (`src/main/services/block-watcher.ts`) marks it `legacy` and
stops emitting `block:event`. The terminal still works as a dumb pipe; the
canvas simply has no block cards to project.

To re-enter structured mode, the user runs the **Set up shell hooks**
command from the canvas command palette (Move 2 follow-up), which appends
the hook to the appropriate rc file.

## Reserved namespace

All future thought-engine markers MUST be prefixed `te-`. The reserved
prefix range is `te-`, `te2-`, `te-canvas-`, `te-agent-`. Anything else
inside `OSC 1337;` belongs to iTerm2 or other tools.
