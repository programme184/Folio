export type AppLocale = 'en' | 'zh-CN'
export type LanguagePreference = 'system' | AppLocale

export function normalizeLanguagePreference(value: unknown): LanguagePreference {
  return value === 'en' || value === 'zh-CN' ? value : 'system'
}

export function resolveSystemLocale(languageTag: string): AppLocale {
  const locale = languageTag.toLowerCase().replaceAll('_', '-')
  return /^zh(?:-|$)/.test(locale) && !/(?:^|-)hant(?:-|$)/.test(locale)
    && !/^zh-(?:tw|hk|mo)(?:-|$)/.test(locale) ? 'zh-CN' : 'en'
}

export function resolveLocale(preference: LanguagePreference, systemLanguageTag: string): AppLocale {
  return preference === 'system' ? resolveSystemLocale(systemLanguageTag) : preference
}
