"use client";
import {
  useSchedulerStore,
  type SchedulerAction,
  type Weekday,
} from '@/lib/scheduler-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CalendarClock, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

const WEEKDAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function formatDays(ev: { daysOfWeek?: Weekday[] }, t: TFunction): string {
  if (ev.daysOfWeek == null || ev.daysOfWeek.length === 0) return t('automation.everyDay');
  if (ev.daysOfWeek.length === 7) return t('automation.everyDay');
  const labels = WEEKDAY_ORDER.filter((d) => ev.daysOfWeek!.includes(d)).map(
    (d) => t(`automation.weekdays.${WEEKDAY_KEYS[d]}`)
  );
  return labels.join(', ');
}

export default function AutomationPage() {
  const { t } = useTranslation();
  const events = useSchedulerStore((s) => s.events);
  const addEvent = useSchedulerStore((s) => s.addEvent);
  const removeEvent = useSchedulerStore((s) => s.removeEvent);

  const [time, setTime] = useState('09:00');
  const [action, setAction] = useState<SchedulerAction>('pause');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<Weekday[]>(() => [0, 1, 2, 3, 4, 5, 6]);

  const allDays = useMemo(() => days.length === 7, [days.length]);

  const toggleDay = (d: Weekday) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tm = time.trim();
    if (!/^\d{2}:\d{2}$/.test(tm)) return;
    const daysOfWeek = days.length === 0 || days.length === 7 ? undefined : (days as Weekday[]);
    addEvent({
      time: tm,
      action,
      label: label.trim() || (action === 'pause' ? t('automation.defaultPause') : t('automation.defaultResume')),
      daysOfWeek,
    });
    setLabel('');
  };

  return (
    <div className="app-page-narrow">
      <div className="flex items-center gap-3 mb-2">
        <CalendarClock className="w-6 h-6 text-primary" />
        <h1 className="text-3xl font-bold text-foreground">{t('automation.title')}</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-8">{t('automation.intro')}</p>

      <form onSubmit={onSubmit} className="surface-2 border border-border rounded-xl p-5 space-y-4 mb-10">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="sched-time">{t('automation.time')}</Label>
            <Input id="sched-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label>{t('automation.action')}</Label>
            <Select value={action} onValueChange={(v) => setAction(v as SchedulerAction)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pause">{t('automation.actionPause')}</SelectItem>
                <SelectItem value="resume">{t('automation.actionResume')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sched-label">{t('automation.labelOptional')}</Label>
            <Input
              id="sched-label"
              placeholder={t('automation.labelPlaceholder')}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>{t('automation.days')}</Label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAY_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => toggleDay(id)}
                className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                  days.includes(id)
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/50'
                }`}
              >
                {t(`automation.weekdays.${WEEKDAY_KEYS[id]}`)}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {allDays || days.length === 0 ? t('automation.runsEveryDay') : t('automation.runsSelected')}
          </p>
        </div>

        <Button type="submit">{t('automation.addSchedule')}</Button>
      </form>

      <div>
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{t('automation.scheduledEvents')}</h2>
        {events.length === 0 ? (
          <div className="surface-2 border border-border rounded-xl p-10 text-center text-muted-foreground text-sm">
            {t('automation.noEvents')}
          </div>
        ) : (
          <ul className="space-y-2">
            {events
              .slice()
              .sort((a, b) => a.time.localeCompare(b.time))
              .map((ev) => (
                <li
                  key={ev.id}
                  className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 surface-2 border border-border rounded-lg px-4 py-3"
                >
                  <span className="font-mono text-lg tabular-nums text-foreground">{ev.time}</span>
                  <span className="text-sm text-muted-foreground">
                    {ev.action === 'pause' ? t('automation.actionPause') : t('automation.actionResume')}
                  </span>
                  <span className="text-[11px] text-muted-foreground sm:order-last sm:ml-auto">
                    {formatDays(ev, t)}
                  </span>
                  <span className="flex-1 text-sm text-foreground truncate">{ev.label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive self-end sm:self-center"
                    onClick={() => removeEvent(ev.id)}
                    aria-label={t('automation.removeAria', { label: ev.label })}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
