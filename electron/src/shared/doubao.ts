import type { Backend, RuntimeModelOption } from './types'

const HOST = 'ark.cn-beijing.volces.com'
/** Volcengine Ark agent-plan presets: Claude Code speaks Anthropic Messages, OpenCode Chat Completions. */
export const DOUBAO_PRESETS: Partial<Record<Backend, { baseURL: string; protocol: 'anthropic' | 'chat_completions'; label: string }>> = {
  claude: { baseURL: `https://${HOST}/api/plan`, protocol: 'anthropic', label: 'Doubao (Claude Code)' },
  opencode: { baseURL: `https://${HOST}/api/plan/v3`, protocol: 'chat_completions', label: 'Doubao (OpenCode)' }
}
/** A small plan model, prefilled so Connect verifies in one step. */
export const DOUBAO_DEFAULT_MODEL = 'doubao-seed-2-0-mini-260428'

/** Public Ark model IDs commonly available to plan/API users. */
export const DOUBAO_MODEL_OPTIONS: RuntimeModelOption[] = [
  { value: 'doubao-seed-evolving-latest-version', label: 'Doubao-Seed-Evolving' },
  { value: 'doubao-seed-2-1-pro-260628', label: 'Doubao-Seed-2.1-pro' },
  { value: 'doubao-seed-2-1-turbo-260628', label: 'Doubao-Seed-2.1-turbo' },
  { value: 'doubao-seed-2-0-lite-260428', label: 'Doubao-Seed-2.0-lite' },
  { value: 'doubao-seed-2-0-mini-260428', label: 'Doubao-Seed-2.0-mini' },
  { value: 'glm-5-2-260617', label: 'GLM-5.2' }
]

export function isDoubaoEndpoint(baseURL?: string | null): boolean {
  try { return new URL(baseURL ?? '').hostname === HOST } catch { return false }
}

/** Merge known Ark choices without replacing provider-discovered metadata. */
export function doubaoModelOptions(baseURL: string | null | undefined, models: RuntimeModelOption[] = []): RuntimeModelOption[] {
  if (!isDoubaoEndpoint(baseURL)) return models
  const present = new Set(models.map(model => model.value))
  return [...models, ...DOUBAO_MODEL_OPTIONS.filter(model => !present.has(model.value))]
}

/** Chat-bar name for an Ark endpoint, keeping the runtime visible. */
export const doubaoLabel = (backend: Backend, baseURL?: string | null) => isDoubaoEndpoint(baseURL) ? DOUBAO_PRESETS[backend]?.label ?? null : null
