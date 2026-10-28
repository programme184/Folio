import { saveLocalStorage } from './local-storage'

export type SavedInspectorTab = 'details' | 'files'
export const INSPECTOR_TAB_KEY = 'agentsdock:inspector-tab'

export function readInspectorTab(): SavedInspectorTab {
  try { return localStorage.getItem(INSPECTOR_TAB_KEY) === 'files' ? 'files' : 'details' }
  catch { return 'details' }
}

export function saveInspectorTab(tab: SavedInspectorTab): void {
  saveLocalStorage(INSPECTOR_TAB_KEY, tab)
}
