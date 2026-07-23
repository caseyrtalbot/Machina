import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CheckCircleIcon, EmptyState } from '../EmptyState'
import { LoadingState } from '../LoadingState'
import { Spinner } from '../Spinner'

describe('EmptyState', () => {
  it('renders eyebrow, title, body, and hint', () => {
    render(
      <EmptyState eyebrow="Empty Vault" title="Put a thought down." body="Some body." hint="hint" />
    )
    expect(screen.getByText('Empty Vault')).toBeTruthy()
    expect(screen.getByText('Put a thought down.')).toBeTruthy()
    expect(screen.getByText('Some body.')).toBeTruthy()
    expect(screen.getByText('hint')).toBeTruthy()
  })

  it('renders actions as buttons and fires their handlers', () => {
    const onPrimary = vi.fn()
    const onSecondary = vi.fn()
    render(
      <EmptyState
        title="T"
        actions={[
          { label: 'Go', onClick: onPrimary },
          { label: 'Other', onClick: onSecondary, kind: 'secondary' }
        ]}
      />
    )
    fireEvent.click(screen.getByText('Go'))
    fireEvent.click(screen.getByText('Other'))
    expect(onPrimary).toHaveBeenCalledOnce()
    expect(onSecondary).toHaveBeenCalledOnce()
  })

  it('card overlay marks the wrapper as an overlay card', () => {
    render(<EmptyState variant="card" overlay testId="canvas-empty-vault" title="T" />)
    const wrapper = screen.getByTestId('canvas-empty-vault')
    expect(wrapper.className).toContain('te-empty')
    expect(wrapper.getAttribute('data-variant')).toBe('card')
    expect(wrapper.getAttribute('data-overlay')).toBe('true')
  })

  it('plain variant fills and centers by default', () => {
    render(<EmptyState testId="dock-empty-state" eyebrow="no surface open" />)
    const el = screen.getByTestId('dock-empty-state')
    expect(el.getAttribute('data-variant')).toBe('plain')
    expect(el.getAttribute('data-align')).toBe('center')
    expect(el.getAttribute('data-height')).toBe('fill')
  })

  it('align=start uses the top-left layout', () => {
    render(<EmptyState testId="thread-empty" align="start" title="Ask." />)
    const el = screen.getByTestId('thread-empty')
    expect(el.getAttribute('data-align')).toBe('start')
  })
})

describe('LoadingState', () => {
  it('renders the default label', () => {
    render(<LoadingState testId="ls" />)
    expect(screen.getByText('Loading...')).toBeTruthy()
  })

  it('renders a custom label and padding', () => {
    render(<LoadingState label="Loading diagram…" padding={12} testId="ls2" />)
    expect(screen.getByText('Loading diagram…')).toBeTruthy()
    expect(screen.getByTestId('ls2').style.padding).toBe('12px')
  })
})

describe('Spinner', () => {
  it('renders the te-spinner ring sized by prop', () => {
    const { container } = render(<Spinner size={20} />)
    const el = container.querySelector('.te-spinner') as HTMLElement
    expect(el).toBeTruthy()
    expect(el.style.width).toBe('20px')
  })
})

describe('CheckCircleIcon', () => {
  it('renders an svg with the shared check path', () => {
    const { container } = render(<CheckCircleIcon />)
    expect(container.querySelector('svg path')?.getAttribute('d')).toContain('M22 11.08')
  })
})
