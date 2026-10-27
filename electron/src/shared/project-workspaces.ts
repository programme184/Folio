export const PROJECT_WORKSPACES_PREFERENCE_KEY = 'projectWorkspaces:v1'
export const PROJECT_DIRECTORY_LIMIT = 32
export const PROJECT_PATH_LIMIT = 4096

export interface ProjectWorkspace {
  directories: string[]
}

export type ProjectWorkspaceMap = Record<string, ProjectWorkspace>

export function normalizeDirectoryPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > PROJECT_PATH_LIMIT) return null
  if (/[\u0000-\u001f]/.test(trimmed)) return null
  const absolute = trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)
  if (!absolute) return null
  const slash = trimmed.includes('\\') && !trimmed.includes('/') ? '\\' : '/'
  if (slash === '/' && trimmed === '/') return '/'
  if (slash === '\\' && /^[A-Za-z]:\\?$/.test(trimmed)) return trimmed.endsWith('\\') ? trimmed : `${trimmed}\\`
  return trimmed.replace(/[\\/]+$/, '')
}

export function normalizeProjectDirectories(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : []
  const directories: string[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const path = normalizeDirectoryPath(entry)
    if (!path || seen.has(path)) continue
    seen.add(path)
    directories.push(path)
    if (directories.length >= PROJECT_DIRECTORY_LIMIT) break
  }
  return directories
}

export function normalizeProjectWorkspaces(value: unknown): ProjectWorkspaceMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const workspaces: ProjectWorkspaceMap = {}
  for (const [rawName, workspace] of Object.entries(value)) {
    const name = rawName.trim()
    if (!name || name.length > 200) continue
    const directories = normalizeProjectDirectories(
      workspace && typeof workspace === 'object' && 'directories' in workspace
        ? (workspace as { directories?: unknown }).directories
        : undefined
    )
    if (!directories.length) continue
    workspaces[name] = { directories }
  }
  return workspaces
}

export function projectDirectories(workspaces: ProjectWorkspaceMap, folder: string | null | undefined): string[] {
  const name = folder?.trim()
  if (!name) return []
  return workspaces[name]?.directories ?? []
}

export function withoutProject(workspaces: ProjectWorkspaceMap, folder: string): ProjectWorkspaceMap {
  if (!Object.hasOwn(workspaces, folder)) return workspaces
  const next = { ...workspaces }
  delete next[folder]
  return next
}

export function renameProjectWorkspace(workspaces: ProjectWorkspaceMap, from: string, to: string): ProjectWorkspaceMap {
  if (!Object.hasOwn(workspaces, from) || from === to) return workspaces
  const next = { ...workspaces }
  next[to] = next[from]
  delete next[from]
  return next
}
