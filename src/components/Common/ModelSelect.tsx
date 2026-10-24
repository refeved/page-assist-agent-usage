import { useQuery } from "@tanstack/react-query"
import { Avatar } from "antd"
import { ChatModelMenu } from "./ChatModelMenu"
import React from "react"
import { useTranslation } from "react-i18next"
import { fetchChatModels } from "@/services/ollama"
import { useMessage } from "@/hooks/useMessage"
import { ProviderIcons } from "./ProviderIcon"

type Props = {
  iconClassName?: string
}

export const ModelSelect: React.FC<Props> = ({ iconClassName = "size-5" }) => {
  const { t } = useTranslation("common")
  const { setSelectedModel, selectedModel } = useMessage()
  const { data } = useQuery({
    queryKey: ["getAllModelsForSelect"],
    queryFn: async () => {
      const models = await fetchChatModels({ returnEmpty: false })
      return models
    }
  })

  return (
    <>
      {data && data.length > 0 && (
        <ChatModelMenu
          label={t("selectAModel")}
          iconClassName={iconClassName}
          selectedKey={selectedModel}
          items={
            data?.map((d) => ({
              key: d.name,
              label: (
                <div className="w-52 gap-2 text-lg truncate inline-flex line-clamp-3  items-center  dark:border-gray-700">
                  <div>
                    {d.avatar ? (
                      <Avatar src={d.avatar} alt={d.name} size="small" />
                    ) : (
                      <ProviderIcons
                        provider={d?.provider}
                        className="h-6 w-6 text-gray-400"
                      />
                    )}
                  </div>
                  {d?.nickname || d.model}
                </div>
              ),
              onClick: () => {
                if (selectedModel === d.model) {
                  setSelectedModel(null)
                } else {
                  setSelectedModel(d.model)
                }
              }
            })) || []
          }
        />
      )}
    </>
  )
}
