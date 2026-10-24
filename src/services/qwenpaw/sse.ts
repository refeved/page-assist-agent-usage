export interface SSEFrame {
  event: string
  data: string
  id?: string
}

export async function* readSSE(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<SSEFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let event = ""
  let eventId: string | undefined
  let data: string[] = []
  const line = (value: string): SSEFrame | undefined => {
    if (!value) {
      const frame = data.length
        ? { event, data: data.join("\n"), id: eventId }
        : undefined
      event = ""
      data = []
      return frame
    }
    if (value.startsWith(":")) return
    const colon = value.indexOf(":")
    const field = colon < 0 ? value : value.slice(0, colon)
    let content = colon < 0 ? "" : value.slice(colon + 1)
    if (content.startsWith(" ")) content = content.slice(1)
    if (field === "event") event = content
    if (field === "data") data.push(content)
    if (field === "id" && !content.includes("\0")) eventId = content
  }
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true })
      if (buffer.length + data.join("").length > 2_000_000)
        throw new Error("SSE frame exceeds limit")
      let end: number
      while ((end = buffer.search(/[\r\n]/)) >= 0) {
        if (!done && buffer[end] === "\r" && end === buffer.length - 1) break
        const width = buffer[end] === "\r" && buffer[end + 1] === "\n" ? 2 : 1
        const frame = line(buffer.slice(0, end))
        buffer = buffer.slice(end + width)
        if (frame) yield frame
      }
      // An incomplete event at EOF is not a committed event.
      if (done) break
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}
