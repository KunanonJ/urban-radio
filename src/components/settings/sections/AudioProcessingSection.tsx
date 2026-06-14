"use client";

import { SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/ui/empty-state";
import { SettingsSection } from "../SettingsSection";

export function AudioProcessingSection() {
  const { t } = useTranslation();
  return (
    <SettingsSection
      testId="audio-section"
      title={t("settings.audio.title")}
      description={t("settings.sectionDescriptions.audio")}
    >
      <EmptyState
        icon={SlidersHorizontal}
        title={t("settings.audio.emptyTitle")}
        description={t("settings.audio.emptyDescription")}
      />
    </SettingsSection>
  );
}
