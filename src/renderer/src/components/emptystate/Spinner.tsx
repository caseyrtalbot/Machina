/**
 * The one ring spinner. Draws in currentColor — set `color` on the spinner or
 * a parent to tint it (accent for page/media loads, inherited for icon slots).
 */
export function Spinner({
  size = 16,
  style
}: {
  readonly size?: number
  readonly style?: React.CSSProperties
}) {
  return <div aria-hidden className="te-spinner" style={{ width: size, height: size, ...style }} />
}
