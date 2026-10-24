import React from "react"
import { Dropdown, Tooltip } from "antd"
import type { MenuProps } from "antd"
import { ArrowUp, ChevronDown, CornerDownLeft } from "lucide-react"

export const SidepanelComposerLayout = ({
  children
}: {
  children: React.ReactNode
}) => (
  <div
    data-chat-composer="layout"
    className="flex w-full flex-col items-center px-2">
    <div className="relative z-10 flex w-full flex-col items-center justify-center gap-2 text-base">
      <div className="relative flex w-full flex-row justify-center gap-2 lg:w-4/5">
        {children}
      </div>
    </div>
  </div>
)

export const SidepanelComposerToolbar = ({
  children,
  compact = false
}: {
  children: React.ReactNode
  compact?: boolean
}) => (
  <div
    data-chat-composer="toolbar"
    className={`flex mt-2 items-center gap-3 ${compact ? "w-full justify-between md:w-auto md:justify-end" : "justify-end"}`}>
    {children}
  </div>
)

export const SidepanelComposerActions = ({
  children,
  compact = false
}: {
  children: React.ReactNode
  compact?: boolean
}) => (
  <div className={`flex items-center gap-3 ${compact ? "ml-auto" : ""}`}>
    {children}
  </div>
)

export const SidepanelSendButton = ({
  compact,
  disabled,
  menuDisabled = disabled,
  label,
  optionsLabel,
  sendWhenEnter,
  menuItems
}: {
  compact: boolean
  disabled: boolean
  menuDisabled?: boolean
  label: string
  optionsLabel: string
  sendWhenEnter: boolean
  menuItems: MenuProps["items"]
}) =>
  compact ? (
    <Tooltip title={label}>
      <button
        type="submit"
        aria-label={label}
        disabled={disabled}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-white transition hover:bg-black disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-gray-100">
        <ArrowUp className="h-4 w-4" />
      </button>
    </Tooltip>
  ) : (
    <Dropdown.Button
      htmlType="submit"
      disabled={menuDisabled}
      buttonsRender={([submit, menu]) => [
        React.isValidElement<{ disabled?: boolean }>(submit)
          ? React.cloneElement(submit, { disabled })
          : submit,
        React.isValidElement<{ "aria-label"?: string }>(menu)
          ? React.cloneElement(menu, { "aria-label": optionsLabel })
          : menu
      ]}
      className="!justify-end !w-auto"
      icon={<ChevronDown className="w-4 h-4" />}
      menu={{ items: menuItems }}>
      <div className="inline-flex gap-2">
        {sendWhenEnter && <CornerDownLeft className="h-4 w-4" />}
        {label}
      </div>
    </Dropdown.Button>
  )

export const UnavailableComposerAction = ({
  label,
  reason,
  children
}: {
  label: string
  reason: string
  children: React.ReactNode
}) => (
  <Tooltip title={`${label}: ${reason}`} trigger={["hover", "focus"]}>
    <span
      tabIndex={0}
      aria-label={`${label}: ${reason}`}
      className="inline-flex cursor-not-allowed">
      <button
        type="button"
        disabled
        aria-label={label}
        className="flex items-center justify-center text-gray-600 opacity-40 dark:text-gray-300">
        {children}
      </button>
    </span>
  </Tooltip>
)

export const SidepanelComposerSurface = ({
  children,
  temporaryChat = false
}: {
  children: React.ReactNode
  temporaryChat?: boolean
}) => (
  <div
    data-istemporary-chat={temporaryChat}
    className="bg-neutral-50 dark:bg-[#262626] relative w-full max-w-[48rem] p-1 backdrop-blur-lg duration-100 border border-gray-300 rounded-t-xl dark:border-[#404040] data-[istemporary-chat='true']:bg-violet-100 data-[istemporary-chat='true']:border-violet-300 data-[istemporary-chat='true']:dark:bg-black data-[istemporary-chat='true']:dark:border-[#404040]">
    {children}
  </div>
)

export const SidepanelTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>((props, ref) => (
  <textarea
    ref={ref}
    className="px-2 py-2 w-full resize-none bg-transparent focus-within:outline-none focus:ring-0 focus-visible:ring-0 ring-0 dark:ring-0 border-0 dark:text-gray-100 disabled:opacity-60"
    rows={1}
    style={{ height: "40px", minHeight: "40px" }}
    tabIndex={0}
    {...props}
  />
))
SidepanelTextarea.displayName = "SidepanelTextarea"
