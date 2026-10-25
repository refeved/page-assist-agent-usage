import { SidepanelHeaderFrame } from "./header-frame"
import { useMessage } from "~/hooks/useMessage"
import { Link } from "react-router-dom"
import { Tooltip, Drawer, notification } from "antd"
import {
  BoxesIcon,
  BrainCog,
  CogIcon,
  EraserIcon,
  // EraserIcon,
  HistoryIcon,
  InfoIcon,
  PlusSquare,
  XIcon,
  MessageSquareShareIcon
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { CurrentChatModelSettings } from "@/components/Common/Settings/CurrentChatModelSettings"
import React from "react"
import { useStorage } from "@plasmohq/storage/hook"
import { PromptSelect } from "@/components/Common/PromptSelect"
import { Sidebar } from "@/components/Option/Sidebar"
import { BsIncognito } from "react-icons/bs"
import { isFireFoxPrivateMode } from "@/utils/is-private-mode"
import { ProviderSwitch } from "@/components/Common/ProviderSwitch"
import { useProviderCapabilities } from "@/services/provider-capabilities"

type SidepanelHeaderProps = {
  sidebarOpen?: boolean
  setSidebarOpen?: (open: boolean) => void
}

export const SidepanelHeader = ({
  sidebarOpen: propSidebarOpen,
  setSidebarOpen: propSetSidebarOpen
}: SidepanelHeaderProps = {}) => {
  const [hideCurrentChatModelSettings] = useStorage(
    "hideCurrentChatModelSettings",
    false
  )

  const {
    clearChat,
    isEmbedding,
    messages,
    streaming,
    selectedSystemPrompt,
    setSelectedSystemPrompt,
    setSelectedQuickPrompt,
    setMessages,
    setHistory,
    setHistoryId,
    setSelectedModel,
    historyId,
    history,
    useOCR,
    temporaryChat,
    setTemporaryChat,
    selectedModel
  } = useMessage()
  const { t } = useTranslation(["sidepanel", "common", "option"])
  const { capabilities } = useProviderCapabilities("local")
  const [openModelSettings, setOpenModelSettings] = React.useState(false)
  const [localSidebarOpen, setLocalSidebarOpen] = React.useState(false)
  const [webuiBtnSidePanel, setWebuiBtnSidePanel] = useStorage(
    "webuiBtnSidePanel",
    false
  )

  // Use prop state if provided, otherwise use local state
  const sidebarOpen =
    propSidebarOpen !== undefined ? propSidebarOpen : localSidebarOpen
  const setSidebarOpen = propSetSidebarOpen || setLocalSidebarOpen

  return (
    <SidepanelHeaderFrame
      temporaryChat={temporaryChat}
      left={
        import.meta.env.BROWSER !== "firefox" ? (
          <ProviderSwitch current="local" />
        ) : undefined
      }>
      <div className="flex items-center space-x-3">
        {webuiBtnSidePanel ? (
          <Tooltip title={t("tooltip.openwebui")}>
            <button
              onClick={() => {
                const url = browser.runtime.getURL("/options.html")
                browser.tabs.create({ url })
              }}
              className="flex items-center space-x-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-700">
              <MessageSquareShareIcon className="size-4 text-gray-500 dark:text-gray-400" />
            </button>
          </Tooltip>
        ) : null}
        {isEmbedding ? (
          <Tooltip title={t("tooltip.embed")}>
            <BoxesIcon className="size-4 text-gray-500 dark:text-gray-400 animate-bounce animate-infinite" />
          </Tooltip>
        ) : null}

        {messages.length > 0 && !streaming && (
          <button
            title={t("option:newChat")}
            onClick={() => {
              clearChat()
            }}
            className="flex items-center space-x-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-700">
            <PlusSquare className="size-4 text-gray-500 dark:text-gray-400" />
          </button>
        )}

        {capabilities.tempChat && (
          <button
            title={t("option:temporaryChat")}
            onClick={() => {
              if (isFireFoxPrivateMode) {
                notification.error({
                  message: "Error",
                  description:
                    "Page Assist can't save chat in Firefox Private Mode. Temporary chat is enabled by default. More fixes coming soon."
                })
                return
              }

              setTemporaryChat(!temporaryChat)
              if (messages.length > 0) {
                clearChat()
              }
            }}
            data-istemporary-chat={temporaryChat}
            className="flex items-center text-gray-500 dark:text-gray-400 space-x-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-700 rounded-full p-1 data-[istemporary-chat='true']:bg-violet-200 data-[istemporary-chat='true']:text-violet-700 data-[istemporary-chat='true']:dark:bg-violet-900 data-[istemporary-chat='true']:dark:text-violet-300">
            <BsIncognito className="size-4 " />
          </button>
        )}

        {history.length > 0 && (
          <button
            title={t("tooltip.clear")}
            onClick={() => {
              setHistory([])
            }}
            className="flex items-center space-x-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-700">
            <EraserIcon className="size-4 text-gray-500 dark:text-gray-400" />
          </button>
        )}
        <Tooltip title={t("tooltip.history")}>
          <button
            onClick={() => {
              setSidebarOpen(true)
            }}
            className="flex items-center space-x-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-700">
            <HistoryIcon className="size-4 text-gray-500 dark:text-gray-400" />
          </button>
        </Tooltip>
        {capabilities.prompts && (
          <PromptSelect
            selectedSystemPrompt={selectedSystemPrompt}
            setSelectedSystemPrompt={setSelectedSystemPrompt}
            setSelectedQuickPrompt={setSelectedQuickPrompt}
            iconClassName="size-4"
            className="text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          />
        )}
        {capabilities.modelSettings && !hideCurrentChatModelSettings && (
          <Tooltip title={t("common:currentChatModelSettings")}>
            <button
              onClick={() => setOpenModelSettings(true)}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
              <BrainCog className="size-4" />
            </button>
          </Tooltip>
        )}
        <Link to="/settings">
          <CogIcon className="size-4 text-gray-500 dark:text-gray-400" />
        </Link>
      </div>
      {capabilities.modelSettings && (
        <CurrentChatModelSettings
          open={openModelSettings}
          setOpen={setOpenModelSettings}
          isOCREnabled={useOCR}
        />
      )}

      <Drawer
        title={
          <div className="flex items-center justify-between">
            <div className="flex items-center justify-between">
              {t("tooltip.history")}
            </div>

            <button onClick={() => setSidebarOpen(false)}>
              <XIcon className="size-4 text-gray-500 dark:text-gray-400" />
            </button>
          </div>
        }
        placement="left"
        closeIcon={null}
        onClose={() => setSidebarOpen(false)}
        open={sidebarOpen}>
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          setMessages={setMessages}
          setHistory={setHistory}
          setHistoryId={setHistoryId}
          setSelectedModel={setSelectedModel}
          setSelectedSystemPrompt={setSelectedSystemPrompt}
          clearChat={clearChat}
          historyId={historyId}
          setSystemPrompt={(e) => {}}
          temporaryChat={false}
          history={history}
          selectedModel={selectedModel}
        />
      </Drawer>
    </SidepanelHeaderFrame>
  )
}

type RemoteSidepanelHeaderProps = {
  newChatDisabled?: boolean
  onNewChat: () => void
  onHistory: () => void
  onDetails: () => void
}

/**
 * Same frame, provider switch and settings entry as the local header. Only the
 * actions the remote channel can honour replace the local-only controls.
 */
export const RemoteSidepanelHeader = ({
  newChatDisabled,
  onNewChat,
  onHistory,
  onDetails
}: RemoteSidepanelHeaderProps) => {
  const { t } = useTranslation("qwenpaw")
  const iconClass = "size-4 text-gray-500 dark:text-gray-400"
  return (
    <SidepanelHeaderFrame left={<ProviderSwitch current="remote" />}>
      <div className="flex items-center space-x-3">
        <Tooltip title={t("newChat")}>
          <button
            aria-label={t("newChat")}
            disabled={newChatDisabled}
            onClick={onNewChat}
            className="disabled:opacity-40">
            <PlusSquare className={iconClass} />
          </button>
        </Tooltip>
        <Tooltip title={t("conversation")}>
          <button aria-label={t("conversation")} onClick={onHistory}>
            <HistoryIcon className={iconClass} />
          </button>
        </Tooltip>
        <Tooltip title={t("connectionDetails")}>
          <button aria-label={t("connectionDetails")} onClick={onDetails}>
            <InfoIcon className={iconClass} />
          </button>
        </Tooltip>
        <Link to="/settings" aria-label={t("openSettings")}>
          <CogIcon className={iconClass} />
        </Link>
      </div>
    </SidepanelHeaderFrame>
  )
}
