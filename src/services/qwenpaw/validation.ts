import { requestStates } from "./types.ts"
import type {
  Approval,
  Capabilities,
  OutputEvent,
  RemoteMessage,
  RequestRecord,
  RequestState
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
  return {
    protocolVersion: 1,
    instanceId: id(v.instanceId),
    principalScope: id(v.principalScope),
    maxContextChars: Number(v.maxContextChars),
    maxTextChars: Number(v.maxTextChars),
    recovery: flag(v.recovery),
    approvals: flag(v.approvals),
    approvalEvents: flag(v.approvalEvents)
  }
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
