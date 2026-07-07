import { scanSecrets } from '@shared/engine/secrets'
import { segmentOutput, maskSegmentText } from '@shared/engine/block-output-segments'

/**
 * Mask every detected secret span in a string with bullet characters.
 * Always-on (no reveal affordance) — for surfaces like the unknown-tool pill
 * preview and error-card text, where a secret has no business being readable.
 */
export function maskSecretsInText(text: string): string {
  const secrets = scanSecrets(text)
  if (secrets.length === 0) return text
  return segmentOutput(text, secrets)
    .map((seg) => (seg.secret ? maskSegmentText(seg.text) : seg.text))
    .join('')
}
