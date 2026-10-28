import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { applyChatFont, ChatFontApplier, setChatFontFamily, setChatFontSize, useChatFontController } from './chat-font'

const mocks = vi.hoisted(() => ({ trackEvent: vi.fn(), getWorkspacePreference: vi.fn(async (_scope, _key, fallback) => fallback), setWorkspacePreference: vi.fn(async () => undefined) }))
vi.mock('./analytics', () => ({ trackEvent: mocks.trackEvent }))
vi.mock('./workspace-preferences', () => ({ getWorkspacePreference: mocks.getWorkspacePreference, setWorkspacePreference: mocks.setWorkspacePreference }))
beforeEach(() => { vi.clearAllMocks(); applyChatFont(14, 'system') })

it('counts a native menu size/family change, not invalid choices or repeated selection', () => {
  setChatFontSize(16); setChatFontSize(16); setChatFontSize(999)
  setChatFontFamily('mono'); setChatFontFamily('mono'); setChatFontFamily('private-custom-font')
  expect(mocks.trackEvent.mock.calls).toEqual([['chat_font_changed'], ['chat_font_changed']])
})

it('never counts startup restoration or a no-op settings update', async () => {
  let controller!: ReturnType<typeof useChatFontController>
  function SettingsFixture() { controller = useChatFontController(); return null }
  render(<><ChatFontApplier /><SettingsFixture /></>)
  await waitFor(() => expect(mocks.getWorkspacePreference).toHaveBeenCalled())
  expect(mocks.trackEvent).not.toHaveBeenCalled()
  act(() => controller.update(14, 'system'))
  expect(mocks.trackEvent).not.toHaveBeenCalled()
  act(() => controller.update(18, 'rounded'))
  expect(mocks.trackEvent).toHaveBeenCalledExactlyOnceWith('chat_font_changed')
})
