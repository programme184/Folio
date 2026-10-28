import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import type { Session } from '@shared/types'
import { useAppStore } from '../store/app-store'
import { queueGeminiPermissionUpdate, awaitGeminiPermissionUpdates, awaitAllGeminiPermissionUpdates } from './gemini-permission-updates'

const update = vi.fn()
beforeEach(() => {
  update.mockReset()
  useAppStore.setState({ activeProfileId: 'p', profileGeneration: 1, switchingProfileId: null,
    sessions: [{ id: 'g', title: 'Gemini', backend: 'gemini', gemini_permission_mode: 'default' }], error: null })
  Object.defineProperty(window, 'agentsDock', { configurable: true, value: { sessions: { update } } })
})
afterEach(async () => { await awaitAllGeminiPermissionUpdates().catch(() => {}); vi.restoreAllMocks() })

it('serializes saves and waits for confirmation before a send/workspace switch', async () => {
  let release!: () => void
  const firstSave = new Promise<void>(resolve => { release = resolve })
  update.mockImplementation(async (_id, patch: Partial<Session>) => {
    if (update.mock.calls.length === 1) await firstSave
    return { ...useAppStore.getState().sessions[0], ...patch }
  })
  const a = queueGeminiPermissionUpdate('g', 'autoEdit'), b = queueGeminiPermissionUpdate('g', 'plan')
  const done = vi.fn(); void awaitGeminiPermissionUpdates('g').then(done)
  await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1)); expect(done).not.toHaveBeenCalled()
  release(); await Promise.all([a, b]); await awaitAllGeminiPermissionUpdates()
  expect(update.mock.calls.map(call => call[1])).toEqual([{ gemini_permission_mode: 'autoEdit' }, { gemini_permission_mode: 'plan' }])
  expect(useAppStore.getState().sessions[0].gemini_permission_mode).toBe('plan')
})

it('refuses a captured save after the selected server changes', async () => {
  const pending = queueGeminiPermissionUpdate('g', 'autoEdit')
  useAppStore.setState({ activeProfileId: 'other', profileGeneration: 2 })
  await expect(pending).rejects.toThrow(/save Gemini permissions/)
  expect(update).not.toHaveBeenCalled()
})

it('refuses silent old-server field omission', async () => {
  update.mockResolvedValue({ id: 'g', title: 'Gemini', backend: 'gemini' })
  await expect(queueGeminiPermissionUpdate('g', 'plan')).rejects.toThrow(/save Gemini permissions/)
})
