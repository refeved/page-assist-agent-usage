import { useEffect, useState } from "react"
import { Alert, Button, Input, Space } from "antd"
import { useTranslation } from "react-i18next"
import {
  loadAgentName,
  loadConnection,
  saveAgentName,
  saveConnection
} from "@/services/qwenpaw/config"
import { QwenPawClient } from "@/services/qwenpaw/client"
import { serviceUrl } from "@/services/qwenpaw/privacy"

type QwenPawConnectionFormProps = {
  /** Called after a connection was persisted successfully. */
  onConfigured?: () => void
  /** Trims the spacing when embedded in the empty sidebar card. */
  compact?: boolean
}

/**
 * Service origin, browser credential and optional console address.
 *
 * Shared by the options page, the sidebar settings page and the first-run card
 * so there is exactly one place that knows how a connection is validated.
 */
export const QwenPawConnectionForm = ({
  onConfigured,
  compact = false
}: QwenPawConnectionFormProps) => {
  const { t } = useTranslation("qwenpaw")
  const [base, setBase] = useState("")
  const [token, setToken] = useState("")
  const [consoleUrl, setConsoleUrl] = useState("")
  const [agentName, setAgentName] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    Promise.all([loadConnection(), loadAgentName()])
      .then(([saved, savedAgentName]) => {
        if (!live) return
        setAgentName(savedAgentName)
        if (saved) {
          setBase(saved.config.baseUrl)
          setToken(saved.token)
          setConsoleUrl(saved.config.consoleUrl || "")
        }
      })
      .catch((e) => {
        if (live) setError(String(e))
      })
    return () => {
      live = false
    }
  }, [])

  const run = async (save: boolean) => {
    setBusy(true)
    setError("")
    setSuccess("")
    try {
      if (save) {
        await saveConnection(base, token, consoleUrl)
        await saveAgentName(agentName)
        setSuccess(t("saved"))
        onConfigured?.()
      } else {
        const client = new QwenPawClient(
          { id: "test", baseUrl: serviceUrl(base.trim()) },
          token.trim()
        )
        await client.capabilities()
        const agents = await client.agents()
        setSuccess(t("tested", { count: agents.length }))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Space
      direction="vertical"
      size={compact ? "small" : "middle"}
      className="w-full">
      <label htmlFor="qp-base" className="text-sm font-medium dark:text-gray-200">
        {t("service")}
      </label>
      <Input
        id="qp-base"
        value={base}
        onChange={(e) => setBase(e.target.value)}
        placeholder="https://qwenpaw.example.com"
      />
      <label
        htmlFor="qp-token"
        className="text-sm font-medium dark:text-gray-200">
        {t("credential")}
      </label>
      <Input.Password
        id="qp-token"
        autoComplete="off"
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <label
        htmlFor="qp-console"
        className="text-sm font-medium dark:text-gray-200">
        {t("console")}
      </label>
      <Input
        id="qp-console"
        value={consoleUrl}
        onChange={(e) => setConsoleUrl(e.target.value)}
      />
      <label
        htmlFor="qp-agent-name"
        className="text-sm font-medium dark:text-gray-200">
        {t("agentName")}
      </label>
      <Input
        id="qp-agent-name"
        value={agentName}
        onChange={(e) => setAgentName(e.target.value)}
        placeholder={t("agentNamePlaceholder")}
      />
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t("agentNameHint")}
      </p>
      <Space wrap>
        <Button
          loading={busy}
          disabled={!base || !token}
          onClick={() => void run(false)}>
          {t("test")}
        </Button>
        <Button
          type="primary"
          loading={busy}
          disabled={!base || !token}
          onClick={() => void run(true)}>
          {t("save")}
        </Button>
      </Space>
      {error && (
        <Alert type="error" message={t("error")} description={error} />
      )}
      {success && <Alert type="success" message={success} />}
    </Space>
  )
}
