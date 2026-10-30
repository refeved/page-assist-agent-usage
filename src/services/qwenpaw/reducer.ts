import type { OutputEvent, RemoteMessage } from "./types.ts"

export function applyMessageEvent(
  messages: RemoteMessage[],
  event: OutputEvent
): RemoteMessage[] {
  if (event.type !== "message.delta" && event.type !== "message.snapshot")
    return messages
  const index = messages.findIndex((m) => m.id === event.messageId)
  const previous = index < 0 ? undefined : messages[index]
  if (
    previous &&
    (previous.requestId !== event.requestId || previous.role !== "assistant")
  ) {
    throw new Error("Message ownership mismatch")
  }
  const next: RemoteMessage = {
    id: event.messageId,
    requestId: event.requestId,
    role: "assistant",
    content:
      event.type === "message.snapshot"
        ? event.content
        : (previous?.content || "") + event.delta,
    // Media only ever arrives with a snapshot; a delta must not erase it.
    attachments:
      event.type === "message.snapshot"
        ? event.attachments
        : previous?.attachments || [],
    status: event.type === "message.snapshot" ? event.status : "streaming"
  }
  return index < 0
    ? [...messages, next]
    : messages.map((m, i) => (i === index ? next : m))
}
