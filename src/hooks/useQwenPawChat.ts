import { useCallback, useEffect, useRef, useState } from "react"
import { Storage } from "@plasmohq/storage"
import { loadConnection } from "@/services/qwenpaw/config"
import { QwenPawClient, RemoteHTTPError } from "@/services/qwenpaw/client"
import { CONFIG_KEY, CREDENTIAL_KEY } from "@/services/qwenpaw/privacy"
import { applyMessageEvent } from "@/services/qwenpaw/reducer"
import { resolveAgentName } from "@/services/qwenpaw/agent-name"
import { linkedController } from "@/services/qwenpaw/abort"
import * as repo from "@/services/qwenpaw/repository"
import { isTerminal } from "@/services/qwenpaw/types"
import type {
  Agent,
  Approval,
  AttachmentRef,
  Capabilities,
  Connection,
  Conversation,
  PageContext,
  RemoteMessage,
  StoredRequest
} from "@/services/qwenpaw/types"

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error)
const delay = (signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const done = () => {
      signal.removeEventListener("abort", abort)
      resolve()
    }
    const timer = setTimeout(done, 1500)
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    if (signal.aborted) {
      clearTimeout(timer)
      reject(signal.reason)
    } else signal.addEventListener("abort", abort, { once: true })
  })
interface Session {
  client: QwenPawClient
  config: Connection
  caps: Capabilities
  agents: Agent[]
}
interface Decision {
  decisionId: string
  approved: boolean
  scope?: string
}

export function useQwenPawChat(agentDisplayName = "") {
  const [session, setSession] = useState<Session>()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversation, setConversation] = useState<Conversation>()
  const [messages, setMessages] = useState<RemoteMessage[]>([])
  const [activeRequest, setActiveRequest] = useState<StoredRequest>()
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [approvalsFresh, setApprovalsFresh] = useState(false)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [decidingId, setDecidingId] = useState<string>()
  const [error, setError] = useState("")
  const [approvalError, setApprovalError] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const operation = useRef(false)
  const lifetime = useRef<AbortController>()
  const stream = useRef<AbortController>()
  const requestRef = useRef<StoredRequest>()
  const freshRequest = useRef<string>()
  const mounted = useRef(true)
  const decisionLock = useRef(false)
  const approvalState = useRef<{ rows: Approval[]; fresh: boolean }>({
    rows: [],
    fresh: false
  })
  const storage = useRef(new Storage({ area: "local" }))

  const report = useCallback((e: unknown) => {
    if (mounted.current) setError(errorText(e))
  }, [])
  const reloadConversations = useCallback(async (s: Session) => {
    const rows = await repo.conversations(
      s.config.id,
      s.caps.instanceId,
      s.caps.principalScope
    )
    if (!lifetime.current?.signal.aborted) setConversations(rows)
    return rows
  }, [])

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    lifetime.current = controller
    const invalidate = () => {
      controller.abort()
      stream.current?.abort()
      setSession(undefined)
      setConversation(undefined)
      setMessages([])
      setApprovals([])
      setApprovalsFresh(false)
      approvalState.current = { rows: [], fresh: false }
      setError(
        "Connection changed. Reopen QwenPaw to authenticate the new scope."
      )
    }
    const settings = storage.current
    settings.watch({ [CONFIG_KEY]: invalidate, [CREDENTIAL_KEY]: invalidate })
    void (async () => {
      try {
        const saved = await loadConnection()
        if (!saved)
          throw new Error(
            "Configure the QwenPaw service and browser credential first."
          )
        const client = new QwenPawClient(saved.config, saved.token)
        const [caps, agents] = await Promise.all([
          client.capabilities(controller.signal),
          client.agents(controller.signal)
        ])
        if (controller.signal.aborted) return
        const s = { client, config: saved.config, caps, agents }
        await repo.pruneCache()
        const rows = await reloadConversations(s)
        if (controller.signal.aborted) return
        setSession(s)
        setConversation(rows[0])
      } catch (e) {
        if (!controller.signal.aborted) report(e)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => {
      mounted.current = false
      controller.abort()
      stream.current?.abort()
      settings.unwatch({
        [CONFIG_KEY]: invalidate,
        [CREDENTIAL_KEY]: invalidate
      })
    }
  }, [reloadConversations, report])

  const refreshApprovals = useCallback(
    async (s: Session, signal: AbortSignal) => {
      if (!s.caps.approvals) return
      try {
        const rows = await s.client.approvals(signal)
        const saved: Record<string, Decision> = {}
        const prefix = `qwenpaw.decision.${s.config.id}.`
        const keys = Object.keys(await browser.storage.local.get()).filter(
          (key) => key.startsWith(prefix)
        )
        for (const key of keys) {
          const decision = await storage.current.get<Decision>(key)
          if (decision) saved[key.slice(prefix.length)] = decision
        }
        if (!signal.aborted) {
          approvalState.current = { rows, fresh: true }
          setApprovals(rows)
          setDecisions(saved)
          setApprovalsFresh(true)
          setApprovalError("")
        }
      } catch (e) {
        if (!signal.aborted) {
          approvalState.current.fresh = false
          setApprovalsFresh(false)
          setApprovalError(errorText(e))
        }
        throw e
      }
    },
    []
  )

  useEffect(() => {
    if (!session?.caps.approvals) return
    const controller = linkedController(lifetime.current.signal)
    const signal = controller.signal
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        await refreshApprovals(session, signal)
      } catch (e) {
        if (!signal.aborted) setApprovalError(errorText(e))
      }
      if (!signal.aborted) timer = setTimeout(poll, 5000)
    }
    void poll()
    if (session.caps.approvalEvents) {
      void (async () => {
        while (!signal.aborted) {
          try {
            await session.client.notifications(signal, () => {
              approvalState.current.fresh = false
              setApprovalsFresh(false)
              return refreshApprovals(session, signal)
            })
          } catch (e) {
            if (signal.aborted) return
            setApprovalsFresh(false)
            approvalState.current.fresh = false
            setApprovalError(errorText(e))
            try {
              await delay(signal)
            } catch {
              return
            }
          }
        }
      })()
    }
    return () => {
      controller.abort()
      clearTimeout(timer)
      approvalState.current.fresh = false
      setApprovalsFresh(false)
    }
  }, [session, refreshApprovals])

  useEffect(() => {
    setMessages([])
    setActiveRequest(undefined)
    requestRef.current = undefined
    setConnected(false)
    if (!session || !conversation) return
    const controller = linkedController(lifetime.current.signal)
    stream.current?.abort()
    stream.current = controller
    const signal = controller.signal
    const c = conversation
    const s = session
    setBusy(true)
    setError("")
    void (async () => {
      try {
        const cached = await repo.messages(c.id)
        if (!signal.aborted) setMessages(cached)
        const stored = await repo.requests(c.id)
        const pending = stored.filter((r) => !isTerminal(r.state))
        if (pending.length > 1)
          throw new Error(
            "Multiple unresolved requests; recovery requires server reconciliation"
          )
        let record = pending[0] || stored[stored.length - 1]
        if (record) {
          requestRef.current = record
          if (!signal.aborted) setActiveRequest(record)
          if (!isTerminal(record.state)) {
            if (!s.caps.recovery && freshRequest.current !== record.requestId) {
              throw new Error(
                "Server does not support recovery; request outcome is unknown"
              )
            }
            if (s.caps.recovery) {
              const remote = await s.client.request(
                record.requestId,
                c.conversationId,
                signal
              )
              record = { ...record, ...remote, submission: "accepted" }
              await repo.saveRequest(record)
            }
          }
          freshRequest.current = undefined
          requestRef.current = record
          if (!signal.aborted) setActiveRequest(record)
        }
        const history = await s.client.messages(c.conversationId, signal)
        await repo.replaceMessages(c.id, history)
        if (signal.aborted) return
        setMessages(history)
        if (record && !isTerminal(record.state) && record.state !== "unknown") {
          setBusy(false)
          await follow(s, c, record, history, signal)
        } else {
          setConnected(true)
        }
      } catch (e) {
        if (!signal.aborted) report(e)
      } finally {
        if (!signal.aborted) setBusy(false)
      }
    })()
    return () => controller.abort()
  }, [session, conversation, refreshKey, report])

  async function follow(
    s: Session,
    c: Conversation,
    record: StoredRequest,
    initial: RemoteMessage[],
    signal: AbortSignal
  ) {
    let visible = initial
    let lastWrite = 0
    for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
      try {
        setConnected(true)
        let terminal: StoredRequest["state"] | undefined
        for await (const event of s.client.events(record.requestId, signal)) {
          if (signal.aborted) return
          if (event.type === "request.error")
            throw new Error(`${event.code}: ${event.message}`)
          if (
            event.type === "message.delta" ||
            event.type === "message.snapshot"
          ) {
            visible = applyMessageEvent(visible, event)
            setMessages(visible)
            if (Date.now() - lastWrite > 500) {
              await repo.replaceMessages(c.id, visible)
              lastWrite = Date.now()
            }
          }
          if (event.type === "request.state") {
            // Terminal confirmation follows the final message snapshots.
            if (isTerminal(event.state)) continue
            record = { ...record, state: event.state }
            await repo.saveRequest(record)
            if (signal.aborted) return
            requestRef.current = record
            setActiveRequest(record)
          }
          if (event.type === "request.terminal") {
            terminal = event.state
            break
          }
        }
        if (signal.aborted) return
        if (!s.caps.recovery && terminal !== undefined) {
          if (!isTerminal(terminal) && terminal !== "unknown")
            throw new Error("Invalid terminal confirmation from channel")
          record = { ...record, state: terminal }
          await repo.replaceMessages(c.id, visible)
          await repo.saveRequest(record)
          if (signal.aborted) return
          requestRef.current = record
          setActiveRequest(record)
          setError("")
          return
        }
        if (!s.caps.recovery)
          throw new Error(
            "Stream closed; recovery unavailable. Outcome is unknown."
          )
        const remote = await s.client.request(
          record.requestId,
          c.conversationId,
          signal
        )
        record = { ...record, ...remote }
        const history = await s.client.messages(c.conversationId, signal)
        visible = history
        await repo.replaceMessages(c.id, history)
        await repo.saveRequest(record)
        if (signal.aborted) return
        requestRef.current = record
        setActiveRequest(record)
        setMessages(history)
        setError("")
        if (isTerminal(record.state) || record.state === "unknown") return
        throw new Error(
          "Output stream ended without an authoritative terminal state"
        )
      } catch (e) {
        if (signal.aborted) return
        setConnected(false)
        report(e)
        await repo.replaceMessages(c.id, visible)
        if (
          (e instanceof RemoteHTTPError &&
            [401, 403, 404].includes(e.status)) ||
          !s.caps.recovery
        )
          break
        try {
          const remote = await s.client.request(
            record.requestId,
            c.conversationId,
            signal
          )
          record = { ...record, ...remote }
          const history = await s.client.messages(c.conversationId, signal)
          visible = history
          await repo.replaceMessages(c.id, history)
          await repo.saveRequest(record)
          if (signal.aborted) return
          requestRef.current = record
          setActiveRequest(record)
          setMessages(history)
          if (isTerminal(record.state)) {
            setError("")
            return
          }
          if (record.state === "unknown") return
        } catch (recoveryError) {
          if (signal.aborted) return
          report(recoveryError)
          if (
            recoveryError instanceof RemoteHTTPError &&
            [401, 403, 404].includes(recoveryError.status)
          )
            break
        }
        if (attempt < 2) await delay(signal)
      }
    }
    if (!signal.aborted) setConnected(false)
    if (!signal.aborted) {
      const uncertain: StoredRequest = { ...record, state: "unknown" }
      await repo.saveRequest(uncertain)
      if (signal.aborted) return
      requestRef.current = uncertain
      setActiveRequest(uncertain)
    }
  }

  async function create(agentId: string) {
    if (operation.current) return
    if (!session || !session.agents.some((a) => a.id === agentId)) {
      report(
        new Error("Select an authorized Agent before creating a conversation")
      )
      return
    }
    operation.current = true
    setBusy(true)
    setError("")
    try {
      const remote = await session.client.create(
        agentId,
        lifetime.current.signal
      )
      const c: Conversation = {
        ...remote,
        id: crypto.randomUUID(),
        connectionId: session.config.id,
        principalScope: session.caps.principalScope,
        instanceId: session.caps.instanceId,
        title: resolveAgentName(agentId, session.agents, agentDisplayName),
        updatedAt: Date.now()
      }
      try {
        await repo.saveConversation(c)
      } catch (e) {
        throw new Error(
          `Conversation ${c.conversationId} was created but caching failed; do not create again automatically. ${errorText(e)}`
        )
      }
      if (lifetime.current.signal.aborted) return
      await reloadConversations(session)
      setConversation(c)
      return c
    } catch (e) {
      const failure = new Error(
        `Conversation creation was not confirmed locally. Check the service before retrying. ${errorText(e)}`
      )
      report(failure)
      throw failure
    } finally {
      operation.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function send(
    value: string,
    pageContext?: PageContext,
    agentId?: string,
    attachments?: AttachmentRef[]
  ) {
    if (!session || operation.current)
      throw new Error("Connection is not ready")
    if (lifetime.current.signal.aborted) throw new Error("Connection is closed")
    if (requestRef.current && !isTerminal(requestRef.current.state))
      throw new Error("Request unresolved; reconcile before sending")
    if (
      (!value.trim() && !attachments?.length) ||
      value.length > session.caps.maxTextChars
    )
      throw new Error("Question is empty or exceeds the server limit")
    const target = conversation || (agentId ? await create(agentId) : undefined)
    if (!target) throw new Error("Select an Agent to start a conversation")
    operation.current = true
    setBusy(true)
    setError("")
    const signal = lifetime.current.signal
    let record: StoredRequest | undefined
    try {
      record = await repo.prepare(target, {
        requestId: crypto.randomUUID(),
        text: value,
        ...(pageContext ? { pageContext } : {}),
        ...(attachments?.length ? { attachments } : {})
      })
      requestRef.current = record
      setActiveRequest(record)
      const remote = await session.client.submit(
        target.conversationId,
        record.payload,
        signal
      )
      record = { ...record, ...remote, submission: "accepted" }
      await repo.saveRequest(record)
      if (signal.aborted) return
      requestRef.current = record
      setActiveRequest(record)
      freshRequest.current = record.requestId
      await reloadConversations(session)
      setRefreshKey((k) => k + 1)
    } catch (e) {
      if (record) {
        const uncertain: StoredRequest = {
          ...record,
          submission: "uncertain",
          state: "unknown"
        }
        await repo.saveRequest(uncertain)
        requestRef.current = uncertain
        if (!signal.aborted) setActiveRequest(uncertain)
      }
      report(e)
      throw e
    } finally {
      operation.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function decide(a: Approval, approved: boolean, scope?: string) {
    if (!session || decisionLock.current) return
    decisionLock.current = true
    setDecidingId(a.id)
    setApprovalsFresh(false)
    const latest = approvalState.current.rows.find((row) => row.id === a.id)
    const wasFresh = approvalState.current.fresh
    approvalState.current.fresh = false
    const key = `qwenpaw.decision.${session.config.id}.${a.id}`
    try {
      if (
        !wasFresh ||
        !latest ||
        !latest.actionable ||
        Date.parse(latest.expiresAt) <= Date.now() ||
        latest.conversationId !== a.conversationId ||
        latest.requestId !== a.requestId ||
        latest.agentId !== a.agentId ||
        latest.tool !== a.tool ||
        latest.target !== a.target ||
        latest.risk !== a.risk ||
        JSON.stringify(latest.scopes) !== JSON.stringify(a.scopes) ||
        (approved && !latest.scopes.some((s) => s.id === scope))
      ) {
        throw new Error(
          "Approval changed or expired; reconcile trusted details before deciding"
        )
      }
      const existing = await storage.current.get<Decision>(key)
      const decision: Decision = existing || {
        decisionId: crypto.randomUUID(),
        approved,
        ...(approved ? { scope } : {})
      }
      if (
        existing &&
        (existing.approved !== approved || existing.scope !== scope)
      )
        throw new Error(
          "Previous decision outcome is unknown; only retry the same decision"
        )
      await storage.current.set(key, decision)
      setDecisions((d) => ({ ...d, [a.id]: decision }))
      await session.client.decide(a.id, decision, lifetime.current.signal)
      await storage.current.remove(key)
      await refreshApprovals(session, lifetime.current.signal)
    } catch (e) {
      setApprovalError(errorText(e))
      // A lost response is not evidence of rejection or approval.
      try {
        await refreshApprovals(session, lifetime.current.signal)
      } catch (refreshError) {
        setApprovalError(errorText(refreshError))
      }
      setApprovalError(errorText(e))
    } finally {
      decisionLock.current = false
      if (mounted.current) setDecidingId(undefined)
    }
  }

  async function remove() {
    if (!conversation || !session) return
    try {
      await repo.removeCache(conversation.id)
      const rows = await reloadConversations(session)
      setConversation(rows[0])
    } catch (e) {
      report(e)
    }
  }
  return {
    session,
    conversations,
    conversation,
    messages,
    activeRequest,
    approvals,
    approvalsFresh,
    decisions,
    decidingId,
    error,
    approvalError,
    loading,
    busy,
    connected,
    create,
    send,
    decide,
    remove,
    select: (c?: Conversation) => {
      if (!operation.current) {
        setError("")
        setConversation(c)
      }
    },
    reconcile: () => {
      stream.current?.abort()
      setRefreshKey((k) => k + 1)
    },
    disconnect: () => {
      stream.current?.abort()
      setConnected(false)
      setBusy(false)
    },
    locked:
      !connected ||
      busy ||
      (!!activeRequest && !isTerminal(activeRequest.state))
  }
}
