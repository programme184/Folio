import chinese from './zh-CN.json'
import type { AppLocale } from './locale'
import { useLanguageStore } from '../store/useLanguageStore'

const messages: Readonly<Record<string, string>> = chinese

export function translate(source: string, locale: AppLocale, params?: Record<string, string | number>): string {
  if (locale !== 'zh-CN') return interpolate(source, params)
  if (!source.trim()) return source
  const prefix = source.match(/^\s*/)?.[0] ?? ''
  const suffix = source.match(/\s*$/)?.[0] ?? ''
  const text = source.slice(prefix.length, source.length - suffix.length)
  const translated = Object.hasOwn(messages, text) ? messages[text] : text
  return interpolate(`${prefix}${translated}${suffix}`, params)
}

function interpolate(source: string, params?: Record<string, string | number>): string {
  if (!params) return source
  return source.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder)
}

export function t(source: string, params?: Record<string, string | number>): string {
  return translate(source, useLanguageStore.getState().locale, params)
}
