import AsyncStorage from '@react-native-async-storage/async-storage'
import { Appearance } from 'react-native'
import { create } from 'zustand'

export type ThemePreference = 'system' | 'light' | 'dark'
const STORAGE_KEY = 'agentsdock.react.appearance'
const normalize = (value: unknown): ThemePreference => value === 'light' || value === 'dark' ? value : 'system'
const apply = (value: ThemePreference) => Appearance.setColorScheme(value === 'system' ? 'unspecified' : value)
let revision = 0
let hydration: Promise<void> | null = null
let persistence = Promise.resolve()

interface AppearanceState {
  preference: ThemePreference
  hydrated: boolean
  error: string | null
  hydrate(): Promise<void>
  setPreference(value: ThemePreference): Promise<void>
}

// App-wide, separate from server profiles so switching or removing a server cannot reset it.
export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  preference: 'system',
  hydrated: false,
  error: null,
  async hydrate() {
    if (get().hydrated) return
    if (hydration) return hydration
    const started = revision
    hydration = (async () => {
      try {
        const preference = normalize(await AsyncStorage.getItem(STORAGE_KEY))
        if (started !== revision) return
        apply(preference)
        set({ preference, hydrated: true, error: null })
      } catch {
        if (started === revision) set({ hydrated: true, error: 'Could not load the saved theme.' })
      }
    })()
    try { await hydration } finally { hydration = null }
  },
  setPreference(value) {
    const preference = normalize(value)
    const started = ++revision
    apply(preference)
    set({ preference, hydrated: true, error: null })
    // Serialize rapid taps so the last visible choice is also the last saved choice.
    persistence = persistence.then(() => AsyncStorage.setItem(STORAGE_KEY, preference)).catch(() => {
      if (started === revision) set({ error: 'Could not save the theme. Select it again to retry.' })
    })
    return persistence
  },
}))
