// Leaf-only capability constants. Keep OAuth authorization independent from the Gmail data adapter
// so the ordinary editor can prepare consent without loading mailbox parsing/UI code.
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose'
export const GMAIL_CONNECTED_MAILBOX_SCOPES = [GMAIL_READONLY_SCOPE, GMAIL_COMPOSE_SCOPE] as const
