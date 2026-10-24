export function linkedController(...signals: AbortSignal[]) {
  const controller = new AbortController()
  const listeners = signals.map((signal) => {
    const abort = () => controller.abort(signal.reason)
    return { signal, abort }
  })
  controller.signal.addEventListener(
    "abort",
    () => {
      for (const { signal, abort } of listeners)
        signal.removeEventListener("abort", abort)
    },
    { once: true }
  )
  for (const { signal, abort } of listeners) {
    if (signal.aborted) {
      abort()
      break
    }
    signal.addEventListener("abort", abort, { once: true })
  }
  return controller
}
