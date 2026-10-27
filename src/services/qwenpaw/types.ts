export const requestStates = [
  "accepted",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
  "unknown"
] as const
export type RequestState = (typeof requestStates)[number]
export const isTerminal = (state: RequestState) =>
  state === "completed" || state === "failed" || state === "cancelled"

export interface Capabilities {
  protocolVersion: 1
  instanceId: string
  principalScope: string
  maxContextChars: number
  maxTextChars: number
  recovery: boolean
  approvals: boolean
  approvalEvents: boolean
  attachments: boolean
  maxAttachmentBytes: number
  maxAttachments: number
}
export interface Agent {
  id: string
  name: string
  description?: string
}
export interface PageContext {
  type: "webpage"
  mode: "article" | "selection"
  title: string
  url: string
  capturedAt: string
  content: string
  contentHash: string
  truncated: boolean
}
export interface AttachmentRef {
  attachmentId: string
}
export interface UploadedAttachment extends AttachmentRef {
  name: string
  kind: "image" | "file"
  mediaType: string
  bytes: number
}
export interface MessagePayload {
  requestId: string
  text: string
  pageContext?: PageContext
  attachments?: AttachmentRef[]
}
export interface RemoteMessage {
  id: string
  requestId: string
  role: "user" | "assistant"
  content: string
  status: string
}
export interface RequestRecord {
  requestId: string
  conversationId: string
  state: RequestState
}
export type OutputEvent =
  | {
      type: "request.state" | "request.terminal"
      requestId: string
      state: RequestState
    }
  | {
      type: "message.delta"
      requestId: string
      messageId: string
      delta: string
    }
  | {
      type: "message.snapshot"
      requestId: string
      messageId: string
      content: string
      status: string
    }
  | { type: "request.error"; requestId: string; code: string; message: string }

export interface Approval {
  id: string
  conversationId: string
  agentId: string
  requestId: string
  tool: string
  target: string
  risk: string
  expiresAt: string
  actionable: boolean
  scopes: { id: string; label: string; description: string }[]
}
export interface Connection {
  id: string
  baseUrl: string
  consoleUrl?: string
}
export interface Conversation {
  id: string
  connectionId: string
  principalScope: string
  instanceId: string
  agentId: string
  conversationId: string
  title: string
  updatedAt: number
}
export interface StoredRequest extends RequestRecord {
  connectionId: string
  conversationLocalId: string
  payload: MessagePayload
  submission: "prepared" | "accepted" | "uncertain"
  updatedAt: number
}
export interface CachedMessage extends RemoteMessage {
  conversationLocalId: string
  updatedAt: number
}
