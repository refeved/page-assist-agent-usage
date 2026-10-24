import { Dropdown, Tooltip } from "antd"
import type { MenuProps } from "antd"
import { LucideBrain } from "lucide-react"

export const ChatModelMenu = ({
  label,
  items,
  selectedKey,
  disabled = false,
  iconClassName = "size-5"
}: {
  label: string
  items: MenuProps["items"]
  selectedKey?: string
  disabled?: boolean
  iconClassName?: string
}) => (
  <Dropdown
    menu={{
      items,
      style: { maxHeight: 500, overflowY: "scroll" },
      className: "no-scrollbar",
      activeKey: selectedKey
    }}
    disabled={disabled}
    placement="topLeft"
    trigger={["click"]}>
    <Tooltip title={label} overlayStyle={{ pointerEvents: "none" }}>
      <span className="inline-flex">
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          className="dark:text-gray-300 disabled:opacity-50">
          <LucideBrain className={iconClassName} />
        </button>
      </span>
    </Tooltip>
  </Dropdown>
)
