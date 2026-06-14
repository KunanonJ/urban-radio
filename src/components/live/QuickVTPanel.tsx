'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/format';

/**
 * Quick Voice Track panel — the Live Studio's open-VT-actions surface.
 *
 * Shows the last 3 ready voice tracks (fetched from `/api/voice-tracks?status=ready&limit=3`)
 * and two CTAs that hand control to the recorder + AI drawer panels (owned by
 * other agents in this phase) via custom DOM events:
 *
 *   - `open-vt-recorder` — opens the recorder.
 *   - `open-vt-ai-drawer` — opens the AI generation drawer.
 *
 * The drawer/recorder components attach `addEventListener('open-vt-…')` to
 * `window`; they live elsewhere in the tree. We dispatch from here so the
 * panels remain independently testable and we don't need a shared store
 * just to flip "is this drawer open".
 *
 * Data fetch is inlined (not via `useVoiceTracks`) because the hook lives in
 * a peer-agent's file that is materialising in parallel. The duplication is
 * tiny and we can fold into the hook once it lands.
 */
export interface QuickVTPanelProps {
  className?: string;
}

interface VoiceTrackListItem {
  id: string;
  durationMs: number;
  transcript: string | null;
}

interface VoiceTracksListResponse {
  voiceTracks?: Array<{
    id?: string;
    durationMs?: number;
    transcript?: string | null;
  }>;
}

const VT_API = '/api/voice-tracks?status=ready&limit=3';

function firstLine(transcript: string | null | undefined): string | null {
  if (!transcript) return null;
  const trimmed = transcript.trim();
  if (!trimmed) return null;
  const newline = trimmed.indexOf('\n');
  return newline >= 0 ? trimmed.slice(0, newline).trim() : trimmed;
}

function formatVtDuration(durationMs: number): string {
  return formatDuration(Math.floor(Math.max(0, durationMs) / 1000));
}

export function QuickVTPanel({ className }: QuickVTPanelProps = {}) {
  const { t } = useTranslation();
  const [tracks, setTracks] = useState<VoiceTrackListItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(VT_API, { credentials: 'same-origin' });
        if (!res.ok) {
          if (!cancelled) setTracks([]);
          return;
        }
        const data = (await res.json()) as VoiceTracksListResponse;
        if (cancelled) return;
        const list = (data.voiceTracks ?? [])
          .filter((row): row is { id: string; durationMs: number; transcript: string | null } =>
            typeof row?.id === 'string' && typeof row?.durationMs === 'number',
          )
          .slice(0, 3)
          .map((row) => ({
            id: row.id,
            durationMs: row.durationMs,
            transcript: row.transcript ?? null,
          }));
        setTracks(list);
      } catch {
        if (!cancelled) setTracks([]);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const onRecord = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-vt-recorder'));
  }, []);

  const onAi = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-vt-ai-drawer'));
  }, []);

  // These two strings don't have dedicated locale keys yet (locales/* is
  // outside this agent's allowed file scope). Use `t()` with a `defaultValue`
  // so a future PR can drop the key in without touching this component.
  const untitledLabel = t('voiceTracks.untitled', { defaultValue: 'Voice track' });
  const emptyLabel = t('liveStudio.quickVT.empty', {
    defaultValue: 'No ready voice tracks. Record one or generate with AI.',
  });

  return (
    <section
      data-testid="quick-vt-panel"
      className={cn(
        'surface-2 flex flex-col gap-3 rounded-xl border border-border/40 p-4',
        className,
      )}
    >
      <header className="flex items-center gap-2">
        <Mic className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {t('liveStudio.quickVT.title')}
        </h2>
      </header>

      {tracks.length === 0 ? (
        <p
          data-testid="quick-vt-empty"
          className="text-xs leading-relaxed text-muted-foreground"
        >
          {emptyLabel}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {tracks.map((vt) => {
            const title = firstLine(vt.transcript) ?? untitledLabel;
            return (
              <li
                key={vt.id}
                data-testid={`quick-vt-item-${vt.id}`}
                className="flex items-center justify-between gap-2 rounded-md border border-border/30 bg-background/40 px-2 py-1.5 text-xs"
              >
                <span className="truncate text-foreground" title={title}>
                  {title}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatVtDuration(vt.durationMs)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          data-testid="quick-vt-record"
          onClick={onRecord}
          className="flex-1 gap-2"
          size="sm"
          variant="secondary"
        >
          <Mic className="h-4 w-4" aria-hidden="true" />
          {t('voiceTracks.newRecord')}
        </Button>
        <Button
          type="button"
          data-testid="quick-vt-ai"
          onClick={onAi}
          className="flex-1 gap-2"
          size="sm"
          variant="outline"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {t('voiceTracks.newAi')}
        </Button>
      </div>
    </section>
  );
}
