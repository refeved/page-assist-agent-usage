import { requestStates } from "./types.ts"
import type {
  Approval,
  Capabilities,
  OutputEvent,
  RemoteAttachment,
  RemoteMessage,
  RequestRecord,
  RequestState,
  UploadedAttachment
} from "./types.ts"

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid QwenPaw response: expected object")
  }
  return value as Record<string, unknown>
}
export function text(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Invalid QwenPaw response: expected text")
  return value
}
export function id(value: unknown): string {
  const result = text(value)
  if (!result.trim() || result.length > 512)
    throw new Error("Invalid QwenPaw identifier")
  return result
}
export function flag(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new Error("Invalid QwenPaw capability flag")
  return value
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value))
    throw new Error("Invalid QwenPaw response: expected list")
  return value
}
export function state(value: unknown): RequestState {
  if (!requestStates.some((s) => s === value))
    throw new Error("Invalid QwenPaw request state")
  return value as RequestState
}
export function capabilities(value: unknown): Capabilities {
  const v = object(value)
  if (v.protocolVersion !== 1)
    throw new Error("Unsupported QwenPaw protocol version")
  for (const field of ["maxContextChars", "maxTextChars"]) {
    if (!Number.isSafeInteger(v[field]) || Number(v[field]) <= 0) {
      throw new Error("Invalid QwenPaw size limit")
    }
  }
  // Attachment fields are optional: servers predating uploads omit
  // them entirely, so a missing flag means "unsupported", never "invalid".
  const attachments = v.attachments === true
  return {
    protocolVersion: 1,
    instanceId: id(v.instanceId),
    principalScope: id(v.principalScope),
    maxContextChars: Number(v.maxContextChars),
    maxTextChars: Number(v.maxTextChars),
    recovery: flag(v.recovery),
    approvals: flag(v.approvals),
    approvalEvents: flag(v.approvalEvents),
    attachments,
    maxAttachmentBytes: positiveLimit(v.maxAttachmentBytes),
    maxAttachments: attachments ? positiveLimit(v.maxAttachments) : 0,
    media: v.media === true
  }
}
function positiveLimit(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0
}
function byteSize(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
}
export function uploadedAttachment(value: unknown): UploadedAttachment {
  const v = object(value)
  if (v.kind !== "image" && v.kind !== "file") {
    throw new Error("Invalid QwenPaw attachment kind")
  }
  return {
    attachmentId: id(v.attachmentId),
    name: text(v.name),
    kind: v.kind,
    mediaType: text(v.mediaType),
    bytes: byteSize(v.bytes)
  }
}
// A reply carries a handful of files at most. Anything larger is a broken or
// hostile payload and must never turn into that many protected downloads.
const MAX_MESSAGE_ATTACHMENTS = 8
function webUrl(value: unknown): string {
  const raw = text(value)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error("Invalid QwenPaw attachment URL")
  }
  // Only public links: a file:, data: or javascript: href would read the
  // user's disk or run code inside the extension page.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("Invalid QwenPaw attachment URL")
  return parsed.href
}
export function attachment(value: unknown): RemoteAttachment {
  const v = object(value)
  if (v.kind !== "image" && v.kind !== "file") {
    throw new Error("Invalid QwenPaw attachment kind")
  }
  const mediaId = v.mediaId === undefined ? undefined : id(v.mediaId)
  const url = v.url === undefined ? undefined : webUrl(v.url)
  if (!mediaId && !url)
    throw new Error("Invalid QwenPaw attachment: no readable source")
  return {
    mediaId,
    url,
    kind: v.kind,
    name: text(v.name),
    mediaType: text(v.mediaType),
    bytes: byteSize(v.bytes)
  }
}
// Servers without reply media omit the field entirely, so a missing list
// means "nothing attached" rather than an invalid message.
export function attachmentList(value: unknown): RemoteAttachment[] {
  if (value === undefined) return []
  const rows = list(value)
  if (rows.length > MAX_MESSAGE_ATTACHMENTS)
    throw new Error("Too many QwenPaw attachments")
  return rows.map(attachment)
}
export function request(value: unknown): RequestRecord {
  const v = object(value)
  return {
    requestId: id(v.requestId),
    conversationId: id(v.conversationId),
    state: state(v.state)
  }
}
export function message(value: unknown): RemoteMessage {
  const v = object(value)
  if (v.role !== "user" && v.role !== "assistant")
    throw new Error("Unsupported remote message role")
  return {
    id: id(v.id),
    requestId: id(v.requestId),
    role: v.role,
    content: text(v.content),
    attachments: attachmentList(v.attachments),
    status: text(v.status)
  }
}
export function output(value: unknown): OutputEvent {
  const v = object(value)
  const requestId = id(v.requestId)
  switch (v.type) {
    case "request.state":
    case "request.terminal":
      return { type: v.type, requestId, state: state(v.state) }
    case "message.delta":
      return {
        type: v.type,
        requestId,
        messageId: id(v.messageId),
        delta: text(v.delta)
      }
    case "message.snapshot":
      return {
        type: v.type,
        requestId,
        messageId: id(v.messageId),
        content: text(v.content),
        attachments: attachmentList(v.attachments),
        status: text(v.status)
      }
    case "request.error":
      return {
        type: v.type,
        requestId,
        code: id(v.code),
        message: text(v.message)
      }
    default:
      throw new Error("Unsupported QwenPaw output event")
  }
}
export function approval(value: unknown): Approval {
  const v = object(value)
  const expiresAt = text(v.expiresAt)
  if (!Number.isFinite(Date.parse(expiresAt)))
    throw new Error("Invalid approval expiry")
  return {
    id: id(v.id),
    conversationId: id(v.conversationId),
    agentId: id(v.agentId),
    requestId: id(v.requestId),
    tool: text(v.tool),
    target: text(v.target),
    risk: text(v.risk),
    expiresAt,
    actionable: flag(v.actionable),
    scopes: list(v.scopes).map((item) => {
      const s = object(item)
      return {
        id: id(s.id),
        label: text(s.label),
        description: text(s.description)
      }
    })
  }
}
