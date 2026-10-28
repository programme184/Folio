import { Platform } from 'react-native'
import { importWithDeadline } from './deferred-import'
import { PhotoLibraryPermissionError } from './file-transfer'

async function mediaLibrary() {
  try {
    return await importWithDeadline(() => import('expo-media-library'), 'Photo library', 10_000)
  } catch {
    throw new Error('Saving to Photos is unavailable in this app build. Update the app and try again.')
  }
}

export async function preparePhotoSave(): Promise<void> {
  const library = await mediaLibrary()
  // Android 10+ can add app-owned media through MediaStore without library access.
  if (Platform.OS === 'android' && Number(Platform.Version) >= 29) return
  let permission = await library.getPermissionsAsync(true, [])
  if (!permission.granted && permission.canAskAgain) permission = await library.requestPermissionsAsync(true, [])
  if (!permission.granted) throw new PhotoLibraryPermissionError()
}

export async function saveToPhotos(uri: string): Promise<void> {
  const library = await mediaLibrary()
  await library.Asset.create(uri)
}
