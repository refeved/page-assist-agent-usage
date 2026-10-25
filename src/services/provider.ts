import { getMode, loadConnection, setMode } from "./qwenpaw/config"

/**
 * The backend that serves a chat turn.
 *
 * `local` covers Ollama, Chrome AI and OpenAI-compatible models.
 * `remote` is a generic Agent provider: QwenPaw is the first backend and lives
 * behind the `qwenpaw` namespace, so more backends can join without changing
 * this provider id or the UI labels.
 *
 * The selection reuses the existing `qwenpaw.mode` key (a legacy name) so
 * installed profiles and browser fixtures keep working without a migration.
 */
export type ProviderId = "local" | "remote"

export async function getProvider(): Promise<ProviderId> {
  const mode = await getMode()
  return mode === "remote" ? "remote" : "local"
}

export function setProvider(provider: ProviderId) {
  return setMode(provider)
}

export async function isRemoteConfigured() {
  try {
    const connection = await loadConnection()
    return Boolean(connection?.config.baseUrl && connection.token)
  } catch {
    // Credential scoping is unavailable outside Chrome; treat it as unconfigured
    // instead of breaking the sidebar entry.
    return false
  }
}

/**
 * A stale `remote` value must never render an unusable sidebar, so fall back to
 * local models when the remote channel has no usable connection.
 */
export async function resolveProvider(): Promise<ProviderId> {
  const provider = await getProvider()
  if (provider === "remote" && !(await isRemoteConfigured())) {
    return "local"
  }
  return provider
}
