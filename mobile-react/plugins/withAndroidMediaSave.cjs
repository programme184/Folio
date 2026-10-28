const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins')

function restrictMediaSavePermissions(manifest) {
  manifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools'
  const permissions = manifest.manifest['uses-permission'] ?? []
  manifest.manifest['uses-permission'] = permissions.filter(permission => permission.$['android:name'] !== 'android.permission.WRITE_EXTERNAL_STORAGE')
  manifest.manifest['uses-permission'].push({ $: {
    'android:name': 'android.permission.WRITE_EXTERNAL_STORAGE',
    'android:maxSdkVersion': '28',
    'tools:replace': 'android:maxSdkVersion',
  } })
  // Modern Android uses scoped MediaStore insertion, never legacy storage access.
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest)
  delete application.$['android:requestLegacyExternalStorage']
  return manifest
}

// Register before expo-media-library: manifest mods execute in reverse order.
module.exports = config => withAndroidManifest(config, next => {
  next.modResults = restrictMediaSavePermissions(next.modResults)
  return next
})
module.exports.restrictMediaSavePermissions = restrictMediaSavePermissions
