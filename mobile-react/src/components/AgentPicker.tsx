import { useRef, useState, type ReactNode } from 'react'
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Check, RefreshCw } from 'lucide-react-native'
import { dismissAppKeyboard } from '../lib/app-keyboard'
import { chatBackendLabel, chatBackendSelection, type ChatBackendChoice } from '../lib/provider-selection'
import { radius, spacing, typography, usePalette } from '../theme'
import { Text } from './AppText'
import { BackendMark } from './BackendMark'
import { SheetCloseButton } from './ui'

export function AgentPicker({ value, choices, onChange, onReload, children, label, testID, style }: {
  value: ChatBackendChoice
  choices: ChatBackendChoice[]
  onChange: (value: ChatBackendChoice) => void
  onReload?: () => void
  children: ReactNode
  label: string
  testID: string
  style?: StyleProp<ViewStyle>
}) {
  const colors = usePalette()
  const { width, height } = useWindowDimensions()
  const [open, setOpen] = useState(false)
  const afterDismiss = useRef<(() => void) | null>(null)
  const close = () => { afterDismiss.current = null; setOpen(false) }
  const finishDismiss = () => {
    const action = afterDismiss.current
    afterDismiss.current = null
    action?.()
  }
  const choose = (action: () => void) => {
    // Wait for the iOS modal to leave before an action can present an alert.
    afterDismiss.current = action
    setOpen(false)
    if (Platform.OS !== 'ios') finishDismiss()
  }
  return <>
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={() => { dismissAppKeyboard(); setOpen(true) }} style={style}>
      {children}
    </Pressable>
    <Modal visible={open} transparent animationType="fade" statusBarTranslucent={Platform.OS === 'android'} onRequestClose={close} onDismiss={finishDismiss}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={[styles.backdrop, width < 600 && styles.compactBackdrop]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss agent choices" style={StyleSheet.absoluteFill} onPress={close} />
          <View accessibilityViewIsModal style={[styles.menu, { maxHeight: Math.min(480, height * 0.7), backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.header, { borderColor: colors.border }]}>
              <Text style={[styles.title, { color: colors.text }]} localize>Choose agent</Text>
              <SheetCloseButton onPress={close} label="Close choose agent" />
            </View>
            <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={styles.options}>
              {choices.map(choice => <Pressable key={choice} testID={`agent-choice-${choice}`} accessibilityRole="button" accessibilityLabel={chatBackendLabel(choice)} accessibilityState={{ selected: value === choice }} onPress={() => choose(() => onChange(choice))} style={({ pressed }) => [styles.option, { backgroundColor: pressed || value === choice ? colors.raised : 'transparent' }]}>
                <BackendMark backend={chatBackendSelection(choice).backend} size={22} />
                <Text style={[styles.name, { color: colors.text }]}>{chatBackendLabel(choice)}</Text>
                {value === choice ? <Check size={18} color={colors.blue} /> : <View style={styles.checkSpace} />}
              </Pressable>)}
              {onReload ? <Pressable testID="agent-reload" accessibilityRole="button" accessibilityLabel={`Reload ${chatBackendLabel(value)}`} onPress={() => choose(onReload)} style={({ pressed }) => [styles.option, styles.reload, { borderColor: colors.border, backgroundColor: pressed ? colors.raised : 'transparent' }]}>
                <RefreshCw size={22} color={colors.muted} />
                <Text style={[styles.name, { color: colors.text }]} localize>Reload {chatBackendLabel(value)}</Text>
              </Pressable> : null}
            </ScrollView>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  </>
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#00000088' },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.md },
  compactBackdrop: { justifyContent: 'flex-end' },
  menu: { width: '100%', maxWidth: 440, borderRadius: radius.sheet, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, paddingRight: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { ...typography.body, flex: 1, fontWeight: '600' },
  options: { padding: spacing.sm },
  option: { minHeight: 48, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md },
  name: { ...typography.body, flex: 1 },
  checkSpace: { width: 18 },
  reload: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.xs },
})
