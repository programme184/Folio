import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentsDockAPI } from '@shared/ipc'
import { useAppStore } from '../store/app-store'
import { AnswerFollowUp } from './AnswerFollowUp'
import { MarkdownContent } from './MarkdownContent'

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

  it('copies a selected formula from an answer as LaTeX', () => {
    const writeClipboard = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'agentsDock', {
      configurable: true,
      value: { native: { writeClipboard } } as unknown as AgentsDockAPI
    })
    const source = String.raw`\(\boldsymbol{\tau_{\text{ref}}} = \big[\;(h_0^*,q_0^*)\;\big]\)`
    const copied = String.raw`$\boldsymbol{\tau_{\text{ref}}} = \big[\;(h_0^*,q_0^*)\;\big]$`
    render(<div className="message-row assistant"><MarkdownContent text={source} /></div>)
    const visual = document.querySelector('.katex-html')
    expect(visual?.textContent).not.toContain('\\boldsymbol')
    const range = document.createRange()
    range.selectNode(visual!)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    render(<AnswerFollowUp />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeClipboard).toHaveBeenCalledWith(copied)
  })
})
