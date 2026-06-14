"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api-base";

export type RoyaltyFormat = "ascap" | "bmi" | "soundexchange";

export interface RoyaltyExportPanelProps {
  /** ISO 8601 from / to bounds. */
  from?: string;
  to?: string;
  className?: string;
}

const FORMATS: { id: RoyaltyFormat; i18nKey: string }[] = [
  { id: "ascap", i18nKey: "reports.royalty.ascap" },
  { id: "bmi", i18nKey: "reports.royalty.bmi" },
  { id: "soundexchange", i18nKey: "reports.royalty.soundexchange" },
];

function buildExportUrl(format: RoyaltyFormat, from?: string, to?: string): string {
  const qs = new URLSearchParams();
  qs.set("format", format);
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  return `/api/royalty/export?${qs.toString()}`;
}

/** Trigger a browser download for a `Blob` using a temporary `<a>`. */
function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Free the object URL on next tick — the browser has already started the
  // download by the time we get here.
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }, 0);
}

export function RoyaltyExportPanel({
  from,
  to,
  className,
}: RoyaltyExportPanelProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<RoyaltyFormat | null>(null);

  const handleDownload = useCallback(
    async (format: RoyaltyFormat) => {
      if (pending) return;
      setPending(format);
      try {
        const res = await apiFetch(buildExportUrl(format, from, to));
        if (res.status === 413) {
          toast.error(t("reports.royalty.exportCapHit"));
          return;
        }
        if (!res.ok) {
          toast.error(
            t("reports.royalty.exportFailed", { error: `HTTP ${res.status}` }),
          );
          return;
        }
        const blob = await res.blob();
        const filename = `royalty-${format}-${from?.slice(0, 10) ?? "all"}_${to?.slice(0, 10) ?? "all"}.csv`;
        triggerBlobDownload(blob, filename);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(t("reports.royalty.exportFailed", { error: message }));
      } finally {
        setPending(null);
      }
    },
    [pending, from, to, t],
  );

  return (
    <Card data-testid="reports-royalty-panel" className={className}>
      <CardHeader>
        <CardTitle>{t("reports.royalty.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t("reports.royalty.intro")}
        </p>
        <div className="flex flex-wrap gap-2">
          {FORMATS.map((f) => {
            const isPending = pending === f.id;
            return (
              <Button
                key={f.id}
                type="button"
                variant="default"
                data-testid={`reports-royalty-${f.id}-button`}
                disabled={!!pending}
                onClick={() => void handleDownload(f.id)}
              >
                {isPending ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Download className="mr-2 size-4" />
                )}
                {t(f.i18nKey)}
              </Button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("reports.royalty.rowCap")}
        </p>
      </CardContent>
    </Card>
  );
}

export default RoyaltyExportPanel;
