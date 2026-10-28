import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, View } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'
import { QrCode } from 'lucide-react-native'
import { parseServerConnectionLink, type ServerConnectionDetails } from '../lib/server-connection-link'
import { radius, spacing, typography, usePalette } from '../theme'
import { Text } from './AppText'

// Existing Dev binaries must still open the app before their camera rebuild is installed.
const camera: typeof import('expo-camera') | null = requireOptionalNativeModule('ExpoCamera') ? require('expo-camera') : null

export function ServerQrScanner({ onScanned }: { onScanned: (details: ServerConnectionDetails) => void }) {
  const colors = usePalette()
  return <View style={styles.body}>
    {camera ? <CameraScanner onScanned={onScanned} /> : <Text accessibilityRole="alert" style={[typography.body, { color: colors.muted }]} localize>
      Update this app to enable camera scanning. You can still enter the server address and token manually.
    </Text>}
    <View style={styles.guidance}>
      <QrCode size={32} color={colors.muted} accessible={false} />
      <Text style={[typography.body, styles.centered, { color: colors.text }]} localize>Scan a QR code from your server terminal or AgentsDock desktop.</Text>
      <Text style={[typography.caption, styles.centered, { color: colors.muted }]} localize>Use the same Wi-Fi or connect both devices to Tailscale.</Text>
    </View>
  </View>
}

function CameraScanner({ onScanned }: { onScanned: (details: ServerConnectionDetails) => void }) {
  const { CameraView, useCameraPermissions } = camera!
  const colors = usePalette()
  const [permission, requestPermission, getPermission] = useCameraPermissions()
  const [foreground, setForeground] = useState(AppState.currentState === 'active')
  const [error, setError] = useState<string | null>(null)
  const scanning = useRef(true)
  const prompted = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    const subscription = AppState.addEventListener('change', state => {
      setForeground(state === 'active')
      if (state === 'active') void getPermission().catch(() => {})
    })
    return () => { alive.current = false; subscription.remove() }
  }, [getPermission])
  const allowCamera = async () => {
    try {
      if (permission?.canAskAgain === false) await Linking.openSettings()
      else await requestPermission()
    } catch { if (alive.current) setError('Camera access is unavailable. Enter the connection manually instead.') }
  }
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain && !prompted.current) {
      prompted.current = true
      void allowCamera()
    }
  }, [permission])
  const accept = (value: string) => {
    if (!alive.current || !foreground || !scanning.current) return
    scanning.current = false
    try { onScanned(parseServerConnectionLink(value)) }
    catch { setError('Not an AgentsDock connection QR. Generate a fresh one with agentsdock pair.') }
  }
  return <View style={styles.body}>
    <View style={styles.previewWidth}>
    <View testID="server-camera-preview" style={[styles.preview, { backgroundColor: colors.raised }]}>
    {!permission ? <ActivityIndicator accessibilityLabel="Checking camera permission" color={colors.muted} /> : !permission.granted ?
      <Pressable accessibilityRole="button" accessibilityLabel={permission.canAskAgain ? 'Allow camera' : 'Open camera settings'} onPress={() => { void allowCamera() }}
        style={[styles.button, { backgroundColor: colors.raised, borderColor: colors.controlBorder }]}>
        <Text style={[typography.body, { color: colors.text }]} localize>{permission.canAskAgain ? 'Allow camera' : 'Open camera settings'}</Text>
      </Pressable> : foreground && !error ?
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={result => accept(result.data)}
          onMountError={() => { scanning.current = false; setError('Camera unavailable. Use a physical phone to scan, or enter the connection manually.') }} />
      : <QrCode size={48} color={colors.muted} accessible={false} />}
    </View>
    </View>
    {error ? <>
      <Text accessibilityRole="alert" style={[typography.caption, { color: colors.red }]}>{error}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Try scanning again" onPress={() => { scanning.current = true; setError(null) }}
        style={[styles.button, { backgroundColor: colors.raised, borderColor: colors.controlBorder }]}>
        <Text style={[typography.body, { color: colors.text }]} localize>Try again</Text>
      </Pressable>
    </> : null}
  </View>
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  previewWidth: { width: '100%', maxWidth: 360, alignSelf: 'center' },
  preview: { aspectRatio: 1, width: '100%', alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, overflow: 'hidden' },
  guidance: { alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  centered: { textAlign: 'center' },
  button: { minHeight: 44, padding: spacing.md, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
})
