"use client";

import { CreditCard } from "lucide-react";
import { useTranslation } from "react-i18next";

import { EmptyState } from "@/components/ui/empty-state";
import { SettingsSection } from "../SettingsSection";

export function BillingSection() {
  const { t } = useTranslation();
  return (
    <SettingsSection
      testId="billing-section"
      title={t("settings.billing.title")}
      description={t("settings.sectionDescriptions.billing")}
    >
      <EmptyState
        icon={CreditCard}
        title={t("settings.billing.emptyTitle")}
        description={t("settings.billing.emptyDescription")}
      />
    </SettingsSection>
  );
}
