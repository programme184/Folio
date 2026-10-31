import type { TeamHubScope } from '@shared/team-hub'

export const TEAM_NETWORK_MESSAGE_DELETED_EVENT = 'agentsdock:team-network-message-deleted'

export interface TeamNetworkMessageDeletedEventDetail {
  scopeKey: string
  profileId: string
  profileGeneration: number
  serverIdentity: string
  teamId: string
  messageId: string
}

export function dispatchTeamNetworkMessageDeleted(
  scope: TeamHubScope,
  teamId: string,
  messageId: string
): void {
  window.dispatchEvent(new CustomEvent<TeamNetworkMessageDeletedEventDetail>(
    TEAM_NETWORK_MESSAGE_DELETED_EVENT,
    {
      detail: {
        scopeKey: JSON.stringify(scope),
        profileId: scope.profileId,
        profileGeneration: scope.profileGeneration,
        serverIdentity: scope.serverIdentity,
        teamId,
        messageId
      }
    }
  ))
}
