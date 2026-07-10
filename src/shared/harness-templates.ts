/**
 * Built-in harness catalog + compatibility helpers (workstation Step 8).
 * Template definitions are split by gallery category so the registry remains
 * reviewable as the catalog grows.
 */
import type { HarnessFrontmatter, HarnessScope, HarnessTemplate } from './harness-types'
import { serializeHarnessFrontmatter } from './harness-types'
import { GUIDED_TEMPLATES } from './harness-templates/guided'
import { ARCHITECTURE_TEMPLATES } from './harness-templates/architecture'
import { ENGINEERING_TEMPLATES } from './harness-templates/engineering'
import { BRIDGE_TEMPLATES } from './harness-templates/bridge'

export type { HarnessTemplate } from './harness-types'

const CATALOG = [
  ...GUIDED_TEMPLATES,
  ...ARCHITECTURE_TEMPLATES,
  ...ENGINEERING_TEMPLATES,
  ...BRIDGE_TEMPLATES
] as const

/** The single registry consumed by gallery, preview, and main creation. */
export const HARNESS_TEMPLATES: Readonly<Record<string, HarnessTemplate>> = Object.freeze(
  Object.fromEntries(CATALOG.map((template) => [template.id, template]))
)

/** Replace every `<dir>` occurrence in both scope glob lists. */
export function materializeHarnessScope(scope: HarnessScope, harnessDir: string): HarnessScope {
  const replaceDir = (glob: string): string => glob.split('<dir>').join(harnessDir)
  return {
    ...scope,
    allowedGlobs: scope.allowedGlobs.map(replaceDir),
    forbiddenGlobs: scope.forbiddenGlobs.map(replaceDir)
  }
}

/** Compatibility wrapper retained for the Phase 1 main service. */
export function materializeScope(template: HarnessTemplate, harnessDir: string): HarnessScope {
  return materializeHarnessScope(template.scope, harnessDir)
}

/** Compatibility wrapper retained for existing generator/tests. */
export function frontmatterFor(template: HarnessTemplate, slug: string): string {
  const frontmatter: HarnessFrontmatter = {
    name: slug,
    description: template.description,
    adapter: template.adapter,
    permissionMode: template.permissionMode,
    budgets: template.budgets,
    ...(template.invocationTemplate !== undefined
      ? { invocationTemplate: template.invocationTemplate }
      : {})
  }
  return serializeHarnessFrontmatter(frontmatter)
}
