import { useMemo, useState } from 'react'
import {
  HARNESS_AUDIENCES,
  type HarnessCreateRequest,
  type HarnessTemplate
} from '@shared/harness-types'
import {
  ALL_HARNESS_FILTERS,
  filterHarnessCatalog,
  type HarnessAudienceFilter,
  type HarnessCategoryFilter
} from './harness-gallery-model'

const CATEGORY_FILTERS: readonly HarnessCategoryFilter[] = [
  ALL_HARNESS_FILTERS,
  'Guided',
  'Architecture',
  'Engineering',
  'Bridge'
]

interface HarnessTemplateCatalogProps {
  readonly creatingSlug: string | null
  readonly onConfigure: (template: HarnessTemplate) => void
  readonly onCreate: (request: HarnessCreateRequest) => void
}

export function HarnessTemplateCatalog({
  creatingSlug,
  onConfigure,
  onCreate
}: HarnessTemplateCatalogProps) {
  const [category, setCategory] = useState<HarnessCategoryFilter>(ALL_HARNESS_FILTERS)
  const [audience, setAudience] = useState<HarnessAudienceFilter>(ALL_HARNESS_FILTERS)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const templates = useMemo(
    () => filterHarnessCatalog({ category, audience }),
    [category, audience]
  )

  function toggleExpanded(templateId: string): void {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(templateId)) next.delete(templateId)
      else next.add(templateId)
      return next
    })
  }

  return (
    <section aria-labelledby="harness-template-heading" className="harness-gallery-section">
      <div className="harness-gallery-section-heading">
        <div>
          <h2 id="harness-template-heading">Local agent templates</h2>
          <p>
            Each template becomes a reviewable harness. On first run, give it a concrete task brief.
          </p>
        </div>
        <div className="harness-catalog-filters">
          <div role="group" aria-label="Filter templates by category" className="harness-tabs">
            {CATEGORY_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={category === filter}
                className="harness-tab"
                onClick={() => setCategory(filter)}
              >
                {filter === ALL_HARNESS_FILTERS ? 'All' : filter}
              </button>
            ))}
          </div>
          <label className="harness-audience-filter">
            <span>Audience</span>
            <select
              aria-label="Filter templates by audience"
              value={audience}
              onChange={(event) => setAudience(event.target.value as HarnessAudienceFilter)}
            >
              <option value={ALL_HARNESS_FILTERS}>All audiences</option>
              {HARNESS_AUDIENCES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="harness-card-grid" data-testid="harness-template-grid">
        {templates.map((template) => {
          const isExpanded = expanded.has(template.id)
          const isCreating = creatingSlug === template.id
          return (
            <article
              key={template.id}
              className="harness-card"
              data-testid={`harness-template-card-${template.id}`}
            >
              <div className="harness-card-kicker">
                <span>{template.category}</span>
                <span>{template.adapter}</span>
              </div>
              <h3>{template.label}</h3>
              <p className="harness-card-description">{template.description}</p>
              <div className="harness-audience-list" aria-label="Intended audience">
                {template.audience.map((audience) => (
                  <span key={audience}>{audience}</span>
                ))}
              </div>

              <dl className="harness-card-facts">
                <div>
                  <dt>Budget</dt>
                  <dd>
                    {template.budgets.maxTurns} turns · {template.budgets.maxWritesPerMinute}{' '}
                    writes/min
                  </dd>
                </div>
                <div>
                  <dt>Scope</dt>
                  <dd>{template.scope.allowedGlobs.join(', ') || 'No writable globs'}</dd>
                </div>
                <div>
                  <dt>Verifier</dt>
                  <dd>verify.sh</dd>
                </div>
              </dl>

              {isExpanded && (
                <div className="harness-card-details" id={`harness-details-${template.id}`}>
                  <strong>Goal</strong>
                  <p>{template.scope.goal}</p>
                  <strong>Forbidden</strong>
                  <p>{template.scope.forbiddenGlobs.join(', ')}</p>
                  <strong>Acceptance</strong>
                  <p>{template.scope.acceptance}</p>
                  <strong>Deterministic verifier</strong>
                  <pre>{template.verifySh}</pre>
                  <strong>First run</strong>
                  <p>
                    This role has no task context yet. Thought Engine requires a concrete brief
                    before it can start.
                  </p>
                </div>
              )}

              <div className="harness-card-actions">
                <button
                  type="button"
                  className="harness-button harness-button-secondary"
                  aria-expanded={isExpanded}
                  aria-controls={`harness-details-${template.id}`}
                  onClick={() => toggleExpanded(template.id)}
                >
                  {isExpanded ? 'Hide details' : 'Details'}
                </button>
                <button
                  type="button"
                  className="harness-button harness-button-primary"
                  disabled={creatingSlug !== null}
                  onClick={() => {
                    if (template.requiresConfiguration) onConfigure(template)
                    else onCreate({ template: template.id, slug: template.id })
                  }}
                >
                  {isCreating
                    ? 'Creating…'
                    : template.requiresConfiguration
                      ? 'Configure'
                      : 'Create'}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
