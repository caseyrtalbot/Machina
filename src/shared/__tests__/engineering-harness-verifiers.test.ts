// @vitest-environment node
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HARNESS_TEMPLATES } from '../harness-templates'

interface ScriptResult {
  readonly code: number
  readonly output: string
}

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'machina-engineering-verifier-'))
  await run('git', ['init', '-q'], root)
  await fs.writeFile(path.join(root, '.gitignore'), '/fake-bin/\n/node_modules/\n', 'utf8')
  await commitFile('.gitignore')
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env })
    let output = ''
    child.stdout.on('data', (chunk) => (output += String(chunk)))
    child.stderr.on('data', (chunk) => (output += String(chunk)))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? -1, output }))
  })
}

async function commitFile(relativePath: string): Promise<void> {
  const added = await run('git', ['add', '--', relativePath], root)
  if (added.code !== 0) throw new Error(added.output)
  const committed = await run(
    'git',
    [
      '-c',
      'user.email=verifier@example.test',
      '-c',
      'user.name=Verifier Test',
      'commit',
      '-qm',
      `baseline ${relativePath}`
    ],
    root
  )
  if (committed.code !== 0) throw new Error(committed.output)
}

async function installVerifier(templateId: string): Promise<string> {
  const template = HARNESS_TEMPLATES[templateId]
  if (template === undefined) throw new Error(`unknown template: ${templateId}`)
  const harnessDir = path.join(root, '.machina', 'agents', templateId)
  await fs.mkdir(harnessDir, { recursive: true })
  const scriptPath = path.join(harnessDir, 'verify.sh')
  await fs.writeFile(scriptPath, template.verifySh, { mode: 0o555 })
  return scriptPath
}

async function writePackageTest(script: string): Promise<void> {
  await fs.writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify({ private: true, scripts: { test: script } }, null, 2)}\n`,
    'utf8'
  )
  await commitFile('package.json')
}

const PASSING_NODE_TEST = [
  "const test = require('node:test')",
  "const assert = require('node:assert/strict')",
  "test('reported behavior', () => assert.equal(2 + 2, 4))",
  ''
].join('\n')

const FAILING_NODE_TEST = [
  "const test = require('node:test')",
  "const assert = require('node:assert/strict')",
  "test('reported behavior', () => assert.equal(2 + 2, 5))",
  ''
].join('\n')

async function writeChangedTest(content = '// regression\n'): Promise<void> {
  await fs.mkdir(path.join(root, 'tests'), { recursive: true })
  await fs.writeFile(path.join(root, 'tests', 'reported-bug.test.js'), content, 'utf8')
}

async function writeChangedTestAt(relativePath: string, content: string): Promise<void> {
  const target = path.join(root, relativePath)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf8')
}

async function writeChangedPythonTest(): Promise<void> {
  await fs.mkdir(path.join(root, 'tests'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'tests', 'test_reported_bug.py'),
    'def test_reported_behavior():\n    assert 2 + 2 == 5\n',
    'utf8'
  )
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function processIsRunning(pid: number): Promise<boolean> {
  const status = await run('/bin/ps', ['-o', 'stat=', '-p', String(pid)], os.tmpdir())
  if (status.code !== 0) return false
  return !status.output.trim().startsWith('Z')
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!(await processIsRunning(pid))) return true
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return !(await processIsRunning(pid))
}

describe('engineering harness executable verifiers', () => {
  it.each(['test-fixer', 'vertical-slice-builder'])(
    '%s fails closed when the workspace has no supported test gate',
    async (templateId) => {
      const script = await installVerifier(templateId)

      const result = await run('/bin/sh', [script], root)

      expect(result.code).not.toBe(0)
      expect(result.output).toContain(
        templateId === 'vertical-slice-builder'
          ? 'Expected at least one changed implementation'
          : 'No supported repository test gate found'
      )
    }
  )

  it.each(['test-fixer', 'vertical-slice-builder'])(
    '%s executes a repository-native passing package test',
    async (templateId) => {
      await writePackageTest('node -e "process.exit(0)"')
      if (templateId === 'vertical-slice-builder') {
        await fs.mkdir(path.join(root, 'src'), { recursive: true })
        await fs.writeFile(path.join(root, 'src', 'feature.ts'), 'export const value = 1\n', 'utf8')
      }
      const script = await installVerifier(templateId)

      const result = await run('/bin/sh', [script], root)

      expect(result.code, result.output).toBe(0)
    }
  )

  it('vertical-slice-builder refuses a passing suite when no slice artifact changed', async () => {
    await writePackageTest('node -e "process.exit(0)"')
    const script = await installVerifier('vertical-slice-builder')

    const result = await run('/bin/sh', [script], root)

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('Expected at least one changed implementation')
  })

  it('bug-reproducer rejects a failure when no test file changed', async () => {
    await writePackageTest(
      'node -e "console.error(\'AssertionError: expected false\'); process.exit(1)"'
    )
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root)

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('Expected at least one changed or untracked test file')
  })

  it('bug-reproducer rejects missing-runner and discovery failures as infrastructure', async () => {
    await writeChangedTest()
    const script = await installVerifier('bug-reproducer')

    const missingRunner = await run('/bin/sh', [script], root)
    expect(missingRunner.code).not.toBe(0)
    expect(missingRunner.output).toContain('not bug evidence')

    await writePackageTest('vitest run')
    const fakeBin = path.join(root, 'node_modules', '.bin')
    await fs.mkdir(fakeBin, { recursive: true })
    await fs.writeFile(
      path.join(fakeBin, 'vitest'),
      '#!/bin/sh\necho "No test files found" >&2\nexit 1\n',
      { mode: 0o755 }
    )
    const discovery = await run('/bin/sh', [script], root)
    expect(discovery.code).not.toBe(0)
    expect(discovery.output).toContain('test discovery or infrastructure')
  })

  it('bug-reproducer rejects a JavaScript suite-load failure before a test body executes', async () => {
    await writePackageTest('jest')
    await writeChangedTest(FAILING_NODE_TEST)
    const fakeBin = path.join(root, 'node_modules', '.bin')
    await fs.mkdir(fakeBin, { recursive: true })
    await fs.writeFile(
      path.join(fakeBin, 'jest'),
      [
        '#!/bin/sh',
        'echo "FAIL tests/reported-bug.test.js"',
        'echo "Test suite failed to run"',
        'echo "failureType: testCodeFailure"',
        'exit 1',
        ''
      ].join('\n'),
      { mode: 0o755 }
    )
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root)

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('test body did not execute and fail')
  })

  it('bug-reproducer kills a timed-out runner child and grandchild', async () => {
    await writePackageTest('node --test')
    await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8')
    await commitFile('pnpm-lock.yaml')
    await writeChangedTest(FAILING_NODE_TEST)
    const fakeBin = path.join(root, 'fake-bin')
    await fs.mkdir(fakeBin)
    await fs.writeFile(path.join(fakeBin, 'sleep'), '#!/bin/sh\n/bin/sleep 0.01\n', {
      mode: 0o755
    })
    await fs.writeFile(
      path.join(fakeBin, 'pnpm'),
      [
        '#!/bin/sh',
        '(',
        "  trap '' TERM",
        '  (',
        "    trap '' TERM",
        '    /bin/sleep 30',
        '  ) &',
        '  _grandchild=$!',
        '  printf "%s\\n" "$_grandchild" > grandchild.pid',
        '  wait "$_grandchild"',
        ') &',
        '_child=$!',
        'printf "%s\\n" "$_child" > child.pid',
        'wait "$_child"',
        ''
      ].join('\n'),
      { mode: 0o755 }
    )
    const script = await installVerifier('bug-reproducer')
    const pids: number[] = []

    try {
      const result = await run('/bin/sh', [script], root, {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`
      })
      pids.push(Number(await fs.readFile(path.join(root, 'child.pid'), 'utf8')))
      pids.push(Number(await fs.readFile(path.join(root, 'grandchild.pid'), 'utf8')))

      expect(result.code).not.toBe(0)
      expect(result.output).toContain('exceeded 120 seconds')
      for (const pid of pids) {
        expect(await waitForProcessExit(pid), `process ${pid} survived timeout`).toBe(true)
      }
    } finally {
      for (const pid of pids) {
        if (!processExists(pid)) continue
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          // Already exited between the existence check and cleanup.
        }
      }
    }
  })

  it.each([
    'node -e "console.error(\'AssertionError: unrelated\'); process.exit(1)"',
    'node --test tests/pre-existing.test.js',
    'vitest',
    'vitest --watch',
    'jest --watch'
  ])(
    'bug-reproducer rejects a package script that cannot isolate the changed file: %s',
    async (testScript) => {
      await writeChangedTest()
      await writePackageTest(testScript)
      const script = await installVerifier('bug-reproducer')

      const result = await run('/bin/sh', [script], root)

      expect(result.code).not.toBe(0)
      expect(result.output).toContain('cannot target one changed test file safely')
    }
  )

  it('bug-reproducer rejects package.json without a real test script as infrastructure', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{"private":true}\n', 'utf8')
    await commitFile('package.json')
    await writeChangedTest()
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root)

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('no real, non-empty scripts.test')
  })

  it('bug-reproducer forwards the focused file to pnpm without an npm-style separator', async () => {
    await writePackageTest('node --test')
    await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8')
    await commitFile('pnpm-lock.yaml')
    await writeChangedTest(FAILING_NODE_TEST)
    const fakeBin = path.join(root, 'fake-bin')
    await fs.mkdir(fakeBin)
    await fs.writeFile(
      path.join(fakeBin, 'pnpm'),
      [
        '#!/bin/sh',
        'printf "PNPM_ARGS:%s\\n" "$*"',
        'case "$*" in',
        '  "test tests/reported-bug.test.js")',
        '    echo "reported behavior failed"',
        '    echo "tests 1"',
        '    echo "fail 1"',
        '    echo "test at tests/reported-bug.test.js:3:1"',
        '    echo "AssertionError: reported behavior"',
        '    exit 1',
        '    ;;',
        '  *) exit 2 ;;',
        'esac',
        ''
      ].join('\n'),
      { mode: 0o755 }
    )
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root, {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`
    })

    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain('PNPM_ARGS:test tests/reported-bug.test.js')
  })

  it('test-fixer uses Bun native discovery without inventing a package test script', async () => {
    await fs.writeFile(path.join(root, 'package.json'), '{"private":true}\n', 'utf8')
    await commitFile('package.json')
    await fs.writeFile(path.join(root, 'bun.lock'), '', 'utf8')
    await commitFile('bun.lock')
    const fakeBin = path.join(root, 'fake-bin')
    await fs.mkdir(fakeBin)
    await fs.writeFile(path.join(fakeBin, 'bun'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const script = await installVerifier('test-fixer')

    const result = await run('/bin/sh', [script], root, {
      ...process.env,
      PATH: `${fakeBin}:/usr/bin:/bin`
    })

    expect(result.code, result.output).toBe(0)
  })

  it.each([
    ['product source', 'src/checkout.ts', 'export const checkout = false\n'],
    ['root product source', 'main.go', 'package main\n'],
    ['dependency state', 'package-lock.json', '{"lockfileVersion":3}\n'],
    ['test configuration', 'pytest.ini', '[pytest]\n']
  ])('bug-reproducer rejects simultaneous %s edits', async (_label, relativePath, content) => {
    await writePackageTest(
      'node -e "console.error(\'AssertionError: expected false\'); process.exit(1)"'
    )
    await writeChangedTest()
    const target = path.join(root, relativePath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root)

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('must change exactly one test and no other workspace file')
    expect(result.output).toContain(relativePath)
  })

  it('bug-reproducer rejects a deleted product file beside the changed test', async () => {
    await writePackageTest('node --test')
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'legacy.ts'), 'export const legacy = true\n', 'utf8')
    await commitFile('src/legacy.ts')
    await fs.rm(path.join(root, 'src', 'legacy.ts'))
    await writeChangedTest(FAILING_NODE_TEST)
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root)

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('must change exactly one test and no other workspace file')
    expect(result.output).toContain('src/legacy.ts')
  })

  it('bug-reproducer treats a product-to-test rename as a forbidden deletion plus addition', async () => {
    await writePackageTest('node --test')
    await fs.mkdir(path.join(root, 'src'), { recursive: true })
    await fs.writeFile(path.join(root, 'src', 'legacy.js'), FAILING_NODE_TEST, 'utf8')
    await commitFile('src/legacy.js')
    await fs.mkdir(path.join(root, 'tests'), { recursive: true })
    await fs.rename(
      path.join(root, 'src', 'legacy.js'),
      path.join(root, 'tests', 'reported-bug.test.js')
    )
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root)

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('must change exactly one test and no other workspace file')
    expect(result.output).toContain('src/legacy.js')
  })

  it('bug-reproducer fails closed when a Git change-enumeration command fails', async () => {
    await writePackageTest('node --test')
    await writeChangedTest(FAILING_NODE_TEST)
    const fakeBin = path.join(root, 'fake-bin')
    await fs.mkdir(fakeBin)
    await fs.writeFile(
      path.join(fakeBin, 'git'),
      '#!/bin/sh\nif [ "$1" = diff ]; then exit 3; fi\nexec /usr/bin/git "$@"\n',
      { mode: 0o755 }
    )
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root, {
      ...process.env,
      PATH: `${fakeBin}:/usr/bin:/bin`
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('Could not inspect changed test files')
  })

  it('bug-reproducer preflights pytest availability as infrastructure', async () => {
    await fs.writeFile(path.join(root, 'pyproject.toml'), '[tool.pytest.ini_options]\n', 'utf8')
    await commitFile('pyproject.toml')
    await writeChangedPythonTest()
    const fakeBin = path.join(root, 'fake-bin')
    await fs.mkdir(fakeBin)
    await fs.writeFile(path.join(fakeBin, 'python3'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root, {
      ...process.env,
      PATH: `${fakeBin}:/usr/bin:/bin`
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('pytest is unavailable')
  })

  it('bug-reproducer rejects a pytest setup AssertionError before the test body executes', async () => {
    await fs.writeFile(path.join(root, 'pyproject.toml'), '[tool.pytest.ini_options]\n', 'utf8')
    await commitFile('pyproject.toml')
    await writeChangedPythonTest()
    const fakeBin = path.join(root, 'fake-bin')
    await fs.mkdir(fakeBin)
    await fs.writeFile(
      path.join(fakeBin, 'python3'),
      [
        '#!/bin/sh',
        'case "$*" in',
        '  *"-c import pytest"*) exit 0 ;;',
        'esac',
        'echo "ERROR at setup of test_reported_behavior"',
        'echo "AssertionError: fixture exploded"',
        'echo "1 error in 0.01s"',
        'exit 1',
        ''
      ].join('\n'),
      { mode: 0o755 }
    )
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root, {
      ...process.env,
      PATH: `${fakeBin}:/usr/bin:/bin`
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('test body did not execute and fail')
  })

  it('bug-reproducer refuses system-Python fallback when uv.lock exists but uv is absent', async () => {
    await fs.writeFile(path.join(root, 'pyproject.toml'), '[tool.pytest.ini_options]\n', 'utf8')
    await commitFile('pyproject.toml')
    await fs.writeFile(path.join(root, 'uv.lock'), 'version = 1\n', 'utf8')
    await commitFile('uv.lock')
    await writeChangedPythonTest()
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root, {
      ...process.env,
      PATH: '/usr/bin:/bin'
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('uv.lock exists but uv is unavailable')
  })

  it('bug-reproducer rejects a passing suite even with a changed test', async () => {
    await writeChangedTest(PASSING_NODE_TEST)
    await writePackageTest('node --test')
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root)

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('changed test passed')
  })

  it('bug-reproducer refuses more than one changed test file', async () => {
    await writeChangedTest()
    await fs.writeFile(path.join(root, 'tests', 'second.test.ts'), '// unrelated\n', 'utf8')
    await writePackageTest(
      'node -e "console.error(\'AssertionError: expected false\'); process.exit(1)"'
    )
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root)

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('Expected exactly one changed test file; found 2')
  })

  it('bug-reproducer accepts only a changed test plus an executable assertion failure', async () => {
    await writeChangedTest(FAILING_NODE_TEST)
    await writePackageTest('node --test')
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root)

    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain('one changed test produced an executable assertion/failure')
    expect(result.output).toContain('operator must still confirm')
  })

  it('bug-reproducer rejects product mutation performed while the changed test runs', async () => {
    await writeChangedTest(
      [
        "const test = require('node:test')",
        "const assert = require('node:assert/strict')",
        "const fs = require('node:fs')",
        "test('reported behavior', () => {",
        "  fs.mkdirSync('src', { recursive: true })",
        "  fs.writeFileSync('src/runtime-mutation.ts', 'export const changed = true\\n')",
        '  assert.equal(2 + 2, 5)',
        '})',
        ''
      ].join('\n')
    )
    await writePackageTest('node --test')
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root)

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('workspace changed while the focused test was running')
    expect(result.output).toContain('src/runtime-mutation.ts')
  })

  it('bug-reproducer rejects an unrelated committed suite failure when the changed test passes', async () => {
    await writePackageTest('node --test')
    await fs.mkdir(path.join(root, 'tests'), { recursive: true })
    await fs.writeFile(path.join(root, 'tests', 'pre-existing.test.js'), FAILING_NODE_TEST, 'utf8')
    await commitFile('tests/pre-existing.test.js')
    await writeChangedTest(PASSING_NODE_TEST)
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root)

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('changed test passed')
  })

  it('bug-reproducer gives Jest the changed file through --runTestsByPath', async () => {
    await writePackageTest('jest')
    await writeChangedTestAt('tests/aa.test.js', FAILING_NODE_TEST)
    await commitFile('tests/aa.test.js')
    await writeChangedTestAt('tests/a.test.js', PASSING_NODE_TEST)
    const fakeBin = path.join(root, 'node_modules', '.bin')
    await fs.mkdir(fakeBin, { recursive: true })
    await fs.writeFile(
      path.join(fakeBin, 'jest'),
      [
        '#!/bin/sh',
        'case " $* " in',
        '  *" --runTestsByPath tests/a.test.js "*) echo "PASS tests/a.test.js"; exit 0 ;;',
        '  *) echo "FAIL tests/aa.test.js"; echo "AssertionError: unrelated"; exit 1 ;;',
        'esac',
        ''
      ].join('\n'),
      { mode: 0o755 }
    )
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root)

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('--runTestsByPath tests/a.test.js')
    expect(result.output).toContain('changed test passed')
    expect(result.output).not.toContain('tests/aa.test.js')
  })

  it('bug-reproducer rejects a Vitest substring collision before running tests', async () => {
    await writePackageTest('vitest run')
    await writeChangedTestAt('tests/reported-bug.test.js.copy.test.js', FAILING_NODE_TEST)
    await commitFile('tests/reported-bug.test.js.copy.test.js')
    await writeChangedTest(FAILING_NODE_TEST)
    const fakeBin = path.join(root, 'node_modules', '.bin')
    await fs.mkdir(fakeBin, { recursive: true })
    await fs.writeFile(
      path.join(fakeBin, 'vitest'),
      '#!/bin/sh\necho "FAIL tests/reported-bug.test.js.copy.test.js"\necho "AssertionError: unrelated"\nexit 1\n',
      { mode: 0o755 }
    )
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root)

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('cannot isolate the changed test path exactly')
    expect(result.output).not.toContain('AssertionError: unrelated')
  })

  it('bug-reproducer targets one changed Go test without running sibling test files', async () => {
    await fs.writeFile(path.join(root, 'go.mod'), 'module example.test/repro\n\ngo 1.22\n', 'utf8')
    await commitFile('go.mod')
    await fs.writeFile(path.join(root, 'logic.go'), 'package repro\n', 'utf8')
    await commitFile('logic.go')
    await fs.writeFile(
      path.join(root, 'logic_test.go'),
      'package repro\n\nimport "testing"\n\nfunc TestReported(t *testing.T) {}\n',
      'utf8'
    )
    const fakeBin = path.join(root, 'fake-bin')
    await fs.mkdir(fakeBin)
    await fs.writeFile(
      path.join(fakeBin, 'go'),
      '#!/bin/sh\ncase "$*" in *logic_test.go*logic.go*) echo "--- FAIL: TestReported"; exit 1 ;; *) echo "wrong Go target: $*" >&2; exit 2 ;; esac\n',
      { mode: 0o755 }
    )
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root, {
      ...process.env,
      PATH: `${fakeBin}:/usr/bin:/bin`
    })

    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain('one changed test produced an executable assertion/failure')
  })

  it('bug-reproducer rejects a Go setup failure before the changed test executes', async () => {
    await fs.writeFile(path.join(root, 'go.mod'), 'module example.test/repro\n\ngo 1.22\n', 'utf8')
    await commitFile('go.mod')
    await fs.writeFile(path.join(root, 'logic.go'), 'package repro\n', 'utf8')
    await commitFile('logic.go')
    await fs.writeFile(
      path.join(root, 'logic_test.go'),
      'package repro\n\nimport "testing"\n\nfunc TestReported(t *testing.T) {}\n',
      'utf8'
    )
    const fakeBin = path.join(root, 'fake-bin')
    await fs.mkdir(fakeBin)
    await fs.writeFile(
      path.join(fakeBin, 'go'),
      '#!/bin/sh\necho "FAIL example.test/repro [setup failed]"\nexit 1\n',
      { mode: 0o755 }
    )
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root, {
      ...process.env,
      PATH: `${fakeBin}:/usr/bin:/bin`
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('test discovery or infrastructure')
  })

  it('bug-reproducer targets one changed Rust integration-test binary', async () => {
    const crateDir = path.join(root, 'crates', 'repro')
    await fs.mkdir(crateDir, { recursive: true })
    await fs.writeFile(
      path.join(crateDir, 'Cargo.toml'),
      '[package]\nname = "repro"\nversion = "0.1.0"\n',
      'utf8'
    )
    await commitFile('crates/repro/Cargo.toml')
    await fs.mkdir(path.join(crateDir, 'tests'))
    await fs.writeFile(
      path.join(crateDir, 'tests', 'reported.rs'),
      '#[test]\nfn reported() {}\n',
      'utf8'
    )
    const fakeBin = path.join(root, 'fake-bin')
    await fs.mkdir(fakeBin)
    await fs.writeFile(
      path.join(fakeBin, 'cargo'),
      '#!/bin/sh\ncase "$*" in *--manifest-path*Cargo.toml*--test*reported*) echo "test reported ... FAILED"; exit 101 ;; *) echo "wrong Rust target: $*" >&2; exit 2 ;; esac\n',
      { mode: 0o755 }
    )
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root, {
      ...process.env,
      PATH: `${fakeBin}:/usr/bin:/bin`
    })

    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain('one changed test produced an executable assertion/failure')
  })

  it('bug-reproducer rejects a Cargo build-script failure before the changed test executes', async () => {
    await fs.writeFile(
      path.join(root, 'Cargo.toml'),
      '[package]\nname = "repro"\nversion = "0.1.0"\n',
      'utf8'
    )
    await commitFile('Cargo.toml')
    await fs.mkdir(path.join(root, 'tests'))
    await fs.writeFile(
      path.join(root, 'tests', 'reported.rs'),
      '#[test]\nfn reported() {}\n',
      'utf8'
    )
    const fakeBin = path.join(root, 'fake-bin')
    await fs.mkdir(fakeBin)
    await fs.writeFile(
      path.join(fakeBin, 'cargo'),
      '#!/bin/sh\necho "error: failed to run custom build command for dependency"\nexit 101\n',
      { mode: 0o755 }
    )
    const script = await installVerifier('bug-reproducer')

    const result = await run('/bin/sh', [script], root, {
      ...process.env,
      PATH: `${fakeBin}:/usr/bin:/bin`
    })

    expect(result.code).not.toBe(0)
    expect(result.output).toContain('test discovery or infrastructure')
  })
})
