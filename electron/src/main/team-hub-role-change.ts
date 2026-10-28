/** Internal receipt: authenticated health confirmed that hosting stopped,
 * although another part of the role-change operation failed. */
export class TeamHubStoppedHostingError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Hosting stopped, but the connection could not be restored.', { cause })
    this.name = 'TeamHubStoppedHostingError'
  }
}
