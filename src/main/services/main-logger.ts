import { app } from 'electron'
import { appendFileSync, mkdirSync, statSync } from 'fs'
import { appendFile, mkdir, rename } from 'fs/promises'
import { dirname, join } from 'path'
import { inspect } from 'util'

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error'

const LOG_FILENAME = 'main.log'
const FALLBACK_USER_DATA_DIR = join(process.cwd(), '.machina-user-data')
export const MAX_LOG_SIZE_BYTES = 5 * 1024 * 1024
const FLUSH_DELAY_MS = 250

let installed = false
let logFilePath = ''
let originalConsole: Pick<Console, ConsoleLevel> | null = null

// Buffered async appends: console patches enqueue lines, a short timer
// batches them into one fs.appendFile per flush. A sync flush on process
// exit catches whatever is still buffered when the app dies.
let buffer: string[] = []
let bufferBytes = 0
let flushTimer: ReturnType<typeof setTimeout> | null = null
let writeChain: Promise<void> = Promise.resolve()
let logFileSize: number | null = null
let exitFlushRegistered = false

function getUserDataPath(): string {
  try {
    return app.getPath('userData')
  } catch {
    return FALLBACK_USER_DATA_DIR
  }
}

function serializeArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack ?? `${arg.name}: ${arg.message}`
  }
  if (typeof arg === 'string') {
    return arg
  }
  return inspect(arg, { depth: 6, breakLength: 120, compact: true })
}

export function resolveMainLogFilePath(userDataPath = getUserDataPath()): string {
  return join(userDataPath, 'logs', LOG_FILENAME)
}

export function formatMainLogEntry(
  level: ConsoleLevel,
  args: readonly unknown[],
  now: Date = new Date()
): string {
  const body = args.map(serializeArg).join(' ')
  return `${now.toISOString()} [${level}] ${body}`.trimEnd()
}

function resolveTargetPath(): string {
  if (!logFilePath) {
    logFilePath = resolveMainLogFilePath()
  }
  return logFilePath
}

function currentLogSize(targetPath: string): number {
  if (logFileSize === null) {
    try {
      logFileSize = statSync(targetPath).size
    } catch {
      logFileSize = 0
    }
  }
  return logFileSize
}

async function writeChunk(chunk: string, chunkBytes: number): Promise<void> {
  const targetPath = resolveTargetPath()
  try {
    await mkdir(dirname(targetPath), { recursive: true })
    if (currentLogSize(targetPath) + chunkBytes > MAX_LOG_SIZE_BYTES) {
      // Size-based rotation: keep one previous generation.
      await rename(targetPath, `${targetPath}.1`).catch(() => {})
      logFileSize = 0
    }
    await appendFile(targetPath, chunk, 'utf8')
    logFileSize = (logFileSize ?? 0) + chunkBytes
  } catch (err) {
    process.stderr.write(`[main-logger] write failed: ${String(err)}\n`)
  }
}

function flushNow(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (buffer.length === 0) return writeChain

  const chunk = `${buffer.join('\n')}\n`
  const chunkBytes = bufferBytes
  buffer = []
  bufferBytes = 0
  writeChain = writeChain.then(() => writeChunk(chunk, chunkBytes))
  return writeChain
}

/** Await all buffered log lines reaching disk. */
export function flushMainLogger(): Promise<void> {
  return flushNow()
}

function flushSyncOnExit(): void {
  if (buffer.length === 0) return
  const chunk = `${buffer.join('\n')}\n`
  buffer = []
  bufferBytes = 0
  const targetPath = resolveTargetPath()
  try {
    mkdirSync(dirname(targetPath), { recursive: true })
    appendFileSync(targetPath, chunk, 'utf8')
  } catch {
    // Process is exiting; nothing left to do.
  }
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushNow()
  }, FLUSH_DELAY_MS)
  flushTimer.unref?.()
}

function enqueueLogLine(line: string): void {
  if (!exitFlushRegistered) {
    exitFlushRegistered = true
    process.on('exit', flushSyncOnExit)
  }
  buffer = [...buffer, line]
  bufferBytes += Buffer.byteLength(line, 'utf8') + 1
  scheduleFlush()
}

/**
 * Forward a renderer console warning/error (from webContents 'console-message')
 * into main.log so production bug reports carry renderer context.
 */
export function logRendererConsole(
  level: 'warning' | 'error',
  message: string,
  sourceId: string,
  lineNumber: number
): void {
  const mapped: ConsoleLevel = level === 'warning' ? 'warn' : 'error'
  enqueueLogLine(formatMainLogEntry(mapped, [`[renderer] ${message} (${sourceId}:${lineNumber})`]))
}

function patchConsoleLevel(level: ConsoleLevel): void {
  const original = originalConsole?.[level]
  if (!original) return

  console[level] = ((...args: unknown[]) => {
    original(...args)
    enqueueLogLine(formatMainLogEntry(level, args))
  }) as Console[ConsoleLevel]
}

export function installMainLogger(): string {
  if (installed) {
    return logFilePath || resolveMainLogFilePath()
  }

  logFilePath = resolveMainLogFilePath()
  originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  }

  patchConsoleLevel('log')
  patchConsoleLevel('info')
  patchConsoleLevel('warn')
  patchConsoleLevel('error')
  installed = true

  enqueueLogLine(formatMainLogEntry('info', ['Main logger initialized']))
  return logFilePath
}

export function resetMainLoggerForTests(): void {
  if (originalConsole) {
    console.log = originalConsole.log
    console.info = originalConsole.info
    console.warn = originalConsole.warn
    console.error = originalConsole.error
  }

  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (exitFlushRegistered) {
    process.removeListener('exit', flushSyncOnExit)
    exitFlushRegistered = false
  }

  buffer = []
  bufferBytes = 0
  writeChain = Promise.resolve()
  logFileSize = null
  originalConsole = null
  installed = false
  logFilePath = ''
}
