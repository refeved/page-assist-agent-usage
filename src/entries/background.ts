import { getOllamaURL, isOllamaRunning } from "../services/ollama"
import { browser } from "wxt/browser"
import { clearBadge, streamDownload, cancelDownload } from "@/utils/pull-ollama"
import { Storage } from "@plasmohq/storage"
import { getInitialConfig } from "@/services/action"
import { getCustomCopilotPrompts, getCopilotPromptsEnabledState, type CustomCopilotPrompt } from "@/services/application"
import { startMcpOAuthFlow, disconnectMcpOAuth } from "@/libs/mcp/oauth-flow"
import { McpServerDb } from "@/db/dexie/mcp"
import { restrictCredentialAccess } from "@/services/qwenpaw/config"

export default defineBackground({
  main() {
    if (typeof chrome.storage.local.setAccessLevel === "function") {
      void restrictCredentialAccess().catch(error => {
        console.error("[QwenPaw] Failed to restrict extension-local credential access", error)
      })
    }
    const storage = new Storage({
      area: "local"
    })
    let isCopilotRunning: boolean = false
    let actionIconClick: string = "webui"
    let contextMenuClick: string = "sidePanel"
    const contextMenuId = {
      webui: "open-web-ui-pa",
      sidePanel: "open-side-panel-pa"
    }

    const contextMenuTitle = {
      webui: browser.i18n.getMessage("openOptionToChat"),
      sidePanel: browser.i18n.getMessage("openSidePanelToChat")
    }

    // The setting is free text, so an unknown value must never reach the menu
    // api, where it would produce an entry without an id or a title.
    const chatMenuKey = (value: string) =>
      contextMenuId[value] ? value : "sidePanel"

    let customCopilotMenuIds: string[] = []
    const builtinCopilotMenus = [
      { id: "summarize-pa", key: "summary", title: "Summarize" },
      { id: "explain-pa", key: "explain", title: "Explain" },
      { id: "rephrase-pa", key: "rephrase", title: "Rephrase" },
      { id: "translate-pg", key: "translate", title: "Translate" },
      { id: "custom-pg", key: "custom", title: "Custom" }
    ]

    // Chrome keeps the menus an extension registered for the whole browser
    // session, while this file runs again on every service worker wake-up, so a
    // create has to drop the copy from the previous run first or the ids
    // collide and the menu silently stays as it was.
    const removeMenu = async (menuId?: string) => {
      if (!menuId) return
      try {
        await browser.contextMenus.remove(menuId)
      } catch (e) {
        // Menu might not exist, ignore
      }
    }

    const createBuiltinCopilotMenus = async () => {
      const enabledState = await getCopilotPromptsEnabledState()

      for (const menu of builtinCopilotMenus) {
        // Remove existing menu
        await removeMenu(menu.id)

        // Create menu only if enabled
        if (enabledState[menu.key]) {
          browser.contextMenus.create({
            id: menu.id,
            title: menu.title,
            contexts: ["selection"]
          })
        }
      }
    }

    const createCustomCopilotMenus = async () => {
      // Remove existing custom copilot menus
      for (const menuId of customCopilotMenuIds) {
        await removeMenu(menuId)
      }
      customCopilotMenuIds = []

      // Create new custom copilot menus
      const customPrompts = await getCustomCopilotPrompts()
      const enabledPrompts = customPrompts.filter(p => p.enabled)

      for (const prompt of enabledPrompts) {
        const menuId = `custom_copilot_${prompt.id}`
        // The tracker above is empty after a service worker restart while the
        // menus of the previous run are still registered, so drop by id too.
        await removeMenu(menuId)
        customCopilotMenuIds.push(menuId)
        browser.contextMenus.create({
          id: menuId,
          title: prompt.title,
          contexts: ["selection"]
        })
      }
    }

    const setChatMenu = async (previousKey?: string) => {
      await removeMenu(contextMenuId[previousKey])
      await removeMenu(contextMenuId[contextMenuClick])
      browser.contextMenus.create({
        id: contextMenuId[contextMenuClick],
        title: contextMenuTitle[contextMenuClick],
        contexts: ["page", "selection"]
      })
    }

    const initialize = async () => {
      try {
        storage.watch({
          actionIconClick: (value) => {
            const oldValue = value?.oldValue || "webui"
            const newValue = value?.newValue || "webui"
            if (oldValue !== newValue) {
              actionIconClick = newValue
            }
          },
          contextMenuClick: async (value) => {
            const oldValue = value?.oldValue || "sidePanel"
            const newValue = value?.newValue || "sidePanel"
            if (oldValue !== newValue) {
              contextMenuClick = chatMenuKey(newValue)
              await setChatMenu(oldValue)
            }
          },
          customCopilotPrompts: async () => {
            // Recreate custom copilot menus when prompts change
            await createCustomCopilotMenus()
          },
          youtubeAutoSummarize: async (value) => {
            const newValue = value?.newValue || false
            const tabs = await browser.tabs.query({
              url: "*://www.youtube.com/watch*"
            })
            tabs.forEach((tab) => {
              if (tab.id) {
                browser.tabs
                  .sendMessage(tab.id, {
                    type: "youtube_summarize_setting_changed",
                    enabled: newValue
                  })
                  .catch(() => {})
              }
            })
          }
        })
        const data = await getInitialConfig()
        contextMenuClick = chatMenuKey(data.contextMenuClick)
        actionIconClick = data.actionIconClick

        // Menus outlive the service worker, so start from a clean slate instead
        // of adding a second copy of everything below.
        await browser.contextMenus.removeAll()
        await setChatMenu()

        // Create built-in copilot menus
        await createBuiltinCopilotMenus()

        // Create custom copilot menus
        await createCustomCopilotMenus()
      } catch (error) {
        console.error("Error in initLogic:", error)
      }
    }

    browser.runtime.onMessage.addListener(async (message, sender) => {
      if (message.type === "refresh_custom_copilot_menus") {
        await createCustomCopilotMenus()
        return Promise.resolve({ success: true })
      } else if (message.type === "refresh_builtin_copilot_menus") {
        await createBuiltinCopilotMenus()
        return Promise.resolve({ success: true })
      } else if (message.type === "check_youtube_summarize_enabled") {
        const enabled = await storage.get("youtubeAutoSummarize")
        return Promise.resolve({ enabled: enabled || false })
      } else if (message.type === "sidepanel") {
        await browser.sidebarAction.open()
      } else if (message.type === "pull_model") {
        const ollamaURL = await getOllamaURL()

        const isRunning = await isOllamaRunning()

        if (!isRunning) {
          setBadgeText({ text: "E" })
          setBadgeBackgroundColor({ color: "#FF0000" })
          setTitle({ title: "Ollama is not running" })
          setTimeout(() => {
            clearBadge()
          }, 5000)
          return
        }

        await streamDownload(ollamaURL, message.modelName)
      } else if (message.type === "cancel_download") {
        cancelDownload()
      } else if (message.type === "mcp_oauth_start") {
        const mcpDb = new McpServerDb()
        const server = await mcpDb.getById(message.serverId)
        if (!server) {
          return Promise.resolve({ success: false, error: "Server not found" })
        }
        const result = await startMcpOAuthFlow(server)
        return Promise.resolve(result)
      } else if (message.type === "mcp_oauth_disconnect") {
        await disconnectMcpOAuth(message.serverId)
        return Promise.resolve({ success: true })
      } else if (message.type === "youtube_summarize") {
        openSidePanel(sender.tab?.id)

        setTimeout(
          async () => {
            const prompt = `Summarize this YouTube video: "${message.videoTitle}".\n\nPlease provide a comprehensive summary of the video content.`

            await browser.runtime.sendMessage({
              from: "background",
              type: "yt_summarize",
              text: prompt
            })
          },
          isCopilotRunning ? 0 : 5000
        )
      }
    })

    browser.runtime.onConnect.addListener((port) => {
      if (port.name === "pgCopilot") {
        isCopilotRunning = true
        port.onDisconnect.addListener(() => {
          isCopilotRunning = false
        })
      }
    })

    // Both click events hand out the tab as an optional argument, and
    // `sidePanel.open` rejects on its own when the panel is already showing or
    // the tab went away, so neither may be allowed to reject the listener.
    const openSidePanel = (tabId?: number) => {
      if (tabId === undefined) return
      chrome.sidePanel.open({ tabId }).catch((error) => {
        console.error("Failed to open the side panel", error)
      })
    }

    chrome.action.onClicked.addListener((tab) => {
      if (actionIconClick === "webui") {
        chrome.tabs.create({ url: chrome.runtime.getURL("/options.html") })
      } else {
        openSidePanel(tab.id)
      }
    })

    browser.contextMenus.onClicked.addListener(async (info, tab) => {
      // Opening the Web UI is the only entry that does not need a tab.
      if (info.menuItemId === "open-web-ui-pa") {
        browser.tabs.create({
          url: browser.runtime.getURL("/options.html")
        })
        return
      }

      const tabId = tab?.id
      if (tabId === undefined) return

      if (info.menuItemId === "open-side-panel-pa") {
        openSidePanel(tabId)
      } else if (info.menuItemId === "summarize-pa") {
        openSidePanel(tabId)
        // this is a bad method hope somone can fix it :)
        setTimeout(
          async () => {
            await browser.runtime.sendMessage({
              from: "background",
              type: "summary",
              text: info.selectionText
            })
          },
          isCopilotRunning ? 0 : 5000
        )
      } else if (info.menuItemId === "rephrase-pa") {
        openSidePanel(tabId)
        setTimeout(
          async () => {
            await browser.runtime.sendMessage({
              type: "rephrase",
              from: "background",
              text: info.selectionText
            })
          },
          isCopilotRunning ? 0 : 5000
        )
      } else if (info.menuItemId === "translate-pg") {
        openSidePanel(tabId)

        setTimeout(
          async () => {
            await browser.runtime.sendMessage({
              type: "translate",
              from: "background",
              text: info.selectionText
            })
          },
          isCopilotRunning ? 0 : 5000
        )
      } else if (info.menuItemId === "explain-pa") {
        openSidePanel(tabId)

        setTimeout(
          async () => {
            await browser.runtime.sendMessage({
              type: "explain",
              from: "background",
              text: info.selectionText
            })
          },
          isCopilotRunning ? 0 : 5000
        )
      } else if (info.menuItemId === "custom-pg") {
        openSidePanel(tabId)

        setTimeout(
          async () => {
            await browser.runtime.sendMessage({
              type: "custom",
              from: "background",
              text: info.selectionText
            })
          },
          isCopilotRunning ? 0 : 5000
        )
      } else if (typeof info.menuItemId === "string" && info.menuItemId.startsWith("custom_copilot_")) {
        // Handle custom copilot prompts
        openSidePanel(tabId)

        setTimeout(
          async () => {
            await browser.runtime.sendMessage({
              type: info.menuItemId,
              from: "background",
              text: info.selectionText
            })
          },
          isCopilotRunning ? 0 : 5000
        )
      }
    })

    const sidePanelClose = (chrome.sidePanel as any)?.close as
      | ((options: { tabId?: number; windowId?: number }) => Promise<void>)
      | undefined

    browser.commands.onCommand.addListener((command) => {
      switch (command) {
        case "execute_side_panel":
          chrome.tabs.query(
            { active: true, currentWindow: true },
            async (tabs) => {
              const tab = tabs[0]
              if (!tab?.id) return

              if (isCopilotRunning && sidePanelClose) {
                const closeAttempts: Array<{
                  tabId?: number
                  windowId?: number
                }> = []
                if (tab.windowId !== undefined) {
                  closeAttempts.push({ windowId: tab.windowId })
                }
                closeAttempts.push({ tabId: tab.id })

                for (const attempt of closeAttempts) {
                  try {
                    await sidePanelClose(attempt)
                    return
                  } catch (e) {
                  }
                }
                console.warn(
                  "Side panel reported open but close() rejected for both windowId and tabId"
                )
              }

              openSidePanel(tab.id)
            }
          )
          break
        default:
          break
      }
    })

    initialize()
  },
  persistent: true
})
