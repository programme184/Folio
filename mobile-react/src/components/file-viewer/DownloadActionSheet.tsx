import { useRef } from 'react'
import { Modal, Pressable, StyleSheet, View } from 'react-native'
import { Download, ImageDown, Share2 } from 'lucide-react-native'
import type { FileTransferAction } from '../../lib/file-transfer'
import { radius, spacing, typography, usePalette } from '../../theme'
import { Text } from '../AppText'

export function DownloadActionSheet({ filename, allowPhotos, bottomInset, onSelect, onClose }: {
  filename: string
  allowPhotos: boolean
  bottomInset: number
  onSelect: (action: FileTransferAction) => void
  onClose: () => void
}) {
  const colors = usePalette()
  const settled = useRef(false)
  const options = [
    { action: 'download' as const, label: 'Save to Files', icon: Download },
    ...(allowPhotos ? [{ action: 'save-photos' as const, label: 'Save to Photos', icon: ImageDown }] : []),
    { action: 'share' as const, label: 'Share / Open in...', icon: Share2 },
  ]

  const select = (action?: FileTransferAction) => {
    if (settled.current) return
    settled.current = true
    if (action) onSelect(action)
    else onClose()
  }
  return <Modal transparent visible animationType="slide" statusBarTranslucent onRequestClose={() => select()}>
    <View style={styles.backdrop}>
      <Pressable accessibilityRole="button" accessibilityLabel="Cancel download options" style={StyleSheet.absoluteFill} onPress={() => select()} />
      <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: Math.max(bottomInset, spacing.lg) }]}>
        <Text numberOfLines={2} style={[styles.filename, { color: colors.muted }]}>{filename}</Text>
        {options.map(({ action, label, icon: Icon }) => <Pressable key={action} accessibilityRole="button" accessibilityLabel={label} onPress={() => select(action)} style={({ pressed }) => [styles.option, { backgroundColor: pressed ? colors.raised : 'transparent' }]}>
          <Icon size={20} color={colors.blue} />
          <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        </Pressable>)}
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel download options" onPress={() => select()} style={styles.option}>
          <Text style={[styles.label, { color: colors.muted }]} localize>Cancel</Text>
        </Pressable>
      </View>
    </View>
  </Modal>
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' },
  sheet: { width: '100%', maxWidth: 560, alignSelf: 'center', borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingTop: spacing.lg, paddingHorizontal: spacing.lg },
  filename: { ...typography.caption, paddingHorizontal: spacing.sm, marginBottom: spacing.sm },
  option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
  label: { ...typography.body, flexShrink: 1 },
})
