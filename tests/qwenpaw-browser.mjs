import assert from "node:assert/strict"
import { cp, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { chromium } from "playwright"
import { build } from "esbuild"

// Uses the installed Chrome and an isolated, disposable profile; no real QwenPaw service.
const profile = await mkdtemp(
  path.join(tmpdir(), "page-assist-qwenpaw-browser-")
)
const extension = path.join(profile, "extension")
let context
try {
  await cp(path.resolve("build/chrome-mv3"), extension, { recursive: true })
  await build({
    stdin: {
      contents:
        'export * from "./src/services/qwenpaw/repository"; export { db } from "./src/db/dexie/schema";',
      resolveDir: process.cwd()
    },
    bundle: true,
    format: "esm",
    platform: "browser",
    alias: { "@": path.resolve("src") },
    outfile: path.join(extension, "repository-probe.js")
  })
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    headless: false,
    chromiumSandbox: true,
    args: ["--enable-unsafe-extension-debugging"],
    ignoreDefaultArgs: ["--disable-extensions"]
  })
  const cdp = await context.browser().newBrowserCDPSession()
  const { id } = await cdp.send("Extensions.loadUnpacked", { path: extension })
  const origin = `chrome-extension://${id}`
  const service = "http://127.0.0.1:19787"
  const writes = []
  const histories = new Map()
  const records = new Map()
  const unexpectedRequests = []
  context.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith(`${service}/`)
    )
      unexpectedRequests.push(request.url())
  })
  let unknownNext = false
  let approvalPending = true
  let decisions = 0
  await context.route(`${service}/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const endpoint = url.pathname.replace("/api/page-assist", "")
    if (url.pathname === "/article") {
      return route.fulfill({
        contentType: "text/html",
        body: "<html><head><title>Private test article</title></head><body><article><h1>Research</h1><p>Visible research fact with enough readable article content for extraction. This is local synthetic test content.</p><form><input value='DO_NOT_SHARE'><textarea>FORM_SECRET</textarea></form><div contenteditable>EDIT_SECRET</div></article></body></html>"
      })
    }
    if (req.headers().authorization !== "Bearer test-browser-credential")
      return route.fulfill({ status: 401, json: {} })
    if (req.method() === "POST")
      writes.push({ endpoint, body: req.postDataJSON() })
    if (endpoint === "/capabilities")
      return route.fulfill({
        json: {
          protocolVersion: 1,
          instanceId: "test-instance",
          principalScope: "test-user",
          maxContextChars: 30000,
          maxTextChars: 4000,
          recovery: true,
          approvals: true,
          approvalEvents: false
        }
      })
    if (endpoint === "/agents")
      return route.fulfill({
        json: { agents: [{ id: "research", name: "Research Agent" }] }
      })
    if (endpoint === "/conversations") {
      const conversationId = `conversation-${histories.size + 1}`
      histories.set(conversationId, [])
      return route.fulfill({ json: { conversationId, agentId: "research" } })
    }
    const messages = endpoint.match(/^\/conversations\/([^/]+)\/messages$/)
    if (messages) {
      const conversationId = messages[1]
      if (req.method() === "GET")
        return route.fulfill({
          json: {
            conversationId,
            complete: true,
            messages: histories.get(conversationId) || []
          }
        })
      const payload = req.postDataJSON()
      const record = {
        requestId: payload.requestId,
        conversationId,
        state: unknownNext ? "unknown" : "accepted"
      }
      records.set(payload.requestId, record)
      histories.get(conversationId).push({
        id: `user-${payload.requestId}`,
        requestId: payload.requestId,
        role: "user",
        content: payload.text,
        status: "complete"
      })
      if (unknownNext) {
        unknownNext = false
        return route.abort("failed")
      }
      return route.fulfill({ json: record })
    }
    const event = endpoint.match(/^\/requests\/([^/]+)\/events$/)
    if (event) {
      const record = records.get(event[1])
      record.state = "completed"
      const message = {
        id: `assistant-${record.requestId}`,
        requestId: record.requestId,
        role: "assistant",
        content:
          'Verified answer 中文\n\n![do not load](https://example.invalid/private-image.png)\n\n```html\n<iframe src="https://example.invalid/private-frame"></iframe>\n```\n\n| Result | Status |\n| --- | --- |\n| remote | OK |',
        status: "complete"
      }
      histories.get(record.conversationId).push(message)
      return route.fulfill({
        contentType: "text/event-stream",
        body: [
          {
            type: "message.snapshot",
            requestId: record.requestId,
            messageId: message.id,
            content: "Verified",
            status: "streaming"
          },
          {
            type: "message.delta",
            requestId: record.requestId,
            messageId: message.id,
            delta: message.content.slice("Verified".length)
          },
          {
            type: "request.terminal",
            requestId: record.requestId,
            state: "completed"
          }
        ]
          .map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`)
          .join("")
      })
    }
    const request = endpoint.match(/^\/requests\/([^/]+)$/)
    if (request) return route.fulfill({ json: records.get(request[1]) })
    if (endpoint === "/approvals")
      return route.fulfill({
        json: {
          approvals: approvalPending
            ? [
                {
                  id: "approval-1",
                  conversationId: "conversation-1",
                  agentId: "research",
                  requestId: "tool-request",
                  tool: "read_file",
                  target: "/synthetic-test.txt",
                  risk: "Read synthetic test data",
                  expiresAt: new Date(Date.now() + 60000).toISOString(),
                  actionable: true,
                  scopes: [
                    {
                      id: "exact",
                      label: "Exact target",
                      description: "May remember approval for this exact target"
                    }
                  ]
                }
              ]
            : []
        }
      })
    if (endpoint === "/approvals/approval-1/decision") {
      decisions++
      approvalPending = false
      return route.fulfill({
        json: {
          ...req.postDataJSON(),
          approvalId: "approval-1",
          status: "confirmed"
        }
      })
    }
    return route.fulfill({ status: 404, json: {} })
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(e.message))
  // A static extension resource gives access to its origin without mounting the app.
  await page.goto(`${origin}/manifest.json`)
  const seeded = await page.evaluate(async () => {
    const databases = await indexedDB.databases()
    if (databases.some((d) => d.name === "PageAssistDatabase")) return false
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("PageAssistDatabase", 50)
      req.onupgradeneeded = () => {
        const stores = {
          chatHistories:
            "id,title,is_rag,message_source,is_pinned,createdAt,doc_id,last_used_prompt,model_id,folder_id",
          messages:
            "id,history_id,name,role,content,createdAt,messageType,modelName,messageKind,toolCallId,toolName,toolServerName",
          prompts: "id,title,content,is_system,createdBy,createdAt",
          webshares: "id,title,url,api_url,share_id,createdAt",
          sessionFiles: "sessionId,retrievalEnabled,createdAt",
          userSettings: "id,user_id",
          knowledge:
            "id,db_type,title,status,embedding_model,systemPrompt,followupPrompt,createdAt",
          documents: "id,db_type,title,status,embedding_model,createdAt",
          vectors: "id,vectors",
          openaiConfigs:
            "id,name,baseUrl,apiKey,createdAt,provider,db_type,headers",
          customModels:
            "id,model_id,name,model_name,model_image,provider_id,lookup,model_type,db_type",
          modelNickname: "id,model_id,model_name,model_avatar",
          modelState: "id,model_id,is_enabled",
          providerState: "id,provider_id,is_enabled",
          memories: "id,content,createdAt,updatedAt",
          projectFolders: "id,title,color,createdAt",
          mcpServers:
            "id,name,url,enabled,transport,updatedAt,createdAt,toolsLastSyncedAt"
        }
        for (const [name, definition] of Object.entries(stores)) {
          const [keyPath, ...indexes] = definition.split(",")
          const store = req.result.createObjectStore(name, { keyPath })
          for (const index of indexes) store.createIndex(index, index)
        }
        req.transaction
          .objectStore("chatHistories")
          .put({ id: "legacy-v5", title: "Preserved v5 history", createdAt: 1 })
      }
      req.onsuccess = () => {
        req.result.close()
        resolve()
      }
      req.onerror = () => reject(req.error)
    })
    return true
  })
  assert.equal(
    seeded,
    true,
    "v5 fixture must be created before app opens the database"
  )
  await page.evaluate(async (service) => {
    localStorage.setItem("i18nextLng", "en")
    await chrome.storage.local.set({
      "qwenpaw.mode": JSON.stringify("remote"),
      "qwenpaw.connection": JSON.stringify({
        id: "browser-test",
        baseUrl: service
      }),
      "qwenpaw.credential": JSON.stringify("test-browser-credential"),
      selectedModel: JSON.stringify("preserved-local-model")
    })
    await chrome.storage.sync.set({
      isTTSAutoPlayEnabled: JSON.stringify(true)
    })
  }, service)
  await page.goto(`${origin}/sidepanel.html`)
  await page
    .getByRole("button", { name: "New remote chat", exact: true })
    .waitFor()
  await page.getByRole("button", { name: /^Agent for new chat:/ }).click()
  await page
    .getByRole("menuitem", { name: "Research Agent", exact: true })
    .click()
  await page.setViewportSize({ width: 420, height: 800 })
  const toolbar = page.locator('[data-chat-composer="toolbar"]')
  for (const label of ["Search Internet", "MCP"]) {
    assert.equal(
      await toolbar.getByRole("button", { name: label, exact: true }).count(),
      0
    )
  }
  const unavailable = [
    ["Upload Image", "This channel does not yet transmit image attachments."],
    ["Upload file", "This channel does not yet upload files to the Agent."],
    [
      "[Experimental] Vision Chat",
      "This channel does not yet transmit webpage screenshots or OCR images."
    ]
  ]
  for (const [label, reason] of unavailable) {
    assert.equal(
      await toolbar
        .getByRole("button", { name: label, exact: true })
        .isDisabled(),
      true
    )
    await toolbar
      .locator("span[tabindex='0']")
      .filter({ has: page.getByRole("button", { name: label, exact: true }) })
      .hover()
    await page
      .getByRole("tooltip", { name: `${label}: ${reason}`, exact: true })
      .waitFor()
  }
  await page.evaluate(async () =>
    chrome.storage.sync.set({
      optimizeQueueForSmallScreen: JSON.stringify(true)
    })
  )
  await toolbar.getByRole("button", { name: "More", exact: true }).click()
  await page.getByText("Upload file — Not available", { exact: true }).waitFor()
  for (const label of ["Search Internet", "MCP"]) {
    assert.equal(
      await page.getByText(`${label} — Not available`, { exact: true }).count(),
      0
    )
  }
  await page
    .getByText("This channel does not yet upload files to the Agent.", {
      exact: true
    })
    .waitFor()
  await toolbar.getByRole("button", { name: "More", exact: true }).click()
  await page.evaluate(async () =>
    chrome.storage.sync.set({
      optimizeQueueForSmallScreen: JSON.stringify(false)
    })
  )
  await page.waitForFunction(
    () =>
      !!document.querySelector(
        '[data-chat-composer="toolbar"] .ant-dropdown-button'
      )
  )
  const remoteComposer = await page
    .locator('[data-chat-composer="layout"]')
    .evaluate((node) => ({
      width: node
        .querySelector("[data-istemporary-chat]")
        .getBoundingClientRect().width,
      toolbarClass: node.querySelector('[data-chat-composer="toolbar"]')
        .className,
      textareaClass: node.querySelector("textarea").className
    }))
  await toolbar.getByRole("button", { name: "More", exact: true }).click()
  const enterOption = page.getByRole("checkbox", {
    name: "Send when Enter pressed",
    exact: true
  })
  await enterOption.waitFor()
  assert.equal(
    await page
      .getByRole("checkbox", {
        name: "Extract text from image (OCR) — Not available",
        exact: true
      })
      .isDisabled(),
    true
  )
  await enterOption.click()
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '[data-chat-composer="toolbar"] .lucide-corner-down-left'
      )
  )
  await page
    .getByPlaceholder("Ask the selected Agent…")
    .fill("Do not send with Enter disabled")
  await page.getByPlaceholder("Ask the selected Agent…").press("Enter")
  assert.equal(writes.filter((w) => w.endpoint.endsWith("/messages")).length, 0)
  await toolbar.getByRole("button", { name: "More", exact: true }).click()
  await enterOption.click()
  await page.waitForFunction(
    () =>
      !!document.querySelector(
        '[data-chat-composer="toolbar"] .lucide-corner-down-left'
      )
  )
  await page.getByPlaceholder("Ask the selected Agent…").click()
  await page.getByPlaceholder("Ask the selected Agent…").waitFor()
  await page.getByPlaceholder("Ask the selected Agent…").fill("First question")
  await page.getByPlaceholder("Ask the selected Agent…").press("Shift+Enter")
  assert.match(
    await page.getByPlaceholder("Ask the selected Agent…").inputValue(),
    /\n$/
  )
  assert.equal(writes.filter((w) => w.endpoint.endsWith("/messages")).length, 0)
  await page
    .getByPlaceholder("Ask the selected Agent…")
    .dispatchEvent("compositionstart")
  await page
    .getByPlaceholder("Ask the selected Agent…")
    .dispatchEvent("keydown", { key: "Enter", isComposing: true })
  assert.equal(writes.filter((w) => w.endpoint.endsWith("/messages")).length, 0)
  await page
    .getByPlaceholder("Ask the selected Agent…")
    .dispatchEvent("compositionend")
  await page.getByPlaceholder("Ask the selected Agent…").fill("First question")
  await page.getByPlaceholder("Ask the selected Agent…").press("Enter")
  await page.getByText("Verified answer 中文", { exact: true }).waitFor()
  await page.waitForFunction(() => !document.querySelector("textarea").disabled)
  assert.equal(await page.locator("article iframe").count(), 0)
  assert.equal(await page.locator('article img[src^="https:"]').count(), 0)
  assert.equal(
    await page.locator("article").getByText("Table", { exact: true }).count(),
    1
  )
  assert.equal(await page.locator("article td").count(), 2)
  assert.ok(
    (await page
      .getByRole("button", { name: "Copy to clipboard", exact: true })
      .count()) >= 1
  )
  const inputBox = await page
    .getByPlaceholder("Ask the selected Agent…")
    .boundingBox()
  assert.ok(
    inputBox.y + inputBox.height <= 800 && inputBox.y > 500,
    "native composer stays at bottom"
  )
  if (process.env.SCREENSHOT_PATH)
    await page.screenshot({ path: process.env.SCREENSHOT_PATH })
  await page.getByPlaceholder("Ask the selected Agent…").fill("Follow-up")
  await page.getByRole("button", { name: "Submit", exact: true }).click()
  await page.waitForFunction(() => !document.querySelector("textarea").disabled)
  assert.equal(writes.filter((w) => w.endpoint === "/conversations").length, 1)
  assert.equal(writes.filter((w) => w.endpoint.endsWith("/messages")).length, 2)
  assert.ok(
    writes
      .filter((w) => w.endpoint.endsWith("/messages"))
      .every((w) => Object.keys(w.body).sort().join(",") === "requestId,text")
  )
  await page.reload()
  await page.waitForFunction(
    () =>
      !document.querySelector("textarea")?.disabled &&
      document.querySelectorAll("article").length >= 4
  )
  assert.equal(
    writes.filter((w) => w.endpoint.endsWith("/messages")).length,
    2,
    "reload must not resend"
  )
  const upgrade = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("PageAssistDatabase")
        req.onsuccess = () => {
          const db = req.result
          const read = db
            .transaction("chatHistories")
            .objectStore("chatHistories")
            .get("legacy-v5")
          read.onsuccess = () => {
            resolve({
              version: db.version,
              legacy: read.result.title,
              stores: [...db.objectStoreNames]
            })
            db.close()
          }
          read.onerror = () => reject(read.error)
        }
        req.onerror = () => reject(req.error)
      })
  )
  assert.equal(upgrade.version, 60)
  assert.equal(upgrade.legacy, "Preserved v5 history")
  assert.ok(upgrade.stores.includes("qwenpawRequests"))
  const repositoryChecks = await page.evaluate(async (origin) => {
    const repo = await import(`${origin}/repository-probe.js`)
    const c = {
      id: "repository-test",
      connectionId: "repository-test",
      conversationId: "remote-repository",
      instanceId: "test-instance",
      principalScope: "test-user",
      agentId: "research",
      title: "transaction-test",
      updatedAt: Date.now()
    }
    await repo.saveConversation(c)
    const payload = { requestId: "stable-request-id", text: "exact payload" }
    await Promise.all([repo.prepare(c, payload), repo.prepare(c, payload)])
    const count = (await repo.requests(c.id)).length
    let busy = false
    try {
      await repo.prepare(c, { requestId: "second-request", text: "blocked" })
    } catch {
      busy = true
    }
    let conflict = false
    try {
      await repo.prepare(c, { ...payload, text: "different payload" })
    } catch {
      conflict = true
    }
    const row = (await repo.requests(c.id))[0]
    await repo.saveRequest({ ...row, state: "completed" })
    const collision = { requestId: "rollback-id", text: "must roll back" }
    await repo.db.qwenpawMessages.add({
      conversationLocalId: c.id,
      id: `local:${collision.requestId}`,
      requestId: "collision",
      role: "user",
      content: "collision",
      status: "complete",
      updatedAt: Date.now()
    })
    let rolledBack = false
    try {
      await repo.prepare(c, collision)
    } catch {
      rolledBack = !(await repo.db.qwenpawRequests.get([
        c.connectionId,
        collision.requestId
      ]))
    }
    const otherScope = await repo.conversations(
      c.connectionId,
      c.instanceId,
      "other-principal"
    )
    await repo.removeCache(c.id)
    repo.db.close()
    return { count, busy, conflict, rolledBack, otherScope: otherScope.length }
  }, origin)
  assert.deepEqual(repositoryChecks, {
    count: 1,
    busy: true,
    conflict: true,
    rolledBack: true,
    otherScope: 0
  })
  // The approval lives behind the composer button now, not in the transcript.
  await page.getByRole("button", { name: "Approvals", exact: true }).click()
  if (process.env.APPROVAL_SCREENSHOT_PATH) {
    await page.waitForTimeout(400)
    await page.screenshot({ path: process.env.APPROVAL_SCREENSHOT_PATH })
  }
  await page.getByRole("button", { name: "Reject", exact: true }).click()
  // The popover keeps its DOM while closed, so watch the button instead of
  // waiting for the approval text to be detached.
  await page.waitForFunction(
    () =>
      document.querySelector('button[aria-label="Approvals"]')?.disabled ===
      true
  )
  assert.equal(decisions, 1)
  // Synthetic HTML is opened as the active tab; capture is triggered without activating the extension tab.
  const article = await context.newPage()
  await article.goto(`${service}/article?access_token=secret#part`)
  const contentScriptAccess = await page.evaluate(async (articleUrl) => {
    const [tab] = await chrome.tabs.query({ url: articleUrl })
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        try {
          const values = await chrome.storage.local.get("qwenpaw.credential")
          return { exposed: "qwenpaw.credential" in values }
        } catch {
          return { exposed: false }
        }
      }
    })
    return result
  }, `${service}/article*`)
  assert.equal(
    contentScriptAccess.exposed,
    false,
    "content scripts must not access browser credentials"
  )
  await article.bringToFront()
  await page
    .getByRole("button", { name: "Chat with current page", exact: true })
    .evaluate((button) => button.click())
  // Ant Design selects are custom widgets, not native selects.
  await page
    .locator(".ant-select")
    .filter({ has: page.getByRole("combobox", { name: "Webpage context" }) })
    .click()
  await page
    .locator(".ant-select-item-option-content")
    .filter({ hasText: /^Current article$/ })
    .click()
  await article.bringToFront()
  await page
    .getByRole("button", { name: "Read / refresh", exact: true })
    .evaluate((button) => button.click())
  await page
    .getByRole("dialog")
    .getByText("Private test article", { exact: false })
    .waitFor()
  const preview = await page.locator("section pre").last().textContent()
  assert.ok(preview.includes("Visible research fact"))
  for (const secret of ["DO_NOT_SHARE", "FORM_SECRET", "EDIT_SECRET"])
    assert.ok(!preview.includes(secret))
  assert.ok(
    !(await page.locator("main").innerText()).includes("access_token=secret")
  )
  await page
    .getByPlaceholder("Ask the selected Agent…")
    .fill("Question with previewed page")
  await page
    .getByRole("checkbox", {
      name: "I have previewed and confirm sharing this snapshot"
    })
    .check()
  await article.bringToFront()
  await page
    .getByRole("button", { name: "Submit", exact: true })
    .evaluate((button) => button.click())
  await page.waitForFunction(() => !document.querySelector("textarea").disabled)
  const attached = writes
    .filter((w) => w.endpoint.endsWith("/messages"))
    .at(-1).body
  assert.equal(
    attached.pageContext.content,
    preview,
    "preview and submitted bytes must match"
  )
  assert.equal(attached.pageContext.url, `${service}/article`)
  assert.match(attached.pageContext.contentHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(attached.pageContext.truncated, false)
  await article.evaluate(() => {
    const range = document.createRange()
    range.selectNodeContents(document.querySelector("article p"))
    const selection = window.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
  })
  await page
    .getByRole("button", { name: "Chat with current page", exact: true })
    .evaluate((button) => button.click())
  await page
    .locator(".ant-select")
    .filter({ has: page.getByRole("combobox", { name: "Webpage context" }) })
    .click()
  await page
    .locator(".ant-select-item-option-content")
    .filter({ hasText: /^Selected text$/ })
    .click()
  await article.bringToFront()
  await page
    .getByRole("button", { name: "Read / refresh", exact: true })
    .evaluate((button) => button.click())
  await page
    .getByRole("checkbox", {
      name: "I have previewed and confirm sharing this snapshot"
    })
    .waitFor()
  const selectionPreview = await page
    .locator("section pre")
    .last()
    .textContent()
  assert.ok(selectionPreview.startsWith("Visible research fact"))
  assert.ok(!selectionPreview.includes("# Research"))
  await article.evaluate(() => window.getSelection().removeAllRanges())
  await article.bringToFront()
  await page
    .getByRole("button", { name: "Read / refresh", exact: true })
    .evaluate((button) => button.click())
  await page
    .getByRole("dialog")
    .getByText("Error: Select text in the page first", { exact: true })
    .waitFor()
  await page
    .locator(".ant-select")
    .filter({ has: page.getByRole("combobox", { name: "Webpage context" }) })
    .click()
  await page
    .locator(".ant-select-item-option-content")
    .filter({ hasText: /^Current article$/ })
    .click()
  await article.evaluate(() => {
    document.querySelector("article p").textContent = "X".repeat(30100)
  })
  await article.bringToFront()
  await page
    .getByRole("button", { name: "Read / refresh", exact: true })
    .evaluate((button) => button.click())
  await page
    .getByText(
      "Content exceeds the limit. Explicitly truncate to 30000 characters and preview?",
      { exact: true }
    )
    .waitFor()
  await page.getByRole("button", { name: "OK", exact: true }).click()
  await page
    .getByRole("checkbox", {
      name: "I have previewed and confirm sharing this snapshot"
    })
    .waitFor()
  assert.equal(
    (await page.locator("section pre").last().textContent()).length,
    30000
  )
  await page
    .getByRole("checkbox", {
      name: "I have previewed and confirm sharing this snapshot"
    })
    .check()
  await page
    .getByPlaceholder("Ask the selected Agent…")
    .fill("Do not send a changed page")
  await article.evaluate(() => {
    document.querySelector("article p").textContent = "Changed after preview"
  })
  await article.bringToFront()
  const beforeStaleSend = writes.filter((w) =>
    w.endpoint.endsWith("/messages")
  ).length
  await page
    .getByRole("button", { name: "Submit", exact: true })
    .evaluate((button) => button.click())
  await page
    .getByText(
      "Page or active tab changed. Refresh and preview before sharing.",
      { exact: true }
    )
    .waitFor()
  assert.equal(
    writes.filter((w) => w.endpoint.endsWith("/messages")).length,
    beforeStaleSend
  )
  // A failed submission must survive reload as unknown and must never be resent automatically.
  await page
    .locator(".ant-select")
    .filter({ has: page.getByRole("combobox", { name: "Webpage context" }) })
    .click()
  await page
    .locator(".ant-select-item-option-content")
    .filter({ hasText: /^Do not attach a page$/ })
    .click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Back", exact: true })
    .click()
  unknownNext = true
  await page
    .getByPlaceholder("Ask the selected Agent…")
    .fill("Uncertain question")
  await page.getByRole("button", { name: "Submit", exact: true }).click()
  await page
    .getByText("Outcome unknown — do not resend", { exact: false })
    .waitFor()
  const submitted = writes.filter((w) =>
    w.endpoint.endsWith("/messages")
  ).length
  await page.reload()
  await page
    .getByText("Outcome unknown — do not resend", { exact: false })
    .waitFor()
  assert.equal(
    writes.filter((w) => w.endpoint.endsWith("/messages")).length,
    submitted
  )
  assert.equal(
    await page
      .getByRole("button", { name: "Submit", exact: true })
      .isDisabled(),
    true
  )
  assert.equal(
    await page.evaluate(
      async () =>
        (await chrome.storage.local.get("selectedModel")).selectedModel
    ),
    JSON.stringify("preserved-local-model")
  )
  await page.evaluate(async (service) => {
    await chrome.storage.local.set({
      "qwenpaw.connection": JSON.stringify({
        id: "rotated-credential",
        baseUrl: service
      })
    })
  }, service)
  await page
    .getByText(
      "Connection changed. Reopen QwenPaw to authenticate the new scope.",
      { exact: true }
    )
    .waitFor()
  assert.equal(
    await page.getByText("Verified answer 中文", { exact: true }).count(),
    0
  )
  await page.reload()
  await page
    .getByText(
      "Chat with your QwenPaw Agent. Use the page icon beside the input to share the current page or selected text.",
      { exact: true }
    )
    .waitFor()
  assert.equal(
    await page.getByText("Verified answer 中文", { exact: true }).count(),
    0
  )
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(
    unexpectedRequests,
    [],
    "remote UI must not call Ollama, local RAG/MCP, TTS or load message images/previews"
  )
  await page.getByRole("button", { name: "Local models", exact: true }).click()
  const localComposer = await page
    .locator('[data-chat-composer="layout"]')
    .evaluate((node) => ({
      width: node
        .querySelector("[data-istemporary-chat]")
        .getBoundingClientRect().width,
      toolbarClass: node.querySelector('[data-chat-composer="toolbar"]')
        .className,
      textareaClass: node.querySelector("textarea").className
    }))
  assert.deepEqual(
    localComposer,
    remoteComposer,
    "local and remote must share composer width, toolbar layout and textarea styles"
  )
  const remoteEntry = page.getByRole("button", {
    name: "Remote Agent",
    exact: true
  })
  await remoteEntry.waitFor()
  assert.equal(await remoteEntry.innerText(), "")
  const icon = remoteEntry.locator("img")
  await icon.evaluate((image) => image.decode())
  assert.equal(await icon.getAttribute("alt"), "")
  const iconSize = await icon.boundingBox()
  assert.equal(iconSize.width, 16)
  assert.equal(iconSize.height, 16)
  await remoteEntry.hover()
  await page
    .getByRole("tooltip", { name: "Remote Agent", exact: true })
    .waitFor()
  await remoteEntry.click()
  await page
    .getByRole("button", { name: "Local models", exact: true })
    .waitFor()
  const input = page.getByPlaceholder("Ask the selected Agent…")
  await input.fill("History one")
  await page.getByRole("button", { name: "Submit", exact: true }).click()
  await page.waitForFunction(() => !document.querySelector("textarea").disabled)
  const previousConversation = [...histories.keys()].at(-1)
  const creations = writes.filter((w) => w.endpoint === "/conversations").length
  await page
    .getByRole("button", { name: "New remote chat", exact: true })
    .click()
  await page
    .getByText(
      "Chat with your QwenPaw Agent. Use the page icon beside the input to share the current page or selected text.",
      { exact: true }
    )
    .waitFor()
  assert.equal(
    writes.filter((w) => w.endpoint === "/conversations").length,
    creations,
    "new-chat icon must open a draft, not create an empty server conversation"
  )
  await input.fill("History two")
  await page.getByRole("button", { name: "Submit", exact: true }).click()
  await page.waitForFunction(() => !document.querySelector("textarea").disabled)
  await page
    .getByRole("button", { name: "Remote conversations", exact: true })
    .click()
  await page.locator(`[data-conversation-id="${previousConversation}"]`).click()
  await page
    .locator("article")
    .getByText("History one", { exact: true })
    .waitFor()
  assert.equal(
    await page
      .locator("article")
      .getByText("History two", { exact: true })
      .count(),
    0
  )
  console.log(
    "PASS: paw icon loads at 20px with accessible label, tooltip and working remote navigation"
  )
  console.log(
    "PASS: Chrome MV3 mount, Dexie v5→v6 preservation, transactional request dedup/conflict/busy/rollback, identity partitioning, continuous conversation, exact preview/send, article/selection snapshots, native approval DTO, reload recovery, no uncertain-write retry"
  )
} catch (error) {
  for (const page of context?.pages() || []) {
    console.error(
      "Browser diagnostic:",
      page.url(),
      (await page.locator("body").innerText()).slice(0, 4000)
    )
  }
  throw error
} finally {
  if (context) await context.close()
  await rm(profile, { recursive: true, force: true })
}
