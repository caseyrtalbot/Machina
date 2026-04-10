import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { inspect } from 'util'

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error'

const LOG_FILENAME = 'main.log'
const FALLBACK_USER_DATA_DIR = join(process.cwd(), '.machina-user-data')

let installed = false
let logFilePath = ''
let originalConsole: Pick<Console, ConsoleLevel> | null = null

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

function appendLogLine(line: string): void {
  const targetPath = logFilePath || resolveMainLogFilePath()
  logFilePath = targetPath

  try {
    mkdirSync(dirname(targetPath), { recursive: true })
    appendFileSync(targetPath, `${line}\n`, 'utf8')
  } catch (err) {
    process.stderr.write(`[main-logger] write failed: ${String(err)}\n`)
  }
}

function patchConsoleLevel(level: ConsoleLevel): void {
  const original = originalConsole?.[level]
  if (!original) return

  console[level] = ((...args: unknown[]) => {
    original(...args)
    appendLogLine(formatMainLogEntry(level, args))
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

  appendLogLine(formatMainLogEntry('info', ['Main logger initialized']))
  return logFilePath
}

export function resetMainLoggerForTests(): void {
  if (originalConsole) {
    console.log = originalConsole.log
    console.info = originalConsole.info
    console.warn = originalConsole.warn
    console.error = originalConsole.error
  }

  originalConsole = null
  installed = false
  logFilePath = ''
}
