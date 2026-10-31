import type { Backend } from './types'

const HOST = 'ark.cn-beijing.volces.com'
/** Volcengine Ark agent-plan presets: Claude Code speaks Anthropic Messages, OpenCode Chat Completions. */
export const DOUBAO_PRESETS: Partial<Record<Backend, { baseURL: string; protocol: 'anthropic' | 'chat_completions'; label: string }>> = {
  claude: { baseURL: `https://${HOST}/api/plan`, protocol: 'anthropic', label: 'Doubao (Claude Code)' },
  opencode: { baseURL: `https://${HOST}/api/plan/v3`, protocol: 'chat_completions', label: 'Doubao (OpenCode)' }
}
/** A small plan model, prefilled so Connect verifies in one step. */
export const DOUBAO_DEFAULT_MODEL = 'doubao-seed-2-0-mini-260428'

export function isDoubaoEndpoint(baseURL?: string | null): boolean {
  try { return new URL(baseURL ?? '').hostname === HOST } catch { return false }
}

/** Chat-bar name for an Ark endpoint, keeping the runtime visible. */
export const doubaoLabel = (backend: Backend, baseURL?: string | null) => isDoubaoEndpoint(baseURL) ? DOUBAO_PRESETS[backend]?.label ?? null : null
