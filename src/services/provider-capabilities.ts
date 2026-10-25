import { useEffect, useState } from "react"
import { getProvider, type ProviderId } from "./provider"

/**
 * A user-facing feature. Components ask for a capability instead of branching
 * on the provider id, so adding a provider never means touching every surface.
 */
export type Capability =
  | "chat"
  | "pageContext"
  | "history"
  | "newChat"
  | "approvals"
  | "rag"
  | "webSearch"
  | "mcp"
  | "pageAction"
  | "webMcp"
  | "modelSettings"
  | "prompts"
  | "tempChat"
  | "vision"
  | "ocr"
  | "tts"
  | "speechToText"
  | "fileUpload"
  | "imageUpload"

export type ProviderCapabilities = Record<Capability, boolean>

const LOCAL_CAPABILITIES: ProviderCapabilities = {
  chat: true,
  pageContext: true,
  history: true,
  newChat: true,
  approvals: false,
  rag: true,
  webSearch: true,
  mcp: true,
  pageAction: true,
  webMcp: true,
  modelSettings: true,
  prompts: true,
  tempChat: true,
  vision: true,
  ocr: true,
  tts: true,
  speechToText: true,
  fileUpload: true,
  imageUpload: true
}

/**
 * The remote channel only transports text plus a page snapshot. Everything the
 * Agent does with tools runs on the QwenPaw side, so local-only affordances stay
 * off and the composer explains why instead of silently disappearing.
 */
const REMOTE_CAPABILITIES: ProviderCapabilities = {
  chat: true,
  pageContext: true,
  history: true,
  newChat: true,
  approvals: true,
  rag: false,
  webSearch: false,
  mcp: false,
  pageAction: false,
  webMcp: false,
  modelSettings: false,
  prompts: false,
  tempChat: false,
  vision: false,
  ocr: false,
  tts: false,
  speechToText: false,
  fileUpload: false,
  imageUpload: false
}

export const capabilitiesOf = (provider: ProviderId): ProviderCapabilities =>
  provider === "remote" ? REMOTE_CAPABILITIES : LOCAL_CAPABILITIES

export const supports = (provider: ProviderId, capability: Capability) =>
  capabilitiesOf(provider)[capability]

/**
 * Resolves capabilities for the active provider unless the caller already
 * knows which one it is rendering.
 */
export function useProviderCapabilities(provider?: ProviderId) {
  const [resolved, setResolved] = useState<ProviderId | undefined>(provider)

  useEffect(() => {
    if (provider) {
      setResolved(provider)
      return
    }
    let live = true
    getProvider()
      .then((value) => {
        if (live) setResolved(value)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [provider])

  const id: ProviderId = provider ?? resolved ?? "local"
  return { provider: id, capabilities: capabilitiesOf(id) }
}
