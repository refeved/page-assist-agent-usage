export const CONFIG_KEY = "qwenpaw.connection"
export const CREDENTIAL_KEY = "qwenpaw.credential"
export const MODE_KEY = "qwenpaw.mode"
// Cosmetic override kept apart from the connection so renaming never
// re-partitions the credential-scoped caches in `saveConnection`.
export const AGENT_NAME_KEY = "qwenpaw.agentName"
export function filterRemoteStorage(data: Record<string, unknown>) {
  // Plasmo may encode values as JSON; discard the entire namespace, not just token fields.
  return Object.fromEntries(
    Object.entries(data).filter(
      ([key]) => !key.toLowerCase().startsWith("qwenpaw")
    )
  )
}
export function serviceUrl(value: string) {
  const url = new URL(value)
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new Error(
      "QwenPaw requires HTTPS (HTTP is allowed only on localhost)"
    )
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "Use a service origin without credentials, path, query or fragment"
    )
  }
  return url.origin
}
export function sourceUrl(value: string) {
  const url = new URL(value)
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Only HTTP(S) HTML pages are supported")
  url.username = ""
  url.password = ""
  url.hash = ""
  // Query strings frequently contain login tokens or personal identifiers.
  url.search = ""
  return url.href
}
export async function contextHash(url: string, mode: string, content: string) {
  const bytes = new TextEncoder().encode(
    JSON.stringify([sourceUrl(url), mode, content])
  )
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return (
    "sha256:" +
    Array.from(new Uint8Array(hash), (b) =>
      b.toString(16).padStart(2, "0")
    ).join("")
  )
}
