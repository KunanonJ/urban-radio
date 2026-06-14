"use client";

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rrulestr } from 'rrule';

import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

const PRESETS = {
  none: null,
  everyDay: 'FREQ=DAILY',
  weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  weekends: 'FREQ=WEEKLY;BYDAY=SA,SU',
} as const;

type PresetKey = keyof typeof PRESETS | 'custom';

function describeRRule(input: string): string {
  try {
    const parsed = rrulestr(input);
    if ('toText' in parsed && typeof parsed.toText === 'function') {
      const text = parsed.toText();
      if (text && text.trim().length > 0) return text;
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function detectPreset(value: string | null): PresetKey {
  if (value === null || value === '') return 'none';
  // The canonical RRULE form may include RRULE: prefix; compare loosely.
  const norm = value.replace(/^RRULE:/i, '').toUpperCase();
  if (norm === PRESETS.everyDay) return 'everyDay';
  if (norm === PRESETS.weekdays.toUpperCase()) return 'weekdays';
  if (norm === PRESETS.weekends.toUpperCase()) return 'weekends';
  return 'custom';
}

interface RRuleEditorProps {
  value: string | null;
  onChange: (rrule: string | null) => void;
}

export function RRuleEditor({ value, onChange }: RRuleEditorProps) {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<PresetKey>(() => detectPreset(value));
  const [customText, setCustomText] = useState<string>(() =>
    detectPreset(value) === 'custom' ? value ?? '' : '',
  );
  const [customError, setCustomError] = useState<string | null>(null);

  // Sync from props if value changes externally (e.g. switching between edit/create modes).
  useEffect(() => {
    const next = detectPreset(value);
    setPreset(next);
    if (next === 'custom') setCustomText(value ?? '');
  }, [value]);

  const summary = useMemo(() => {
    if (preset === 'none') return '';
    if (preset === 'custom') {
      if (customError) return '';
      return describeRRule(customText);
    }
    return describeRRule(PRESETS[preset]);
  }, [preset, customText, customError]);

  function handlePresetChange(next: string) {
    const key = next as PresetKey;
    setPreset(key);
    setCustomError(null);
    if (key === 'custom') {
      // Don't emit yet — wait for user to enter / validate.
      return;
    }
    onChange(PRESETS[key as keyof typeof PRESETS]);
  }

  function validateAndEmit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      setCustomError(null);
      return;
    }
    try {
      const parsed = rrulestr(trimmed);
      setCustomError(null);
      onChange(parsed.toString());
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : 'Invalid RRULE');
    }
  }

  function handleCustomChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value;
    setCustomText(next);
    // Live-validate so the error surfaces (and onChange emits) without waiting
    // for blur. This keeps the UI honest while typing and is also easier to test.
    validateAndEmit(next);
  }

  function handleCustomBlur() {
    // Re-validate on blur in case the user pasted invalid text and never edited
    // it further. Same logic — no duplicate emit if already valid.
    if (preset !== 'custom') return;
    validateAndEmit(customText);
  }

  return (
    <div className="space-y-3">
      <Label className="block">{t('schedule.rrule.label')}</Label>
      <RadioGroup value={preset} onValueChange={handlePresetChange} className="gap-2">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <RadioGroupItem value="none" id="rrule-none" />
          <span>{t('schedule.rrule.none')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <RadioGroupItem value="everyDay" id="rrule-everyDay" />
          <span>{t('schedule.rrule.everyDay')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <RadioGroupItem value="weekdays" id="rrule-weekdays" />
          <span>{t('schedule.rrule.weekdays')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <RadioGroupItem value="weekends" id="rrule-weekends" />
          <span>{t('schedule.rrule.weekends')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <RadioGroupItem value="custom" id="rrule-custom" />
          <span>{t('schedule.rrule.custom')}</span>
        </label>
      </RadioGroup>
      {preset === 'custom' ? (
        <div className="space-y-1">
          <Textarea
            value={customText}
            onChange={handleCustomChange}
            onBlur={handleCustomBlur}
            placeholder="FREQ=DAILY"
            className="font-mono text-xs"
            aria-invalid={customError ? 'true' : 'false'}
          />
          {customError ? (
            <p
              className="text-xs text-destructive"
              data-rrule-error="true"
              role="alert"
            >
              {customError}
            </p>
          ) : null}
        </div>
      ) : null}
      {summary ? (
        <p className="text-xs text-muted-foreground" data-rrule-summary="true">
          {summary}
        </p>
      ) : null}
    </div>
  );
}
