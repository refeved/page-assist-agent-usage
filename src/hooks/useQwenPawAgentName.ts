import { useEffect, useState } from "react"
import { Storage } from "@plasmohq/storage"
import { AGENT_NAME_KEY } from "@/services/qwenpaw/privacy"
import { loadAgentName } from "@/services/qwenpaw/config"

/**
 * The user's optional Agent display name. Kept in a dedicated storage key so
 * changing it never invalidates the credential-scoped connection caches.
 */
export function useQwenPawAgentName() {
  const [name, setName] = useState("")
  useEffect(() => {
    let live = true
    const storage = new Storage({ area: "local" })
    const refresh = () => {
      loadAgentName()
        .then((value) => {
          if (live) setName(value)
        })
        .catch(() => {
          if (live) setName("")
        })
    }
    refresh()
    storage.watch({ [AGENT_NAME_KEY]: refresh })
    return () => {
      live = false
      storage.unwatch({ [AGENT_NAME_KEY]: refresh })
    }
  }, [])
  return name
}
