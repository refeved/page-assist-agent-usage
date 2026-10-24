import { defaultExtractContent } from "@/parser/default"
import { contextHash, sourceUrl } from "@/services/qwenpaw/privacy"
import type { PageContext } from "@/services/qwenpaw/types"

export interface PageSnapshot {
  context: PageContext
  tabId: number
  documentUrl: string
  fingerprint: string
}
function readDocument(mode: "article" | "selection") {
  if (document.contentType !== "text/html")
    throw new Error("Only top-level HTML pages are supported")
  const title = document.title
  const url = location.href
  const capturedAt = new Date().toISOString()
  if (mode === "selection") {
    return {
      title,
      url,
      capturedAt,
      content: window.getSelection()?.toString() || ""
    }
  }
  const clone = document.documentElement.cloneNode(true) as HTMLElement
  clone
    .querySelectorAll(
      "script,style,noscript,iframe,object,embed,input,textarea,select,button,form,[contenteditable]:not([contenteditable=false]),[hidden],[aria-hidden=true]"
    )
    .forEach((node) => node.remove())
  return { title, url, capturedAt, content: clone.outerHTML }
}
async function withTimeout<T>(task: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Page capture timed out")),
          15000
        )
      })
    ])
  } finally {
    clearTimeout(timer!)
  }
}
export async function capture(
  mode: "article" | "selection",
  maxChars: number
): Promise<PageSnapshot> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id || !tab.url) throw new Error("No readable active tab")
  sourceUrl(tab.url)
  if (/\.pdf(?:$|[?#])/i.test(tab.url))
    throw new Error("PDF snapshots are not supported")
  const result = await withTimeout(
    browser.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      func: readDocument,
      args: [mode]
    })
  )
  const page = result[0]?.result
  const [current] = await browser.tabs.query({
    active: true,
    currentWindow: true
  })
  if (
    !page ||
    current?.id !== tab.id ||
    page.url !== tab.url ||
    current.url !== page.url
  ) {
    throw new Error("Page changed during capture; refresh the snapshot")
  }
  const url = sourceUrl(page.url)
  const content = (
    mode === "article" ? defaultExtractContent(page.content, url) : page.content
  ).trim()
  if (!content)
    throw new Error(
      mode === "selection"
        ? "Select text in the page first"
        : "No article content could be extracted"
    )
  if (content.length > maxChars)
    throw new Error(`CONTEXT_TOO_LARGE:${content.length}:${maxChars}`)
  return {
    context: {
      type: "webpage",
      mode,
      title: page.title,
      url,
      capturedAt: page.capturedAt,
      content,
      contentHash: await contextHash(url, mode, content),
      truncated: false
    },
    tabId: tab.id,
    documentUrl: page.url,
    fingerprint: await contextHash(url, mode, page.content)
  }
}
export async function truncateCapture(
  mode: "article" | "selection",
  maxChars: number
): Promise<PageSnapshot> {
  // Capture remains explicit: this function is only invoked after the user's confirmation.
  const snapshot = await capture(mode, Number.MAX_SAFE_INTEGER)
  const content = snapshot.context.content.slice(0, maxChars)
  return {
    ...snapshot,
    context: {
      ...snapshot.context,
      content,
      truncated: snapshot.context.content.length > maxChars,
      contentHash: await contextHash(snapshot.context.url, mode, content)
    }
  }
}
export async function validateSnapshot(snapshot: PageSnapshot) {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.id !== snapshot.tabId || tab.url !== snapshot.documentUrl) {
    throw new Error("Active page changed; refresh and preview before sending")
  }
  const result = await withTimeout(
    browser.scripting.executeScript({
      target: { tabId: snapshot.tabId, frameIds: [0] },
      func: readDocument,
      args: [snapshot.context.mode]
    })
  )
  const page = result[0]?.result
  const [current] = await browser.tabs.query({
    active: true,
    currentWindow: true
  })
  if (
    !page ||
    current?.id !== snapshot.tabId ||
    current.url !== snapshot.documentUrl ||
    page.url !== snapshot.documentUrl ||
    (await contextHash(
      snapshot.context.url,
      snapshot.context.mode,
      page.content
    )) !== snapshot.fingerprint
  ) {
    throw new Error(
      "Page content or selection changed; refresh and preview before sending"
    )
  }
}
