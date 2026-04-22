import { Separator } from "@/components/ui/separator"
import { SettingsForm } from "./settings-form"

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Settings</h3>
        <p className="text-sm text-muted-foreground">
          Manage your restaurant&apos;s profile and settings.
        </p>
      </div>
      <Separator />
      <SettingsForm />
    </div>
  )
}
