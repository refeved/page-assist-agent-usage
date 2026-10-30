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
  RELAY_SAFE_BYTES,
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
  attachmentList,
  capabilities,
  message,
  output,
  request,
  uploadedAttachment
} from "../src/services/qwenpaw/validation.ts"
import { messageMedia } from "../src/libs/qwenpaw/message-media.ts"
import type { MediaStore } from "../src/libs/qwenpaw/message-media.ts"
import { isTerminal } from "../src/services/qwenpaw/types.ts"
import { resolveAgentName } from "../src/services/qwenpaw/agent-name.ts"
import type {
  RemoteAttachment,
  RemoteMessage
} from "../src/services/qwenpaw/types.ts"

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
  assert.equal(legacy.media, false)
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
    maxAttachments: 4,
    media: true
  })
  assert.equal(modern.attachments, true)
  assert.equal(modern.maxAttachments, 4)
  assert.equal(modern.maxAttachmentBytes, 5242880)
  assert.equal(modern.media, true)
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
  // Full quality by default: only the channel's own cap triggers re-encode.
  assert.equal(COMPRESS_ABOVE, 5 * 1024 * 1024)
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

  // A tight relay-safe target walks down the ladder until a rung fits: the
  // fake encoder yields ~400 bytes per pixel of width, so the first fitting
  // rung is the 1600px pass.
  const fiveM = new File([new Uint8Array(5 * 1024 * 1024)], "big.png", {
    type: "image/png"
  })
  const rungs: Array<{ width: number; quality: number }> = []
  const stepped = await compressScreenshotBlob(
    fiveM,
    {
      decode: async () => ({ width: 3000, height: 2000 }),
      encode: async (_b, width, _h, quality) => {
        rungs.push({ width, quality })
        return new Blob([new Uint8Array(width * 400)], { type: "image/jpeg" })
      }
    },
    RELAY_SAFE_BYTES
  )
  assert.equal(stepped.size, 1600 * 400)
  assert.deepEqual(
    rungs.map((r) => r.width),
    [2560, 1600]
  )
})

test("compressImageFile only touches large images", async () => {
  const log = new File([new Uint8Array(COMPRESS_ABOVE + 1)], "app.log", {
    type: "application/octet-stream"
  })
  assert.equal(await compressImageFile(log), log)
  const tiny = new File([new Uint8Array(10)], "x.png", { type: "image/png" })
  assert.equal(await compressImageFile(tiny), tiny)
})

test("reply attachments need exactly one readable, public-free source", () => {
  // Servers predating reply media simply omit the field.
  assert.deepEqual(attachmentList(undefined), [])
  assert.deepEqual(
    attachmentList([
      {
        mediaId: "m",
        kind: "file",
        name: "a.pdf",
        mediaType: "application/pdf"
      }
    ]),
    [
      {
        mediaId: "m",
        url: undefined,
        kind: "file",
        name: "a.pdf",
        mediaType: "application/pdf",
        bytes: 0
      }
    ]
  )
  const linked = attachmentList([
    {
      url: "https://cdn.example/chart.png",
      kind: "image",
      name: "chart.png",
      mediaType: "image/png"
    }
  ])
  assert.equal(linked[0].url, "https://cdn.example/chart.png")
  assert.equal(linked[0].mediaId, undefined)
  for (const row of [
    { mediaId: "m", kind: "exe", name: "a", mediaType: "" },
    { kind: "file", name: "a", mediaType: "" },
    { mediaId: "", kind: "file", name: "a", mediaType: "" },
    { url: "file:///secret/a.pdf", kind: "file", name: "a", mediaType: "" },
    { url: "javascript:alert(1)", kind: "file", name: "a", mediaType: "" },
    { url: "not a url", kind: "file", name: "a", mediaType: "" }
  ]) {
    assert.throws(() => attachmentList([row]))
  }
  assert.throws(() =>
    attachmentList(
      Array.from({ length: 9 }, () => ({
        mediaId: "m",
        kind: "file",
        name: "a",
        mediaType: ""
      }))
    )
  )
})

test("messages and snapshots carry attachments, deltas do not erase them", () => {
  const legacy = message({
    id: "m",
    requestId: "r",
    role: "assistant",
    content: "hi",
    status: "complete"
  })
  assert.deepEqual(legacy.attachments, [])
  const media = [
    {
      mediaId: "m1",
      kind: "image",
      name: "p.png",
      mediaType: "image/png",
      bytes: 3
    }
  ]
  const snapshot = output({
    type: "message.snapshot",
    requestId: "r",
    messageId: "m",
    content: "hi",
    attachments: media,
    status: "complete"
  })
  if (snapshot.type !== "message.snapshot")
    throw new Error("Expected a message snapshot")
  assert.deepEqual(
    message({
      id: "m",
      requestId: "r",
      role: "assistant",
      content: "hi",
      attachments: media,
      status: "complete"
    }).attachments,
    snapshot.attachments
  )
  let rows = applyMessageEvent([], snapshot)
  assert.equal(rows[0].attachments.length, 1)
  rows = applyMessageEvent(
    rows,
    output({
      type: "message.delta",
      requestId: "r",
      messageId: "m",
      delta: "!"
    })
  )
  assert.equal(rows[0].content, "hi!")
  assert.equal(rows[0].attachments.length, 1)
})

test("media bytes use the authenticated route without insisting on JSON", async () => {
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(url, "https://service.example/api/page-assist/media/m%201")
    assert.equal(init?.redirect, "error")
    assert.equal(init?.credentials, "omit")
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer restricted"
    )
    assert.equal((init?.headers as Record<string, string>).Accept, "*/*")
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { "content-type": "image/png" }
    })
  }
  const blob = await new QwenPawClient(config, "restricted", fetcher).media(
    "m 1"
  )
  assert.equal(blob.size, 3)
  await assert.rejects(
    new QwenPawClient(
      config,
      "x",
      async () => new Response("gone", { status: 404 })
    ).media("m"),
    (e: unknown) => e instanceof RemoteHTTPError && e.status === 404
  )
  // An id that is not an identifier never reaches the URL at all.
  await assert.rejects(
    new QwenPawClient(config, "x", async () => Response.json({})).media("")
  )
})

test("the transcript shows ready media and explains missing bytes", () => {
  const attachment = (
    name: string,
    kind: "image" | "file",
    source: { mediaId?: string; url?: string }
  ): RemoteAttachment => ({
    mediaId: source.mediaId,
    url: source.url,
    kind,
    name,
    mediaType: `${kind}/x`,
    bytes: source.mediaId ? 1 : 0
  })
  const row: RemoteMessage = {
    id: "m",
    requestId: "r",
    role: "assistant",
    content: "here",
    status: "complete",
    attachments: [
      attachment("a.png", "image", { mediaId: "ready" }),
      attachment("b.png", "image", { mediaId: "pending" }),
      attachment("c.png", "image", { mediaId: "gone" }),
      attachment("d.pdf", "file", { mediaId: "doc" }),
      attachment("e.png", "image", { url: "https://cdn.example/e.png" })
    ]
  }
  const store: MediaStore = {
    ready: { status: "ready", url: "blob:1" },
    gone: { status: "failed" },
    doc: { status: "ready", url: "blob:2" }
  }
  const media = messageMedia(row, store)
  assert.deepEqual(media.images, ["blob:1", "https://cdn.example/e.png"])
  assert.deepEqual(
    media.files.map((file) => [
      file.name,
      file.status,
      file.href,
      file.external
    ]),
    [
      // A previewable picture still needs a saveable chip.
      ["a.png", "ready", "blob:1", false],
      // One whose bytes are still coming is visible as a pending chip.
      ["b.png", "loading", undefined, false],
      ["c.png", "failed", undefined, false],
      ["d.pdf", "ready", "blob:2", false],
      ["e.png", "ready", "https://cdn.example/e.png", true]
    ]
  )
  const hosted = attachment("f.pdf", "file", {
    url: "https://cdn.example/f.pdf"
  })
  const link = messageMedia(
    { ...row, attachments: [hosted] },
    {}
  )
  assert.deepEqual(link.files, [
    {
      key: "m:0",
      name: "f.pdf",
      status: "ready",
      href: "https://cdn.example/f.pdf",
      external: true
    }
  ])
  // Rows cached before reply media have no list at all.
  assert.deepEqual(
    messageMedia({ ...row, attachments: undefined as never }, store),
    { images: [], files: [] }
  )
})

