export function needsLegacyUpdateRecovery(message: string): boolean {
  return message.includes('the previous server update could not be safely finalized')
}
