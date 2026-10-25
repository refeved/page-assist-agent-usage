import { useEffect, useRef, useState } from "react"
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
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
  MicIcon
} from "lucide-react"
import { useStorage } from "@plasmohq/storage/hook"
import { ChatModelMenu } from "@/components/Common/ChatModelMenu"
import { useTranslation } from "react-i18next"
import { useQwenPawChat } from "@/hooks/useQwenPawChat"
import { useSmartScroll } from "@/hooks/useSmartScroll"
import useDynamicTextareaSize from "@/hooks/useDynamicTextareaSize"
import {
  useFocusShortcuts,
  useChatShortcuts,
  useSidebarShortcuts
} from "@/hooks/keyboard/useKeyboardShortcuts"
import { useWebUI } from "@/store/webui"
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
import { capabilitiesOf } from "@/services/provider-capabilities"
import {
  capture,
  truncateCapture,
  validateSnapshot
} from "@/libs/qwenpaw/page-context"
import type { PageSnapshot } from "@/libs/qwenpaw/page-context"
import type { PageContext } from "@/services/qwenpaw/types"

const noEdit = () => {}

export default function QwenPawSidebar() {
  const { t } = useTranslation("qwenpaw")
  const { t: common } = useTranslation("common")
  const { t: playground } = useTranslation("playground")
  const [useCompactActions] = useStorage("optimizeQueueForSmallScreen", false)
  const chat = useQwenPawChat()
  const { sendWhenEnter, setSendWhenEnter } = useWebUI()
  const [agentId, setAgentId] = useState<string>()
  const [question, setQuestion] = useState("")
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
  const newChat = () => {
    if (agentId && !sending && !chat.busy) {
      setQuestion("")
      setError("")
      setContextMode("none")
      setSnapshot(undefined)
      setConfirmed(false)
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
  const send = async () => {
    if (disabled || !question.trim() || !agentId) return
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
      await chat.send(question, context, agentId)
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
  const capabilities = capabilitiesOf("remote")
  const unavailableActions = [
    ...(capabilities.speechToText
      ? []
      : [
          {
            label: playground("tooltip.speechToText"),
            reason: t("unavailableSpeech"),
            icon: <MicIcon className="size-4" />
          }
        ]),
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
                    message.role === "assistant"
                      ? chat.conversation?.agentId || "QwenPaw"
                      : "You"
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
                  isTTSEnabled={false}
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
            {chat.session?.caps.approvals && (
              <section className="flex w-full flex-col gap-2 border-t pt-3 dark:border-gray-700">
                <h2>{t("approvals")}</h2>
                <p>{t("approvalNotice")}</p>
                {chat.approvalError && (
                  <Alert type="warning" message={chat.approvalError} />
                )}
                {Object.keys(chat.decisions)
                  .filter((id) => !chat.approvals.some((a) => a.id === id))
                  .map((id) => (
                    <Alert
                      key={id}
                      type="warning"
                      message={t("decisionUnknown")}
                      description={id}
                    />
                  ))}
                {chat.approvals.map((a) => {
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
                      className="flex flex-col gap-2 rounded border p-2 dark:border-gray-700">
                      <strong>
                        {a.tool} · {a.agentId}
                      </strong>
                      {chat.decidingId === a.id && (
                        <p role="status">{t("submitting")}</p>
                      )}
                      <p className="break-all">
                        {a.conversationId} / {a.requestId}
                      </p>
                      <pre className="whitespace-pre-wrap break-words">
                        {a.target}
                      </pre>
                      <p>{a.risk}</p>
                      <p>{a.expiresAt}</p>
                      {!valid && <p>{t("expired")}</p>}
                      {previous ? (
                        <>
                          <Alert
                            type="warning"
                            message={t("decisionUnknown")}
                          />
                          <Button
                            disabled={!valid}
                            onClick={() =>
                              void chat.decide(
                                a,
                                previous.approved,
                                previous.scope
                              )
                            }>
                            {t("retryDecision")}
                          </Button>
                        </>
                      ) : (
                        <>
                          {a.scopes
                            .filter(
                              (s) => s.label.trim() && s.description.trim()
                            )
                            .map((scope) => (
                              <div key={scope.id}>
                                <p>{scope.description}</p>
                                <Button
                                  disabled={!valid}
                                  onClick={() =>
                                    Modal.confirm({
                                      title: scope.label,
                                      content: `${scope.description}\n${t("approvalNotice")}`,
                                      onOk: () => chat.decide(a, true, scope.id)
                                    })
                                  }>
                                  {t("approve")} — {scope.label}
                                </Button>
                              </div>
                            ))}
                          <Button
                            danger
                            disabled={!valid}
                            onClick={() => void chat.decide(a, false)}>
                            {t("reject")}
                          </Button>
                        </>
                      )}
                    </article>
                  )
                })}
                {chat.session.config.consoleUrl && (
                  <a
                    href={chat.session.config.consoleUrl}
                    target="_blank"
                    rel="noreferrer noopener">
                    {t("consoleFallback")}
                  </a>
                )}
              </section>
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
                  setError(t("noAttachments"))
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
                      setError(t("noAttachments"))
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
                      label={`${t("agent")}${agentId ? `: ${chat.session?.agents.find((a) => a.id === agentId)?.name || agentId}` : ""}${chat.conversation ? ` — ${t("agentBound")}` : ""}`}
                      iconClassName="size-4"
                      selectedKey={agentId}
                      disabled={
                        processing || !!chat.conversation || !chat.session
                      }
                      items={chat.session?.agents.map((a) => ({
                        key: a.id,
                        label: (
                          <span className="inline-flex w-52 items-center gap-2 truncate text-lg">
                            {a.name}
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
                        disabled || !question.trim() || !agentId || reading
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
                <span className="block truncate">{c.title}</span>
                <span className="text-xs text-gray-500">
                  {c.agentId} · {c.conversationId.slice(0, 8)}
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
