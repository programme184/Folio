import { pathToFileURL } from 'node:url'

type TimerHandle = ReturnType<typeof setTimeout> | number

export interface RendererLoadRecoveryOptions {
  rendererPath: string
  pathExists: (path: string) => boolean
  reload: () => void | Promise<void>
  active: () => boolean
  schedule?: (callback: () => void, milliseconds: number) => TimerHandle
  cancel?: (timer: TimerHandle) => void
  intervalMs?: number
  maxAttempts?: number
}

export interface RendererLoadRecovery {
  recover: (errorCode: number, failedURL: string, isMainFrame: boolean) => boolean
  dispose: () => void
}

const FILE_NOT_FOUND = -6

export function createRendererLoadRecovery(options: RendererLoadRecoveryOptions): RendererLoadRecovery {
  const schedule = options.schedule ?? setTimeout
  const cancel = options.cancel ?? (timer => clearTimeout(timer))
  const intervalMs = options.intervalMs ?? 250
  const maxAttempts = options.maxAttempts ?? 480
  const expectedURL = pathToFileURL(options.rendererPath).href
  let timer: TimerHandle | null = null
  let attempts = 0

  const stop = (): void => {
    if (timer) cancel(timer)
    timer = null
    attempts = 0
  }

  const check = (): void => {
    timer = null
    if (!options.active()) return stop()
    if (options.pathExists(options.rendererPath)) {
      stop()
      void options.reload()
      return
    }
    attempts += 1
    if (attempts >= maxAttempts) return stop()
    timer = schedule(check, intervalMs)
  }

  return {
    recover(errorCode, failedURL, isMainFrame) {
      if (errorCode !== FILE_NOT_FOUND || !isMainFrame || failedURL !== expectedURL || timer) return false
      attempts = 0
      timer = schedule(check, intervalMs)
      return true
    },
    dispose: stop
  }
}

