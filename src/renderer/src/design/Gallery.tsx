import type { ReactNode } from 'react'
import { FileText } from 'lucide-react'
import { TabBar, type TabBarItem, type TabBarVariant } from '../components/tabbar/TabBar'
import { EmptyState, CheckCircleIcon } from '../components/emptystate/EmptyState'
import { Spinner } from '../components/emptystate/Spinner'
import { LoadingState } from '../components/emptystate/LoadingState'
import { PanelHeader } from '../components/panelheader/PanelHeader'
import { iconSize, iconStroke } from './tokens'
import './gallery.css'

/**
 * Dev-only component gallery (ADR 0005 §Enforcement). Reached ONLY via
 * `?gallery=1` (wired in main.tsx); never linked from the app. It enumerates
 * every shared primitive in every state its own classes can express, as the
 * fixed target for the Playwright visual-regression spec.
 *
 * Determinism contract (relied on by the visual spec): static content only —
 * no timers, no network, no IPC, no random data, no dates, no hover state. The
 * ring spinner animates; the spec masks its section (`gallery-spinner`).
 */

function noop() {
  // Static gallery: primitive callbacks are inert (no interaction is exercised).
}

function Section({
  id,
  label,
  children
}: {
  readonly id: string
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <section className="te-gallery-section" data-testid={`gallery-${id}`}>
      <h2 className="te-gallery-section__label">{label}</h2>
      {children}
    </section>
  )
}

function Swatch({ token, name, value }: { token: string; name: string; value: string }) {
  return (
    <div className="te-gallery-swatch">
      <div className="te-gallery-swatch__chip" data-token={token} />
      <div className="te-gallery-swatch__meta">
        <span className="te-gallery-swatch__name">{name}</span>
        <span className="te-gallery-swatch__val">{value}</span>
      </div>
    </div>
  )
}

function Frame({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="te-gallery-frame">
      <div className="te-gallery-frame__caption">{caption}</div>
      <div className="te-gallery-frame__body">{children}</div>
    </div>
  )
}

// Stable tab sets per variant: one active, one dirty, one preview, one plain.
function tabItems(prefix: string): TabBarItem[] {
  return [
    { id: `${prefix}-1`, label: 'Overview', testId: `${prefix}-tab-1` },
    { id: `${prefix}-2`, label: 'Unsaved', dirty: true, testId: `${prefix}-tab-2` },
    { id: `${prefix}-3`, label: 'Preview', preview: true, testId: `${prefix}-tab-3` },
    { id: `${prefix}-4`, label: 'Details', testId: `${prefix}-tab-4` }
  ]
}

function TabBarShowcase({ variant }: { variant: TabBarVariant }) {
  const items = tabItems(variant)
  return (
    <Frame caption={`variant="${variant}"`}>
      <TabBar
        variant={variant}
        items={items}
        activeId={items[0].id}
        ariaLabel={`${variant} example tabs`}
        onActivate={noop}
        onClose={noop}
        testId={`gallery-tabbar-${variant}`}
      />
    </Frame>
  )
}

export function Gallery() {
  return (
    <div className="te-gallery" data-testid="gallery-root">
      <h1 className="te-gallery__title">Machina component gallery</h1>
      <p className="te-gallery__lede">
        Every ratified primitive and token, enumerated for visual regression. Dev-only route
        (?gallery=1). ADR 0005.
      </p>

      <Section id="color-ramp" label="Color · neutral & accent ramp">
        <div className="te-gallery-swatches">
          <Swatch token="bg-base" name="bg / base (void)" value="--color-bg-base" />
          <Swatch token="bg-surface" name="bg / surface" value="--color-bg-surface" />
          <Swatch token="bg-elevated" name="bg / elevated" value="--color-bg-elevated" />
          <Swatch token="bg-card" name="bg / card" value="--bg-card" />
          <Swatch token="bg-card-hover" name="bg / card hover" value="--bg-card-hover" />
          <Swatch token="bg-chrome" name="bg / chrome" value="--color-bg-chrome" />
          <Swatch token="bg-rail" name="bg / rail" value="--color-bg-rail" />
          <Swatch token="accent-default" name="accent / default" value="--color-accent-default" />
          <Swatch token="accent-hover" name="accent / hover" value="--color-accent-hover" />
          <Swatch token="accent-muted" name="accent / muted" value="--color-accent-muted" />
          <Swatch token="accent-soft" name="accent / soft" value="--color-accent-soft" />
          <Swatch token="accent-line" name="accent / line" value="--color-accent-line" />
          <Swatch token="line-faint" name="line / faint" value="--line-faint" />
          <Swatch token="line-subtle" name="line / subtle" value="--line-subtle" />
          <Swatch token="line-default" name="line / default" value="--line-default" />
          <Swatch token="line-strong" name="line / strong" value="--line-strong" />
        </div>
      </Section>

      <Section id="signals" label="Color · status signals">
        <div className="te-gallery-swatches">
          <Swatch token="signal-success" name="signal / success" value="--signal-success" />
          <Swatch token="signal-warn" name="signal / warn" value="--signal-warn" />
          <Swatch token="signal-danger" name="signal / danger" value="--signal-danger" />
          <Swatch token="signal-info" name="signal / info" value="--signal-info" />
        </div>
      </Section>

      <Section id="text-levels" label="Color · text levels on each surface">
        <div className="te-gallery-text-rows">
          {(['base', 'surface', 'elevated'] as const).map((surface) => (
            <div key={`p-${surface}`}>
              <div className="te-gallery-text-row" data-surface={surface} data-level="primary">
                Primary text on {surface} — the quick brown fox jumps over the lazy dog.
              </div>
            </div>
          ))}
          <div className="te-gallery-text-row" data-surface="surface" data-level="secondary">
            Secondary text — supporting copy and labels.
          </div>
          <div className="te-gallery-text-row" data-surface="surface" data-level="muted">
            Muted text — timestamps, counts, de-emphasized metadata.
          </div>
          <div className="te-gallery-text-row" data-surface="surface" data-level="disabled">
            Disabled text — inactive controls (WCAG-exempt).
          </div>
          <div className="te-gallery-text-row" data-surface="surface" data-level="accent">
            Accent text — links and active labels.
          </div>
        </div>
      </Section>

      <Section id="type-scale" label="Typography · modular scale">
        <div>
          <TypeRow tag="microLabel · 9px" size="micro" sample="Weekday · palette tag" />
          <TypeRow tag="metadata · 10px" size="metadata" sample="Section header" />
          <TypeRow tag="ui-fs-sm · 12px" size="ui-sm" sample="Secondary UI text" />
          <TypeRow tag="ui-fs · 13px (base)" size="ui" sample="Base UI text" />
          <TypeRow tag="palette input · 15px" size="input" sample="Command input" />
          <TypeRow tag="card body · 16px" size="body" sample="Reading body copy" />
        </div>
      </Section>

      <Section id="elevation" label="Material · elevation tiers">
        <div className="te-gallery-elevation">
          <div className="te-gallery-elev-card" data-elev="void">
            <span className="te-gallery-elev-card__name">Void</span>
            base · no shadow
          </div>
          <div className="te-gallery-elev-card" data-elev="surface">
            <span className="te-gallery-elev-card__name">Surface</span>
            surface · --shadow-card
          </div>
          <div className="te-gallery-elev-card" data-elev="raised">
            <span className="te-gallery-elev-card__name">Raised</span>
            elevated · --shadow-compact
          </div>
          <div className="te-gallery-elev-card" data-elev="overlay">
            <span className="te-gallery-elev-card__name">Overlay</span>
            card · --shadow-floating
          </div>
        </div>
      </Section>

      <Section id="tabbar" label="Primitive · TabBar (all variants)">
        <div className="te-gallery-row">
          <TabBarShowcase variant="underline" />
          <TabBarShowcase variant="chrome" />
          <TabBarShowcase variant="pill" />
        </div>
      </Section>

      <Section id="contextmenu" label="Primitive · ContextMenu item styling">
        {/*
          Static replica of ContextMenu's item DOM/classes. role="menu"/
          "menuitem" are deliberately omitted — that ARIA vocabulary is owned
          solely by ContextMenu.tsx (CLAUDE.md invariant); the live menu is
          portaled + position:fixed and can't render in flow, so we showcase
          only its class-encoded states.
        */}
        <div className="te-gallery-menu-host">
          <div className="te-ctx-menu">
            <div className="te-ctx-menu__header">Section header</div>
            <button type="button" className="te-ctx-menu__item">
              <FileText
                size={iconSize.sm}
                strokeWidth={iconStroke}
                className="te-ctx-menu__item-icon"
              />
              <span className="te-ctx-menu__item-label">Open note</span>
              <span className="te-ctx-menu__item-shortcut">⌘O</span>
            </button>
            <button type="button" className="te-ctx-menu__item" data-active>
              <span className="te-ctx-menu__item-label">Active / highlighted item</span>
              <span className="te-ctx-menu__item-shortcut">⏎</span>
            </button>
            <button type="button" className="te-ctx-menu__item" disabled>
              <span className="te-ctx-menu__item-label">Disabled item</span>
            </button>
            <div className="te-ctx-menu__sep" />
            <button type="button" className="te-ctx-menu__item" data-destructive>
              <span className="te-ctx-menu__item-label">Delete</span>
              <span className="te-ctx-menu__item-shortcut">⌫</span>
            </button>
          </div>
        </div>
      </Section>

      <Section id="emptystate" label="Primitive · EmptyState (card / plain / error)">
        <div className="te-gallery-row">
          <Frame caption='variant="card"'>
            <EmptyState
              variant="card"
              eyebrow="Canvas"
              title="Nothing here yet"
              body="Drop a note or run an agent to populate this canvas."
              actions={[{ label: 'New note', onClick: noop }]}
            />
          </Frame>
          <Frame caption='variant="plain" · resolved'>
            <EmptyState
              variant="plain"
              icon={<CheckCircleIcon size={32} />}
              title="All clear"
              body="No outstanding ghosts to resolve."
              hint="Refreshed on every save."
            />
          </Frame>
          <Frame caption='variant="plain" · error'>
            <EmptyState
              variant="plain"
              eyebrow="Error"
              title="Couldn't load vault"
              body="The workspace path no longer exists."
              actions={[
                { label: 'Retry', onClick: noop },
                { label: 'Choose folder', onClick: noop, kind: 'secondary' }
              ]}
            />
          </Frame>
        </div>
      </Section>

      <Section id="spinner" label="Primitive · Spinner (animated — masked in visual spec)">
        <div className="te-gallery-row" data-testid="gallery-spinner">
          <Spinner size={16} />
          <Spinner size={24} />
          <Spinner size={32} />
        </div>
      </Section>

      <Section id="loadingstate" label="Primitive · LoadingState">
        <Frame caption="LoadingState">
          <LoadingState label="Loading vault..." />
        </Frame>
      </Section>

      <Section id="panelheader" label="Primitive · PanelHeader (bar / masthead)">
        <div className="te-gallery-col">
          <Frame caption='variant="bar"'>
            <PanelHeader
              variant="bar"
              title="OUTLINE"
              trailing={
                <button type="button" className="te-btn" data-size="sm">
                  Action
                </button>
              }
            />
          </Frame>
          <Frame caption='variant="masthead"'>
            <PanelHeader
              variant="masthead"
              title="Ghosts"
              display="12"
              subtitle="unresolved density gaps"
              trailing={
                <button type="button" className="te-btn" data-size="sm">
                  Refresh
                </button>
              }
            />
          </Frame>
        </div>
      </Section>

      <Section id="buttons" label="Primitive · Buttons & chips">
        <div className="te-gallery-row">
          <button type="button" className="te-btn">
            Default
          </button>
          <button type="button" className="te-btn" data-variant="primary">
            Primary
          </button>
          <button type="button" className="te-btn" data-variant="ghost">
            Ghost
          </button>
          <button type="button" className="te-btn" data-size="sm">
            Small
          </button>
          <button type="button" className="te-btn" disabled>
            Disabled
          </button>
          <div className="te-float-chip">
            <div className="te-gallery-chip-inner">
              <button type="button" className="te-btn" data-variant="ghost" data-size="sm">
                Zoom in
              </button>
              <button type="button" className="te-btn" data-variant="ghost" data-size="sm">
                Fit
              </button>
            </div>
          </div>
        </div>
      </Section>

      <Section id="inputs" label="Primitive · Form inputs">
        {/*
          The app has no single canonical form-input primitive — fields are
          context-scoped. `.te-rename-input` is the representative bordered
          text field. Values are readOnly so the section stays static.
        */}
        <div className="te-gallery-col">
          <input
            className="te-rename-input"
            value="Editable field"
            readOnly
            aria-label="Text field"
          />
          <input
            className="te-rename-input"
            value="Disabled field"
            readOnly
            disabled
            aria-label="Disabled text field"
          />
        </div>
      </Section>
    </div>
  )
}

function TypeRow({ tag, size, sample }: { tag: string; size: string; sample: string }) {
  return (
    <div className="te-gallery-type-row">
      <span className="te-gallery-type-row__tag">{tag}</span>
      <span className="te-gallery-type-row__sample" data-size={size}>
        {sample}
      </span>
    </div>
  )
}
