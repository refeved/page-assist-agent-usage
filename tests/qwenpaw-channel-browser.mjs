import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { once } from "node:events"
import { cp, mkdtemp, rm } from "node:fs/promises"
import net from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { chromium } from "playwright"

// Real plugin HTTP + BaseChannel + TaskTracker, deterministic Agent stub.
const root = path.resolve("..")
const profile = await mkdtemp(
  path.join(tmpdir(), "page-assist-channel-browser-")
)
const extension = path.join(profile, "extension")
const token = "page-assist-test-token-not-for-production"
let backend
let context
try {
  const socket = net.createServer()
  socket.listen(0, "127.0.0.1")
  await once(socket, "listening")
  const port = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  const service = `http://127.0.0.1:${port}`
  backend = spawn(
    process.env.QWENPAW_TEST_PYTHON || path.join(root, ".venv/bin/python"),
    [
      path.join(
        process.env.QWENPAW_CHANNEL_DIR ||
          path.join(root, "qwenpaw-channel-page-assist"),
        "tests/test_channel.py"
      ),
      String(port)
    ],
    { env: { ...process.env, PYTHONPATH: "" } }
  )
  let output = ""
  backend.stdout.on("data", (data) => {
    output += data
  })
  backend.stderr.on("data", (data) => {
    output += data
  })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Channel readiness timeout: ${output}`))
    }, 30000)
    const ready = () => {
      if (output.includes("CHANNEL_TEST_READY")) {
        cleanup()
        resolve()
      }
    }
    const exit = () => {
      cleanup()
      reject(new Error(`Channel exited before readiness: ${output}`))
    }
    const error = (e) => {
      cleanup()
      reject(e)
    }
    const cleanup = () => {
      clearTimeout(timer)
      backend.stdout.off("data", ready)
      backend.off("exit", exit)
      backend.off("error", error)
    }
    backend.stdout.on("data", ready)
    backend.once("exit", exit)
    backend.once("error", error)
    ready()
  })
  const headers = { Authorization: `Bearer ${token}` }
  const caps = await fetch(`${service}/api/page-assist/capabilities`, {
    headers
  })
  assert.equal(caps.status, 200)
  assert.equal((await caps.json()).recovery, false)
  await cp(path.resolve("build/chrome-mv3"), extension, { recursive: true })
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
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`${origin}/manifest.json`)
  await page.evaluate(
    async ({ service, token }) => {
      localStorage.setItem("i18nextLng", "en")
      await chrome.storage.local.set({
        "qwenpaw.mode": JSON.stringify("remote"),
        "qwenpaw.connection": JSON.stringify({
          id: "native-channel-test",
          baseUrl: service
        }),
        "qwenpaw.credential": JSON.stringify(token)
      })
    },
    { service, token }
  )
  await page.goto(`${origin}/sidepanel.html`)
  await page
    .getByRole("button", { name: "Connection and chat details", exact: true })
    .click()
  await page.getByText("Basic channel:", { exact: false }).waitFor()
  await page.getByRole("button", { name: "Close", exact: true }).click()
  // The composer shows an approval button whenever the channel declares
  // approvals support; it stays disabled while nothing is pending.
  const approvalButton = page.getByRole("button", {
    name: "Approvals",
    exact: true
  })
  assert.equal(await approvalButton.count(), 1)
  assert.equal(await approvalButton.isDisabled(), true)
  await page.getByRole("button", { name: /^Agent for new chat:/ }).click()
  await page.getByRole("menuitem", { name: "test-agent", exact: true }).click()
  const question = page.getByPlaceholder("Ask the selected Agent…")
  const send = page.getByRole("button", { name: "Submit", exact: true })
  await question.fill("First question 中文")
  await send.click()
  await page
    .getByText("Native reply 1: First question 中文", { exact: true })
    .waitFor()
  await page.waitForFunction(() => !document.querySelector("textarea").disabled)
  await question.fill("Follow up")
  await send.click()
  await page.getByText("Native reply 2: Follow up", { exact: true }).waitFor()
  await page.waitForFunction(() => !document.querySelector("textarea").disabled)
  assert.equal(await page.locator("article").count(), 4)
  if (process.env.SCREENSHOT_PATH)
    await page.screenshot({ path: process.env.SCREENSHOT_PATH })
  assert.equal(
    await page.getByText("HIDDEN_REASONING", { exact: false }).count(),
    0
  )
  await page.reload()
  await page.getByText("Native reply 2: Follow up", { exact: true }).waitFor()
  await question.fill("error")
  await send.click()
  await page.getByText("Failed", { exact: false }).first().waitFor()
  await page.waitForFunction(() => !document.querySelector("textarea").disabled)
  await question.fill("wait")
  await send.click()
  await page.getByText("Running", { exact: false }).first().waitFor()
  await page.reload()
  await page
    .getByText("Server does not support recovery; request outcome is unknown", {
      exact: false
    })
    .waitFor()
  assert.equal(await send.isDisabled(), true)
  assert.deepEqual(errors, [])
  console.log(
    "PASS: real plugin HTTP → native BaseChannel/TaskTracker → browser replies, follow-up, no hidden reasoning, failure status, and no-recovery lock"
  )
} catch (error) {
  for (const page of context?.pages() || [])
    console.error(
      "Browser diagnostic:",
      page.url(),
      (await page.locator("body").innerText()).slice(0, 4000)
    )
  throw error
} finally {
  if (context) await context.close()
  if (backend && backend.exitCode === null && backend.pid) {
    const exited = once(backend, "exit")
    backend.kill("SIGTERM")
    await exited
  }
  await rm(profile, { recursive: true, force: true })
}
