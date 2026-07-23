export interface PanelHeaderProps {
  /** 'bar' = 44px hairline-bottom chrome bar; 'masthead' = content-flow panel heading. */
  readonly variant?: 'bar' | 'masthead'
  /**
   * bar: mono metadata label in the left cluster.
   * masthead: the 13px/300 heading line.
   */
  readonly title?: React.ReactNode
  /** bar only: nodes before the title in the left cluster. */
  readonly leading?: React.ReactNode
  /** Right-aligned action cluster. */
  readonly trailing?: React.ReactNode
  /** bar only: full-bleed content replacing the left/right clusters. */
  readonly flush?: boolean
  /** masthead only: large display line (e.g. the ghost count numeral). */
  readonly display?: React.ReactNode
  /** masthead only: small line under the title/display. */
  readonly subtitle?: React.ReactNode
  readonly children?: React.ReactNode
  readonly testId?: string
}

/**
 * The one panel header/toolbar pattern. Skins live in the `te-panel-header`
 * CSS vocabulary (data-variant); consumers own only their content nodes.
 */
export function PanelHeader({
  variant = 'bar',
  title,
  leading,
  trailing,
  flush = false,
  display,
  subtitle,
  children,
  testId
}: PanelHeaderProps) {
  if (variant === 'masthead') {
    return (
      <header className="te-panel-header" data-variant="masthead" data-testid={testId}>
        <div className="te-panel-header__left">
          {title && <div className="te-panel-header__m-title">{title}</div>}
          {display !== undefined && <div className="te-panel-header__display">{display}</div>}
          {subtitle && <div className="te-panel-header__subtitle">{subtitle}</div>}
        </div>
        {trailing && <div className="te-panel-header__right">{trailing}</div>}
      </header>
    )
  }

  return (
    <header
      className="te-panel-header"
      data-variant="bar"
      data-flush={flush || undefined}
      data-testid={testId}
    >
      {flush ? (
        children
      ) : (
        <>
          <div className="te-panel-header__left">
            {leading}
            {title && <span className="te-panel-header__title">{title}</span>}
          </div>
          {trailing && <div className="te-panel-header__right">{trailing}</div>}
        </>
      )}
    </header>
  )
}
