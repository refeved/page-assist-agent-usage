// The remote channel never hands the page a server-side path: reply media is
// either a public URL the service passed through, or an id behind the bearer
// protected download endpoint. Ids are turned into blob URLs by the chat hook,
// and this mapping decides what the transcript can show for each message right
// now — nothing local to the Ollama path is involved here.
import type {
  RemoteAttachment,
  RemoteMessage
} from "@/services/qwenpaw/types"

export type MediaStatus = "loading" | "ready" | "failed"
export interface MediaEntry {
  status: MediaStatus
  url?: string
}
export type MediaStore = Record<string, MediaEntry>
export interface MessageFile {
  key: string
  name: string
  status: MediaStatus
  href?: string
  // A public link opens in a new tab; a fetched blob is saved as `name`.
  external: boolean
}
export interface MessageMedia {
  images: string[]
  files: MessageFile[]
}
const missing: MediaEntry = { status: "loading" }
const entryFor = (
  attachment: RemoteAttachment,
  store: MediaStore
): MediaEntry => {
  if (attachment.url) return { status: "ready", url: attachment.url }
  return (attachment.mediaId && store[attachment.mediaId]) || missing
}
export function messageMedia(
  message: RemoteMessage,
  store: MediaStore
): MessageMedia {
  const images: string[] = []
  const files: MessageFile[] = []
  // Rows restored from an older cache carry no attachment list at all.
  for (const [index, attachment] of (message.attachments || []).entries()) {
    const entry = entryFor(attachment, store)
    const key = `${message.id}:${index}`
    // A hosted link is opened by the browser itself, so its real name cannot
    // be kept on save; only a fetched blob earns the `download` attribute.
    const external = !attachment.mediaId
    const href = entry.status === "ready" ? entry.url : undefined
    // A thumbnail alone would leave a picture unsavable, so a ready image is
    // previewed inline *and* keeps the chip that carries the download. Every
    // attachment gets a chip: one still waiting for bytes shows a spinner
    // rather than vanishing from the transcript.
    if (attachment.kind === "image" && href) images.push(href)
    files.push({
      key,
      name: attachment.name,
      status: entry.status,
      href,
      external
    })
  }
  return { images, files }
}
