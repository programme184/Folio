import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentsDockAPI } from '@shared/ipc'
import type { Session } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { hasMainProviderConversation, paperSideChatAvailable, paperUseSideChat, usePaperAsk } from './paper-ask'

const scope = { profileId: 'profile-a', profileGeneration: 3, serverIdentity: 'server-a' }
const capability = {
  available: true,
  version: 2,
  native_context: true,
  backends: ['codex', 'claude'] as Array<'codex' | 'claude'>,
  max_question_chars: 8_000
}
const health = { ok: true, capabilities: { side_questions: capability } }
const passage = { text: 'A selected paper passage.', pages: [2], column: 'body' as const }

const codex = (codexThreadId?: string): Session => ({
  id: 'chat-a', title: 'Research', backend: 'codex', archived: false,
  ...(codexThreadId === undefined ? {} : { codex_thread_id: codexThreadId })
})

let sendPromptForSession: ReturnType<typeof vi.fn>

beforeEach(() => {
  sendPromptForSession = vi.fn().mockResolvedValue(true)
  Object.defineProperty(window, 'agentsDock', {
    configurable: true,
    value: {
      sharedChat: false,
      sideQuestions: { ask: vi.fn(), cancel: vi.fn(), close: vi.fn().mockResolvedValue(undefined) }
    } as unknown as AgentsDockAPI
  })
  useAppStore.setState({
    connected: true,
    switchingProfileId: null,
    health,
    sendPromptForSession
  } as never)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('paper chat routing', () => {
  it('requires a native main conversation before using a paper Side chat', () => {
    expect(hasMainProviderConversation(codex())).toBe(false)
    expect(paperSideChatAvailable(health, codex())).toBe(false)
    expect(hasMainProviderConversation(codex('thread-a'))).toBe(true)
    expect(paperSideChatAvailable(health, codex('thread-a'))).toBe(true)
    expect(hasMainProviderConversation({ ...codex(), session_id: 'legacy-thread' })).toBe(true)
  })

  it('uses Side chat only while the main conversation is running', () => {
    expect(paperUseSideChat(health, codex('thread-a'), true)).toBe(true)
    expect(paperUseSideChat(health, codex('thread-a'), false)).toBe(false)
  })

  it('sends Explain into the main conversation when Codex has no main thread', async () => {
    const { result } = renderHook(() => usePaperAsk(codex(), scope))

    await act(async () => {
      await result.current.askPassage({ kind: 'explain', passage }, new AbortController().signal)
    })

    expect(sendPromptForSession).toHaveBeenCalledOnce()
    expect(sendPromptForSession.mock.calls[0][0]).toBe('chat-a')
    expect(sendPromptForSession.mock.calls[0][2]).toBe(false)
    expect(sendPromptForSession.mock.calls[0][3]).toMatchObject({ consumeComposer: false })
  })

  it('routes Explain to the visible chat surface supplied by the workspace', async () => {
    const submitInChat = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => usePaperAsk(codex('thread-a'), scope, submitInChat))

    await act(async () => {
      await result.current.askPassage({ kind: 'explain', passage }, new AbortController().signal)
    })

    expect(submitInChat).toHaveBeenCalledOnce()
    expect(submitInChat.mock.calls[0][0]).toContain('A selected paper passage.')
    expect(sendPromptForSession).not.toHaveBeenCalled()
  })
})
