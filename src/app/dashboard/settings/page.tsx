import { SettingsForm } from "./settings-form"

// Flutter `settingsModule`: one centered column (max-width 760) of grouped
// cards under section headers — no page-level title or global save.
export default function SettingsPage(): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-[760px]">
      <SettingsForm />
    </div>
  )
}
