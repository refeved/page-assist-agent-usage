import { useEffect, useState, type ReactNode } from "react"
import { Button } from "antd"
import { CheckCircle2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import pawIcon from "~/assets/qwenpaw-paw.png"
import { OllamaIcon } from "@/components/Icons/Ollama"
import { QwenPawConnectionForm } from "@/components/Common/QwenPawConnection"
import { isRemoteConfigured, setProvider, type ProviderId } from "@/services/provider"

type ProviderCardProps = {
  selected: boolean
  onClick: () => void
  icon: ReactNode
  title: string
  description: string
}

const ProviderCard = ({
  selected,
  onClick,
  icon,
  title,
  description
}: ProviderCardProps) => (
  <button
    type="button"
    aria-pressed={selected}
    onClick={onClick}
    className={`rounded-lg border p-3 text-left transition-colors ${
      selected
        ? "border-blue-500 ring-1 ring-blue-500"
        : "border-gray-200 hover:border-gray-300 dark:border-[#404040] dark:hover:border-gray-500"
    }`}>
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-sm font-medium dark:text-gray-100">{title}</span>
      {selected && (
        <CheckCircle2 className="ml-auto size-4 text-blue-500" aria-hidden />
      )}
    </div>
    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
      {description}
    </p>
  </button>
)

type ProviderSetupProps = {
  selected: ProviderId
  onSelect: (provider: ProviderId) => void
}

/**
 * Inline first-run chooser shown on top of the empty sidebar card. It reuses
 * the regular settings form instead of opening a wizard, so picking remote is
 * just another configuration block next to Ollama.
 */
export const ProviderSetup = ({ selected, onSelect }: ProviderSetupProps) => {
  const { t } = useTranslation("qwenpaw")
  const navigate = useNavigate()
  const [remoteReady, setRemoteReady] = useState<boolean>()

  useEffect(() => {
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
  }, [])

  const enterRemote = async () => {
    await setProvider("remote")
    navigate("/qwenpaw", { replace: true })
  }

  return (
    <div className="w-full">
      <p className="text-center text-sm font-medium dark:text-gray-100">
        {t("firstRun.title")}
      </p>
      <p className="mt-1 text-center text-xs text-gray-500 dark:text-gray-400">
        {t("firstRun.description")}
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ProviderCard
          selected={selected === "local"}
          onClick={() => onSelect("local")}
          icon={<OllamaIcon className="size-4 text-gray-600 dark:text-gray-300" />}
          title={t("provider.local")}
          description={t("provider.localDescription")}
        />
        <ProviderCard
          selected={selected === "remote"}
          onClick={() => onSelect("remote")}
          icon={<img src={pawIcon} alt="" className="size-4 object-contain" />}
          title={t("provider.remote")}
          description={t("provider.remoteDescription")}
        />
      </div>
      {selected === "remote" && (
        <div className="mt-4 rounded-lg border border-gray-200 p-3 text-left dark:border-[#404040]">
          {remoteReady ? (
            <div className="flex flex-col items-start gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                <span className="size-2 rounded-full bg-green-500" />
                {t("online")}
              </span>
              <Button type="primary" onClick={() => void enterRemote()}>
                {t("firstRun.continue")}
              </Button>
            </div>
          ) : (
            <QwenPawConnectionForm compact onConfigured={() => void enterRemote()} />
          )}
        </div>
      )}
    </div>
  )
}
