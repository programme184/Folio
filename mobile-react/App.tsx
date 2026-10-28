import 'react-native-gesture-handler'
import { useEffect } from 'react'
import { StatusBar } from 'expo-status-bar'
import { AppState } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { AppTypographyProvider } from './src/components/AppText'
import { AppShell } from './src/components/AppShell'
import { trackEvent } from './src/lib/analytics'
import { useAppearanceStore } from './src/store/useAppearanceStore'
import { useLanguageStore } from './src/store/useLanguageStore'
import { usePalette } from './src/theme'

export default function App() {
  const colors = usePalette()
  useLanguageStore(state => state.locale)
  useEffect(() => {
    void useAppearanceStore.getState().hydrate()
    void useLanguageStore.getState().hydrate()
    trackEvent('app_launched')
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') useLanguageStore.getState().refreshSystemLocale()
    })
    return () => subscription.remove()
  }, [])
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardProvider preload={false}>
        <AppTypographyProvider>
          <SafeAreaProvider>
            <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'left', 'right']}>
              <AppShell />
            </SafeAreaView>
            <StatusBar style="auto" />
          </SafeAreaProvider>
        </AppTypographyProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}
