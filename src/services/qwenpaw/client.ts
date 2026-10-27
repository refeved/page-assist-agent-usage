import type { Connection, MessagePayload, OutputEvent } from "./types"
import * as v from "./validation.ts"
import { serviceUrl } from "./privacy.ts"
import { readSSE } from "./sse.ts"
import { linkedController } from "./abort.ts"

export class RemoteHTTPError extends Error {
  status: number
  constructor(status: number) {
    super(
      `QwenPaw HTTP ${status}${status === 401 || status === 403 ? ": authentication or permission denied" : ""}`
    )
    this.status = status
  }
}
export class QwenPawClient {
  private origin: string
  private token: string
  private fetcher: typeof fetch
  constructor(
    config: Connection,
    token: string,
    fetcher: typeof fetch = (input, init) => fetch(input, init)
  ) {
    if (!token.trim() || /[\r\n]/.test(token))
      throw new Error("A valid browser-specific credential is required")
    this.origin = serviceUrl(config.baseUrl)
    this.token = token
    this.fetcher = fetcher
  }
  private async fetch(
    path: string,
    signal?: AbortSignal,
    body?: unknown,
    stream = false
  ) {
    const response = await this.fetcher(
      `${this.origin}/api/page-assist${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: stream ? "text/event-stream" : "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: stream
          ? signal
          : linkedController(
              ...(signal ? [signal] : []),
              AbortSignal.timeout(20000)
            ).signal
      }
    )
    if (!response.ok) throw new RemoteHTTPError(response.status)
    const expected = stream ? "text/event-stream" : "application/json"
    if (!response.headers.get("content-type")?.includes(expected))
      throw new Error(`QwenPaw response must be ${expected}`)
    return response
  }
  private async json(
    path: string,
    signal?: AbortSignal,
    body?: unknown
  ): Promise<unknown> {
    return (await this.fetch(path, signal, body)).json()
  }
  async capabilities(signal?: AbortSignal) {
    return v.capabilities(await this.json("/capabilities", signal))
  }
  async agents(signal?: AbortSignal) {
    return v
      .list(v.object(await this.json("/agents", signal)).agents)
      .map((item) => {
        const a = v.object(item)
        return {
          id: v.id(a.id),
          name: v.text(a.name),
          description:
            a.description === undefined ? undefined : v.text(a.description)
        }
      })
  }
  async create(agentId: string, signal?: AbortSignal) {
    const result = v.object(
      await this.json("/conversations", signal, { agentId })
    )
    if (result.agentId !== agentId)
      throw new Error("Conversation Agent binding mismatch")
    return { conversationId: v.id(result.conversationId), agentId }
  }
  async submit(
    conversationId: string,
    payload: MessagePayload,
    signal?: AbortSignal
  ) {
    const result = v.request(
      await this.json(
        `/conversations/${encodeURIComponent(conversationId)}/messages`,
        signal,
        payload
      )
    )
    if (
      result.requestId !== payload.requestId ||
      result.conversationId !== conversationId
    )
      throw new Error("Request binding mismatch")
    return result
  }
  async uploadAttachment(
    input: { name: string; mediaType: string; data: string },
    signal?: AbortSignal
  ) {
    return v.uploadedAttachment(
      await this.json("/attachments", signal, input)
    )
  }
  async request(
    requestId: string,
    conversationId: string,
    signal?: AbortSignal
  ) {
    const result = v.request(
      await this.json(`/requests/${encodeURIComponent(requestId)}`, signal)
    )
    if (
      result.requestId !== requestId ||
      result.conversationId !== conversationId
    )
      throw new Error("Request binding mismatch")
    return result
  }
  async messages(conversationId: string, signal?: AbortSignal) {
    const result = v.object(
      await this.json(
        `/conversations/${encodeURIComponent(conversationId)}/messages`,
        signal
      )
    )
    if (result.conversationId !== conversationId || result.complete !== true) {
      throw new Error("Complete authoritative conversation history is required")
    }
    const messages = v.list(result.messages).map(v.message)
    if (new Set(messages.map((m) => m.id)).size !== messages.length)
      throw new Error("Duplicate message identifiers")
    return messages
  }
  async approvals(signal?: AbortSignal) {
    return v
      .list(v.object(await this.json("/approvals", signal)).approvals)
      .map(v.approval)
  }
  async decide(
    approvalId: string,
    decision: { decisionId: string; approved: boolean; scope?: string },
    signal?: AbortSignal
  ) {
    const result = v.object(
      await this.json(
        `/approvals/${encodeURIComponent(approvalId)}/decision`,
        signal,
        decision
      )
    )
    if (
      result.decisionId !== decision.decisionId ||
      result.approvalId !== approvalId ||
      result.approved !== decision.approved ||
      (decision.approved && result.scope !== decision.scope) ||
      result.status !== "confirmed"
    ) {
      throw new Error(
        "Approval decision is not confirmed; reconcile before trying again"
      )
    }
  }
  async *events(
    requestId: string,
    signal: AbortSignal
  ): AsyncGenerator<OutputEvent> {
    const response = await this.fetch(
      `/requests/${encodeURIComponent(requestId)}/events`,
      signal,
      undefined,
      true
    )
    if (!response.body) throw new Error("Missing QwenPaw event stream")
    const snapshots = new Set<string>()
    for await (const frame of readSSE(response.body)) {
      const event = v.output(JSON.parse(frame.data))
      if (event.requestId !== requestId)
        throw new Error("Event request binding mismatch")
      if (event.type === "message.snapshot") snapshots.add(event.messageId)
      if (event.type === "message.delta" && !snapshots.has(event.messageId)) {
        throw new Error(
          "A new subscription must send a message snapshot before deltas"
        )
      }
      yield event
    }
  }
  async notifications(signal: AbortSignal, refresh: () => Promise<void>) {
    const response = await this.fetch("/events", signal, undefined, true)
    if (!response.body) throw new Error("Missing approval notification stream")
    for await (const frame of readSSE(response.body)) {
      const event = v.object(JSON.parse(frame.data))
      if (event.type !== "approvals.changed" && event.type !== "events.gap")
        throw new Error("Unsupported approval event")
      await refresh()
    }
    throw new Error("Approval notification stream disconnected")
  }
}
