import { Children, createContext, forwardRef, useContext, type ComponentRef, type ReactNode } from 'react'
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native'
import { APP_FONT_SCALE_DEFAULT, scaleAppFont } from '../lib/typography'
import { translate } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import { useLanguageStore } from '../store/useLanguageStore'

const DEFAULT_NATIVE_TEXT_SIZE = 14
const AppFontScaleContext = createContext(APP_FONT_SCALE_DEFAULT)
const InheritedTextSizeContext = createContext(DEFAULT_NATIVE_TEXT_SIZE)

export function AppTypographyProvider({ children }: { children: ReactNode }) {
  const fontScale = useAppStore(state => state.fontScale)
  return <AppFontScaleContext.Provider value={fontScale}>{children}</AppFontScaleContext.Provider>
}

function baseTextSize(style: StyleProp<TextStyle> | undefined, inheritedSize: number): number {
  const flattened = StyleSheet.flatten(style)
  return typeof flattened?.fontSize === 'number' ? flattened.fontSize : inheritedSize
}

function scaledStyle(style: StyleProp<TextStyle> | undefined, scale: number, fallbackSize: number): StyleProp<TextStyle> {
  if (scale === APP_FONT_SCALE_DEFAULT) return style
  const flattened = StyleSheet.flatten(style)
  const fontSize = typeof flattened?.fontSize === 'number' ? flattened.fontSize : fallbackSize
  const override: TextStyle = { fontSize: scaleAppFont(fontSize, scale) }
  if (typeof flattened?.lineHeight === 'number') override.lineHeight = scaleAppFont(flattened.lineHeight, scale)
  return [style, override]
}

export type Text = ComponentRef<typeof NativeText>
type AppTextProps = TextProps & { localize?: boolean }

function LocalizedContent({ children }: { children: ReactNode }) {
  const locale = useLanguageStore(state => state.locale)
  return <>{Children.map(children, child => typeof child === 'string' ? translate(child, locale) : child)}</>
}

export const Text = forwardRef<Text, AppTextProps>(function AppText({ children, style, localize = false, ...props }, ref) {
  const fontScale = useContext(AppFontScaleContext)
  const inheritedSize = useContext(InheritedTextSizeContext)
  const currentSize = baseTextSize(style, inheritedSize)
  return <InheritedTextSizeContext.Provider value={currentSize}>
    <NativeText ref={ref} style={scaledStyle(style, fontScale, inheritedSize)} {...props}>
      {localize ? <LocalizedContent>{children}</LocalizedContent> : children}
    </NativeText>
  </InheritedTextSizeContext.Provider>
})

export type TextInput = ComponentRef<typeof NativeTextInput>
export const TextInput = forwardRef<TextInput, TextInputProps>(function AppTextInput({ style, placeholder, accessibilityLabel, ...props }, ref) {
  const fontScale = useContext(AppFontScaleContext)
  const locale = useLanguageStore(state => state.locale)
  return <NativeTextInput ref={ref} style={scaledStyle(style, fontScale, DEFAULT_NATIVE_TEXT_SIZE)}
    placeholder={placeholder ? translate(placeholder, locale) : placeholder}
    accessibilityLabel={accessibilityLabel ? translate(accessibilityLabel, locale) : accessibilityLabel}
    {...props} />
})
