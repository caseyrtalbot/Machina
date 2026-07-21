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
import { harnessUi } from './harness-styles'

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
    <section aria-labelledby="harness-template-heading">
      <div className={harnessUi.sectionHeading}>
        <div>
          <h2 id="harness-template-heading" className={harnessUi.sectionHeadingTitle}>
            Local agent templates
          </h2>
          <p className={harnessUi.sectionHeadingLede}>
            Each template becomes a reviewable harness. On first run, give it a concrete task brief.
          </p>
        </div>
        <div className={harnessUi.catalogFilters}>
          <div role="group" aria-label="Filter templates by category" className={harnessUi.tabs}>
            {CATEGORY_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                aria-pressed={category === filter}
                className={harnessUi.tab}
                onClick={() => setCategory(filter)}
              >
                {filter === ALL_HARNESS_FILTERS ? 'All' : filter}
              </button>
            ))}
          </div>
          <label className={harnessUi.audienceFilter}>
            <span className={harnessUi.audienceFilterLabel}>Audience</span>
            <select
              aria-label="Filter templates by audience"
              className={harnessUi.audienceFilterSelect}
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

      <div className={harnessUi.cardGrid} data-testid="harness-template-grid">
        {templates.map((template) => {
          const isExpanded = expanded.has(template.id)
          const isCreating = creatingSlug === template.id
          return (
            <article
              key={template.id}
              className={harnessUi.card}
              data-testid={`harness-template-card-${template.id}`}
            >
              <div className={harnessUi.cardKicker}>
                <span>{template.category}</span>
                <span>{template.adapter}</span>
              </div>
              <h3 className={harnessUi.cardTitle}>{template.label}</h3>
              <p className={harnessUi.cardDescription}>{template.description}</p>
              <div className={harnessUi.audienceList} aria-label="Intended audience">
                {template.audience.map((audience) => (
                  <span key={audience} className={harnessUi.audienceTag}>
                    {audience}
                  </span>
                ))}
              </div>

              <dl className={harnessUi.factList}>
                <div className={harnessUi.factRow}>
                  <dt className={harnessUi.factTerm}>Budget</dt>
                  <dd className={harnessUi.factValue}>
                    {template.budgets.maxTurns} turns · {template.budgets.maxWritesPerMinute}{' '}
                    writes/min
                  </dd>
                </div>
                <div className={harnessUi.factRow}>
                  <dt className={harnessUi.factTerm}>Scope</dt>
                  <dd className={harnessUi.factValue}>
                    {template.scope.allowedGlobs.join(', ') || 'No writable globs'}
                  </dd>
                </div>
                <div className={harnessUi.factRow}>
                  <dt className={harnessUi.factTerm}>Verifier</dt>
                  <dd className={harnessUi.factValue}>verify.sh</dd>
                </div>
              </dl>

              {isExpanded && (
                <div className={harnessUi.cardDetails} id={`harness-details-${template.id}`}>
                  <strong className={harnessUi.cardDetailsLabel}>Goal</strong>
                  <p className={harnessUi.cardDetailsText}>{template.scope.goal}</p>
                  <strong className={harnessUi.cardDetailsLabel}>Forbidden</strong>
                  <p className={harnessUi.cardDetailsText}>
                    {template.scope.forbiddenGlobs.join(', ')}
                  </p>
                  <strong className={harnessUi.cardDetailsLabel}>Acceptance</strong>
                  <p className={harnessUi.cardDetailsText}>{template.scope.acceptance}</p>
                  <strong className={harnessUi.cardDetailsLabel}>Deterministic verifier</strong>
                  <pre className={harnessUi.pre}>{template.verifySh}</pre>
                  <strong className={harnessUi.cardDetailsLabel}>First run</strong>
                  <p className={harnessUi.cardDetailsText}>
                    This role has no task context yet. Thought Engine requires a concrete brief
                    before it can start.
                  </p>
                </div>
              )}

              <div className={harnessUi.cardActions}>
                <button
                  type="button"
                  className={`${harnessUi.button} ${harnessUi.buttonSecondary}`}
                  aria-expanded={isExpanded}
                  aria-controls={`harness-details-${template.id}`}
                  onClick={() => toggleExpanded(template.id)}
                >
                  {isExpanded ? 'Hide details' : 'Details'}
                </button>
                <button
                  type="button"
                  className={`${harnessUi.button} ${harnessUi.buttonPrimary}`}
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
