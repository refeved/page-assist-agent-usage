import { useEffect, useState } from "react"
import { Tooltip } from "antd"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import pawIcon from "~/assets/qwenpaw-paw.png"
import {
  isRemoteConfigured,
  setProvider,
  type ProviderId
} from "@/services/provider"
import { useStoreMessageOption } from "@/store/option"
import { OllamaIcon } from "../Icons/Ollama"

/**
 * Two-state provider toggle shown in the sidebar header.
 *
 * Switching providers only rewrites `qwenpaw.mode` and moves to the matching
 * route; chat engines stay separate, so no conversation is torn down.
 */
export const ProviderSwitch = ({ current }: { current: ProviderId }) => {
  const { t } = useTranslation("qwenpaw")
  const navigate = useNavigate()
  const [remoteReady, setRemoteReady] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  // The remote channel ships Chrome-only; Firefox keeps the local shell only.
  const remoteAvailable = import.meta.env.BROWSER !== "firefox"

  useEffect(() => {
    if (!remoteAvailable) return
    let live = true
    isRemoteConfigured()
      .then((ready) => {
        if (live) setRemoteReady(ready)
      })
      .catch(() => {
        if (live) setRemoteReady(false)
      })
    return () => {
      live = false
    }
  }, [remoteAvailable])

  const select = async (target: ProviderId) => {
    if (target === current || busy) return
    if (target === "remote" && remoteReady === false) {
      navigate("/settings")
      return
    }
    setBusy(true)
    try {
      await setProvider(target)
      // RAG is local-only, so a stale rag state must not follow into remote.
      useStoreMessageOption.getState().setChatMode("normal")
      navigate(target === "remote" ? "/qwenpaw" : "/local", { replace: true })
    } finally {
      setBusy(false)
    }
  }

  const buttonClass = (active: boolean) =>
    `flex items-center justify-center rounded-full p-1 transition-opacity ${
      active
        ? "bg-gray-200 opacity-100 dark:bg-[#404040]"
        : "opacity-60 hover:opacity-100"
    }`

  if (!remoteAvailable) return null

  return (
    <div
      role="group"
      aria-label={t("provider.switch")}
      className="inline-flex items-center rounded-full border border-gray-200 p-0.5 dark:border-[#404040]">
      <Tooltip title={t("provider.local")}>
        <button
          type="button"
          aria-label={t("provider.local")}
          aria-pressed={current === "local"}
          onClick={() => void select("local")}
          className={buttonClass(current === "local")}>
          <OllamaIcon className="size-4" />
        </button>
      </Tooltip>
      <Tooltip
        title={
          remoteReady === false
            ? t("provider.notConfigured")
            : t("provider.remote")
        }>
        <button
          type="button"
          aria-label={t("provider.remote")}
          aria-pressed={current === "remote"}
          onClick={() => void select("remote")}
          className={buttonClass(current === "remote")}>
          <img src={pawIcon} alt="" className="size-4 object-contain" />
        </button>
      </Tooltip>
    </div>
  )
}
