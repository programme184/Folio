import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentsDockAPI } from '@shared/ipc'
import { PaperPassageView } from './PaperSelection'

const glyphs = [
  { text: 'Their rich kinematic structure en-', x: 50, y: 700, width: 200, height: 10 },
  { text: 'ables robots to reproduce.', x: 50, y: 686, width: 170, height: 10 }
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

  it('offers the paragraph under the pointer without a manual selection', () => {
    const view = render(<PaperPassageView pages={[{ page: 1, glyphs }]} canAsk={false} />)
    const first = view.container.querySelector<HTMLElement>('[data-paper-item="0"]')!
    fireEvent.mouseMove(first)
    expect(screen.getByRole('toolbar', { name: 'Paper selection' })).toBeInTheDocument()
    expect(first).toHaveClass('paper-paragraph-hot')
    expect(view.container.querySelector('[data-paper-item="1"]')).toHaveClass('paper-paragraph-hot')
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
})
