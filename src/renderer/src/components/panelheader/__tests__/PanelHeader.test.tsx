import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PanelHeader } from '../PanelHeader'

describe('PanelHeader', () => {
  it('bar renders title in the left cluster and trailing actions right', () => {
    const onAction = vi.fn()
    render(
      <PanelHeader
        testId="ph"
        title="welcome"
        leading={<span data-testid="dot" />}
        trailing={<button onClick={onAction}>Act</button>}
      />
    )
    const header = screen.getByTestId('ph')
    expect(header.getAttribute('data-variant')).toBe('bar')
    expect(header.querySelector('.te-panel-header__title')?.textContent).toBe('welcome')
    expect(screen.getByTestId('dot')).toBeTruthy()
    fireEvent.click(screen.getByText('Act'))
    expect(onAction).toHaveBeenCalledOnce()
  })

  it('flush bar renders children full-bleed without clusters', () => {
    render(
      <PanelHeader testId="ph" flush>
        <button>Vault</button>
      </PanelHeader>
    )
    const header = screen.getByTestId('ph')
    expect(header.getAttribute('data-flush')).toBe('true')
    expect(header.querySelector('.te-panel-header__left')).toBeNull()
    expect(screen.getByText('Vault')).toBeTruthy()
  })

  it('masthead renders title, display, subtitle, and trailing', () => {
    render(
      <PanelHeader
        testId="ph"
        variant="masthead"
        title="Unresolved References"
        display={7}
        subtitle="ghosts across your vault"
        trailing={<button>Refresh</button>}
      />
    )
    const header = screen.getByTestId('ph')
    expect(header.getAttribute('data-variant')).toBe('masthead')
    expect(header.querySelector('.te-panel-header__m-title')?.textContent).toBe(
      'Unresolved References'
    )
    expect(header.querySelector('.te-panel-header__display')?.textContent).toBe('7')
    expect(header.querySelector('.te-panel-header__subtitle')?.textContent).toBe(
      'ghosts across your vault'
    )
    expect(screen.getByText('Refresh')).toBeTruthy()
  })
})
