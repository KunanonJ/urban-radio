"use client";
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Megaphone, Plus, RotateCcw, Save, Trash2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { useMergedTracks } from '@/lib/library';
import type { Weekday } from '@/lib/scheduler-store';
import {
  computeNextOccurrences,
  type SpotInsertMode,
  type SpotRule,
} from '@/lib/spot-schedule-engine';
import { useSpotScheduleStore } from '@/lib/spot-schedule-store';

const PRESET_MINUTES = [0, 15, 30, 45] as const;
const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

type SchedulingPresetId = 'hourly' | 'hourlyHalf' | 'weekdays' | 'morningDrive' | 'openHours';

function schedulingPresetFields(
  preset: SchedulingPresetId
): Pick<SpotRule, 'minutesPastHour' | 'daysOfWeek' | 'windowStart' | 'windowEnd'> {
  switch (preset) {
    case 'hourly':
      return {
        minutesPastHour: [0],
        daysOfWeek: undefined,
        windowStart: '06:00',
        windowEnd: '22:00',
      };
    case 'hourlyHalf':
      return {
        minutesPastHour: [0, 30],
        daysOfWeek: undefined,
        windowStart: '06:00',
        windowEnd: '22:00',
      };
    case 'weekdays':
      return {
        minutesPastHour: [0, 30],
        daysOfWeek: [1, 2, 3, 4, 5],
        windowStart: '06:00',
        windowEnd: '22:00',
      };
    case 'morningDrive':
      return {
        minutesPastHour: [0, 15, 30, 45],
        daysOfWeek: [1, 2, 3, 4, 5],
        windowStart: '06:00',
        windowEnd: '10:00',
      };
    case 'openHours':
      return {
        minutesPastHour: [0, 30],
        daysOfWeek: undefined,
        windowStart: '06:00',
        windowEnd: '22:00',
      };
  }
}

function toggleMinute(list: number[], m: number): number[] {
  const set = new Set(list);
  if (set.has(m)) set.delete(m);
  else set.add(m);
  return [...set].sort((a, b) => a - b);
}

function cloneSpotRule(r: SpotRule): SpotRule {
  return {
    ...r,
    minutesPastHour: [...r.minutesPastHour],
    trackIds: [...r.trackIds],
    daysOfWeek: r.daysOfWeek ? [...r.daysOfWeek] : undefined,
  };
}

function snapshotForCompare(r: SpotRule): string {
  return JSON.stringify({
    name: r.name,
    enabled: r.enabled,
    minutesPastHour: [...r.minutesPastHour].sort((a, b) => a - b),
    daysOfWeek: r.daysOfWeek?.length ? [...r.daysOfWeek].sort() : null,
    windowStart: r.windowStart ?? null,
    windowEnd: r.windowEnd ?? null,
    trackIds: [...r.trackIds].sort(),
    insertMode: r.insertMode,
    rotationIndex: r.rotationIndex,
  });
}

function applySchedulingPresetToDraft(draft: SpotRule, preset: SchedulingPresetId): SpotRule {
  const f = schedulingPresetFields(preset);
  return cloneSpotRule({
    ...draft,
    minutesPastHour: [...f.minutesPastHour],
    daysOfWeek: f.daysOfWeek ? [...f.daysOfWeek] : undefined,
    windowStart: f.windowStart,
    windowEnd: f.windowEnd,
  });
}

const PRESET_IDS: SchedulingPresetId[] = [
  'hourly',
  'hourlyHalf',
  'weekdays',
  'morningDrive',
  'openHours',
];

const PRESET_LABEL_KEY: Record<SchedulingPresetId, string> = {
  hourly: 'spotSchedule.presetHourly',
  hourlyHalf: 'spotSchedule.presetHourlyHalf',
  weekdays: 'spotSchedule.presetWeekdays',
  morningDrive: 'spotSchedule.presetMorningDrive',
  openHours: 'spotSchedule.presetOpenHours',
};

function RuleCard({
  rule,
  onSave,
  onRemove,
  onTest,
}: {
  rule: SpotRule;
  onSave: (patch: Partial<Omit<SpotRule, 'id'>>) => void;
  onRemove: () => void;
  onTest: () => void;
}) {
  const { t } = useTranslation();
  const tracks = useMergedTracks();
  const [draft, setDraft] = useState(() => cloneSpotRule(rule));

  const fp = useMemo(() => snapshotForCompare(rule), [rule]);
  const dirty = useMemo(
    () => snapshotForCompare(draft) !== snapshotForCompare(rule),
    [draft, rule]
  );

  useEffect(() => {
    if (!dirty) {
      setDraft(cloneSpotRule(rule));
    }
  }, [fp, dirty, rule]);

  const nextRuns = useMemo(
    () => computeNextOccurrences(draft, new Date(), 5),
    [draft]
  );

  const firstNext = nextRuns[0];

  const effectiveDays: Weekday[] =
    draft.daysOfWeek == null || draft.daysOfWeek.length === 0
      ? [0, 1, 2, 3, 4, 5, 6]
      : draft.daysOfWeek;

  const toggleDay = (d: Weekday) => {
    const has = effectiveDays.includes(d);
    const next = has ? effectiveDays.filter((x) => x !== d) : [...effectiveDays, d].sort((a, b) => a - b);
    if (next.length === 0 || next.length === 7) {
      setDraft((s) => ({ ...s, daysOfWeek: undefined }));
    } else {
      setDraft((s) => ({ ...s, daysOfWeek: next as Weekday[] }));
    }
  };

  const patchFromDraft = (): Partial<Omit<SpotRule, 'id'>> => {
    const { id: _id, ...rest } = draft;
    return rest;
  };

  const handleSave = () => {
    onSave(patchFromDraft());
    toast.success(t('spotSchedule.saved'));
  };

  const handleDiscard = () => {
    setDraft(cloneSpotRule(rule));
  };

  return (
    <div className="surface-2 border border-border rounded-xl overflow-hidden">
      <div className="p-5 border-b border-border bg-muted/20 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{t('spotSchedule.rulesListTitle')}</p>
          <p className="font-semibold text-foreground truncate">{draft.name || t('spotSchedule.ruleName')}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {firstNext
              ? t('spotSchedule.ruleSummaryNext', { time: firstNext.toLocaleString() })
              : t('spotSchedule.ruleSummaryNoNext')}
          </p>
        </div>
        <Badge variant={draft.enabled ? 'default' : 'secondary'}>
          {draft.enabled ? t('spotSchedule.ruleSummaryEnabled') : t('spotSchedule.ruleSummaryDisabled')}
        </Badge>
      </div>

      <div className="p-5 space-y-6">
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-3">
          <p className="text-xs font-semibold text-primary mb-2">{t('spotSchedule.sectionPreview')}</p>
          {nextRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('spotSchedule.noUpcoming')}</p>
          ) : (
            <ul className="text-sm font-mono space-y-1 text-foreground">
              {nextRuns.map((d, i) => (
                <li key={i}>{d.toLocaleString()}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{t('spotSchedule.sectionWhen')}</h3>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 flex-1 min-w-0">
              <Label htmlFor={`name-${rule.id}`}>{t('spotSchedule.ruleName')}</Label>
              <Input
                id={`name-${rule.id}`}
                value={draft.name}
                onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch
                id={`en-${rule.id}`}
                checked={draft.enabled}
                onCheckedChange={(v) => setDraft((s) => ({ ...s, enabled: v }))}
              />
              <Label htmlFor={`en-${rule.id}`} className="text-sm cursor-pointer">
                {t('spotSchedule.enabled')}
              </Label>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('spotSchedule.minutesPastHour')}</Label>
            <div className="flex flex-wrap gap-2">
              {PRESET_MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() =>
                    setDraft((s) => ({
                      ...s,
                      minutesPastHour: toggleMinute(s.minutesPastHour, m),
                    }))
                  }
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs border transition-colors min-h-[36px]',
                    draft.minutesPastHour.includes(m)
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:border-muted-foreground/50'
                  )}
                >
                  {t(`spotSchedule.minutePreset.${m}` as const)}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{t('spotSchedule.minutesHint')}</p>
          </div>

          <div className="space-y-2">
            <Label>{t('spotSchedule.days')}</Label>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleDay(id)}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs border transition-colors min-h-[36px]',
                    effectiveDays.includes(id)
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:border-muted-foreground/50'
                  )}
                >
                  {t(`automation.weekdays.${WEEKDAY_KEYS[id]}`)}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {draft.daysOfWeek == null || draft.daysOfWeek.length === 0
                ? t('spotSchedule.everyDay')
                : t('spotSchedule.selectedDays')}
            </p>
          </div>

          <Accordion type="single" collapsible className="border border-border rounded-lg px-3">
            <AccordionItem value="daypart" className="border-0">
              <AccordionTrigger className="text-sm py-3 hover:no-underline">
                {t('spotSchedule.daypartTitle')}
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <p className="text-[11px] text-muted-foreground mb-3">{t('spotSchedule.daypartDesc')}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`ws-${rule.id}`}>{t('spotSchedule.windowStart')}</Label>
                    <Input
                      id={`ws-${rule.id}`}
                      type="time"
                      value={draft.windowStart ?? ''}
                      onChange={(e) =>
                        setDraft((s) => ({ ...s, windowStart: e.target.value || undefined }))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`we-${rule.id}`}>{t('spotSchedule.windowEnd')}</Label>
                    <Input
                      id={`we-${rule.id}`}
                      type="time"
                      value={draft.windowEnd ?? ''}
                      onChange={(e) => setDraft((s) => ({ ...s, windowEnd: e.target.value || undefined }))}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">{t('spotSchedule.windowHint')}</p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t('spotSchedule.applyPreset')}</p>
            <div className="flex flex-wrap gap-2">
              {PRESET_IDS.map((pid) => (
                <Button
                  key={pid}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs h-9"
                  onClick={() => setDraft((d) => applySchedulingPresetToDraft(d, pid))}
                >
                  {t(PRESET_LABEL_KEY[pid])}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">{t('spotSchedule.sectionWhat')}</h3>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {tracks.map((tr) => {
              const on = draft.trackIds.includes(tr.id);
              return (
                <label
                  key={tr.id}
                  className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40"
                >
                  <input
                    type="checkbox"
                    className="rounded border-border"
                    checked={on}
                    onChange={() => {
                      setDraft((s) => {
                        const next = on
                          ? s.trackIds.filter((x) => x !== tr.id)
                          : [...s.trackIds, tr.id];
                        return { ...s, trackIds: next };
                      });
                    }}
                  />
                  <span className="truncate flex-1">{tr.title}</span>
                  <span className="text-xs text-muted-foreground truncate">{tr.artist}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{t('spotSchedule.sectionHow')}</h3>
          <Label>{t('spotSchedule.insertMode')}</Label>
          <Select
            value={draft.insertMode}
            onValueChange={(v) => setDraft((s) => ({ ...s, insertMode: v as SpotInsertMode }))}
          >
            <SelectTrigger className="min-h-[44px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="playNext">{t('spotSchedule.playNext')}</SelectItem>
              <SelectItem value="addToEnd">{t('spotSchedule.addToEnd')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-border">
          <Button type="button" className="gap-2 min-h-[44px]" onClick={handleSave} disabled={!dirty}>
            <Save className="w-4 h-4" />
            {t('spotSchedule.save')}
          </Button>
          <Button type="button" variant="outline" className="gap-2 min-h-[44px]" onClick={handleDiscard} disabled={!dirty}>
            <RotateCcw className="w-4 h-4" />
            {t('spotSchedule.discardChanges')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="gap-2 min-h-[44px]"
            onClick={onTest}
            disabled={dirty}
            title={dirty ? t('spotSchedule.saveBeforeTest') : undefined}
          >
            <Zap className="w-4 h-4" />
            {t('spotSchedule.testFire')}
          </Button>
          <Button type="button" variant="ghost" className="gap-2 text-destructive min-h-[44px]" onClick={onRemove}>
            <Trash2 className="w-4 h-4" />
            {t('spotSchedule.deleteRule')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SpotSchedulePage() {
  const { t } = useTranslation();
  const rules = useSpotScheduleStore((s) => s.rules);
  const addRule = useSpotScheduleStore((s) => s.addRule);
  const updateRule = useSpotScheduleStore((s) => s.updateRule);
  const removeRule = useSpotScheduleStore((s) => s.removeRule);
  const fireRuleNow = useSpotScheduleStore((s) => s.fireRuleNow);

  const addFromPreset = (preset: SchedulingPresetId) => {
    const sched = schedulingPresetFields(preset);
    addRule({
      name: t('spotSchedule.defaultRuleName'),
      enabled: true,
      minutesPastHour: [...sched.minutesPastHour],
      daysOfWeek: sched.daysOfWeek ? [...sched.daysOfWeek] : undefined,
      windowStart: sched.windowStart,
      windowEnd: sched.windowEnd,
      trackIds: ['spot-ad-1', 'spot-ad-2'],
      insertMode: 'playNext',
    });
  };

  const handleAddBlank = () => {
    addRule({
      name: t('spotSchedule.defaultRuleName'),
      enabled: true,
      minutesPastHour: [0, 30],
      trackIds: ['spot-ad-1', 'spot-ad-2'],
      insertMode: 'playNext',
      windowStart: '06:00',
      windowEnd: '22:00',
    });
  };

  return (
    <div className="app-page-medium">
      <div className="flex items-center gap-3 mb-2">
        <Megaphone className="w-6 h-6 text-primary" />
        <h1 className="text-3xl font-bold text-foreground">{t('spotSchedule.title')}</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6 max-w-[62ch]">{t('spotSchedule.intro')}</p>

      <div className="surface-2 border border-border rounded-xl p-5 mb-6 space-y-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{t('spotSchedule.quickTemplates')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('spotSchedule.quickTemplatesHint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESET_IDS.map((pid) => (
            <Button key={pid} type="button" variant="secondary" size="sm" className="h-10" onClick={() => addFromPreset(pid)}>
              {t(PRESET_LABEL_KEY[pid])}
            </Button>
          ))}
        </div>
        <Button type="button" variant="outline" className="gap-2 h-10" onClick={handleAddBlank}>
          <Plus className="w-4 h-4" />
          {t('spotSchedule.addRule')}
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="surface-2 border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
          {t('spotSchedule.empty')}
        </div>
      ) : (
        <div className="space-y-6">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              onSave={(patch) => updateRule(rule.id, patch)}
              onRemove={() => removeRule(rule.id)}
              onTest={() => {
                const r = fireRuleNow(rule.id);
                if (r.ok) {
                  toast.success(t('spotSchedule.testOk'));
                } else if (r.error === 'no_tracks') {
                  toast.error(t('spotSchedule.errNoTracks'));
                } else if (r.error === 'missing_track') {
                  toast.error(t('spotSchedule.errMissingTrack'));
                } else {
                  toast.error(t('spotSchedule.testFail'));
                }
              }}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-8 leading-relaxed">{t('spotSchedule.disclaimer')}</p>
    </div>
  );
}
