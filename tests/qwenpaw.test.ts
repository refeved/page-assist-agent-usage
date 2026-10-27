import assert from "node:assert/strict"
import { test } from "node:test"
import { readSSE } from "../src/services/qwenpaw/sse.ts"
import {
  QwenPawClient,
  RemoteHTTPError
} from "../src/services/qwenpaw/client.ts"
import { applyMessageEvent } from "../src/services/qwenpaw/reducer.ts"
import { dataUrlToFile } from "../src/libs/qwenpaw/image-payload.ts"
import {
  COMPRESS_ABOVE,
  compressImageFile,
  compressScreenshotBlob,
  fitEdges
} from "../src/libs/qwenpaw/compress-image.ts"
import {
  contextHash,
  filterRemoteStorage,
  serviceUrl,
  sourceUrl
} from "../src/services/qwenpaw/privacy.ts"
import {
  approval,
  capabilities,
  output,
  request,
  uploadedAttachment
} from "../src/services/qwenpaw/validation.ts"
import { isTerminal } from "../src/services/qwenpaw/types.ts"
import { resolveAgentName } from "../src/services/qwenpaw/agent-name.ts"
import type { RemoteMessage } from "../src/services/qwenpaw/types.ts"

const stream = (bytes: Uint8Array, size = 1) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size)
        controller.enqueue(bytes.slice(i, i + size))
      controller.close()
    }
  })
test("SSE handles byte-split UTF-8, CRLF, heartbeat, ids and multiline data", async () => {
  const bytes = new TextEncoder().encode(
    ': heartbeat\r\nid: 1\r\nevent: message.snapshot\r\ndata: {"text":\r\ndata: "中文"}\r\n\r\n'
  )
  const frames = []
  for await (const f of readSSE(stream(bytes))) frames.push(f)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].id, "1")
  assert.deepEqual(JSON.parse(frames[0].data), { text: "中文" })
})
test("SSE does not dispatch an incomplete EOF frame or interpret EOF as completion", async () => {
  const frames = []
  for await (const f of readSSE(
    stream(new TextEncoder().encode('data: {"partial":true}\n'))
  ))
    frames.push(f)
  assert.deepEqual(frames, [])
  assert.equal(isTerminal("unknown"), false)
  assert.equal(isTerminal("waiting_approval"), false)
  assert.equal(isTerminal("completed"), true)
})
test("service URL allows only trusted origins and loopback HTTP", () => {
  assert.equal(
    serviceUrl("https://service.example/"),
    "https://service.example"
  )
  assert.equal(serviceUrl("http://127.0.0.1:9876"), "http://127.0.0.1:9876")
  for (const value of [
    "http://remote.example",
    "https://name:secret@service.example",
    "https://service.example/api",
    "https://service.example/?token=x"
  ]) {
    assert.throws(() => serviceUrl(value))
  }
})
test("source metadata removes credentials, fragments and sensitive query strings", () => {
  assert.equal(
    sourceUrl("https://user:pass@example.com/docs?access_token=secret#part"),
    "https://example.com/docs"
  )
  assert.throws(() => sourceUrl("file:///secret"))
  assert.throws(() => sourceUrl("chrome://settings"))
})
test("context hashes bind sanitized source, extraction mode and exact content", async () => {
  const a = await contextHash(
    "https://example.com/a?token=x",
    "article",
    "hello"
  )
  assert.equal(
    a,
    await contextHash("https://example.com/a#part", "article", "hello")
  )
  assert.notEqual(
    a,
    await contextHash("https://example.com/b", "article", "hello")
  )
  assert.notEqual(
    a,
    await contextHash("https://example.com/a", "selection", "hello")
  )
  assert.notEqual(
    a,
    await contextHash("https://example.com/a", "article", "hello!")
  )
})
test("both export and untrusted import storage filtering exclude the remote namespace", () => {
  const data = {
    selectedModel: "local",
    "qwenpaw.credential": '"secret"',
    "qwenpaw.connection": { token: "injected" },
    "QwenPaw.Future": "secret",
    "qwenpaw.decision.id": "pending"
  }
  assert.deepEqual(filterRemoteStorage(data), { selectedModel: "local" })
  assert.equal(data["qwenpaw.credential"], '"secret"')
})
test("snapshots replace replayed output rather than appending duplicates", () => {
  let messages: RemoteMessage[] = []
  const snapshot = output({
    type: "message.snapshot",
    requestId: "r",
    messageId: "m",
    content: "Hello",
    status: "streaming"
  })
  messages = applyMessageEvent(messages, snapshot)
  messages = applyMessageEvent(
    messages,
    output({
      type: "message.delta",
      requestId: "r",
      messageId: "m",
      delta: " world"
    })
  )
  messages = applyMessageEvent(messages, snapshot)
  assert.equal(messages.length, 1)
  assert.equal(messages[0].content, "Hello")
  assert.throws(() =>
    applyMessageEvent(
      messages,
      output({
        type: "message.snapshot",
        requestId: "other",
        messageId: "m",
        content: "attack",
        status: "done"
      })
    )
  )
})
test("DTO validation fails closed for unknown states, protocols and incomplete approvals", () => {
  assert.throws(() =>
    request({ requestId: "r", conversationId: "c", state: "idle" })
  )
  assert.throws(() => capabilities({ protocolVersion: 2 }))
  assert.throws(() => approval({ id: "fake", target: "from markdown" }))
  assert.throws(() => output({ type: "execute.command", requestId: "r" }))
})
test("capabilities stay valid for servers without attachment fields", () => {
  const legacy = capabilities({
    protocolVersion: 1,
    instanceId: "i",
    principalScope: "p",
    maxContextChars: 30000,
    maxTextChars: 8000,
    recovery: false,
    approvals: true,
    approvalEvents: false
  })
  assert.equal(legacy.attachments, false)
  assert.equal(legacy.maxAttachments, 0)
  assert.equal(legacy.maxAttachmentBytes, 0)
  const modern = capabilities({
    protocolVersion: 1,
    instanceId: "i",
    principalScope: "p",
    maxContextChars: 30000,
    maxTextChars: 8000,
    recovery: false,
    approvals: true,
    approvalEvents: false,
    attachments: true,
    maxAttachmentBytes: 5242880,
    maxAttachments: 4
  })
  assert.equal(modern.attachments, true)
  assert.equal(modern.maxAttachments, 4)
  assert.equal(modern.maxAttachmentBytes, 5242880)
  assert.equal(
    uploadedAttachment({
      attachmentId: "a",
      name: "shot.png",
      kind: "image",
      mediaType: "image/png",
      bytes: 12
    }).kind,
    "image"
  )
  assert.throws(() => uploadedAttachment({ attachmentId: "a", kind: "exe" }))
})
const config = { id: "local", baseUrl: "https://service.example" }
test("client authenticates fixed paths, rejects redirects and sends no history", async () => {
  let calls = 0
  const fetcher: typeof fetch = async (url, init) => {
    calls++
    assert.equal(
      url,
      "https://service.example/api/page-assist/conversations/c/messages"
    )
    assert.equal(init?.redirect, "error")
    assert.equal(init?.credentials, "omit")
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer restricted"
    )
    assert.deepEqual(JSON.parse(String(init?.body)), {
      requestId: "r",
      text: "new question"
    })
    return Response.json({
      requestId: "r",
      conversationId: "c",
      state: "accepted"
    })
  }
  await new QwenPawClient(config, "restricted", fetcher).submit("c", {
    requestId: "r",
    text: "new question"
  })
  assert.equal(calls, 1)
})
test("screenshot data URLs rebuild as ordinary PNG files", () => {
  const png = Buffer.from("\x89PNG\r\n\x1a\n pixel-payload", "binary")
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`
  const file = dataUrlToFile(dataUrl, "screenshot-1.png")
  assert.equal(file.name, "screenshot-1.png")
  assert.equal(file.type, "image/png")
  assert.equal(file.size, png.length)

  // A bare base64 body (no data: prefix) still decodes with a sane default.
  const bare = dataUrlToFile(png.toString("base64"), "shot.png")
  assert.equal(bare.type, "image/png")
  assert.equal(bare.size, png.length)

  assert.throws(() => dataUrlToFile("data:image/png;base64,", "x.png"))
})

test("attachment uploads post base64 once and fail closed", async () => {
  let calls = 0
  const fetcher: typeof fetch = async (url, init) => {
    calls++
    assert.equal(url, "https://service.example/api/page-assist/attachments")
    assert.deepEqual(JSON.parse(String(init?.body)), {
      name: "shot.png",
      mediaType: "image/png",
      data: "cG5n"
    })
    return Response.json({
      attachmentId: "a",
      name: "shot.png",
      kind: "image",
      mediaType: "image/png",
      bytes: 3
    })
  }
  const uploaded = await new QwenPawClient(
    config,
    "restricted",
    fetcher
  ).uploadAttachment({ name: "shot.png", mediaType: "image/png", data: "cG5n" })
  assert.equal(uploaded.attachmentId, "a")
  assert.equal(calls, 1)
  await assert.rejects(
    new QwenPawClient(
      config,
      "x",
      async () =>
        Response.json({ attachmentId: "a", name: "n", kind: "exe" })
    ).uploadAttachment({ name: "n", mediaType: "", data: "x" })
  )
})
for (const status of [401, 403, 409, 429, 500]) {
  test(`HTTP ${status} is explicit and writes are never retried`, async () => {
    let calls = 0
    const client = new QwenPawClient(config, "restricted", async () => {
      calls++
      return new Response("not a JSON error body", { status })
    })
    await assert.rejects(
      client.create("agent"),
      (e: unknown) => e instanceof RemoteHTTPError && e.status === status
    )
    assert.equal(calls, 1)
  })
}
test("client rejects non-JSON success responses and mismatched bindings", async () => {
  await assert.rejects(
    new QwenPawClient(
      config,
      "x",
      async () => new Response("<html>login</html>")
    ).capabilities()
  )
  await assert.rejects(
    new QwenPawClient(config, "x", async () =>
      Response.json({
        requestId: "other",
        conversationId: "c",
        state: "running"
      })
    ).request("r", "c")
  )
  await assert.rejects(
    new QwenPawClient(config, "x", async () =>
      Response.json({
        conversationId: "c",
        complete: false,
        messages: []
      })
    ).messages("c")
  )
})
test("streams require snapshots before deltas and reject non-JSON events", async () => {
  for (const payload of [
    "not json",
    '{"type":"message.delta","requestId":"r","messageId":"m","delta":"bad"}'
  ]) {
    const client = new QwenPawClient(
      config,
      "x",
      async () =>
        new Response(`data: ${payload}\n\n`, {
          headers: { "content-type": "text/event-stream" }
        })
    )
    await assert.rejects(async () => {
      for await (const _event of client.events(
        "r",
        new AbortController().signal
      )) {
        /* consume */
      }
    })
  }
})
test("an empty SSE stream yields no fabricated terminal event", async () => {
  const client = new QwenPawClient(
    config,
    "x",
    async () =>
      new Response(": heartbeat\n\n", {
        headers: { "content-type": "text/event-stream" }
      })
  )
  const events = []
  for await (const e of client.events("r", new AbortController().signal))
    events.push(e)
  assert.deepEqual(events, [])
})
test("approval notifications and event gaps requery without implying approval at EOF", async () => {
  const body =
    'data: {"type":"approvals.changed"}\n\ndata: {"type":"events.gap"}\n\n'
  const client = new QwenPawClient(
    config,
    "x",
    async () =>
      new Response(body, { headers: { "content-type": "text/event-stream" } })
  )
  let reconciled = 0
  await assert.rejects(
    client.notifications(new AbortController().signal, async () => {
      reconciled++
    }),
    /disconnected/
  )
  assert.equal(reconciled, 2)
})
test("unconfirmed approval responses are not converted into success or retried", async () => {
  let calls = 0
  const client = new QwenPawClient(config, "x", async () => {
    calls++
    return Response.json({
      decisionId: "d",
      approvalId: "a",
      approved: true,
      status: "unknown"
    })
  })
  await assert.rejects(
    client.decide("a", { decisionId: "d", approved: true, scope: "exact" }),
    /not confirmed/
  )
  assert.equal(calls, 1)
})
test("agent labels prefer the custom name, then the channel name, then default", () => {
  const agents = [{ id: "default", name: "Research Agent" }]
  assert.equal(resolveAgentName("default", agents, " My Agent "), "My Agent")
  assert.equal(resolveAgentName("default", agents), "Research Agent")
  assert.equal(
    resolveAgentName("default", [{ id: "default", name: "   " }]),
    "default"
  )
  assert.equal(resolveAgentName("missing", agents), "default")
  assert.equal(resolveAgentName(undefined, agents, ""), "default")
})

test("oversized screenshots are re-encoded before they can hit the cap", () => {
  assert.deepEqual(fitEdges(4000, 3000, 2560), { width: 2560, height: 1920 })
  assert.deepEqual(fitEdges(1000, 800, 2560), { width: 1000, height: 800 })
  assert.ok(COMPRESS_ABOVE < 5 * 1024 * 1024)
})

test("compressScreenshotBlob re-encodes only what needs it", async () => {
  const small = new Blob([new Uint8Array(1024)], { type: "image/jpeg" })
  let decoded = 0
  const codec = {
    decode: async () => {
      decoded++
      return { width: 4000, height: 3000 }
    },
    encode: async (_b: unknown, width: number, height: number) => {
      assert.deepEqual({ width, height }, { width: 2560, height: 1920 })
      return small
    }
  }
  const big = new File([new Uint8Array(6 * 1024 * 1024)], "shot.png", {
    type: "image/png"
  })
  assert.equal(await compressScreenshotBlob(big, codec), small)
  assert.equal(decoded, 1)

  // Small inputs pass through untouched, and a re-encode that would only
  // grow the payload keeps the original bytes instead.
  const tiny = new File([new Uint8Array(10)], "x.png", { type: "image/png" })
  const never = {
    decode: async () => {
      throw new Error("must not decode")
    },
    encode: async () => small
  }
  assert.equal(await compressScreenshotBlob(tiny, never), tiny)

  const lossy = new File([new Uint8Array(4 * 1024 * 1024)], "flat.png", {
    type: "image/png"
  })
  const grown = new Blob([new Uint8Array(5 * 1024 * 1024)], {
    type: "image/jpeg"
  })
  const kept = await compressScreenshotBlob(lossy, {
    decode: async () => ({ width: 1000, height: 700 }),
    encode: async () => grown
  })
  assert.equal(kept, lossy)
})

test("compressImageFile only touches large images", async () => {
  const log = new File([new Uint8Array(COMPRESS_ABOVE + 1)], "app.log", {
    type: "application/octet-stream"
  })
  assert.equal(await compressImageFile(log), log)
  const tiny = new File([new Uint8Array(10)], "x.png", { type: "image/png" })
  assert.equal(await compressImageFile(tiny), tiny)
})
