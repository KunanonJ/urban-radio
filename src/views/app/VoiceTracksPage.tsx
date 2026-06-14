'use client';

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { VoiceTrackList } from '@/components/voice-tracks/VoiceTrackList';
import { VoiceTrackRecorder } from '@/components/voice-tracks/VoiceTrackRecorder';
import {
  useDeleteVoiceTrack,
  useUpdateVoiceTrack,
  useVoiceTracks,
  VT_STATUS_VALUES,
  type VoiceTrackFilters,
  type VoiceTrackRow,
  type VoiceTrackStatus,
} from '@/lib/voice-track-queries';

/**
 * Custom DOM event the AI drawer (owned by a parallel agent) listens for to
 * pop itself open. We dispatch it from the "AI generate" button so this page
 * can ship before the drawer integration lands.
 */
export const OPEN_VT_AI_DRAWER_EVENT = 'open-vt-ai-drawer';

const ALL_STATUS = 'all';

function isVoiceTrackStatus(value: string): value is VoiceTrackStatus {
  return (VT_STATUS_VALUES as readonly string[]).includes(value);
}

export function VoiceTracksPage() {
  const { t } = useTranslation();

  const [statusFilter, setStatusFilter] = useState<typeof ALL_STATUS | VoiceTrackStatus>(
    ALL_STATUS,
  );
  const [recorderOpen, setRecorderOpen] = useState(false);

  const filters: VoiceTrackFilters = useMemo(
    () => (statusFilter === ALL_STATUS ? {} : { status: statusFilter }),
    [statusFilter],
  );

  const list = useVoiceTracks(filters);
  const update = useUpdateVoiceTrack();
  const remove = useDeleteVoiceTrack();

  // Flatten the infinite-query pages into one list. Phase 4 cap is 50/page;
  // we render whatever's already fetched and rely on a future "load more" CTA.
  const tracks: VoiceTrackRow[] = useMemo(() => {
    if (!list.data) return [];
    return list.data.pages.flatMap((p) => p.voiceTracks);
  }, [list.data]);

  const openRecorder = useCallback(() => setRecorderOpen(true), []);

  const dispatchAiDrawer = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(OPEN_VT_AI_DRAWER_EVENT));
  }, []);

  const handleMarkReady = useCallback(
    (id: string) => {
      update.mutate(
        { id, patch: { status: 'ready' } },
        {
          onError: (err) => toast.error(err.message),
        },
      );
    },
    [update],
  );

  const handleArchive = useCallback(
    (id: string) => {
      update.mutate(
        { id, patch: { status: 'archived' } },
        {
          onError: (err) => toast.error(err.message),
        },
      );
    },
    [update],
  );

  const handleDelete = useCallback(
    (id: string) => {
      remove.mutate(id, {
        onError: (err) => toast.error(err.message),
      });
    },
    [remove],
  );

  const handleStatusChange = useCallback((value: string) => {
    if (value === ALL_STATUS) {
      setStatusFilter(ALL_STATUS);
      return;
    }
    if (isVoiceTrackStatus(value)) {
      setStatusFilter(value);
    }
  }, []);

  const header = (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-3">
          <Mic className="h-6 w-6 text-primary" aria-hidden="true" />
          <h1 className="text-3xl font-bold text-foreground">
            {t('voiceTracks.title')}
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{t('voiceTracks.subtitle')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div data-testid="vt-status-filter">
          <Select value={statusFilter} onValueChange={handleStatusChange}>
            <SelectTrigger
              className="w-[160px]"
              data-testid="vt-status-filter-trigger"
              aria-label={t('voiceTracks.filter.all')}
            >
              <SelectValue placeholder={t('voiceTracks.filter.all')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUS}>{t('voiceTracks.filter.all')}</SelectItem>
              {VT_STATUS_VALUES.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`voiceTracks.status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="secondary"
          data-testid="vt-new-ai"
          onClick={dispatchAiDrawer}
        >
          <Sparkles className="mr-1 size-4" />
          {t('voiceTracks.newAi')}
        </Button>
        <Button data-testid="vt-new-record" onClick={openRecorder}>
          <Plus className="mr-1 size-4" />
          {t('voiceTracks.newRecord')}
        </Button>
      </div>
    </header>
  );

  if (list.isLoading) {
    return (
      <div className="app-page space-y-4">
        {header}
        <div data-testid="vt-loading" className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
        <VoiceTrackRecorder
          open={recorderOpen}
          onOpenChange={setRecorderOpen}
          onSaved={() => {
            toast.success(t('voiceTracks.newRecord'));
          }}
        />
      </div>
    );
  }

  if (list.isError) {
    return (
      <div className="app-page space-y-4">
        {header}
        <EmptyState
          title={t('voiceTracks.empty.title')}
          description={list.error?.message ?? t('voiceTracks.empty.description')}
          icon={Mic}
          action={{
            label: t('voiceTracks.empty.action'),
            onClick: () => void list.refetch(),
          }}
        />
        <VoiceTrackRecorder
          open={recorderOpen}
          onOpenChange={setRecorderOpen}
          onSaved={() => {
            toast.success(t('voiceTracks.newRecord'));
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-page space-y-4">
      {header}
      <VoiceTrackList
        tracks={tracks}
        onPlay={(track) => {
          // Default behavior: open the streamUrl in a new tab. The Live Studio
          // pickup will replace this with the broadcast bus.
          if (typeof window !== 'undefined') window.open(track.streamUrl, '_blank', 'noopener');
        }}
        onMarkReady={handleMarkReady}
        onArchive={handleArchive}
        onDelete={handleDelete}
        onCreateClick={openRecorder}
      />
      <VoiceTrackRecorder
        open={recorderOpen}
        onOpenChange={setRecorderOpen}
        onSaved={() => {
          toast.success(t('voiceTracks.newRecord'));
        }}
      />
    </div>
  );
}

export default VoiceTracksPage;
