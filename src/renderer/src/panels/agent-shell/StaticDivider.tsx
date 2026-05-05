/**
 * Vertical hairline divider between the thread panel and the side dock.
 *
 * Renders as a single 1px column on `--line-subtle` (the design's hairline
 * alpha), with a 1px transparent gutter on either side so neighbouring
 * panels still have breathing room.
 */
export function StaticDivider() {
  return (
    <div
      aria-hidden
      style={{
        flexShrink: 0,
        width: 1,
        background: 'var(--line-subtle)'
      }}
    />
  )
}
