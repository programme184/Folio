import type { StoredProfileSettings, StoredServerProfile } from '../types'
import {
  applyStoredServerProfileUpdate,
  assertUniqueServerProfile,
  createStoredServerProfile,
  defaultProfileName,
  findDuplicateProfileByIdentity,
  findDuplicateProfileByURL,
  legacyURLCacheNamespace,
  migrateLegacyProfileSettings,
  nextCredentialVersion,
  normalizeCredentialVersion,
  normalizeStoredProfileSettings,
  profileCredentialKeySuffix,
  profileNamespace,
} from './server-profiles'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEqual(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

function assertThrows(action: () => unknown, pattern: RegExp): void {
  try { action() } catch (error) {
    assert(pattern.test(error instanceof Error ? error.message : String(error)), `Unexpected error: ${String(error)}`)
    return
  }
  throw new Error('Expected action to throw')
}

const timestamp = '2026-07-18T12:00:00.000Z'
const migrated = migrateLegacyProfileSettings({
  serverURL: 'SERVER.EXAMPLE:7850/api/health?ignored=1',
  serverConfigured: true,
  selectedSessionId: 'chat-1',
  folderOrder: ['Work', 'Work', 'Personal'],
  fontScale: 1.26,
}, timestamp)

assertEqual(migrated.settings, {
  schemaVersion: 2,
  activeProfileId: 'default-profile',
  profiles: [{
    id: 'default-profile',
    name: 'server.example:7850',
    serverURL: 'http://server.example:7850',
    serverIdentity: null,
    serverConfigured: true,
    credentialVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  }],
  fontScale: 1.3,
})
assertEqual(migrated.workspace, {
  selectedSessionId: 'chat-1',
  folderOrder: ['Work', 'Personal'],
  collapsedFolders: [],
  drafts: {},
})

// Normalizing an already-migrated value neither creates a new ID nor rewrites timestamps.
assertEqual(normalizeStoredProfileSettings(migrated.settings, '2030-01-01T00:00:00.000Z'), migrated.settings)
assertEqual(profileNamespace(migrated.settings.profiles[0]), 'profile:default-profile')
assertEqual(profileNamespace({ id: 'default-profile', serverIdentity: ' canonical-server ' }), 'canonical-server')
assertEqual(legacyURLCacheNamespace(migrated.settings.profiles[0].serverURL), 'http://server.example:7850')

assertEqual(normalizeCredentialVersion(undefined), 1)
assertEqual(normalizeCredentialVersion(0), 1)
assertEqual(normalizeCredentialVersion(7), 7)
assertEqual(nextCredentialVersion(7), 8)
assertThrows(() => nextCredentialVersion(Number.MAX_SAFE_INTEGER), /cannot be advanced/)

const settingsWithoutCredentialVersion = JSON.parse(JSON.stringify(migrated.settings)) as {
  profiles: Array<Record<string, unknown>>
}
delete settingsWithoutCredentialVersion.profiles[0].credentialVersion
assertEqual(normalizeStoredProfileSettings(settingsWithoutCredentialVersion).profiles[0].credentialVersion, 1)

const secureSuffix = profileCredentialKeySuffix('profile/a ☃')
assert(/^[A-Za-z0-9._-]+$/.test(secureSuffix), 'SecureStore suffix contains unsupported characters')
assert(secureSuffix !== profileCredentialKeySuffix('profile-a ☃'), 'credential suffixes must not collapse distinct profile IDs')

const profileA = createStoredServerProfile({
  name: 'Alpha',
  serverURL: 'alpha.example:7850',
  serverIdentity: 'server-alpha',
  serverConfigured: true,
}, 'profile-a', timestamp)
const profileB = createStoredServerProfile({ serverURL: 'beta.example:7850' }, 'profile-b', timestamp)
assertEqual(profileA.serverURL, 'http://alpha.example:7850')
assertEqual(profileB.name, 'beta.example:7850')
assertEqual(defaultProfileName('https://EXAMPLE.COM'), 'example.com')
assertEqual(defaultProfileName('http://[::1]:7850'), '[::1]:7850')
assertEqual(defaultProfileName('https://user:secret@example.com:7850/api/health?token=secret'), 'example.com:7850')
const unnamedProfile = createStoredServerProfile({
  serverURL: 'http://192.0.2.10:7850',
  serverIdentity: 'opaque-server-identity',
}, 'unnamed', timestamp)
assertEqual(unnamedProfile.name, '192.0.2.10:7850')
assertEqual(profileNamespace(unnamedProfile), 'opaque-server-identity')
assertEqual(migrateLegacyProfileSettings({
  serverURL: unnamedProfile.serverURL,
  serverIdentity: unnamedProfile.serverIdentity,
}, timestamp).settings.profiles[0].name, unnamedProfile.name)

const identityNamedSettings: StoredProfileSettings = {
  schemaVersion: 2,
  activeProfileId: unnamedProfile.id,
  profiles: [{ ...unnamedProfile, name: unnamedProfile.serverIdentity! }, profileA],
  fontScale: 1,
}
const repairedNames = normalizeStoredProfileSettings(identityNamedSettings)
assertEqual(repairedNames.profiles, [unnamedProfile, profileA])
assertEqual(repairedNames.activeProfileId, unnamedProfile.id)
assertEqual(normalizeStoredProfileSettings(repairedNames), repairedNames)
assertEqual(findDuplicateProfileByURL([profileA, profileB], 'HTTP://ALPHA.EXAMPLE:7850/')?.id, 'profile-a')
assertEqual(findDuplicateProfileByIdentity([profileA, profileB], ' server-alpha ')?.id, 'profile-a')
assertThrows(() => assertUniqueServerProfile([profileA, profileB], {
  serverURL: 'alpha.example:7850',
  serverIdentity: null,
}), /already uses/)
assertThrows(() => assertUniqueServerProfile([profileA, profileB], {
  serverURL: 'gamma.example:7850',
  serverIdentity: 'server-alpha',
}), /already belongs/)

const updated = applyStoredServerProfileUpdate(profileA, {
  name: 'Renamed',
  serverURL: 'new-alpha.example:7850',
  resetServerIdentity: true,
}, '2026-07-18T13:00:00.000Z')
assertEqual(updated, {
  ...profileA,
  name: 'Renamed',
  serverURL: 'http://new-alpha.example:7850',
  serverIdentity: null,
  updatedAt: '2026-07-18T13:00:00.000Z',
})

const duplicateSettings: StoredProfileSettings = {
  schemaVersion: 2,
  activeProfileId: profileA.id,
  profiles: [profileA, { ...profileB, serverURL: profileA.serverURL }],
  fontScale: 1,
}
assertThrows(() => normalizeStoredProfileSettings(duplicateSettings), /already uses/)

const duplicateIdentityProfiles: StoredServerProfile[] = [profileA, { ...profileB, serverIdentity: profileA.serverIdentity }]
assertThrows(() => normalizeStoredProfileSettings({
  ...duplicateSettings,
  profiles: duplicateIdentityProfiles,
}), /already belongs/)

console.log('server profile regressions passed')

const stressProfiles = Array.from({ length: 64 }, (_, index) => createStoredServerProfile({
  name: index % 3 === 0 ? `Custom ${index}` : undefined,
  serverURL: `https://server-${index}.example:${7800 + index}`,
  serverIdentity: `identity-${index}`,
}, `profile-${index}`, timestamp))
let stressSettings: StoredProfileSettings = {
  schemaVersion: 2, activeProfileId: stressProfiles[0].id, fontScale: 1,
  profiles: stressProfiles.map((profile, index) => ({ ...profile, name: index % 3 === 0 ? profile.name : profile.serverIdentity! })),
}
for (let pass = 0; pass < 100; pass += 1) {
  stressSettings = normalizeStoredProfileSettings(JSON.parse(JSON.stringify(stressSettings)))
  assertEqual(stressSettings.profiles, stressProfiles)
  assertEqual(stressSettings.profiles.map(profileNamespace), stressProfiles.map(profileNamespace))
  assertEqual(stressSettings.activeProfileId, stressProfiles[0].id)
}
console.log('server profile stress passed: 64 profiles, 100 serialization/migration passes')
