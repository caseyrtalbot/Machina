import { app, safeStorage } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'

const SECRETS_FILE = (): string => path.join(app.getPath('userData'), 'secrets.bin')

export async function resolveAnthropicKey(): Promise<string | null> {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const buf = await fs.readFile(SECRETS_FILE())
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

export async function setAnthropicKey(key: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage not available; refusing to write key in plaintext')
  }
  const enc = safeStorage.encryptString(key)
  await fs.mkdir(path.dirname(SECRETS_FILE()), { recursive: true })
  await fs.writeFile(SECRETS_FILE(), enc)
}

export async function clearAnthropicKey(): Promise<void> {
  try {
    await fs.rm(SECRETS_FILE(), { force: true })
  } catch {
    // best-effort; the file may not exist
  }
}
