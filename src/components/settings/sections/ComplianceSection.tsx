"use client";

import Link from "next/link";
import { ArrowRight, FileText, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsSection } from "../SettingsSection";

export function ComplianceSection() {
  const { t } = useTranslation();
  return (
    <SettingsSection
      testId="compliance-section"
      title={t("settings.compliance.title")}
      description={t("settings.sectionDescriptions.compliance")}
    >
      <div className="surface-2 border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="text-sm font-medium text-foreground">
            {t("settings.compliance.royaltyTitle")}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("settings.compliance.royaltyDescription")}
        </p>
        <Link
          href="/app/reports?tab=royalty"
          data-testid="compliance-royalty-link"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t("settings.compliance.openRoyaltyReports")}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
      <div className="surface-2 border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="text-sm font-medium text-foreground">
            {t("settings.compliance.auditTitle")}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("settings.compliance.auditDescription")}
        </p>
        <Link
          href="/app/audit"
          data-testid="compliance-audit-link"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t("settings.compliance.openAuditLog")}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
    </SettingsSection>
  );
}
