import { describe, expect, it, vi } from 'vitest'
import { createRendererLoadRecovery } from './renderer-load-recovery'

describe('renderer load recovery', () => {
  it('reloads a development renderer after a concurrent build restores it', async () => {
    vi.useFakeTimers()
    let available = false
    const reload = vi.fn()
    const recovery = createRendererLoadRecovery({
      rendererPath: '/app/out/renderer/index.html',
      pathExists: () => available,
      reload,
      active: () => true,
      intervalMs: 10,
      maxAttempts: 3
    })

    expect(recovery.recover(-6, 'file:///app/out/renderer/index.html', true)).toBe(true)
    await vi.advanceTimersByTimeAsync(10)
    expect(reload).not.toHaveBeenCalled()
    available = true
    await vi.advanceTimersByTimeAsync(10)
    expect(reload).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('ignores unrelated, subframe, and non-file-not-found failures', () => {
    const reload = vi.fn()
    const recovery = createRendererLoadRecovery({
      rendererPath: '/app/out/renderer/index.html',
      pathExists: () => true,
      reload,
      active: () => true
    })

    expect(recovery.recover(-105, 'file:///app/out/renderer/index.html', true)).toBe(false)
    expect(recovery.recover(-6, 'file:///app/out/renderer/missing.html', true)).toBe(false)
    expect(recovery.recover(-6, 'file:///app/out/renderer/index.html', false)).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('stops after its bounded retry window', async () => {
    vi.useFakeTimers()
    const reload = vi.fn()
    const recovery = createRendererLoadRecovery({
      rendererPath: '/app/out/renderer/index.html',
      pathExists: () => false,
      reload,
      active: () => true,
      intervalMs: 10,
      maxAttempts: 2
    })

    recovery.recover(-6, 'file:///app/out/renderer/index.html', true)
    await vi.advanceTimersByTimeAsync(30)
    expect(reload).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})
