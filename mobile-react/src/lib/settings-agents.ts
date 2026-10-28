import type { Health, RuntimeCatalog } from '../types'
import { nativeProviderAvailable } from './provider-selection'

// Keep this display inventory aligned with desktop My Agents. Chat creation has
// its own supported-backend gate; this list must also show unavailable agents.
export const SETTINGS_AGENTS = [
  { id: 'codex', name: 'Codex' },
  { id: 'claude', name: 'Claude Code' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'opencode', name: 'OpenCode' },
  { id: 'gemini', name: 'Gemini' },
] as const
export type SettingsAgent = typeof SETTINGS_AGENTS[number]['id']

export function settingsAgentAvailable(health: Health | null, catalog: RuntimeCatalog | null, agent: SettingsAgent): boolean {
  return nativeProviderAvailable(health, catalog, agent)
}

// This identifies a configured server hostname, not the phone's VPN app/status.
export function tailscaleServerHost(serverURL: string): string | null {
  try {
    const url = new URL(serverURL)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    return host.endsWith('.ts.net') || host.endsWith('.beta.tailscale.net') ? host : null
  } catch { return null }
}
