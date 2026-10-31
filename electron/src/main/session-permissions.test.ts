import { expect, it } from 'vitest'
import { permissionAllowed } from './session-permissions'

it('allows only full screen from the app window', () => {
  expect(permissionAllowed('fullscreen', true)).toBe(true)
  expect(permissionAllowed('fullscreen', false)).toBe(false)
  for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal']) expect(permissionAllowed(permission, true)).toBe(false)
})
