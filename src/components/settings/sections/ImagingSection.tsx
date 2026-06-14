"use client";

import Link from "next/link";
import { ArrowRight, Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SettingsSection } from "../SettingsSection";

/**
 * Static legend of the cart-wall hotkeys plus a deep-link to /app/cart.
 * The legend keys mirror the bindings declared in cart-store (Q/W/E/R…).
 */
const HOTKEY_ROWS: Array<{ key: string; labelKey: string }> = [
  { key: "Q", labelKey: "settings.imaging.hotkeys.row1Hint" },
  { key: "W", labelKey: "settings.imaging.hotkeys.row1Hint" },
  { key: "E", labelKey: "settings.imaging.hotkeys.row1Hint" },
  { key: "R", labelKey: "settings.imaging.hotkeys.row1Hint" },
  { key: "A", labelKey: "settings.imaging.hotkeys.row2Hint" },
  { key: "S", labelKey: "settings.imaging.hotkeys.row2Hint" },
  { key: "D", labelKey: "settings.imaging.hotkeys.row2Hint" },
  { key: "F", labelKey: "settings.imaging.hotkeys.row2Hint" },
];

export function ImagingSection() {
  const { t } = useTranslation();
  return (
    <SettingsSection
      testId="imaging-section"
      title={t("settings.imaging.title")}
      description={t("settings.sectionDescriptions.imaging")}
    >
      <div className="surface-2 border border-border rounded-xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="text-sm font-medium text-foreground">
            {t("settings.imaging.hotkeysTitle")}
          </h3>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="imaging-hotkey-grid">
          {HOTKEY_ROWS.map((row, i) => (
            <div
              key={`${row.key}-${i}`}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5"
            >
              <kbd className="font-mono text-xs text-foreground">{row.key}</kbd>
              <span className="text-xs text-muted-foreground">{t(row.labelKey)}</span>
            </div>
          ))}
        </div>
        <Link
          href="/app/cart"
          data-testid="imaging-deep-link"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          {t("settings.imaging.manage")}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
    </SettingsSection>
  );
}
