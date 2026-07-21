// Tailwind class strings replacing HarnessGallery.css (deleted in the Phase 2
// overlay migration). Shared by HarnessGallery, HarnessTaskBriefDialog,
// HarnessBuilderForm, and HarnessTemplateCatalog — keys mirror the old
// .harness-* class names so styles stay greppable against git history.

// Micro building blocks the old stylesheet expressed as grouped selectors.
const microLabel =
  'font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-text-muted)]'
const nanoLabel = 'font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-text-muted)]'
const bodyText = 'm-0 text-[12px] leading-[1.55] text-[var(--color-text-secondary)]'
const surfaceBox =
  'border border-[var(--color-border-default)] rounded-[var(--r-tool)] bg-[var(--color-bg-surface)]'
const warnCallout =
  'px-2 py-[7px] text-[var(--signal-warn)] border-l-2 border-[var(--signal-warn)] bg-[color-mix(in_srgb,var(--signal-warn)_6%,transparent)] font-mono text-[10px] leading-[1.5]'

const dialogShell =
  'flex min-h-0 flex-col overflow-hidden text-[var(--color-text-primary)] border border-[var(--color-border-strong)] rounded-[var(--r-tool)] [font-family:var(--font-body,system-ui,sans-serif)]'

export const harnessUi = {
  // ── Dialog chrome (HarnessGallery / HarnessTaskBriefDialog) ──
  backdropPad: 'p-6 max-[760px]:p-2',
  galleryDialog: `${dialogShell} w-[min(1080px,100%)] max-h-[min(900px,calc(100vh-48px))] max-[760px]:max-h-[calc(100vh-16px)]`,
  taskDialog: `${dialogShell} w-[min(680px,100%)] max-h-[min(820px,calc(100vh-48px))] max-[760px]:max-h-[calc(100vh-16px)]`,
  header:
    'flex items-start justify-between gap-6 px-6 pt-5 pb-4 border-b border-[var(--line-subtle)] bg-[var(--color-bg-chrome)]',
  headerTitle: 'm-0 mt-1 text-[20px] font-semibold text-[var(--color-text-primary)]',
  headerLede: 'mx-0 mb-0 mt-[5px] text-[12px] leading-[1.5] text-[var(--color-text-muted)]',
  eyebrow: microLabel,
  closeButton:
    'h-[30px] w-[30px] cursor-pointer border border-[var(--color-border-default)] rounded-[var(--r-inline)] bg-transparent p-0 text-[22px] leading-none text-[var(--color-text-secondary)] hover:border-[var(--color-accent-default)] hover:text-[var(--color-text-primary)] focus-visible:border-[var(--color-accent-default)] focus-visible:text-[var(--color-text-primary)] focus-visible:outline-none',
  modeTabs: 'flex gap-0 border-b border-[var(--line-subtle)] bg-[var(--color-bg-surface)] px-6',
  modeTab:
    'cursor-pointer border-0 border-b-2 border-b-transparent bg-transparent px-3 py-[10px] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)] aria-[current=page]:border-b-[var(--color-accent-default)] aria-[current=page]:text-[var(--color-text-primary)]',
  galleryBody: 'min-h-0 overflow-y-auto bg-[var(--color-bg-base)] px-6 pt-[22px] pb-7',

  // ── Create result notices (shared) ──
  createError:
    'mb-4 flex items-center justify-between gap-[14px] border-l-2 border-[var(--signal-danger)] bg-[var(--color-bg-surface)] px-3 py-[10px] text-[12px] text-[var(--signal-danger)] [&_span]:min-w-0',
  createSuccess:
    'mb-4 flex items-center justify-between gap-[14px] border-l-2 border-[var(--signal-success)] bg-[var(--color-bg-surface)] px-3 py-[10px] text-[12px] text-[var(--signal-success)]',
  createSuccessDetails: 'grid min-w-0 gap-[3px]',
  createSuccessPath:
    'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-[var(--color-text-muted)]',
  createSuccessNote: 'text-[11px] text-[var(--color-text-secondary)]',

  // ── Buttons (shared) ──
  button:
    'cursor-pointer rounded-[var(--r-inline)] px-[10px] py-[7px] font-mono text-[10px] tracking-[0.06em] disabled:cursor-default disabled:opacity-45',
  buttonPrimary:
    'border border-[var(--color-accent-default)] bg-[var(--color-accent-default)] text-[var(--color-bg-base)]',
  buttonSecondary:
    'border border-[var(--color-border-default)] bg-transparent text-[var(--color-text-secondary)]',

  // ── Task brief dialog body ──
  taskBody: 'grid min-h-0 gap-[14px] overflow-y-auto bg-[var(--color-bg-base)] px-6 pt-5 pb-6',
  taskPanel: `grid gap-[9px] p-3 ${surfaceBox}`,
  taskRoleColumns: 'grid-cols-[minmax(0,1fr)_auto] max-[760px]:grid-cols-1',
  taskPanelHeading: `m-0 mb-[6px] font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]`,
  taskRoleName: 'text-[13px] font-semibold text-[var(--color-text-primary)]',
  taskPanelText: 'mx-0 mb-0 mt-1 text-[12px] leading-[1.5] text-[var(--color-text-secondary)]',
  scopeBoundary: `m-0 ${warnCallout}`,
  taskRoleFacts: 'm-0 grid content-start gap-[7px]',
  taskRoleFactRow: 'grid grid-cols-[56px_auto] gap-2',
  taskFactTerm: nanoLabel,
  taskFactValue: 'm-0 font-mono text-[10px] text-[var(--color-text-secondary)]',
  scopeRow: 'grid grid-cols-[74px_minmax(0,1fr)] gap-2',
  scopeCode:
    'min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-[var(--color-text-secondary)]',
  taskField: 'grid gap-[7px]',
  taskFieldLabel: microLabel,
  taskFieldTextarea:
    'box-border w-full resize-y rounded-[var(--r-inline)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] p-[10px] text-[13px] leading-[1.55] text-[var(--color-text-primary)] outline-none [font-family:var(--font-body,system-ui,sans-serif)] focus:border-[var(--color-accent-default)] focus:outline focus:outline-1 focus:outline-[var(--color-accent-line)]',
  validationRow:
    '-mt-2 flex justify-between gap-3 font-mono text-[10px] text-[var(--color-text-muted)] [&_[data-valid=false]]:text-[var(--signal-danger)] [&_[data-over-limit=true]]:text-[var(--signal-danger)] [&_[data-valid=true]]:text-[var(--signal-success)]',
  taskProgress: 'min-h-[1.5em] font-mono text-[10px] text-[var(--color-text-secondary)]',
  taskActions: 'flex justify-end gap-2 border-t border-[var(--line-subtle)] pt-3',

  // ── Gallery catalog (HarnessTemplateCatalog) ──
  sectionHeading:
    'mb-[18px] flex items-end justify-between gap-5 max-[760px]:flex-col max-[760px]:items-start',
  sectionHeadingTitle: 'm-0 text-[16px] font-semibold text-[var(--color-text-primary)]',
  sectionHeadingLede: 'mx-0 mb-0 mt-[5px] text-[12px] leading-[1.5] text-[var(--color-text-muted)]',
  catalogFilters: 'grid justify-items-end gap-2 max-[760px]:justify-items-start',
  audienceFilter: 'flex items-center gap-2',
  audienceFilterLabel: nanoLabel,
  audienceFilterSelect:
    'rounded-[var(--r-inline)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-[7px] py-[5px] font-mono text-[10px] text-[var(--color-text-secondary)]',
  tabs: 'flex flex-wrap border-b border-[var(--line-subtle)]',
  tab: 'cursor-pointer border-0 border-b-2 border-b-transparent bg-transparent px-[9px] py-[7px] font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--color-text-muted)] aria-pressed:border-b-[var(--color-accent-default)] aria-pressed:text-[var(--color-text-primary)]',
  cardGrid: 'grid grid-cols-2 gap-3 max-[760px]:grid-cols-1',
  card: `flex min-w-0 flex-col gap-[10px] p-4 ${surfaceBox} hover:border-[var(--color-border-strong)]`,
  cardKicker: `flex justify-between gap-3 ${microLabel} tracking-[0.12em]`,
  cardTitle: 'm-0 text-[14px] font-semibold text-[var(--color-text-primary)]',
  cardDescription: bodyText,
  audienceList: 'flex flex-wrap gap-[5px]',
  audienceTag:
    'rounded-[var(--r-inline)] border border-[var(--line-subtle)] px-[6px] py-[3px] font-mono text-[9px] text-[var(--color-text-muted)]',
  factList: 'm-0 grid gap-[7px]',
  factRow: 'grid grid-cols-[68px_minmax(0,1fr)] gap-2',
  factTerm: microLabel,
  factValue:
    'm-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10px] text-[var(--color-text-secondary)]',
  cardDetails:
    'grid gap-[5px] border-l-2 border-[var(--color-accent-line)] bg-[var(--color-bg-elevated)] p-[10px]',
  cardDetailsLabel:
    'mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--color-text-muted)]',
  cardDetailsText: bodyText,
  pre: 'mx-0 mb-0 mt-[3px] max-h-[180px] overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-[1.5] text-[var(--color-text-secondary)]',
  cardActions: 'mt-auto flex items-center justify-end gap-2',

  // ── Builder form (HarnessBuilderForm) ──
  builder: 'grid gap-4',
  formGrid: 'grid grid-cols-2 gap-3 max-[760px]:grid-cols-1',
  field: 'grid min-w-0 content-start gap-[6px]',
  fieldWide: 'col-span-full max-[760px]:col-auto',
  fieldLabel: microLabel,
  fieldInput:
    'box-border w-full rounded-[var(--r-inline)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-[9px] py-2 font-mono text-[11px] leading-[1.5] text-[var(--color-text-primary)] focus:border-[var(--color-accent-default)] focus:outline focus:outline-1 focus:outline-[var(--color-accent-line)]',
  fieldTextarea: 'resize-y',
  fieldError: 'font-mono text-[10px] text-[var(--signal-danger)]',
  fixedValue:
    'box-border w-full rounded-[var(--r-inline)] border border-[var(--color-border-default)] bg-[var(--color-bg-surface)] px-[9px] py-2 font-mono text-[11px] leading-[1.5] text-[var(--color-text-muted)]',
  shellWarning: warnCallout,
  disclosure: `p-3 ${surfaceBox} [&[open]>summary]:mb-3`,
  disclosureSummary: 'cursor-pointer font-mono text-[11px] text-[var(--color-text-secondary)]',
  rawWarning: `grid gap-[9px] p-3 ${surfaceBox} border-[var(--signal-warn)] bg-[color-mix(in_srgb,var(--signal-warn)_7%,var(--color-bg-surface))] [&_code]:font-mono`,
  rawWarningTitle: 'm-0 text-[12px] font-semibold text-[var(--color-text-primary)]',
  rawWarningText: bodyText,
  diagnostics: `p-3 ${surfaceBox}`,
  diagnosticsTitle: 'm-0 text-[12px] font-semibold text-[var(--color-text-primary)]',
  diagnosticsList: 'mx-0 mb-0 mt-2 grid list-none gap-[5px] p-0',
  diagnosticsItem:
    'm-0 font-mono text-[10px] leading-[1.5] data-[severity=error]:text-[var(--signal-danger)] data-[severity=warning]:text-[var(--signal-warn)]',
  diagnosticOk: 'm-0 mt-[7px] font-mono text-[10px] leading-[1.5] text-[var(--signal-success)]',
  builderActions:
    'mt-auto flex items-center justify-end gap-2 border-t border-[var(--line-subtle)] pt-3 [&>span]:mr-auto [&>span]:font-mono [&>span]:text-[10px] [&>span]:text-[var(--color-text-muted)]'
} as const
