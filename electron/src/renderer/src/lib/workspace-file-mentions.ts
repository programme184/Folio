/** Plain-text `@path` file mentions, shared by the composer's `@` palette and file-tree drops. */

export const WORKSPACE_PATH_DRAG_TYPE = 'application/x-agentsdock-workspace-path'

export interface WorkspaceDragPayload {
  path: string
  kind: 'file' | 'directory'
}

export function workspaceMentionText(path: string, kind: 'file' | 'directory' = 'file'): string {
  const clean = path.replace(/\/+$/u, '')
  const display = kind === 'directory' ? `${clean}/` : clean
  return /\s/u.test(display) ? `@"${display}"` : `@${display}`
}

export function insertWorkspaceFileMention(
  text: string,
  start: number,
  end: number,
  path: string,
  kind: 'file' | 'directory' = 'file'
): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  const prefix = text.slice(0, from)
  const suffix = text.slice(to)
  const lead = prefix.length > 0 && !/\s$/u.test(prefix) ? ' ' : ''
  const currentLinePrefix = prefix.slice(prefix.lastIndexOf('\n') + 1)
  const standaloneAtDraftEnd = suffix.length === 0 && currentLinePrefix.trim().length === 0
  const trail = standaloneAtDraftEnd ? '\n' : suffix.length === 0 || !/^\s/u.test(suffix) ? ' ' : ''
  const inserted = `${lead}${workspaceMentionText(path, kind)}${trail}`
  return { text: `${prefix}${inserted}${suffix}`, caret: from + inserted.length }
}

export function setWorkspaceDragData(data: DataTransfer, payload: WorkspaceDragPayload): void {
  data.setData(WORKSPACE_PATH_DRAG_TYPE, JSON.stringify(payload))
  data.setData('text/plain', workspaceMentionText(payload.path, payload.kind))
  data.effectAllowed = 'copy'
}

export function hasWorkspaceDragData(data: DataTransfer | null): boolean {
  return Boolean(data && Array.from(data.types).includes(WORKSPACE_PATH_DRAG_TYPE))
}

export function readWorkspaceDragData(data: DataTransfer | null): WorkspaceDragPayload | null {
  const raw = data?.getData(WORKSPACE_PATH_DRAG_TYPE)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<WorkspaceDragPayload>
    if (typeof value.path !== 'string' || !value.path) return null
    return { path: value.path, kind: value.kind === 'directory' ? 'directory' : 'file' }
  } catch {
    return null
  }
}
