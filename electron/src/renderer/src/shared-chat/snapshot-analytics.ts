import { trackSharedChatEvent } from './analytics'

// Included only in an authenticated, successfully rendered snapshot response.
// No token form, error page, HEAD response or redirect executes this entry.
trackSharedChatEvent('shared_chat_snapshot_activated', location.pathname)
