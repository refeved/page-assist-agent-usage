import React from "react"
import logoImage from "~/assets/icon.png"
import { useTranslation } from "react-i18next"

export const SidepanelHeaderFrame = ({
  children,
  temporaryChat = false
}: {
  children: React.ReactNode
  temporaryChat?: boolean
}) => {
  const { t } = useTranslation("common")
  return (
    <header
      data-istemporary-chat={temporaryChat}
      className="px-3 justify-between bg-white dark:bg-[#1a1a1a] border-b border-gray-300 dark:border-gray-700 py-4 items-center absolute top-0 z-10 flex h-14 w-full data-[istemporary-chat='true']:bg-violet-100 data-[istemporary-chat='true']:border-violet-300 data-[istemporary-chat='true']:dark:bg-black data-[istemporary-chat='true']:dark:border-gray-700">
      <div className="flex items-center dark:text-white">
        <img className="h-6 w-auto" src={logoImage} alt={t("pageAssist")} />
        <span className="ml-1 text-sm">{t("pageAssist")}</span>
      </div>
      {children}
    </header>
  )
}
