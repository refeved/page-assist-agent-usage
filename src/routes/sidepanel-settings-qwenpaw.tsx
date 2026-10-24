import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Alert, Button, Input, Space } from "antd"
import { useTranslation } from "react-i18next"
import { loadConnection, saveConnection } from "@/services/qwenpaw/config"
import { QwenPawClient } from "@/services/qwenpaw/client"
import { serviceUrl } from "@/services/qwenpaw/privacy"

export default function QwenPawSettings() {
  const { t } = useTranslation("qwenpaw")
  const [base, setBase] = useState("")
  const [token, setToken] = useState("")
  const [consoleUrl, setConsoleUrl] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    loadConnection()
      .then((saved) => {
        if (live && saved) {
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
        setSuccess(t("saved"))
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
    <main className="min-h-screen bg-white p-4 text-gray-900 dark:bg-[#1a1a1a] dark:text-gray-100">
      <Space direction="vertical" className="w-full">
        <Link to="/qwenpaw">← {t("back")}</Link>
        <h1 className="text-lg font-semibold">QwenPaw — {t("settings")}</h1>
        <Alert type="info" message={t("unavailable")} />
        <p>{t("privacy")}</p>
        <label htmlFor="qp-base">{t("service")}</label>
        <Input
          id="qp-base"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          placeholder="https://qwenpaw.example.com"
        />
        <label htmlFor="qp-token">{t("credential")}</label>
        <Input.Password
          id="qp-token"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <label htmlFor="qp-console">{t("console")}</label>
        <Input
          id="qp-console"
          value={consoleUrl}
          onChange={(e) => setConsoleUrl(e.target.value)}
        />
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
    </main>
  )
}
