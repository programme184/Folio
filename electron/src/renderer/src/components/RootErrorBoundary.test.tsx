import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RootErrorBoundary } from './RootErrorBoundary'

function Boom(): never { throw new Error('lazy editor exploded') }

afterEach(cleanup)

describe('RootErrorBoundary', () => {
  it('shows a recoverable error instead of unmounting to a blank page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<RootErrorBoundary><Boom /></RootErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toContain('lazy editor exploded')
    expect(screen.getByRole('button')).toBeTruthy()
  })

  it('renders children when nothing fails', () => {
    render(<RootErrorBoundary><p>ok</p></RootErrorBoundary>)
    expect(screen.getByText('ok')).toBeTruthy()
  })
})
