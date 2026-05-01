/**
 * Regenerates the golden block-replay fixtures.
 *
 * Run via: `npx tsx scripts/regen-block-fixtures.ts`
 *
 * The fixtures are JSONL `pty-bytes` streams that, when fed through a
 * fresh BlockDetector via `replay()`, produce the canonical block list
 * snapshotted in `src/shared/engine/__tests__/block-replay.test.ts`.
 *
 * Regenerate when:
 *  - BlockDetector wire format changes (intentionally)
 *  - You add a new fixture for a previously uncovered shell behaviour
 *
 * Do NOT regenerate to mask an unexpected detector behaviour change.
 * If a fixture's expected snapshot diverges, that's a regression to
 * investigate, not a fixture to refresh.
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBlockRecorder } from '../src/shared/engine/block-recorder'

const ESC = '\x1b'
const BEL = '\x07'

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'shared',
  'engine',
  '__tests__',
  '__fixtures__',
  'recorded-sessions'
)

mkdirSync(FIXTURES_DIR, { recursive: true })

interface Fixture {
  readonly name: string
  readonly chunks: readonly string[]
}

const fixtures: readonly Fixture[] = [
  {
    name: 'clean-ls',
    chunks: [
      `${ESC}]1337;te-prompt-start${BEL}`,
      `${ESC}]1337;te-command-start;cwd=/tmp;ts=1000;shell=zsh;user=casey;host=spark${BEL}`,
      `ls\r\nfile1.txt  file2.txt\r\n`,
      `${ESC}]1337;te-command-end;exit=0;ts=1100${BEL}`
    ]
  },
  {
    name: 'stderr',
    chunks: [
      `${ESC}]1337;te-prompt-start${BEL}`,
      `${ESC}]1337;te-command-start;cwd=/tmp;ts=2000;shell=zsh${BEL}`,
      `ls /nope\r\nls: /nope: No such file or directory\r\n`,
      `${ESC}]1337;te-command-end;exit=1;ts=2050${BEL}`
    ]
  },
  {
    name: 'cancelled-sigint',
    chunks: [
      `${ESC}]1337;te-prompt-start${BEL}`,
      `${ESC}]1337;te-command-start;cwd=/tmp;ts=3000;shell=zsh${BEL}`,
      `sleep 99\r\n^C\r\n`,
      `${ESC}]1337;te-command-end;exit=130;ts=3010${BEL}`
    ]
  }
]

for (const f of fixtures) {
  const recorder = createBlockRecorder()
  for (const chunk of f.chunks) {
    recorder.recordEvent({ kind: 'pty-bytes', data: chunk })
  }
  const path = join(FIXTURES_DIR, `${f.name}.jsonl`)
  writeFileSync(path, recorder.serialize(), 'utf-8')
  console.log(`wrote ${path}`)
}
