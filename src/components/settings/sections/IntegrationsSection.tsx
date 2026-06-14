"use client";

import { useTranslation } from "react-i18next";

import { SettingsIntegrations } from "@/views/app/SettingsPage";
import { SettingsSection } from "../SettingsSection";

/**
 * Wraps the existing SettingsIntegrations UI in the new section frame so
 * the mock OAuth flow + CloudUploadPanel continue to work unchanged.
 */
export function IntegrationsSection() {
  const { t } = useTranslation();
  return (
    <SettingsSection
      testId="integrations-section"
      title={t("settings.integrations")}
      description={t("settings.sectionDescriptions.integrations")}
    >
      <SettingsIntegrations />
    </SettingsSection>
  );
}
