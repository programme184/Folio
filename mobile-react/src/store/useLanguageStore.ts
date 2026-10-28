import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { normalizeLanguagePreference, resolveLocale, type AppLocale, type LanguagePreference } from '../i18n/locale'

const STORAGE_KEY = 'agentsdock.react.language'
function systemLanguageTag(): string {
  try {
    return require('expo-localization').getLocales()[0]?.languageTag
      || Intl.DateTimeFormat().resolvedOptions().locale || 'en'
  } catch {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en'
  }
}
let revision = 0
let hydration: Promise<void> | null = null
let persistence = Promise.resolve()

interface LanguageState {
  preference: LanguagePreference
  locale: AppLocale
  hydrated: boolean
  error: string | null
  hydrate(): Promise<void>
  refreshSystemLocale(): void
  setPreference(value: LanguagePreference): Promise<void>
}

// Language belongs to this device, not to the selected server profile.
export const useLanguageStore = create<LanguageState>((set, get) => ({
  preference: 'system',
  locale: resolveLocale('system', systemLanguageTag()),
  hydrated: false,
  error: null,
  async hydrate() {
    if (get().hydrated) return
    if (hydration) return hydration
    const started = revision
    hydration = (async () => {
      try {
        const preference = normalizeLanguagePreference(await AsyncStorage.getItem(STORAGE_KEY))
        if (started !== revision) return
        set({ preference, locale: resolveLocale(preference, systemLanguageTag()), hydrated: true, error: null })
      } catch {
        if (started === revision) set({ hydrated: true, error: 'Could not load the saved language.' })
      }
    })()
    try { await hydration } finally { hydration = null }
  },
  refreshSystemLocale() {
    const preference = get().preference
    if (preference === 'system') set({ locale: resolveLocale(preference, systemLanguageTag()) })
  },
  setPreference(value) {
    const preference = normalizeLanguagePreference(value)
    const started = ++revision
    set({ preference, locale: resolveLocale(preference, systemLanguageTag()), hydrated: true, error: null })
    persistence = persistence.then(() => AsyncStorage.setItem(STORAGE_KEY, preference)).catch(() => {
      if (started === revision) set({ error: 'Could not save the language. Select it again to retry.' })
    })
    return persistence
  },
}))
