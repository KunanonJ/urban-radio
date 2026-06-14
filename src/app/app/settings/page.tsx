import { SettingsPage } from "@/views/app/SettingsPage";

/**
 * Base /app/settings entry. Renders SettingsPage with no section so the
 * default ("station") is shown. Deep-link routes like /app/settings/billing
 * are handled by the dynamic [section] route, and the legacy
 * /app/settings/{playback,appearance,integrations} routes continue to
 * render their existing standalone views.
 */
export default function SettingsIndexPage() {
  return <SettingsPage />;
}
