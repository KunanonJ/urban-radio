"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export interface DateRangeValue {
  from: string;
  to: string;
}

export type RangePreset =
  | "last7"
  | "last30"
  | "last90"
  | "thisMonth"
  | "lastMonth"
  | "custom";

export interface DateRangePickerProps {
  value?: DateRangeValue;
  defaultPreset?: RangePreset;
  onRangeChange: (range: DateRangeValue, preset: RangePreset) => void;
  className?: string;
}

const PRESETS: Exclude<RangePreset, "custom">[] = [
  "last7",
  "last30",
  "last90",
  "thisMonth",
  "lastMonth",
];

function startOfDayIso(date: Date): string {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfDayIso(date: Date): string {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}

/**
 * Compute a preset range using UTC boundaries.
 * Exported for unit tests.
 */
export function computePresetRange(
  preset: Exclude<RangePreset, "custom">,
  now: Date = new Date(),
): DateRangeValue {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);

  if (preset === "last7" || preset === "last30" || preset === "last90") {
    const days = preset === "last7" ? 7 : preset === "last30" ? 30 : 90;
    const from = new Date(today);
    from.setUTCDate(from.getUTCDate() - (days - 1));
    return { from: startOfDayIso(from), to: endOfDayIso(now) };
  }

  if (preset === "thisMonth") {
    const from = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );
    return { from: startOfDayIso(from), to: endOfDayIso(now) };
  }

  // lastMonth
  const from = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1),
  );
  const to = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0),
  );
  return { from: startOfDayIso(from), to: endOfDayIso(to) };
}

function isoToInputDate(iso: string): string {
  if (!iso) return "";
  // Drop time, keep YYYY-MM-DD (UTC).
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function inputDateToFromIso(value: string): string {
  if (!value) return "";
  const [y, m, d] = value.split("-").map((s) => Number(s));
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0)).toISOString();
}

function inputDateToToIso(value: string): string {
  if (!value) return "";
  const [y, m, d] = value.split("-").map((s) => Number(s));
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)).toISOString();
}

export function DateRangePicker({
  value,
  defaultPreset = "last30",
  onRangeChange,
  className,
}: DateRangePickerProps) {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<RangePreset>(defaultPreset);
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");

  // Fire the initial range exactly once on mount (preset only — custom needs
  // user input to be meaningful). External `value` updates do not re-fire.
  // We intentionally rely on the closure-captured initial preset.
  useEffect(() => {
    if (defaultPreset !== "custom") {
      const r = computePresetRange(defaultPreset);
      onRangeChange(r, defaultPreset);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep custom inputs in sync if `value` prop changes externally.
  useEffect(() => {
    if (!value) return;
    setCustomFrom(isoToInputDate(value.from));
    setCustomTo(isoToInputDate(value.to));
  }, [value]);

  const handlePresetClick = useCallback(
    (next: Exclude<RangePreset, "custom">) => {
      setPreset(next);
      const r = computePresetRange(next);
      setCustomFrom(isoToInputDate(r.from));
      setCustomTo(isoToInputDate(r.to));
      onRangeChange(r, next);
    },
    [onRangeChange],
  );

  const handleCustomToggle = useCallback(() => {
    setPreset("custom");
  }, []);

  const emitCustom = useCallback(
    (fromVal: string, toVal: string) => {
      if (!fromVal || !toVal) return;
      let fromIso = inputDateToFromIso(fromVal);
      let toIso = inputDateToToIso(toVal);
      // Clamp: if from > to, swap.
      if (fromIso && toIso && fromIso > toIso) {
        const swap = fromIso;
        fromIso = inputDateToFromIso(toVal);
        toIso = inputDateToToIso(isoToInputDate(swap));
      }
      onRangeChange({ from: fromIso, to: toIso }, "custom");
    },
    [onRangeChange],
  );

  const handleCustomFromChange = useCallback(
    (val: string) => {
      setCustomFrom(val);
      setPreset("custom");
      emitCustom(val, customTo);
    },
    [customTo, emitCustom],
  );

  const handleCustomToChange = useCallback(
    (val: string) => {
      setCustomTo(val);
      setPreset("custom");
      emitCustom(customFrom, val);
    },
    [customFrom, emitCustom],
  );

  const customActive = preset === "custom";

  const buttons = useMemo(
    () =>
      PRESETS.map((p) => ({
        key: p,
        label: t(`reports.range.${p}`),
        active: preset === p,
      })),
    [preset, t],
  );

  return (
    <div
      data-testid="reports-range-picker"
      className={cn("flex flex-wrap items-end gap-2", className)}
    >
      <div className="flex flex-wrap items-center gap-1">
        {buttons.map((b) => (
          <Button
            key={b.key}
            type="button"
            size="sm"
            variant={b.active ? "default" : "outline"}
            data-testid={`reports-range-preset-${b.key}`}
            onClick={() => handlePresetClick(b.key as Exclude<RangePreset, "custom">)}
          >
            {b.label}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant={customActive ? "default" : "outline"}
          data-testid="reports-range-preset-custom"
          onClick={handleCustomToggle}
        >
          {t("reports.range.custom")}
        </Button>
      </div>
      {customActive ? (
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="reports-range-from" className="text-xs">
              {t("reports.range.label")}
            </Label>
            <Input
              id="reports-range-from"
              data-testid="reports-range-from"
              type="date"
              value={customFrom}
              onChange={(e) => handleCustomFromChange(e.currentTarget.value)}
              className="h-8 w-[10.5rem]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Input
              id="reports-range-to"
              data-testid="reports-range-to"
              type="date"
              value={customTo}
              onChange={(e) => handleCustomToChange(e.currentTarget.value)}
              className="h-8 w-[10.5rem]"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default DateRangePicker;
