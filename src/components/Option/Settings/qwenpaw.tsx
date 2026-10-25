import { Alert } from "antd"
import { useTranslation } from "react-i18next"
import { QwenPawConnectionForm } from "@/components/Common/QwenPawConnection"

/**
 * The Remote Agent settings page body, shared by the options page and the
 * sidebar settings page. QwenPaw is the first backend, so its connection form
 * lives here; the surrounding layout owns the page shell and navigation.
 */
export const SettingsQwenPaw = () => {
  const { t } = useTranslation("qwenpaw")
  return (
    <div className="flex flex-col">
      <div className="mb-5">
        <h2 className="text-base font-semibold leading-7 text-gray-900 dark:text-white">
          {t("remote")}
        </h2>
        <div className="border border-b border-gray-200 dark:border-gray-600 mt-3"></div>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {t("settingsSection.description")}
        </p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("channelPreview")}
        </p>
      </div>
      <Alert type="info" message={t("unavailable")} className="!mb-4" />
      <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
        {t("privacy")}
      </p>
      <QwenPawConnectionForm />
    </div>
  )
}
