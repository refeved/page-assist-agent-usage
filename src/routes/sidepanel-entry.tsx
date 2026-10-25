import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"
import { Alert, Spin } from "antd"
import SidepanelChat from "./sidepanel-chat"
import { resolveProvider, type ProviderId } from "@/services/provider"

/**
 * Single sidebar entry point: pick the shell for the active provider.
 *
 * A `remote` selection without a usable connection falls back to local models
 * so a half-configured channel never renders a dead sidebar.
 */
export default function SidepanelEntry() {
  const [provider, setProvider] = useState<ProviderId>()
  const [error, setError] = useState("")
  useEffect(() => {
    let live = true
    resolveProvider()
      .then((value) => {
        if (live) setProvider(value)
      })
      .catch((e) => {
        if (live) setError(String(e))
      })
    return () => {
      live = false
    }
  }, [])
  if (error) return <Alert type="error" message={error} />
  if (!provider) return <Spin />
  return provider === "remote" ? (
    <Navigate to="/qwenpaw" replace />
  ) : (
    <SidepanelChat />
  )
}
