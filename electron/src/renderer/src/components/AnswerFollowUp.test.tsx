import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../store/app-store'
import { AnswerFollowUp } from './AnswerFollowUp'

describe('answer follow-up', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useAppStore.setState({ selectedSessionId: null, drafts: {} })
  })

  it('quotes the selected answer and leaves the question for the composer', () => {
    useAppStore.setState({ selectedSessionId: 'chat', drafts: { chat: '' } })
    render(<div className="message-row assistant"><div className="markdown"><p>reference trajectory，参考轨迹</p></div></div>)
    const passage = screen.getByText('reference trajectory，参考轨迹')
    const selection = {
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'reference trajectory，参考轨迹',
      anchorNode: passage,
      getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 12, top: 24, width: 80, height: 16, right: 92, bottom: 40, x: 12, y: 24, toJSON() { return {} } }) }),
      removeAllRanges: () => undefined
    } as unknown as Selection
    vi.spyOn(window, 'getSelection').mockReturnValue(selection)
    render(<AnswerFollowUp />)
    fireEvent.click(screen.getByRole('button', { name: 'Follow up' }))
    expect(useAppStore.getState().drafts.chat).toBe('> reference trajectory，参考轨迹\n\n')
  })
})
