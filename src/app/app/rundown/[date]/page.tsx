'use client';

import { use, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Wand2, Send, ArrowLeft, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DateNavigator } from '@/features/rundown/components/date-navigator';
import { HourBlock } from '@/features/rundown/components/hour-block';
import { HourTemplateSelector } from '@/features/rundown/components/hour-template-selector';
import { useRundown, useCreateRundown, useUpdateRundown } from '@/features/rundown/hooks/use-rundowns';
import { useClockTemplates } from '@/features/clock-templates/hooks/use-clock-templates';
import { generateRundown } from '@/features/rundown/api/generate';
import { hasBlockingConflicts } from '@/lib/scheduling/conflict-detector';
import type { RundownItem, RundownHour } from '@/types/rundown';
import type { PlayHistory } from '@/lib/scheduling/types';

interface PageProps {
  readonly params: Promise<{ date: string }>;
}

const DEFAULT_HOURS = Array.from({ length: 24 }, (_, i) => i);

const emptyHistory: PlayHistory = {
  trackPlays: new Map(),
  artistPlays: new Map(),
  advertiserPlays: new Map(),
  campaignPlayCounts: new Map(),
};

export default function RundownDatePage({ params }: PageProps) {
  const { date } = use(params);
  const router = useRouter();
  const { data: rundowns = [], isLoading } = useRundown(date);
  const { data: templates = [] } = useClockTemplates();
  const createRundown = useCreateRundown();
  const updateRundown = useUpdateRundown();

  const rundown = rundowns[0] ?? null;

  const [hourTemplates, setHourTemplates] = useState<Record<number, string>>({});
  const [generatedItems, setGeneratedItems] = useState<readonly RundownItem[] | null>(null);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);

  const currentItems = generatedItems ?? rundown?.items ?? [];
  const isDirty = generatedItems !== null;

  const itemsByHour = useMemo(() => {
    const map = new Map<number, RundownItem[]>();
    for (const item of currentItems) {
      const existing = map.get(item.hourBlock) ?? [];
      existing.push(item as RundownItem);
      map.set(item.hourBlock, existing);
    }
    return map;
  }, [currentItems]);

  const allConflicts = useMemo(() => {
    return currentItems.flatMap((item) =>
      item.conflictFlags.map((flag) => ({ itemId: item.id, flags: [flag] })),
    );
  }, [currentItems]);

  const hasBlocking = useMemo(() => {
    const entries = allConflicts.map((c) => ({
      itemId: c.itemId,
      flag: c.flags[0]!,
      message: '',
    }));
    return hasBlockingConflicts(entries);
  }, [allConflicts]);

  const handleDateChange = useCallback(
    (newDate: string) => {
      router.push(`/app/rundown/${newDate}`);
    },
    [router],
  );

  const handleTemplateChange = useCallback((hour: number, templateId: string) => {
    setHourTemplates((prev) => ({ ...prev, [hour]: templateId }));
  }, []);

  const handleGenerate = useCallback(() => {
    const hours: { hour: number; clockTemplateId: string }[] = [];
    for (const h of DEFAULT_HOURS) {
      const tplId = hourTemplates[h] ?? rundown?.hours.find((rh) => rh.hour === h)?.clockTemplateId;
      if (tplId) {
        hours.push({ hour: h, clockTemplateId: tplId });
      }
    }

    if (hours.length === 0) return;

    const templateMap = new Map(
      templates.map((t) => [t.id, { segments: [...t.segments] }]),
    );

    const result = generateRundown({
      date,
      hours,
      templates: templateMap,
      tracks: [], // In production, these would come from Firestore queries
      campaigns: [],
      spots: new Map(),
      existingItems: currentItems.filter((i) => i.isManualOverride),
      context: {
        date,
        dayOfWeek: new Date(date + 'T00:00:00').getDay(),
        explicitAllowed: true,
        songRules: { sameArtistMinSlots: 4, sameTrackMinHours: 2 },
        adRules: { defaultMinMinutesBetweenSameAdvertiser: 30 },
      },
      history: emptyHistory,
    });

    setGeneratedItems(result.items);
  }, [date, hourTemplates, templates, currentItems, rundown]);

  const handleSave = useCallback(() => {
    if (!generatedItems) return;

    const hours: RundownHour[] = Object.entries(hourTemplates).map(([h, tplId]) => ({
      hour: Number(h),
      clockTemplateId: tplId,
    }));

    const data = {
      date,
      stationId: 'default',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      status: 'draft' as const,
      hours,
      items: [...generatedItems],
      generatedAt: new Date(),
      updatedAt: new Date(),
    };

    if (rundown) {
      updateRundown.mutate(
        { id: rundown.id, data },
        { onSuccess: () => setGeneratedItems(null) },
      );
    } else {
      createRundown.mutate(data as Omit<typeof data & { id: string }, 'id'>, {
        onSuccess: () => setGeneratedItems(null),
      });
    }
  }, [generatedItems, hourTemplates, date, rundown, updateRundown, createRundown]);

  const handlePublish = useCallback(() => {
    if (!rundown) return;
    updateRundown.mutate(
      {
        id: rundown.id,
        data: {
          status: 'published',
          publishedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { onSuccess: () => setPublishDialogOpen(false) },
    );
  }, [rundown, updateRundown]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/app/rundown">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Rundown</h1>
            <DateNavigator date={date} onChange={handleDateChange} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {rundown && (
            <Badge variant={
              rundown.status === 'published' ? 'default' :
              rundown.status === 'locked' ? 'destructive' : 'secondary'
            }>
              {rundown.status}
            </Badge>
          )}
          {isDirty && <Badge variant="outline" className="text-amber-500">Unsaved</Badge>}
          <Button variant="outline" onClick={handleGenerate}>
            <Wand2 className="mr-2 h-4 w-4" /> Generate
          </Button>
          {isDirty && (
            <Button onClick={handleSave} disabled={createRundown.isPending || updateRundown.isPending}>
              Save
            </Button>
          )}
          {rundown && rundown.status === 'draft' && (
            <Button
              variant="default"
              onClick={() => setPublishDialogOpen(true)}
              disabled={hasBlocking}
            >
              <Send className="mr-2 h-4 w-4" /> Publish
            </Button>
          )}
        </div>
      </div>

      {/* Blocking conflicts warning */}
      {hasBlocking && currentItems.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          Blocking conflicts detected. Resolve them before publishing.
        </div>
      )}

      {/* Hour template assignment */}
      {!rundown && (
        <div className="rounded-lg border p-4 space-y-2">
          <h2 className="text-sm font-semibold pb-2">Assign Templates to Hours</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {DEFAULT_HOURS.map((h) => (
              <HourTemplateSelector
                key={h}
                hour={h}
                selectedTemplateId={hourTemplates[h]}
                templates={templates}
                onChange={handleTemplateChange}
              />
            ))}
          </div>
        </div>
      )}

      {/* Hour timeline */}
      <div className="space-y-4">
        {DEFAULT_HOURS.filter((h) => {
          return (itemsByHour.get(h)?.length ?? 0) > 0 || hourTemplates[h] || rundown?.hours.some((rh) => rh.hour === h);
        }).map((h) => {
          const items = itemsByHour.get(h) ?? [];
          const tplId = hourTemplates[h] ?? rundown?.hours.find((rh) => rh.hour === h)?.clockTemplateId;
          const tplName = tplId ? templates.find((t) => t.id === tplId)?.name : undefined;
          return (
            <HourBlock
              key={h}
              hour={h}
              items={items}
              templateName={tplName}
            />
          );
        })}

        {currentItems.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            <p>No rundown data for this date.</p>
            <p className="text-sm">Assign templates to hours above, then click Generate.</p>
          </div>
        )}
      </div>

      {/* Publish dialog */}
      <ConfirmDialog
        open={publishDialogOpen}
        onOpenChange={setPublishDialogOpen}
        title="Publish Rundown"
        description={`Publish the rundown for ${date}? This will make it available in the operator view.`}
        confirmLabel="Publish"
        onConfirm={handlePublish}
        loading={updateRundown.isPending}
      />
    </div>
  );
}
