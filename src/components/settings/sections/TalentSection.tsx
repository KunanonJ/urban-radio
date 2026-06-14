"use client";

import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/ui/empty-state";
import { SettingsSection } from "../SettingsSection";

export function TalentSection() {
  const { t } = useTranslation();
  return (
    <SettingsSection
      testId="talent-section"
      title={t("settings.talent.title")}
      description={t("settings.sectionDescriptions.talent")}
    >
      <EmptyState
        icon={Users}
        title={t("settings.talent.emptyTitle")}
        description={t("settings.talent.emptyDescription")}
      />
    </SettingsSection>
  );
}
