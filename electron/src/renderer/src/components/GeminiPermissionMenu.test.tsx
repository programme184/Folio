import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@shared/types'
import { setLocale } from '@shared/i18n'
import { useAppStore } from '../store/app-store'
import { GeminiPermissionMenu } from './GeminiPermissionMenu'

const session: Session = { id: 'g', title: 'Gemini', backend: 'gemini', gemini_permission_mode: 'default' }
const runtime = vi.fn(), update = vi.fn()
function Menu({ running = false }: { running?: boolean }) {
  return <GeminiPermissionMenu session={useAppStore(state => state.sessions[0])} running={running} open />
}
beforeEach(() => {
  setLocale('en'); runtime.mockReset(); update.mockReset()
  runtime.mockResolvedValue({ pending_interactions: [], permission_modes: ['default', 'autoEdit', 'yolo', 'plan'] })
  update.mockImplementation(async (_id, patch) => ({ ...useAppStore.getState().sessions[0], ...patch }))
  Object.defineProperty(window, 'agentsDock', { configurable: true, value: { sessions: { update }, gemini: { runtime } } })
  useAppStore.setState({ activeProfileId: 'p', profileGeneration: 1, switchingProfileId: null, error: null, sessions: [{ ...session }],
    activeSessionIds: new Set(), turnAdmissionTokens: {}, health: { ok: true, capabilities: {
      gemini_backend: { available: true, version: 1, required: false, action: null, message: '',
        permission_modes: ['default', 'autoEdit', 'yolo'], features: { permission_mode_control: true } }
    } } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); setLocale('en') })

describe('Gemini native permission menu', () => {
  it.each(['default', 'custom'])('saves native modes for %s connections without Codex sandbox controls', async connection => {
    useAppStore.setState({ sessions: [{ ...session, provider_connection: connection as 'default' | 'custom' }] })
    render(<Menu />)
    await screen.findByRole('option', { name: 'Plan' })
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    expect(screen.queryByText('Full access')).not.toBeInTheDocument()
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), 'autoEdit')
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith('g', { gemini_permission_mode: 'autoEdit' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Gemini permissions: Auto Edit' })).toBeEnabled())
  })
  it('requires explicit YOLO confirmation, and cancel never writes', async () => {
    render(<Menu />); const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox'), 'yolo')
    expect(screen.getByText(/High risk/)).toBeVisible(); expect(update).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Cancel' })); expect(update).not.toHaveBeenCalled()
    expect(screen.getByRole('combobox')).toHaveFocus()
    await user.selectOptions(screen.getByRole('combobox'), 'yolo')
    await user.click(screen.getByRole('button', { name: 'Enable YOLO' }))
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith('g', { gemini_permission_mode: 'yolo' }))
  })
  it('offers Plan only with native evidence and explains next-turn semantics while running', async () => {
    runtime.mockResolvedValue({ pending_interactions: [], permission_modes: ['default', 'autoEdit', 'yolo'] })
    render(<Menu running />)
    expect(screen.queryByRole('option', { name: 'Plan' })).not.toBeInTheDocument()
    expect(screen.getByText(/current turn keeps/)).toBeVisible()
    expect(screen.getByRole('combobox')).toBeEnabled()
  })
  it('does not claim a successful save on server rejection', async () => {
    update.mockRejectedValue(new Error('Synthetic rejected save'))
    render(<Menu />)
    await userEvent.setup().selectOptions(screen.getByRole('combobox'), 'autoEdit')
    expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic rejected save')
    expect(screen.getByRole('combobox')).toHaveValue('default')
  })
  it('localizes all native modes and disables controls on old servers', async () => {
    setLocale('zh-CN'); const { unmount } = render(<Menu />)
    expect(screen.getByText('Gemini 权限')).toBeVisible()
    expect(screen.getByRole('option', { name: '自动编辑' })).toBeVisible()
    unmount(); useAppStore.setState({ health: { ok: true } }); render(<GeminiPermissionMenu session={session} running={false} />)
    expect(screen.getByRole('button', { name: 'Gemini 权限：默认' })).toBeDisabled()
  })
  it('does not expose permission editing in a shared chat', () => {
    Object.defineProperty(window, 'agentsDock', { configurable: true, value: { sharedChat: {}, gemini: { runtime } } })
    render(<Menu />)
    expect(screen.getByRole('button', { name: 'Gemini permissions: Default' })).toBeDisabled()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(runtime).not.toHaveBeenCalled()
  })
  it('ignores a late native mode list from a previous chat', async () => {
    let resolve!: (value: unknown) => void
    runtime.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    runtime.mockResolvedValue({ pending_interactions: [], permission_modes: ['default', 'autoEdit', 'yolo'] })
    const { rerender } = render(<GeminiPermissionMenu session={session} running={false} open />)
    await vi.waitFor(() => expect(runtime).toHaveBeenCalledWith('g'))
    rerender(<GeminiPermissionMenu session={{ ...session, id: 'other' }} running={false} open />)
    resolve({ pending_interactions: [], permission_modes: ['default', 'autoEdit', 'yolo', 'plan'] })
    await vi.waitFor(() => expect(runtime).toHaveBeenCalledWith('other'))
    expect(screen.queryByRole('option', { name: 'Plan' })).not.toBeInTheDocument()
  })
})
