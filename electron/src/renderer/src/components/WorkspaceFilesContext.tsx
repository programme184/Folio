import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { WorkspaceProfileScope } from '@shared/types'

export function workspaceFilesKey(scope: WorkspaceProfileScope | null, sessionId: string, cwd: string): string {
  return JSON.stringify([scope?.profileId, scope?.profileGeneration, scope?.serverIdentity, sessionId, cwd])
}

const WorkspaceFilesContext = createContext<{
  hosts: ReadonlyMap<string, HTMLElement>
  register: (key: string, host: HTMLElement | null) => void
}>({ hosts: new Map(), register: () => {} })

/** The editor owns file operations and dirty buffers; Files supplies their visual home. */
export function WorkspaceFilesProvider({ children }: { children: ReactNode }) {
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLElement>>(() => new Map())
  const register = useCallback((key: string, host: HTMLElement | null) => {
    setHosts(current => {
      if ((current.get(key) ?? null) === host) return current
      const next = new Map(current)
      if (host) next.set(key, host)
      else next.delete(key)
      return next
    })
  }, [])
  const value = useMemo(() => ({ hosts, register }), [hosts, register])
  return <WorkspaceFilesContext.Provider value={value}>{children}</WorkspaceFilesContext.Provider>
}

export function WorkspaceFilesHost({ owner }: { owner: string }) {
  const { register } = useContext(WorkspaceFilesContext)
  const ref = useCallback((host: HTMLDivElement | null) => { register(owner, host) }, [owner, register])
  return <div className="inspector-files" ref={ref} />
}

export function useWorkspaceFilesHost(owner: string): HTMLElement | null {
  return useContext(WorkspaceFilesContext).hosts.get(owner) ?? null
}
