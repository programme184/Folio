import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentsDockAPI } from '@shared/ipc'
import { PAPER_PARAGRAPH_RETARGET_MS, PaperPassageView } from './PaperSelection'

const glyphs = [
  { text: 'Their rich kinematic structure en-', x: 50, y: 700, width: 200, height: 10 },
  { text: 'ables robots to reproduce.', x: 50, y: 686, width: 170, height: 10 }
]

const twoParagraphs = [
  { text: 'Many grasping systems simplify reaching.', x: 50, y: 700, width: 180, height: 12 },
  { text: 'Once contact occurs, closing toward a fixed configuration offers limited flexibility.', x: 50, y: 680, width: 320, height: 12 }
]

describe('paper selection toolbar', () => {
  afterEach(() => cleanup())

  it('copies the normalized passage and hides when the blank page is clicked', () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'agentsDock', {
      configurable: true,
      value: { native: { writeClipboard } } as unknown as AgentsDockAPI
    })
    const view = render(<PaperPassageView pages={[{ page: 1, glyphs }]} canAsk={false} />)
    const first = view.container.querySelector('[data-paper-item="0"]')
    const second = view.container.querySelector('[data-paper-item="1"]')
    const range = document.createRange()
    range.setStart(first?.firstChild ?? first!, 0)
    range.setEnd(second?.firstChild ?? second!, second?.textContent?.length ?? 0)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.mouseUp(view.container.querySelector('.paper-passage-view')!)

    expect(screen.getByRole('toolbar', { name: 'Paper selection' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Explain' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Translate' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeClipboard).toHaveBeenCalledWith('Their rich kinematic structure enables robots to reproduce.')

    const page = view.container.querySelector('.paper-page')!
    fireEvent.mouseDown(page)
    fireEvent.mouseUp(page)
    expect(screen.queryByRole('toolbar', { name: 'Paper selection' })).not.toBeInTheDocument()
  })

  it('replaces the hovered paragraph with the text dragged by the left button', () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'agentsDock', {
      configurable: true,
      value: { native: { writeClipboard } } as unknown as AgentsDockAPI
    })
    const view = render(<PaperPassageView pages={[{ page: 1, glyphs }]} canAsk={false} />)
    const first = view.container.querySelector<HTMLElement>('[data-paper-item="0"]')!
    const second = view.container.querySelector<HTMLElement>('[data-paper-item="1"]')!
    fireEvent.mouseMove(first)
    expect(second).toHaveClass('paper-paragraph-hot')

    const range = document.createRange()
    range.setStart(first.firstChild ?? first, 0)
    range.setEnd(first.firstChild ?? first, first.textContent?.length ?? 0)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.mouseUp(view.container.querySelector('.paper-passage-view')!)

    expect(first).toHaveClass('paper-paragraph-hot')
    expect(second).not.toHaveClass('paper-paragraph-hot')
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeClipboard).toHaveBeenCalledWith('Their rich kinematic structure en-')
  })

  it('offers the paragraph under the pointer without a manual selection', () => {
    const view = render(<PaperPassageView pages={[{ page: 1, glyphs }]} canAsk={false} />)
    const first = view.container.querySelector<HTMLElement>('[data-paper-item="0"]')!
    fireEvent.mouseMove(first)
    expect(screen.getByRole('toolbar', { name: 'Paper selection' })).toBeInTheDocument()
    expect(first).toHaveClass('paper-paragraph-hot')
    expect(view.container.querySelector('[data-paper-item="1"]')).toHaveClass('paper-paragraph-hot')
  })

  it('keeps the current paragraph while the pointer crosses into the next one', () => {
    vi.useFakeTimers()
    try {
      const view = render(<PaperPassageView pages={[{ page: 1, glyphs: twoParagraphs }]} canAsk={false} />)
      const first = view.container.querySelector<HTMLElement>('[data-paper-item="0"]')!
      const second = view.container.querySelector<HTMLElement>('[data-paper-item="1"]')!
      fireEvent.mouseMove(first)
      expect(first).toHaveClass('paper-paragraph-hot')
      expect(second).not.toHaveClass('paper-paragraph-hot')

      fireEvent.mouseMove(second)
      expect(first).toHaveClass('paper-paragraph-hot')
      expect(second).not.toHaveClass('paper-paragraph-hot')
      fireEvent.mouseEnter(screen.getByRole('toolbar', { name: 'Paper selection' }))
      vi.advanceTimersByTime(PAPER_PARAGRAPH_RETARGET_MS)
      expect(first).toHaveClass('paper-paragraph-hot')
      expect(screen.getByRole('toolbar', { name: 'Paper selection' })).toBeInTheDocument()

      fireEvent.mouseMove(second)
      vi.advanceTimersByTime(PAPER_PARAGRAPH_RETARGET_MS)
      expect(second).toHaveClass('paper-paragraph-hot')
      expect(first).not.toHaveClass('paper-paragraph-hot')
    } finally {
      vi.useRealTimers()
    }
  })

  it('translates the hovered paragraph into Chinese without asking the agent', async () => {
    const translate = vi.fn().mockResolvedValue('他们丰富的运动结构使机器人能够复现。')
    const askPassage = vi.fn()
    Object.defineProperty(window, 'agentsDock', {
      configurable: true,
      value: { papers: { translate }, native: { writeClipboard: vi.fn() } } as unknown as AgentsDockAPI
    })
    const view = render(<PaperPassageView pages={[{ page: 1, glyphs }]} canAsk askPassage={askPassage} />)
    fireEvent.mouseMove(view.container.querySelector('[data-paper-item="0"]')!)
    fireEvent.click(screen.getByRole('button', { name: 'Translate' }))
    expect(await screen.findByText('他们丰富的运动结构使机器人能够复现。')).toBeInTheDocument()
    expect(translate).toHaveBeenCalledWith('Their rich kinematic structure enables robots to reproduce.')
    expect(askPassage).not.toHaveBeenCalled()
  })

  it('keeps a highlight on the passage after the pointer moves, and removes it with the same button', () => {
    vi.useFakeTimers()
    try {
      const view = render(<PaperPassageView pages={[{ page: 1, glyphs: twoParagraphs }]} canAsk={false} />)
      const first = view.container.querySelector<HTMLElement>('[data-paper-item="0"]')!
      const second = view.container.querySelector<HTMLElement>('[data-paper-item="1"]')!
      fireEvent.mouseMove(first)
      fireEvent.click(screen.getByRole('button', { name: 'Highlight' }))
      expect(first).toHaveClass('paper-mark-highlight')
      expect(first.style.getPropertyValue('--paper-highlight')).toBe('#ffd400')
      expect(first).toHaveClass('paper-paragraph-hot')
      expect(screen.getByRole('button', { name: 'Highlight' })).toHaveAttribute('aria-pressed', 'true')

      fireEvent.mouseMove(second)
      vi.advanceTimersByTime(PAPER_PARAGRAPH_RETARGET_MS)
      expect(first).toHaveClass('paper-mark-highlight')
      expect(first).not.toHaveClass('paper-paragraph-hot')
      expect(second).toHaveClass('paper-paragraph-hot')
      expect(second).not.toHaveClass('paper-mark-highlight')

      fireEvent.mouseMove(first)
      vi.advanceTimersByTime(PAPER_PARAGRAPH_RETARGET_MS)
      fireEvent.click(screen.getByRole('button', { name: 'Highlight' }))
      expect(first).not.toHaveClass('paper-mark-highlight')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the passage selected while the pointer moves to the file header', () => {
    vi.useFakeTimers()
    try {
      const view = render(<PaperPassageView pages={[{ page: 1, glyphs }]} canAsk={false} />)
      const first = view.container.querySelector<HTMLElement>('[data-paper-item="0"]')!
      fireEvent.mouseMove(first)
      const header = document.createElement('div')
      header.className = 'workspace-editor-editor-toolbar'
      document.body.append(header)
      fireEvent.mouseLeave(view.container.querySelector('.paper-passage-view')!, { relatedTarget: header })
      vi.advanceTimersByTime(PAPER_PARAGRAPH_RETARGET_MS)
      expect(screen.getByRole('toolbar', { name: 'Paper selection' })).toBeInTheDocument()
      header.remove()
    } finally {
      vi.useRealTimers()
    }
  })

  it('underlines only the dragged glyphs and accepts the underline shortcut', () => {
    const view = render(<PaperPassageView pages={[{ page: 1, glyphs }]} canAsk={false} />)
    const first = view.container.querySelector<HTMLElement>('[data-paper-item="0"]')!
    const second = view.container.querySelector<HTMLElement>('[data-paper-item="1"]')!
    const range = document.createRange()
    range.setStart(first.firstChild ?? first, 0)
    range.setEnd(first.firstChild ?? first, first.textContent?.length ?? 0)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    fireEvent.mouseUp(view.container.querySelector('.paper-passage-view')!)
    fireEvent.click(screen.getByRole('button', { name: 'Underline' }))
    expect(first).toHaveClass('paper-mark-underline')
    expect(second).not.toHaveClass('paper-mark-underline')

    fireEvent.keyDown(window, { key: '1', code: 'Digit1', ctrlKey: true, altKey: true })
    expect(first).toHaveClass('paper-mark-highlight')
    expect(first).toHaveClass('paper-mark-underline')
  })
})
