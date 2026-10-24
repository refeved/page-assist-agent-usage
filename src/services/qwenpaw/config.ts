import { Storage } from "@plasmohq/storage"
import type { Connection } from "./types"
import { CONFIG_KEY, CREDENTIAL_KEY, MODE_KEY, serviceUrl } from "./privacy"

const storage = new Storage({ area: "local" })
export async function restrictCredentialAccess() {
  if (typeof chrome.storage.local.setAccessLevel !== "function") {
    throw new Error(
      "This browser cannot restrict credential storage to trusted extension contexts"
    )
  }
  await chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
}
export const getMode = () => storage.get<string>(MODE_KEY)
export const setMode = (mode: "local" | "remote") => storage.set(MODE_KEY, mode)
export async function loadConnection() {
  await restrictCredentialAccess()
  const config = await storage.get<Connection>(CONFIG_KEY)
  const token = await storage.get<string>(CREDENTIAL_KEY)
  return config && token ? { config, token } : undefined
}
export async function saveConnection(
  base: string,
  token: string,
  consoleAddress: string
) {
  const baseUrl = serviceUrl(base.trim())
  if (!token.trim() || /[\r\n]/.test(token))
    throw new Error("A browser-specific credential is required")
  let consoleUrl: string | undefined
  if (consoleAddress.trim()) {
    const url = new URL(consoleAddress.trim())
    if (
      url.origin !== baseUrl ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "Console must use the configured service origin without credentials or query"
      )
    }
    consoleUrl = url.href
  }
  // Rotating credentials always partitions existing caches, even before authentication.
  const config: Connection = { id: crypto.randomUUID(), baseUrl, consoleUrl }
  await restrictCredentialAccess()
  await storage.remove(CONFIG_KEY)
  await storage.set(CREDENTIAL_KEY, token.trim())
  await storage.set(CONFIG_KEY, config)
  return config
}
