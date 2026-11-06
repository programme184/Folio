import type { AgentFile, ChatReference, TeamReference, WorkspaceProfileScope } from '@shared/types'

export const COMPOSER_DRAFT_APPEND_EVENT = 'agentsdock:append-composer-draft'

export interface ComposerDraftAppendDetail {
  scope: WorkspaceProfileScope
  sessionId: string
  text: string
  mode?: 'append' | 'replace'
  files?: AgentFile[]
  chatReferences?: ChatReference[]
  teamReferences?: TeamReference[]
  replacesPromptEventId?: string
  result?: 'applied' | 'cancelled'
}

/** Let the matching mounted composer append to its current, possibly unsaved text. */
export function appendComposerDraft(source: HTMLElement, scope: WorkspaceProfileScope, sessionId: string, text: string): boolean {
  if (!source.isConnected || !text.trim()) return false
  const event = new CustomEvent<ComposerDraftAppendDetail>(COMPOSER_DRAFT_APPEND_EVENT, {
    bubbles: true, cancelable: true, detail: { scope: { ...scope }, sessionId, text }
  })
  source.dispatchEvent(event)
  return event.defaultPrevented
}

/** Replace the matching composer's draft with a previous prompt for an in-place edit. */
export function replaceComposerDraft(
  source: HTMLElement,
  scope: WorkspaceProfileScope,
  sessionId: string,
  text: string,
  files: readonly AgentFile[],
  chatReferences: readonly ChatReference[],
  teamReferences: readonly TeamReference[],
  replacesPromptEventId: string
): 'applied' | 'cancelled' | 'unavailable' {
  if (!source.isConnected || !text.trim() && files.length === 0) return 'unavailable'
  const detail: ComposerDraftAppendDetail = {
    scope: { ...scope }, sessionId, text, mode: 'replace', replacesPromptEventId,
    files: files.map(file => ({ ...file })),
    chatReferences: chatReferences.map(reference => ({ ...reference })),
    teamReferences: teamReferences.map(reference => ({ ...reference }))
  }
  const event = new CustomEvent<ComposerDraftAppendDetail>(COMPOSER_DRAFT_APPEND_EVENT, {
    bubbles: true, cancelable: true, detail
  })
  source.dispatchEvent(event)
  return detail.result ?? 'unavailable'
}
