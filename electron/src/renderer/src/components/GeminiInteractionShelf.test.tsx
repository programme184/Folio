import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentsDockAPI } from '@shared/ipc'
import type { CodexPendingInteraction, Session } from '@shared/types'
import { setLocale } from '@shared/i18n'
import { useAppStore } from '../store/app-store'
import { GeminiInteractionShelf } from './GeminiInteractionShelf'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it.each([
  ['en', 'Allow', 'Deny', 'accept'],
  ['en', 'Allow', 'Deny', 'decline'],
  ['zh-CN', '允许', '拒绝', 'accept'],
  ['zh-CN', '允许', '拒绝', 'decline'],
] as const)('keeps %s Gemini %s/%s buttons short, scopes %s and refreshes shared runtime updates', async (locale, allow, deny, decision) => {
  setLocale(locale)
  const previous = useAppStore.getState()
  const previousAPI = window.agentsDock
  const session: Session = { id: 'gemini-shared', backend: 'gemini', title: 'Gemini' }
  const listeners = new Map<string, (value: unknown) => void>()
  const pending: CodexPendingInteraction = { id: 'gemini-approval', session_id: session.id, thread_id: 'native-fixture',
    method: 'item/tool/requestApproval', created_at: '2026-10-16T00:00:00Z',
    params: { toolName: `run(arguments: [ask, --route, ${'route_1234567890'.repeat(20)}], helper: chats)`, availableDecisions: ['accept', 'decline'] } }
  let interactions: CodexPendingInteraction[] = []
  const runtime = vi.fn(async () => ({ available: true, pending_interactions: interactions }))
  const resolveInteraction = vi.fn(async () => { interactions = []; return { interaction: pending } })
  useAppStore.setState({ activeProfileId: 'shared-chat', profileGeneration: 1, connected: true,
    health: { capabilities: { gemini_backend: { available: true } } } as never })
  Object.defineProperty(window, 'agentsDock', { configurable: true, value: {
    gemini: { runtime, resolveInteraction }, events: { on: (name: string, listener: (value: unknown) => void) => {
      listeners.set(name, listener); return () => listeners.delete(name)
    } }
  } as unknown as AgentsDockAPI })
  try {
    const view = render(<GeminiInteractionShelf session={session} />)
    await waitFor(() => expect(runtime).toHaveBeenCalledTimes(1))
    interactions = [pending]
    const event = { profileId: 'shared-chat', profileGeneration: 1,
      event: { type: 'provider_runtime_changed', backend: 'gemini', session_id: session.id } }
    await act(async () => listeners.get('server:provider-runtime')!({ ...event, profileId: 'other-server' }))
    expect(runtime).toHaveBeenCalledTimes(1)
    await act(async () => listeners.get('server:provider-runtime')!(event))
    expect(await screen.findByRole('button', { name: allow })).toBeTruthy()
    expect(screen.getByRole('button', { name: deny })).toBeTruthy()
    expect(screen.getByRole('article', { name: `Allow ${pending.params.toolName}?` })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /this session|once/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: decision === 'accept' ? allow : deny }))
    expect(resolveInteraction).toHaveBeenCalledWith(session.id, pending.id, { decision })
    await waitFor(() => expect(screen.queryByRole('button', { name: allow })).toBeNull())
    view.unmount()
    expect(listeners.size).toBe(0)
  } finally {
    setLocale('en')
    useAppStore.setState(previous, true)
    Object.defineProperty(window, 'agentsDock', { configurable: true, value: previousAPI })
  }
})
