import { useRef, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import { X } from 'lucide-react-native'
import { radius, spacing, typography, usePalette } from '../theme'
import { t } from '../i18n'
import { Text } from './AppText'

export function IconButton({ icon: Icon, onPress, disabled, selected, size = 18, touchSize = 44, label, testID, activateOnPressIn = false }: { icon: LucideIcon; onPress: () => void; disabled?: boolean; selected?: boolean; size?: number; touchSize?: number; label?: string; testID?: string; activateOnPressIn?: boolean }) {
  const colors = usePalette()
  const pressInHandled = useRef(false)
  const handlePressIn = () => {
    if (!activateOnPressIn) return
    pressInHandled.current = true
    onPress()
  }
  const handlePress = () => {
    if (activateOnPressIn && pressInHandled.current) {
      pressInHandled.current = false
      return
    }
    onPress()
  }
  const handlePressOut = () => {
    if (activateOnPressIn) setTimeout(() => { pressInHandled.current = false }, 0)
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ? t(label) : undefined}
      accessibilityState={{ disabled: Boolean(disabled), selected: Boolean(selected) }}
      testID={testID}
      disabled={disabled}
      pressRetentionOffset={14}
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={({ pressed }) => [styles.iconButton, { width: touchSize, height: touchSize, backgroundColor: selected ? colors.raised : 'transparent', opacity: disabled ? 0.35 : pressed ? 0.65 : 1 }]}
    >
      <Icon size={size} color={selected ? colors.blue : colors.muted} strokeWidth={1.8} />
    </Pressable>
  )
}

/** A protected close target kept below the native page-sheet drag recognizer. */
export function SheetCloseButton({ onPress, disabled, label = 'Close', testID, activateOnPressIn = false }: { onPress: () => void; disabled?: boolean; label?: string; testID?: string; activateOnPressIn?: boolean }) {
  const colors = usePalette()
  const pressInHandled = useRef(false)
  const handlePressIn = () => {
    if (!activateOnPressIn) return
    pressInHandled.current = true
    onPress()
  }
  const handlePress = () => {
    if (activateOnPressIn && pressInHandled.current) {
      pressInHandled.current = false
      return
    }
    onPress()
  }
  const handlePressOut = () => {
    if (activateOnPressIn) setTimeout(() => { pressInHandled.current = false }, 0)
  }
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={t(label)}
    accessibilityState={{ disabled: Boolean(disabled) }}
    testID={testID}
    disabled={disabled}
    pressRetentionOffset={20}
    onPress={handlePress}
    onPressIn={handlePressIn}
    onPressOut={handlePressOut}
    style={({ pressed }) => [styles.sheetClose, { backgroundColor: colors.raised, opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}
  ><X size={21} color={colors.muted} strokeWidth={2} /></Pressable>
}

export function SectionHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  const colors = usePalette()
  return <View style={styles.sectionHeader}><Text style={[styles.sectionTitle, { color: colors.muted }]}>{t(title)}</Text>{trailing}</View>
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'blue' | 'green' | 'orange' | 'yellow' }) {
  const colors = usePalette()
  const foreground = tone === 'blue' ? colors.blue : tone === 'green' ? colors.green : tone === 'orange' ? colors.orange : tone === 'yellow' ? colors.yellow : colors.muted
  return <View style={[styles.pill, { backgroundColor: colors.raised }]}><Text style={[styles.pillText, { color: foreground }]} numberOfLines={1}>{children}</Text></View>
}

export function Loading({ label }: { label?: string }) {
  const colors = usePalette()
  return <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={{ color: colors.muted }}>{label ? t(label) : label}</Text></View>
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  const colors = usePalette()
  return <View style={styles.empty}><Text style={[styles.emptyTitle, { color: colors.text }]}>{t(title)}</Text>{body ? <Text style={[styles.emptyBody, { color: colors.muted }]}>{t(body)}</Text> : null}</View>
}

const styles = StyleSheet.create({
  iconButton: { flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: radius.round },
  sheetClose: { width: 48, height: 48, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: radius.round },
  sectionHeader: { minHeight: 32, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { ...typography.caption, fontWeight: '600', textTransform: 'uppercase' },
  pill: { minHeight: 24, minWidth: 0, maxWidth: 190, flexShrink: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  pillText: { ...typography.caption, fontWeight: '600' },
  loading: { flex: 1, minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  empty: { flex: 1, minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { ...typography.heading, fontWeight: '600' },
  emptyBody: { ...typography.body, textAlign: 'center', maxWidth: 320 },
})
