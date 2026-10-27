import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaperMarkBar, PaperMarkBarProvider, usePublishPaperMarkBar, type PaperMarkBarApi } from './paper-mark-bar'

function Host(props: PaperMarkBarApi) {
  usePublishPaperMarkBar(props)
  return <PaperMarkBar />
}

describe('paper mark bar', () => {
  afterEach(() => cleanup())

  it('puts highlight, underline, and the color menu on the file header', () => {
    const toggle = vi.fn()
    const setColor = vi.fn()
    const hold = vi.fn()
    const release = vi.fn()
    const api: PaperMarkBarApi = {
      enabled: false,
      highlightActive: false,
      underlineActive: false,
      color: '#ffd400',
      setColor,
      toggle,
      hold,
      release
    }
    const view = render(<PaperMarkBarProvider><Host {...api} /></PaperMarkBarProvider>)
    const highlight = screen.getByRole('button', { name: 'Highlight' })
    const underline = screen.getByRole('button', { name: 'Underline' })
    expect(screen.getByRole('group', { name: 'Highlight and underline' })).toBeInTheDocument()
    expect(highlight).toBeDisabled()
    expect(underline).toBeDisabled()

    view.rerender(<PaperMarkBarProvider><Host {...api} enabled highlightActive /></PaperMarkBarProvider>)
    expect(screen.getByRole('button', { name: 'Highlight' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.mouseEnter(screen.getByRole('group', { name: 'Highlight and underline' }))
    fireEvent.click(screen.getByRole('button', { name: 'Highlight' }))
    expect(toggle).toHaveBeenCalledWith('highlight')
    fireEvent.click(screen.getByRole('button', { name: 'Underline' }))
    expect(toggle).toHaveBeenCalledWith('underline')

    fireEvent.click(screen.getByRole('button', { name: 'Color' }))
    expect(screen.getByRole('menuitemradio', { name: 'Yellow' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Red' }))
    expect(setColor).toHaveBeenCalledWith('#ff6666')
    expect(screen.queryByRole('menu', { name: 'Color' })).not.toBeInTheDocument()
    expect(hold).toHaveBeenCalled()
  })
})
