import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"
import { Alert, Spin } from "antd"
import SidepanelChat from "./sidepanel-chat"
import { getMode } from "@/services/qwenpaw/config"

export default function SidepanelEntry() {
  const [mode, setMode] = useState<string>()
  const [error, setError] = useState("")
  useEffect(() => {
    let live = true
    getMode()
      .then((value) => {
        if (live) setMode(value || "local")
      })
      .catch((e) => {
        if (live) setError(String(e))
      })
    return () => {
      live = false
    }
  }, [])
  if (error) return <Alert type="error" message={error} />
  if (!mode) return <Spin />
  return mode === "remote" ? (
    <Navigate to="/qwenpaw" replace />
  ) : (
    <SidepanelChat />
  )
}
