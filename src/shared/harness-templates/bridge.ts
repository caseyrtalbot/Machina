import type { HarnessTemplate } from '../harness-types'
import { initialStateFor, rulesFor } from './common'

/**
 * Intentionally incomplete until the builder supplies an invocation template,
 * concrete scope, and verifier. Empty forbiddenGlobs make the legacy
 * template-only create path refuse before mkdir during the Step 8 transition.
 */
const RAW_TOOL_RUNNER: HarnessTemplate = {
  id: 'raw-tool-runner',
  label: 'Raw tool runner',
  category: 'Bridge',
  audience: ['seasoned-programmer', 'platform-builder'],
  description: 'Runs an explicitly configured unknown agent CLI through the raw PTY adapter.',
  adapter: 'raw',
  permissionMode: 'queue-all-writes',
  budgets: { maxTurns: 6, maxWritesPerMinute: 6 },
  requiresConfiguration: true,
  skillBody: [
    'Run one task through the configured raw CLI adapter.',
    '',
    '1. Restate the operator task and the configured scope before inspecting the repository.',
    '2. If the task, prerequisite, or scope is ambiguous, ask one focused question and do not write.',
    '3. Perform exactly one delegated task within the configured allowedGlobs.',
    '4. Run the configured verification gate.',
    '5. Report output, verification, and any raw-adapter limitations, then stop.'
  ].join('\n'),
  rules: rulesFor(
    '- [critical] Never invent or guess an executable command; configuration must supply it.',
    '- [major] Perform one delegated task and one configured verifier run only.',
    '- [major] Do not claim structured parsing, resume support, or model discovery on the raw adapter.'
  ),
  scope: {
    goal: 'Configuration required before this harness can run.',
    allowedGlobs: [],
    forbiddenGlobs: [],
    acceptance: 'The configured verifier exits 0.',
    rollback: 'Reject the pending change in the approvals tray.'
  },
  verifySh: [
    '#!/bin/sh',
    'echo "raw-tool-runner requires a configured verifier" >&2',
    'exit 1',
    ''
  ].join('\n'),
  initialState: initialStateFor('raw-tool-runner')
}

export const BRIDGE_TEMPLATES = [RAW_TOOL_RUNNER] as const
