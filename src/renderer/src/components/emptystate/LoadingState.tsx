/** The one plain-text loading block (cards, suspense fallbacks). */
export function LoadingState({
  label = 'Loading...',
  padding = 28,
  testId
}: {
  readonly label?: string
  readonly padding?: number
  readonly testId?: string
}) {
  return (
    <div data-testid={testId} style={{ padding }}>
      <span className="te-loading-state__label">{label}</span>
    </div>
  )
}
