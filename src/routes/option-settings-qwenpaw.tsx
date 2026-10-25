import { SettingsLayout } from "~/components/Layouts/SettingsOptionLayout"
import OptionLayout from "~/components/Layouts/Layout"
import { SettingsQwenPaw } from "~/components/Option/Settings/qwenpaw"

const OptionQwenPawSettings = () => {
  return (
    <OptionLayout>
      <SettingsLayout>
        <SettingsQwenPaw />
      </SettingsLayout>
    </OptionLayout>
  )
}

export default OptionQwenPawSettings
