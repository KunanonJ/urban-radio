"use client";

import Link from "next/link";
import { ArrowRight, Radio } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useBroadcastStore } from "@/lib/broadcast-store";
import { SettingsSection } from "../SettingsSection";

/**
 * Read-only mirror of the demo encoder + mount point from BroadcastPage.
 * Full editing lives on /app/broadcast — this section deep-links there.
 */
export function StreamsSection() {
  const { t } = useTranslation();
  const isOnAir = useBroadcastStore((s) => s.isOnAir);
  const streamMount = useBroadcastStore((s) => s.streamMount);
  const encoderStatus = useBroadcastStore((s) => s.encoderStatus);

  return (
    <SettingsSection
      testId="streams-section"
      title={t("settings.streams.title")}
      description={t("settings.sectionDescriptions.streams")}
    >
      <div
        className="surface-2 border border-border rounded-xl p-5 space-y-3"
        data-testid="streams-mirror"
      >
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" aria-hidden />
          <span className="text-sm font-medium text-foreground">
            {t("settings.streams.encoder")}
          </span>
        </div>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{t("settings.streams.onAir")}</dt>
            <dd
              data-testid="streams-on-air"
              className={isOnAir ? "font-mono text-primary" : "font-mono text-muted-foreground"}
            >
              {isOnAir ? t("settings.streams.onAirYes") : t("settings.streams.onAirNo")}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">{t("settings.streams.status")}</dt>
            <dd className="font-mono text-foreground" data-testid="streams-status">
              {encoderStatus}
            </dd>
          </div>
          <div className="flex items-center justify-between sm:col-span-2">
            <dt className="text-muted-foreground">{t("settings.streams.mount")}</dt>
            <dd className="font-mono text-foreground" data-testid="streams-mount">
              {streamMount || "—"}
            </dd>
          </div>
        </dl>
        <Link
          href="/app/broadcast"
          data-testid="streams-deep-link"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t("settings.streams.manage")}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
    </SettingsSection>
  );
}
