import { render, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BackendMark } from './BackendMark'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('uses the bundled official Gemini asset without a fallback showing through its transparency', () => {
  const { container } = render(<BackendMark backend="gemini" size={24} />)
  expect(container.querySelector('img')).toHaveAttribute('src', './backend-gemini.svg')
  expect(container.querySelector('img')).toHaveAttribute('alt', '')
  expect(container.querySelector('.backend-mark')).toHaveStyle({ width: '24px', height: '24px' })
  expect(container.querySelector('.backend-fallback')).toBeNull()
  expect(container.querySelector('.lucide-bot')).toBeNull()
})
it('uses the shared-chat asset route with the correct SVG extension', () => {
  vi.stubGlobal('agentsDock', { sharedChat: true })
  const { container } = render(<BackendMark backend="gemini" />)
  expect(container.querySelector('img')).toHaveAttribute('src', '/interactive-chat/assets/backend-gemini.svg')
})
it('falls back on an asset error and does not hide another provider after switching', () => {
  const { container, rerender } = render(<BackendMark backend="gemini" />)
  fireEvent.error(container.querySelector('img')!)
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('.lucide-bot')).not.toBeNull()
  rerender(<BackendMark backend="claude" />)
  expect(container.querySelector('img')).toHaveAttribute('src', './backend-claude.png')
  expect(container.querySelector('.backend-fallback')).toBeNull()
})
it('retains the existing icon fallback for providers without an asset', () => {
  const { container } = render(<BackendMark backend="opencode" />)
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('.backend-fallback svg')).not.toBeNull()
})
