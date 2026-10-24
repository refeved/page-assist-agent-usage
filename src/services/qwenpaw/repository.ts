import { db } from "@/db/dexie/schema"
import type {
  Conversation,
  MessagePayload,
  RemoteMessage,
  StoredRequest
} from "./types"
import { isTerminal } from "./types"

export const conversations = (
  connectionId: string,
  instanceId: string,
  principalScope: string
) =>
  db.qwenpawConversations
    .where("connectionId")
    .equals(connectionId)
    .filter(
      (c) => c.instanceId === instanceId && c.principalScope === principalScope
    )
    .reverse()
    .sortBy("updatedAt")
export const requests = (conversationLocalId: string) =>
  db.qwenpawRequests
    .where("conversationLocalId")
    .equals(conversationLocalId)
    .sortBy("updatedAt")
export const messages = (conversationLocalId: string) =>
  db.qwenpawMessages
    .where("conversationLocalId")
    .equals(conversationLocalId)
    .sortBy("updatedAt")
export const saveConversation = (conversation: Conversation) =>
  db.qwenpawConversations.put(conversation)

export async function prepare(
  conversation: Conversation,
  payload: MessagePayload
): Promise<StoredRequest> {
  return db.transaction(
    "rw",
    db.qwenpawRequests,
    db.qwenpawMessages,
    db.qwenpawConversations,
    async () => {
      const existing = await db.qwenpawRequests.get([
        conversation.connectionId,
        payload.requestId
      ])
      if (existing) {
        if (
          existing.conversationLocalId !== conversation.id ||
          JSON.stringify(existing.payload) !== JSON.stringify(payload)
        ) {
          throw new Error("Request ID payload conflict")
        }
        return existing
      }
      const busy = (await requests(conversation.id)).some(
        (r) => !isTerminal(r.state)
      )
      if (busy)
        throw new Error(
          "Conversation has an unresolved request; reconcile before sending"
        )
      const updatedAt = Date.now()
      const record: StoredRequest = {
        connectionId: conversation.connectionId,
        conversationLocalId: conversation.id,
        conversationId: conversation.conversationId,
        requestId: payload.requestId,
        payload,
        submission: "prepared",
        state: "unknown",
        updatedAt
      }
      await db.qwenpawRequests.add(record)
      await db.qwenpawMessages.add({
        id: `local:${payload.requestId}`,
        conversationLocalId: conversation.id,
        requestId: payload.requestId,
        role: "user",
        content: payload.text,
        status: "pending",
        updatedAt
      })
      await db.qwenpawConversations.update(conversation.id, { updatedAt })
      return record
    }
  )
}
export async function saveRequest(record: StoredRequest) {
  await db.qwenpawRequests.put({ ...record, updatedAt: Date.now() })
}
export async function replaceMessages(
  conversationLocalId: string,
  remote: RemoteMessage[]
) {
  await db.transaction("rw", db.qwenpawMessages, async () => {
    await db.qwenpawMessages
      .where("conversationLocalId")
      .equals(conversationLocalId)
      .delete()
    const now = Date.now()
    await db.qwenpawMessages.bulkPut(
      remote.map((m, index) => ({
        ...m,
        conversationLocalId,
        updatedAt: now + index
      }))
    )
  })
}
export async function removeCache(conversationLocalId: string) {
  await db.transaction(
    "rw",
    db.qwenpawConversations,
    db.qwenpawRequests,
    db.qwenpawMessages,
    async () => {
      if (
        (await requests(conversationLocalId)).some((r) => !isTerminal(r.state))
      ) {
        throw new Error("Cannot remove cache while a request is unresolved")
      }
      await db.qwenpawMessages
        .where("conversationLocalId")
        .equals(conversationLocalId)
        .delete()
      await db.qwenpawRequests
        .where("conversationLocalId")
        .equals(conversationLocalId)
        .delete()
      await db.qwenpawConversations.delete(conversationLocalId)
    }
  )
}
export async function pruneCache() {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const old = await db.qwenpawConversations
    .where("updatedAt")
    .below(cutoff)
    .toArray()
  for (const c of old) {
    if ((await requests(c.id)).every((r) => isTerminal(r.state)))
      await removeCache(c.id)
  }
}
