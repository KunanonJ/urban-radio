"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStation, useUpdateStation, type StationRow } from "@/lib/station-queries";
import { SettingsSection } from "../SettingsSection";

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Asia/Bangkok",
];
const LANGUAGES = ["en", "th"];

interface StationFormState {
  name: string;
  timezone: string;
  language: string;
  color: string;
  streamUrl: string;
}

function stationToFormState(station: StationRow): StationFormState {
  return {
    name: station.name,
    timezone: station.timezone,
    language: station.language,
    streamUrl: station.streamUrl ?? "",
    color: "#22c55e",
  };
}

/**
 * Station identity controls. Wired to /api/stations/me via useStation +
 * useUpdateStation. The slug is read-only — changing it would break links,
 * so any rename has to be a separate, more careful operation.
 */
export function StationIdentitySection() {
  const { t } = useTranslation();
  const stationQuery = useStation();
  const updateMutation = useUpdateStation();

  const station = stationQuery.data?.station;
  const [form, setForm] = useState<StationFormState | null>(null);

  // Sync the form once the station loads, and again whenever the
  // server-side data changes (e.g. after a successful save the query
  // invalidates and re-fetches).
  useEffect(() => {
    if (station) setForm(stationToFormState(station));
  }, [station]);

  const update = useCallback(
    <K extends keyof StationFormState>(key: K, value: StationFormState[K]) => {
      setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!form) return;
    try {
      await updateMutation.mutateAsync({
        name: form.name,
        timezone: form.timezone,
        language: form.language,
        streamUrl: form.streamUrl.trim() === "" ? null : form.streamUrl,
      });
      toast.success(t("settings.station.saveSuccess"));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(t("settings.station.saveError", { error: message }));
    }
  }, [form, updateMutation, t]);

  return (
    <SettingsSection
      testId="station-identity-section"
      title={t("settings.station.title")}
      description={t("settings.sectionDescriptions.station")}
    >
      <div className="surface-2 border border-border rounded-xl p-5 space-y-4">
        {stationQuery.isLoading || !station || !form ? (
          <div
            data-testid="station-identity-loading"
            className="text-sm text-muted-foreground"
          >
            {t("settings.station.loading", "Loading…")}
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="station-name">{t("settings.station.name")}</Label>
              <Input
                id="station-name"
                data-testid="station-identity-name"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder={t("settings.station.namePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="station-slug">{t("settings.station.slug")}</Label>
              <Input
                id="station-slug"
                data-testid="station-identity-slug"
                value={station.slug}
                readOnly
                aria-readonly="true"
                placeholder="urban-radio"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="station-tz">{t("settings.station.timezone")}</Label>
                <Select value={form.timezone} onValueChange={(v) => update("timezone", v)}>
                  <SelectTrigger id="station-tz" data-testid="station-identity-timezone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="station-lang">{t("settings.station.language")}</Label>
                <Select value={form.language} onValueChange={(v) => update("language", v)}>
                  <SelectTrigger id="station-lang" data-testid="station-identity-language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGUAGES.map((lang) => (
                      <SelectItem key={lang} value={lang}>
                        {t(`language.names.${lang}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="station-color">{t("settings.station.color")}</Label>
              <Input
                id="station-color"
                data-testid="station-identity-color"
                type="color"
                value={form.color}
                onChange={(e) => update("color", e.target.value)}
                className="h-10 w-20 cursor-pointer p-1"
              />
            </div>
            <Button
              type="button"
              onClick={handleSave}
              data-testid="station-identity-save"
              disabled={updateMutation.isPending}
            >
              {t("settings.station.save")}
            </Button>
          </>
        )}
      </div>
    </SettingsSection>
  );
}
