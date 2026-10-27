import { useEffect, useRef, useState } from "react"
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Dropdown,
  Modal,
  Popover,
  Select,
  Space,
  Spin,
  Switch,
  Tooltip
} from "antd"
import {
  ChevronDown,
  Globe,
  StopCircleIcon,
  PlusIcon,
  EyeOffIcon,
  ImageIcon,
  PaperclipIcon,
  FileTextIcon,
  MicIcon,
  ShieldCheckIcon,
  BookIcon,
  ZapIcon,
  EyeIcon,
  X
} from "lucide-react"
import { useStorage } from "@plasmohq/storage/hook"
import { useQuery } from "@tanstack/react-query"
import { ChatModelMenu } from "@/components/Common/ChatModelMenu"
import { useTranslation } from "react-i18next"
import { useQwenPawChat } from "@/hooks/useQwenPawChat"
import { useQwenPawAgentName } from "@/hooks/useQwenPawAgentName"
import { useSmartScroll } from "@/hooks/useSmartScroll"
import useDynamicTextareaSize from "@/hooks/useDynamicTextareaSize"
import {
  useFocusShortcuts,
  useChatShortcuts,
  useSidebarShortcuts
} from "@/hooks/keyboard/useKeyboardShortcuts"
import { useWebUI } from "@/store/webui"
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition"
import { handleChatInputKeyDown } from "@/utils/key-down"
import { PlaygroundMessage } from "@/components/Common/Playground/Message"
import { RemoteMarkdownContext } from "@/components/Common/Markdown"
import {
  SidepanelComposerSurface,
  SidepanelTextarea,
  SidepanelComposerLayout,
  SidepanelComposerToolbar,
  SidepanelComposerActions,
  SidepanelSendButton,
  UnavailableComposerAction
} from "@/components/Sidepanel/Chat/composer"
import { RemoteSidepanelHeader } from "@/components/Sidepanel/Chat/header"
import pawIcon from "@/assets/qwenpaw-paw.png"
import { setMode } from "@/services/qwenpaw/config"
import { resolveAgentName } from "@/services/qwenpaw/agent-name"
import { capabilitiesOf } from "@/services/provider-capabilities"
import { getAllPrompts } from "@/db/dexie/helpers"
import { getVariable } from "@/utils/select-variable"
import { toBase64 } from "@/libs/to-base64"
import { getScreenshotFromCurrentTab } from "@/libs/get-screenshot"
import { dataUrlToFile } from "@/libs/qwenpaw/image-payload"
import {
  capture,
  truncateCapture,
  validateSnapshot
} from "@/libs/qwenpaw/page-context"
import type { PageSnapshot } from "@/libs/qwenpaw/page-context"
import type {
  PageContext,
  UploadedAttachment
} from "@/services/qwenpaw/types"

const noEdit = () => {}

// Local staging row for one picked file on its way to the channel server.
interface PendingAttachment {
  key: string
  name: string
  preview?: string
  state: "uploading" | "ready" | "failed"
  uploaded?: UploadedAttachment
}

export default function QwenPawSidebar() {
  const { t } = useTranslation("qwenpaw")
  const { t: common } = useTranslation("common")
  const { t: playground } = useTranslation("playground")
  const { t: option } = useTranslation("option")
  const [useCompactActions] = useStorage("optimizeQueueForSmallScreen", false)
  const customAgentName = useQwenPawAgentName()
  const chat = useQwenPawChat(customAgentName)
  const { sendWhenEnter, setSendWhenEnter, ttsEnabled } = useWebUI()
  const [speechToTextLanguage] = useStorage("speechToTextLanguage", "en-US")
  const {
    transcript,
    isListening,
    resetTranscript,
    start: startListening,
    stop: stopSpeechRecognition,
    supported: browserSupportsSpeechRecognition
  } = useSpeechRecognition()
  const [agentId, setAgentId] = useState<string>()
  const agentDisplayName = resolveAgentName(
    chat.conversation?.agentId || agentId,
    chat.session?.agents,
    customAgentName
  )
  const [question, setQuestion] = useState("")
  const [pendingAttachments, setPendingAttachments] = useState<
    PendingAttachment[]
  >([])
  const [shooting, setShooting] = useState(false)
  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [mode, setContextMode] = useState<"none" | "article" | "selection">(
    "none"
  )
  const [snapshot, setSnapshot] = useState<PageSnapshot>()
  const [confirmed, setConfirmed] = useState(false)
  const [stale, setStale] = useState(false)
  const [reading, setReading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [historyOpen, setHistoryOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [approvalOpen, setApprovalOpen] = useState(false)
  const [typing, setTyping] = useState(false)
  const [now, setNow] = useState(Date.now())
  const captureGeneration = useRef(0)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const limit = Math.min(30000, chat.session?.caps.maxContextChars || 30000)
  const unresolved =
    !!chat.activeRequest &&
    !["completed", "failed", "cancelled"].includes(chat.activeRequest.state)
  const processing =
    sending ||
    chat.busy ||
    (unresolved && chat.activeRequest?.state !== "unknown")
  const disabled =
    !chat.session ||
    chat.loading ||
    processing ||
    (!!chat.conversation && chat.locked)
  const { containerRef, isAutoScrollToBottom, autoScrollToBottom } =
    useSmartScroll(chat.messages, processing, 100, chat.conversation?.id)
  useDynamicTextareaSize(textarea, question, 200)
  useFocusShortcuts(textarea, true)
  // Dictation stays local: the transcript simply fills the textarea, and the
  // channel still ships plain text, so the size caps keep applying.
  useEffect(() => {
    if (!isListening) return
    const limit = chat.session?.caps.maxTextChars
    setQuestion(limit ? transcript.slice(0, limit) : transcript)
  }, [transcript, isListening, chat.session])
  const newChat = () => {
    if (agentId && !sending && !chat.busy) {
      setQuestion("")
      setError("")
      setContextMode("none")
      setSnapshot(undefined)
      setConfirmed(false)
      clearAttachments(pendingAttachments)
      setPendingAttachments([])
      chat.select(undefined)
    }
  }
  useChatShortcuts(newChat, true)
  useSidebarShortcuts(() => setHistoryOpen((open) => !open), true)

  useEffect(() => {
    setMode("remote").catch((e) => setError(String(e)))
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      clearInterval(timer)
      captureGeneration.current++
    }
  }, [])
  useEffect(() => {
    if (chat.conversation) setAgentId(chat.conversation.agentId)
    else if (chat.session?.agents.length === 1)
      setAgentId(chat.session.agents[0].id)
  }, [chat.session, chat.conversation?.agentId])
  useEffect(() => {
    captureGeneration.current++
    setSnapshot(undefined)
    setConfirmed(false)
    setStale(false)
  }, [chat.conversation?.id])
  useEffect(() => {
    if (!snapshot) return
    const invalidate = () => {
      setStale(true)
      setConfirmed(false)
    }
    const update = (
      tabId: number,
      change: { status?: string; url?: string }
    ) => {
      if (
        tabId === snapshot.tabId &&
        (change.url || change.status === "loading")
      )
        invalidate()
    }
    browser.tabs.onActivated.addListener(invalidate)
    browser.tabs.onUpdated.addListener(update)
    return () => {
      browser.tabs.onActivated.removeListener(invalidate)
      browser.tabs.onUpdated.removeListener(update)
    }
  }, [snapshot])

  const read = async () => {
    if (mode === "none") return
    const generation = ++captureGeneration.current
    setReading(true)
    setError("")
    setSnapshot(undefined)
    setConfirmed(false)
    try {
      let result: PageSnapshot
      try {
        result = await capture(mode, limit)
      } catch (e) {
        if (
          !(e instanceof Error) ||
          !e.message.startsWith("CONTEXT_TOO_LARGE:")
        )
          throw e
        const allowed = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            content: t("truncate", { limit }),
            onOk: () => resolve(true),
            onCancel: () => resolve(false)
          })
        })
        if (!allowed || generation !== captureGeneration.current) return
        result = await truncateCapture(mode, limit)
      }
      if (generation === captureGeneration.current) {
        setSnapshot(result)
        setStale(false)
      }
    } catch (e) {
      if (generation === captureGeneration.current) setError(String(e))
    } finally {
      setReading(false)
    }
  }
  // Uploads are staged immediately after picking: the composer only ever
  // sends attachment ids the server already confirmed it stored.
  const clearAttachments = (rows: PendingAttachment[]) =>
    rows.forEach((row) => row.preview && URL.revokeObjectURL(row.preview))
  const removeAttachment = (key: string) =>
    setPendingAttachments((rows) => {
      const row = rows.find((item) => item.key === key)
      if (row?.preview) URL.revokeObjectURL(row.preview)
      return rows.filter((item) => item.key !== key)
    })
  const addFiles = async (files: File[]) => {
    const session = chat.session
    if (!files.length) return
    if (!session?.caps.attachments || session.caps.maxAttachments <= 0) {
      setError(t("noAttachments"))
      return
    }
    setError("")
    let slots = session.caps.maxAttachments - pendingAttachments.length
    for (const file of files) {
      if (slots <= 0) {
        setError(
          t("attachmentLimit", { max: session.caps.maxAttachments })
        )
        break
      }
      slots--
      const maxBytes = session.caps.maxAttachmentBytes
      if (!file.size || file.size > maxBytes) {
        setError(
          t("attachmentTooLarge", {
            max: Math.max(1, Math.floor(maxBytes / 1024 / 1024))
          })
        )
        continue
      }
      const key = crypto.randomUUID()
      const preview = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined
      setPendingAttachments((rows) => [
        ...rows,
        { key, name: file.name, preview, state: "uploading" }
      ])
      try {
        const data = (await toBase64(file)).split(",")[1] ?? ""
        const uploaded = await session.client.uploadAttachment({
          name: file.name,
          mediaType: file.type,
          data
        })
        setPendingAttachments((rows) =>
          rows.map((row) =>
            row.key === key ? { ...row, state: "ready", uploaded } : row
          )
        )
      } catch (e) {
        setPendingAttachments((rows) =>
          rows.map((row) => (row.key === key ? { ...row, state: "failed" } : row))
        )
        setError(e instanceof Error ? e.message : String(e))
      }
    }
  }
  // A screenshot is just another image attachment: capture, rebuild as a
  // File, and the staging path enforces the same limits as picked files.
  const shoot = async () => {
    if (shooting) return
    setShooting(true)
    setError("")
    try {
      const result = await getScreenshotFromCurrentTab()
      if (!result.success || !result.screenshot)
        throw new Error(result.error || "Screenshot capture failed")
      await addFiles([
        dataUrlToFile(result.screenshot, `screenshot-${Date.now()}.png`)
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setShooting(false)
    }
  }
  const send = async () => {
    if (disabled || !agentId) return
    if (pendingAttachments.some((row) => row.state === "uploading")) {
      setError(t("attachmentUploading"))
      return
    }
    if (pendingAttachments.some((row) => row.state === "failed")) {
      setError(t("attachmentFailed"))
      return
    }
    const ready = pendingAttachments.filter((row) => row.uploaded)
    if (!question.trim() && !ready.length) return
    if (isListening) stopSpeechRecognition()
    setSending(true)
    setError("")
    try {
      let context: PageContext | undefined
      if (mode !== "none") {
        if (!snapshot || !confirmed || stale) {
          setContextOpen(true)
          throw new Error(t("confirmRequired"))
        }
        try {
          await validateSnapshot(snapshot)
        } catch (e) {
          setStale(true)
          setConfirmed(false)
          setContextOpen(true)
          throw e
        }
        context = snapshot.context
      }
      await chat.send(
        question,
        context,
        agentId,
        ready.map((row) => ({ attachmentId: row.uploaded!.attachmentId }))
      )
      clearAttachments(pendingAttachments)
      setPendingAttachments([])
      setQuestion("")
      setContextMode("none")
      setSnapshot(undefined)
      setConfirmed(false)
      setContextOpen(false)
      textarea.current?.focus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }
  const iconClass = "size-4 text-gray-500 dark:text-gray-400"
  const openContext = () => {
    if (mode === "none") setContextMode("article")
    setContextOpen(true)
  }
  // Only capabilities the remote channel lacks are advertised in the composer.
  // Uploads depend on the connected server: its advertised attachment limits
  // decide whether the image and paperclip buttons act or stay explained.
  // Screenshots ride the same attachment channel, so vision follows it too.
  const attachmentsSupported =
    chat.session?.caps.attachments === true &&
    chat.session.caps.maxAttachments > 0
  const capabilities = {
    ...capabilitiesOf("remote"),
    vision: attachmentsSupported,
    imageUpload: attachmentsSupported,
    fileUpload: attachmentsSupported
  }
  const unavailableActions = [
    ...(capabilities.vision
      ? []
      : [
          {
            label: playground("tooltip.vision"),
            reason: t("unavailableScreenshot"),
            icon: <EyeOffIcon className="size-4" />
          }
        ]),
    ...(capabilities.imageUpload
      ? []
      : [
          {
            label: playground("tooltip.uploadImage"),
            reason: t("unavailableImages"),
            icon: <ImageIcon className="size-4" />
          }
        ]),
    ...(capabilities.fileUpload
      ? []
      : [
          {
            label: t("uploadFile"),
            reason: t("unavailableFiles"),
            icon: <PaperclipIcon className="size-4" />
          }
        ])
  ]
  // Quick prompts are local templates that only fill the textarea; system
  // prompts stay unlisted because the remote Agent owns its system prompt.
  const { data: prompts } = useQuery({
    queryKey: ["getAllPromptsForSelect"],
    queryFn: getAllPrompts
  })
  const quickPrompts = prompts?.filter((prompt) => !prompt.is_system) ?? []
  const insertQuickPrompt = (content: string) => {
    setQuestion(content)
    const word = getVariable(content)
    if (word) {
      textarea.current?.focus()
      setTimeout(() => {
        textarea.current?.setSelectionRange(word.start, word.end)
      }, 100)
    }
  }
  // Approvals belong beside the composer actions: the transcript stays a
  // transcript, and a pending approval only lights up this button.
  const pendingApprovals = chat.approvals
  const approvalPanel = (
    <div className="flex max-h-80 w-72 max-w-[calc(100vw-3rem)] flex-col gap-2 overflow-y-auto">
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t("approvalNotice")}
      </p>
      {chat.approvalError && (
        <Alert type="warning" message={chat.approvalError} />
      )}
      {Object.keys(chat.decisions)
        .filter((id) => !pendingApprovals.some((a) => a.id === id))
        .map((id) => (
          <Alert
            key={id}
            type="warning"
            message={t("decisionUnknown")}
            description={id}
          />
        ))}
      {pendingApprovals.map((a) => {
        const valid =
          !chat.decidingId &&
          chat.approvalsFresh &&
          a.actionable &&
          !!a.tool.trim() &&
          !!a.target.trim() &&
          !!a.risk.trim() &&
          Date.parse(a.expiresAt) > now
        const previous = chat.decisions[a.id]
        return (
          <article
            key={a.id}
            className="flex flex-col gap-2 rounded border border-gray-200 p-2 text-xs dark:border-gray-700">
            <strong className="text-sm">
              {a.tool} · {a.agentId}
            </strong>
            {chat.decidingId === a.id && (
              <p role="status">{t("submitting")}</p>
            )}
            <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-1.5 dark:bg-[#303030]">
              {a.target}
            </pre>
            <p className="text-gray-600 dark:text-gray-300">{a.risk}</p>
            <p className="text-gray-400">
              {t("approvalExpiresAt", {
                time: new Date(a.expiresAt).toLocaleTimeString()
              })}
            </p>
            {!valid && <p className="text-amber-600">{t("expired")}</p>}
            {previous ? (
              <>
                <Alert type="warning" message={t("decisionUnknown")} />
                <Button
                  size="small"
                  disabled={!valid}
                  onClick={() =>
                    void chat.decide(a, previous.approved, previous.scope)
                  }>
                  {t("retryDecision")}
                </Button>
              </>
            ) : (
              <div className="flex flex-col gap-1.5">
                {a.scopes
                  .filter((s) => s.label.trim() && s.description.trim())
                  .map((scope) => (
                    <div key={scope.id} className="flex flex-col gap-1">
                      <p className="text-gray-500 dark:text-gray-400">
                        {scope.description}
                      </p>
                      <Button
                        size="small"
                        type="primary"
                        disabled={!valid}
                        onClick={() => void chat.decide(a, true, scope.id)}>
                        {t("approve")} — {scope.label}
                      </Button>
                    </div>
                  ))}
                <Button
                  size="small"
                  danger
                  disabled={!valid}
                  onClick={() => void chat.decide(a, false)}>
                  {t("reject")}
                </Button>
              </div>
            )}
          </article>
        )
      })}
      {chat.session?.config.consoleUrl && (
        <a
          className="text-xs underline"
          href={chat.session.config.consoleUrl}
          target="_blank"
          rel="noreferrer noopener">
          {t("consoleFallback")}
        </a>
      )}
    </div>
  )
  const composerOptions = (
    <div className="w-60 space-y-2">
      <div className="flex items-center justify-between rounded-lg border border-gray-200 px-2 py-1.5 dark:border-[#404040]">
        <span className="text-xs text-gray-600 dark:text-gray-300">
          {playground("sendWhenEnter")}
        </span>
        <Switch
          size="small"
          checked={sendWhenEnter}
          onChange={setSendWhenEnter}
        />
      </div>
      <Button block onClick={openContext}>
        {common("chatWithCurrentPage")}
      </Button>
      {unavailableActions.map((action) => (
        <div
          key={action.label}
          className="rounded-lg border border-gray-200 px-2 py-1.5 dark:border-[#404040]">
          <div className="flex items-center gap-2 text-gray-500">
            {action.icon}
            <span>
              {action.label} — {t("notAvailable")}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">{action.reason}</p>
        </div>
      ))}
    </div>
  )
  return (
    <RemoteMarkdownContext.Provider value>
      <main className="relative flex h-screen flex-col overflow-hidden bg-white text-sm text-gray-900 dark:bg-[#1a1a1a] dark:text-gray-100">
        <RemoteSidepanelHeader
          newChatDisabled={!agentId || sending || chat.busy}
          onNewChat={newChat}
          onHistory={() => setHistoryOpen(true)}
          onDetails={() => setDetailsOpen(true)}
        />
        <div
          ref={containerRef}
          className="custom-scrollbar relative mt-14 flex min-h-0 flex-1 flex-col items-center overflow-x-hidden overflow-y-auto px-5">
          <div className="flex w-full flex-col items-center py-4">
            {chat.loading && <Spin />}
            {(error || chat.error) && (
              <Alert
                className="mb-3 w-full"
                role="alert"
                type="error"
                showIcon
                message={t("error")}
                description={error || chat.error}
              />
            )}
            {!chat.session && !chat.loading && (
              <Alert type="info" message={t("unavailable")} />
            )}
            {chat.session && chat.messages.length === 0 && (
              <div className="flex min-h-[35vh] flex-col items-center justify-center gap-4 text-center">
                <img
                  src={pawIcon}
                  alt=""
                  className="size-12 object-contain opacity-80"
                />
                <h1 className="text-xl font-semibold">
                  {t("provider.remote")}
                </h1>
                <p className="max-w-xs text-gray-500 dark:text-gray-400">
                  {t("nativeWelcome")}
                </p>
              </div>
            )}
            {chat.messages.map((message, index) => (
              <article key={message.id} className="flex w-full justify-center">
                <PlaygroundMessage
                  message={message.content}
                  isBot={message.role === "assistant"}
                  name={
                    message.role === "assistant" ? agentDisplayName : "You"
                  }
                  modelImage={
                    message.role === "assistant" ? pawIcon : undefined
                  }
                  isLastMessage={index === chat.messages.length - 1}
                  actionIndex={index}
                  onEditFormSubmit={noEdit}
                  hideEditAndRegenerate
                  hideContinue
                  disableQuoteReply
                  isProcessing={false}
                  isStreaming={processing && index === chat.messages.length - 1}
                  isTTSEnabled={ttsEnabled}
                />
              </article>
            ))}
            {processing && (
              <p
                className="my-2 flex items-center gap-2 text-xs text-gray-500"
                role="status">
                <Spin size="small" />
                {chat.activeRequest
                  ? t(chat.activeRequest.state)
                  : t("loading")}
              </p>
            )}
          </div>
        </div>
        {!isAutoScrollToBottom && (
          <div className="pointer-events-none absolute bottom-40 left-0 right-0 z-20 flex justify-center">
            <button
              aria-label={t("scrollDown")}
              onClick={() => autoScrollToBottom()}
              className="pointer-events-auto rounded-full border border-gray-200 bg-gray-50 p-1.5 shadow dark:bg-[#303030]">
              <ChevronDown className={iconClass} />
            </button>
          </div>
        )}
        <div className="z-10 w-full shrink-0">
          <p aria-live="polite" className="sr-only">
            {chat.conversation
              ? chat.connected
                ? t("online")
                : t("cached")
              : t("remote")}
            {chat.activeRequest &&
              ` · ${t("state")}: ${t(chat.activeRequest.state)}`}
          </p>
          <SidepanelComposerLayout>
            <SidepanelComposerSurface>
              <form
                className="flex w-full flex-col px-1"
                onSubmit={(e) => {
                  e.preventDefault()
                  void send()
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  void addFiles(Array.from(e.dataTransfer.files))
                }}>
                {mode !== "none" && (
                  <button
                    type="button"
                    onClick={() => setContextOpen(true)}
                    className="mx-2 mt-2 flex max-w-full items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-100 px-2 py-1 text-left text-xs dark:border-[#525252] dark:bg-[#404040]">
                    <Globe className="size-4 shrink-0" />
                    <span className="truncate">
                      {snapshot?.context.title || t("context")}
                      {stale
                        ? ` · ${t("stale")}`
                        : !confirmed
                          ? ` · ${t("preview")}`
                          : ""}
                    </span>
                  </button>
                )}
                {pendingAttachments.length > 0 && (
                  <div className="mx-2 mt-2 flex flex-wrap gap-2">
                    {pendingAttachments.map((row) => (
                      <span
                        key={row.key}
                        className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-xs ${
                          row.state === "failed"
                            ? "border-red-300 text-red-500 dark:border-red-700"
                            : "border-neutral-200 dark:border-[#525252]"
                        }`}>
                        {row.preview ? (
                          <img
                            src={row.preview}
                            alt=""
                            className="size-6 rounded object-cover"
                          />
                        ) : (
                          <FileTextIcon className="size-4" />
                        )}
                        <span className="max-w-32 truncate">{row.name}</span>
                        {row.state === "uploading" && <Spin size="small" />}
                        <button
                          type="button"
                          aria-label={t("removeAttachment")}
                          onClick={() => removeAttachment(row.key)}
                          className="text-gray-500 hover:text-gray-700">
                          <X className="size-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <SidepanelTextarea
                  ref={textarea}
                  aria-label={t("question")}
                  placeholder={t("question")}
                  value={question}
                  disabled={disabled}
                  maxLength={chat.session?.caps.maxTextChars}
                  onChange={(e) => setQuestion(e.target.value)}
                  onCompositionStart={() => setTyping(true)}
                  onCompositionEnd={() => setTyping(false)}
                  onKeyDown={(e) => {
                    if (
                      e.nativeEvent.isComposing ||
                      e.key === "Process" ||
                      e.key === "229"
                    )
                      return
                    if (
                      handleChatInputKeyDown({
                        e,
                        typing,
                        sendWhenEnter,
                        isSending: disabled
                      })
                    ) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                  onPaste={(e) => {
                    if (e.clipboardData.files.length) {
                      e.preventDefault()
                      void addFiles(Array.from(e.clipboardData.files))
                    }
                  }}
                />
                <SidepanelComposerToolbar compact={useCompactActions}>
                  {useCompactActions && (
                    <Popover
                      trigger="click"
                      placement="topRight"
                      content={composerOptions}>
                      <Tooltip title={common("more", "More")}>
                        <button
                          type="button"
                          aria-label={common("more", "More")}
                          className="inline-flex items-center justify-center rounded-md border border-gray-300 p-1.5 dark:border-[#404040] dark:text-gray-300 md:hidden">
                          <PlusIcon className="size-4" />
                        </button>
                      </Tooltip>
                    </Popover>
                  )}
                  <SidepanelComposerActions compact={useCompactActions}>
                    {attachmentsSupported && (
                      <div
                        className={`items-center gap-3 ${useCompactActions ? "hidden md:flex" : "flex"}`}>
                        <Tooltip title={playground("tooltip.vision")}>
                          <button
                            type="button"
                            aria-label={playground("tooltip.vision")}
                            disabled={disabled || shooting}
                            onClick={() => void shoot()}
                            className="inline-flex items-center justify-center text-gray-600 dark:text-gray-300 disabled:opacity-40">
                            {shooting ? (
                              <Spin size="small" />
                            ) : (
                              <EyeIcon className="size-4" />
                            )}
                          </button>
                        </Tooltip>
                        <Tooltip title={playground("tooltip.uploadImage")}>
                          <button
                            type="button"
                            aria-label={playground("tooltip.uploadImage")}
                            disabled={disabled}
                            onClick={() => imageInput.current?.click()}
                            className="inline-flex items-center justify-center text-gray-600 dark:text-gray-300 disabled:opacity-40">
                            <ImageIcon className="size-4" />
                          </button>
                        </Tooltip>
                        <input
                          ref={imageInput}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            void addFiles(Array.from(e.target.files ?? []))
                            e.target.value = ""
                          }}
                        />
                        <Tooltip title={t("uploadFile")}>
                          <button
                            type="button"
                            aria-label={t("uploadFile")}
                            disabled={disabled}
                            onClick={() => fileInput.current?.click()}
                            className="inline-flex items-center justify-center text-gray-600 dark:text-gray-300 disabled:opacity-40">
                            <PaperclipIcon className="size-4" />
                          </button>
                        </Tooltip>
                        <input
                          ref={fileInput}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            void addFiles(Array.from(e.target.files ?? []))
                            e.target.value = ""
                          }}
                        />
                      </div>
                    )}
                    {browserSupportsSpeechRecognition && (
                      <Tooltip title={playground("tooltip.speechToText")}>
                        <button
                          type="button"
                          aria-label={playground("tooltip.speechToText")}
                          aria-pressed={isListening}
                          disabled={sending || reading}
                          onClick={() => {
                            if (isListening) {
                              stopSpeechRecognition()
                            } else {
                              resetTranscript()
                              startListening({
                                continuous: true,
                                lang: speechToTextLanguage
                              })
                            }
                          }}
                          className={`relative inline-flex items-center justify-center ${isListening ? "text-red-500" : "text-gray-600 dark:text-gray-300"}`}>
                          <MicIcon className="size-4" />
                          {isListening && (
                            <span className="absolute inline-flex size-2 animate-ping rounded-full bg-red-400 opacity-75" />
                          )}
                        </button>
                      </Tooltip>
                    )}
                    {quickPrompts.length > 0 && (
                      <Dropdown
                        trigger={["click"]}
                        placement="topLeft"
                        menu={{
                          items: quickPrompts.map((prompt) => ({
                            key: prompt.id,
                            label: (
                              <span className="inline-flex w-52 items-center gap-2 truncate text-sm">
                                <ZapIcon className="size-4 shrink-0" />
                                {prompt.title}
                              </span>
                            ),
                            onClick: () => insertQuickPrompt(prompt.content)
                          }))
                        }}>
                        <Tooltip title={option("selectAPrompt")}>
                          <button
                            type="button"
                            aria-label={option("selectAPrompt")}
                            disabled={disabled}
                            className="inline-flex items-center justify-center text-gray-600 dark:text-gray-300 disabled:opacity-40">
                            <BookIcon className="size-4" />
                          </button>
                        </Tooltip>
                      </Dropdown>
                    )}
                    <div
                      className={`items-center gap-3 ${useCompactActions ? "hidden md:flex" : "flex"}`}>
                      {unavailableActions.map((action) => (
                        <UnavailableComposerAction
                          key={action.label}
                          label={action.label}
                          reason={action.reason}>
                          {action.icon}
                        </UnavailableComposerAction>
                      ))}
                    </div>
                    {chat.session?.caps.approvals && (
                      <Popover
                        trigger="click"
                        placement="topLeft"
                        open={approvalOpen && pendingApprovals.length > 0}
                        onOpenChange={setApprovalOpen}
                        content={approvalPanel}>
                        <button
                          type="button"
                          aria-label={t("approvals")}
                          aria-haspopup="dialog"
                          aria-expanded={
                            approvalOpen && pendingApprovals.length > 0
                          }
                          disabled={pendingApprovals.length === 0}
                          title={
                            chat.approvalError
                              ? chat.approvalError
                              : pendingApprovals.length
                                ? t("approvalsPending", {
                                    count: pendingApprovals.length
                                  })
                                : t("noApprovals")
                          }
                          className={`relative inline-flex items-center justify-center rounded-md p-1 transition-colors ${pendingApprovals.length ? "bg-amber-100 text-amber-700 ring-1 ring-amber-400 dark:bg-amber-500/20 dark:text-amber-300" : "text-gray-400 dark:text-gray-500"}`}>
                          <ShieldCheckIcon className="size-4" />
                          {pendingApprovals.length > 0 && (
                            <span className="absolute -right-1 -top-1 inline-flex size-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-semibold leading-none text-white">
                              {pendingApprovals.length}
                            </span>
                          )}
                        </button>
                      </Popover>
                    )}
                    <Tooltip title={common("chatWithCurrentPage")}>
                      <button
                        type="button"
                        aria-label={common("chatWithCurrentPage")}
                        aria-pressed={mode !== "none"}
                        disabled={sending || reading}
                        onClick={openContext}
                        className={`inline-flex items-center justify-center ${mode !== "none" ? "text-blue-600 dark:text-blue-400" : "text-gray-600 dark:text-gray-300"}`}>
                        <FileTextIcon className="size-4" />
                      </button>
                    </Tooltip>
                    <ChatModelMenu
                      label={`${t("agent")}${agentId ? `: ${agentDisplayName}` : ""}${chat.conversation ? ` — ${t("agentBound")}` : ""}`}
                      iconClassName="size-4"
                      selectedKey={agentId}
                      disabled={
                        processing || !!chat.conversation || !chat.session
                      }
                      items={chat.session?.agents.map((a) => ({
                        key: a.id,
                        label: (
                          <span className="inline-flex w-52 items-center gap-2 truncate text-lg">
                            {resolveAgentName(
                              a.id,
                              chat.session?.agents,
                              customAgentName
                            )}
                          </span>
                        ),
                        title: a.description,
                        onClick: () => setAgentId(a.id)
                      }))}
                    />
                    {unresolved && chat.activeRequest?.state !== "unknown" && (
                      <Tooltip title={t("notCancel")}>
                        <button
                          type="button"
                          aria-label={t("disconnect")}
                          onClick={chat.disconnect}
                          className="rounded-md border border-gray-300 p-1 dark:border-[#404040]">
                          <StopCircleIcon className="size-5" />
                        </button>
                      </Tooltip>
                    )}
                    <SidepanelSendButton
                      optionsLabel={common("more", "More")}
                      compact={useCompactActions}
                      disabled={
                        disabled ||
                        (!question.trim() &&
                          !pendingAttachments.some((row) => row.uploaded)) ||
                        !agentId ||
                        reading
                      }
                      menuDisabled={!chat.session || sending || reading}
                      label={common("submit")}
                      sendWhenEnter={sendWhenEnter}
                      menuItems={[
                        {
                          key: "enter",
                          label: (
                            <Checkbox
                              checked={sendWhenEnter}
                              onChange={(e) =>
                                setSendWhenEnter(e.target.checked)
                              }>
                              {playground("sendWhenEnter")}
                            </Checkbox>
                          )
                        },
                        {
                          key: "page",
                          label: (
                            <Checkbox
                              checked={mode !== "none"}
                              onChange={(e) => {
                                if (e.target.checked) openContext()
                                else {
                                  captureGeneration.current++
                                  setContextMode("none")
                                  setSnapshot(undefined)
                                  setConfirmed(false)
                                }
                              }}>
                              {common("chatWithCurrentPage")}
                            </Checkbox>
                          )
                        },
                        {
                          key: "ocr",
                          label: (
                            <Tooltip title={t("unavailableScreenshot")}>
                              <span>
                                <Checkbox disabled>
                                  {playground("useOCR")} — {t("notAvailable")}
                                </Checkbox>
                              </span>
                            </Tooltip>
                          )
                        }
                      ]}
                    />
                  </SidepanelComposerActions>
                </SidepanelComposerToolbar>
              </form>
            </SidepanelComposerSurface>
          </SidepanelComposerLayout>
        </div>
        <Drawer
          title={t("conversation")}
          placement="left"
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}>
          <div className="flex flex-col gap-3">
            <Button
              disabled={!agentId || sending || chat.busy}
              onClick={() => {
                newChat()
                setHistoryOpen(false)
              }}>
              {t("newChat")}
            </Button>
            {chat.conversations.map((c) => (
              <button
                key={c.id}
                data-conversation-id={c.conversationId}
                disabled={sending || chat.busy}
                onClick={() => {
                  chat.select(c)
                  setAgentId(c.agentId)
                  setHistoryOpen(false)
                }}
                className={`rounded-lg border p-3 text-left hover:bg-gray-50 dark:hover:bg-[#303030] ${c.id === chat.conversation?.id ? "border-gray-500" : "border-gray-200 dark:border-gray-700"}`}>
                <span className="block truncate">
                  {c.title && c.title !== c.agentId
                    ? c.title
                    : resolveAgentName(
                        c.agentId,
                        chat.session?.agents,
                        customAgentName
                      )}
                </span>
                <span className="text-xs text-gray-500">
                  {resolveAgentName(
                    c.agentId,
                    chat.session?.agents,
                    customAgentName
                  )}{" "}
                  · {c.conversationId.slice(0, 8)}
                </span>
              </button>
            ))}
          </div>
        </Drawer>
        <Drawer
          title={t("connectionDetails")}
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}>
          <div className="flex flex-col gap-3 text-sm">
            <p className="break-all">{chat.session?.config.baseUrl}</p>
            {chat.session && !chat.session.caps.recovery && (
              <Alert type="info" message={t("channelPreview")} />
            )}
            <p>{t("notCancel")}</p>
            <p>{t("nativeLimitations")}</p>
            <Switch
              checked={sendWhenEnter}
              onChange={setSendWhenEnter}
              checkedChildren={t("enterSend")}
              unCheckedChildren={t("enterNewline")}
            />
            {chat.conversation && (
              <Space wrap>
                <Button
                  disabled={sending || chat.busy}
                  onClick={chat.reconcile}>
                  {t("reconcile")}
                </Button>
                <Button
                  disabled={sending || chat.busy}
                  onClick={chat.disconnect}>
                  {t("disconnect")}
                </Button>
                <Button
                  disabled={chat.locked || sending}
                  onClick={() =>
                    Modal.confirm({
                      content: t("removeConfirm"),
                      onOk: chat.remove
                    })
                  }>
                  {t("remove")}
                </Button>
              </Space>
            )}
            <p>{t("retention")}</p>
            <p>{t("creating")}</p>
          </div>
        </Drawer>
        <Modal
          title={t("context")}
          open={contextOpen}
          onCancel={() => setContextOpen(false)}
          footer={
            <Button onClick={() => setContextOpen(false)}>{t("back")}</Button>
          }>
          <section className="flex flex-col gap-3">
            <p>{t("freshness")}</p>
            <Select
              aria-label={t("context")}
              value={mode}
              disabled={sending || reading}
              options={["none", "article", "selection"].map((value) => ({
                value,
                label: t(value)
              }))}
              onChange={(value) => {
                captureGeneration.current++
                setContextMode(value)
                setSnapshot(undefined)
                setConfirmed(false)
                setStale(false)
              }}
            />
            {mode !== "none" && (
              <Button
                loading={reading}
                disabled={sending}
                onClick={() => void read()}>
                {t("read")}
              </Button>
            )}
            {stale && <Alert type="warning" message={t("stale")} />}
            {snapshot && (
              <>
                <h3>{t("preview")}</h3>
                <p className="break-all">
                  {snapshot.context.title}
                  <br />
                  {snapshot.context.url}
                </p>
                <p>
                  {snapshot.context.capturedAt} ·{" "}
                  {t("size", { count: snapshot.context.content.length })}
                  {snapshot.context.truncated && ` · ${t("truncated")}`}
                </p>
                <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-100 p-2 dark:bg-gray-800">
                  {snapshot.context.content}
                </pre>
                <Checkbox
                  checked={confirmed}
                  disabled={stale || sending}
                  onChange={(e) => setConfirmed(e.target.checked)}>
                  {t("confirm")}
                </Checkbox>
                <Button
                  onClick={() => {
                    captureGeneration.current++
                    setSnapshot(undefined)
                    setConfirmed(false)
                    setContextMode("none")
                  }}>
                  {t("clear")}
                </Button>
              </>
            )}
            {error && <Alert role="alert" type="error" message={error} />}
          </section>
        </Modal>
      </main>
    </RemoteMarkdownContext.Provider>
  )
}
