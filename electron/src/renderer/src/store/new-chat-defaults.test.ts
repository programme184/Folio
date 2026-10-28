import { describe, expect, it } from 'vitest'
import type { Session } from '@shared/types'
import { newChatPermissions, preferredNewChatDefaults } from './app-store'

const saved = { version: 1, folder: 'Saved', cwd: '/saved', backend: 'claude', model: 'old-model', effort: 'high', claude_permission_mode: 'bypassPermissions' }
const base: Session = { id: 'opened', title: 'Existing', backend: 'codex', folder: 'Current', cwd: '/current', model: 'current-model', effort: 'low' }

describe('preferred new-chat settings', () => {
  it.each([
    { backend: 'codex' as const, codex_provider: 'custom' as const, codex_approval_policy: 'on-request' as const, codex_sandbox_mode: 'read-only' as const, codex_permission_profile: 'restricted', codex_approvals_reviewer: 'user' as const },
    { backend: 'claude' as const, provider_connection: 'custom' as const, claude_permission_mode: 'plan' as const },
    { backend: 'cursor' as const, provider_connection: 'custom' as const, cursor_permission_mode: 'plan' as const },
    { backend: 'opencode' as const, provider_connection: 'custom' as const, opencode_permission_mode: 'full_access' as const },
    { backend: 'gemini' as const, provider_connection: 'custom' as const, gemini_permission_mode: 'plan' as const }
  ])('inherits $backend settings, not saved defaults or session-owned state', policy => {
    const opened = { ...base, ...policy, system_prompt: 'Use concise replies.', session_id: 'native-thread', provider_jobs_access: 'full' as const }
    const actual = preferredNewChatDefaults([opened], opened.id, '/server', saved)
    expect(actual).toMatchObject({ ...policy, folder: 'Current', cwd: '/current', model: 'current-model', effort: 'low', system_prompt: 'Use concise replies.' })
    for (const field of ['session_id', 'provider_jobs_access', 'id', 'title', 'provider_connection_revision']) expect(actual).not.toHaveProperty(field)
    if (policy.backend !== 'claude') expect(actual).not.toHaveProperty('claude_permission_mode')
  })

  it('preserves deliberate native/default model choices instead of filling from stale custom settings', () => {
    expect(preferredNewChatDefaults([{ ...base, model: null, effort: null }], base.id, '/server', { ...saved, backend: 'codex', codex_provider: 'custom' }))
      .toMatchObject({ backend: 'codex', model: null, effort: null })
    expect(preferredNewChatDefaults([base], base.id, '/server', { ...saved, backend: 'codex', codex_provider: 'custom' })).not.toHaveProperty('codex_provider')
  })

  it('uses stored permissions only with no eligible open session; accepts legacy records', () => {
    expect(preferredNewChatDefaults([base], null, '/server', saved)).toMatchObject(saved)
    expect(preferredNewChatDefaults([{ ...base, archived: true }], base.id, '/server', saved)).toMatchObject(saved)
    const { claude_permission_mode: _permission, ...legacy } = saved
    expect(preferredNewChatDefaults([], null, '/server', legacy)).toMatchObject({ ...legacy, claude_permission_mode: null })
  })

  it('rejects malformed stored permissions and uses only same-server fallback sessions', () => {
    expect(preferredNewChatDefaults([], null, '/server', { ...saved, claude_permission_mode: 'unsafe-unknown' })).toBeNull()
    expect(preferredNewChatDefaults([base], null, '/server', { ...saved, codex_permission_profile: 42 })).toMatchObject({ backend: 'codex' })
    expect(preferredNewChatDefaults([], 'old-server-chat', '/server', null)).toBeNull()
    expect(preferredNewChatDefaults([], null, '/server', { ...saved, subagent_limit: 0 })).toBeNull()
    expect(preferredNewChatDefaults([], null, '/server', { ...saved, system_prompt: 42 })).toBeNull()
  })

  it('never carries another provider permission when changing backend in the chooser', () => {
    expect(newChatPermissions({ claude_permission_mode: 'bypassPermissions', cursor_permission_mode: 'full_access' }, 'opencode'))
      .toEqual({ opencode_permission_mode: 'default' })
  })
})
