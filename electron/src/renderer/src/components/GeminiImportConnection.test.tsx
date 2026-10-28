import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentsDockAPI } from '@shared/ipc'
import type { Session } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { GeminiImportConnection } from './GeminiImportConnection'

const session: Session = { id: 'imported', title: 'Native conversation', backend: 'gemini', session_id: 'native-id', provider_connection: 'default' }
const original = useAppStore.getState().updateSession
const update = vi.fn().mockResolvedValue(undefined)
beforeEach(() => {
  update.mockClear()
  Object.defineProperty(window, 'agentsDock', { configurable: true, value: {} as AgentsDockAPI })
  useAppStore.setState({ connected: true, updateSession: update,
    health: { ok: true, capabilities: { gemini_backend: { available: true, required: false, message: '', action: null, features: { native_import_api: true } } } },
    runtimeCatalog: { backends: { gemini: { models: [], efforts: [], custom_provider: {
      configured: true, available: true, model: null, base_url: 'https://example.invalid', models: []
    } } } } })
})
afterEach(() => { cleanup(); useAppStore.setState({ updateSession: original }) })
it('requires an explicit click and discloses the API destination', async () => {
  render(<GeminiImportConnection session={session} />)
  expect(screen.getByText(/https:\/\/example.invalid/)).toBeInTheDocument()
  expect(update).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Connect Gemini API' }))
  expect(update).toHaveBeenCalledWith('imported', { gemini_connect_api: true })
})
it('offers configuration instead of binding an unavailable API', () => {
  useAppStore.setState({ runtimeCatalog: null })
  render(<GeminiImportConnection session={session} />)
  expect(screen.getByRole('button', { name: 'Configure API' })).toBeInTheDocument()
  expect(update).not.toHaveBeenCalled()
})
it.each([
  { ...session, provider_connection: 'custom' as const },
  { ...session, archived: true },
  { ...session, session_id: null },
  { ...session, backend: 'claude' as const }
])('does not offer account switching for ineligible sessions', candidate => {
  const { container } = render(<GeminiImportConnection session={candidate} />)
  expect(container).toBeEmptyDOMElement()
})
it('does not expose a server mutation on old servers or shared chats', () => {
  useAppStore.setState({ health: null })
  const { container, rerender } = render(<GeminiImportConnection session={session} />)
  expect(container).toBeEmptyDOMElement()
  useAppStore.setState({ health: { ok: true, capabilities: { gemini_backend: { available: true, required: false, message: '', action: null, features: { native_import_api: true } } } } })
  Object.defineProperty(window, 'agentsDock', { configurable: true, value: { sharedChat: {} } })
  rerender(<GeminiImportConnection session={session} />)
  expect(container).toBeEmptyDOMElement()
})
