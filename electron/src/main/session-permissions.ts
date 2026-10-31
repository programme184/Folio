/** Every web permission is denied except HTML full screen, which the PDF viewer needs, and only for the app window. */
export const permissionAllowed = (permission: string, fromAppWindow: boolean): boolean => permission === 'fullscreen' && fromAppWindow
