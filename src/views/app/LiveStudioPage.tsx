'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Power, Radio } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createAudioGraph, type AudioGraph } from '@/lib/audio-graph';
import { Mixer } from '@/components/live/Mixer';
import { NowNextQueueStrip } from '@/components/live/NowNextQueueStrip';
import { LiveStudioHotkeys } from '@/components/live/LiveStudioHotkeys';
import { HealthStrip } from '@/components/live/HealthStrip';
import { QuickVTPanel } from '@/components/live/QuickVTPanel';

/**
 * localStorage key for the layout preference. Exported so tests can read it.
 */
export const LIVE_STUDIO_LAYOUT_STORAGE_KEY = 'sonic-bloom-live-layout';

export type LiveStudioLayout = 'compact' | 'wide' | 'minimal';

const LAYOUT_VALUES: readonly LiveStudioLayout[] = ['compact', 'wide', 'minimal'] as const;

function isLayout(v: string | null): v is LiveStudioLayout {
  return v !== null && (LAYOUT_VALUES as readonly string[]).includes(v);
}

function readPersistedLayout(): LiveStudioLayout {
  if (typeof window === 'undefined') return 'compact';
  try {
    const v = window.localStorage.getItem(LIVE_STUDIO_LAYOUT_STORAGE_KEY);
    return isLayout(v) ? v : 'compact';
  } catch {
    return 'compact';
  }
}

function persistLayout(layout: LiveStudioLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LIVE_STUDIO_LAYOUT_STORAGE_KEY, layout);
  } catch {
    // localStorage may be disabled (private browsing); a layout reset on
    // next mount is acceptable, no need to surface this to the user.
  }
}

/**
 * Live Studio shell — composes Mixer, Now/Next/Queue strip, HealthStrip,
 * QuickVTPanel, and the global LiveStudioHotkeys bridge.
 *
 * Audio graph activation is lazy: `createAudioGraph()` is invoked on the
 * first "Enable audio" click. Until then the mixer renders disabled. This
 * avoids creating an AudioContext on every page load (browsers throttle
 * autoplay-suspect AudioContexts, and jsdom can't construct one anyway).
 *
 * Layout is one of `compact | wide | minimal`, persisted to localStorage
 * under {@link LIVE_STUDIO_LAYOUT_STORAGE_KEY}.
 */
export function LiveStudioPage() {
  const { t } = useTranslation();

  const [layout, setLayoutState] = useState<LiveStudioLayout>(() => readPersistedLayout());
  const [graph, setGraph] = useState<AudioGraph | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const graphRef = useRef<AudioGraph | null>(null);

  // Re-sync from localStorage on mount in case the SSR/CSR boundary or
  // hydration order missed the initial useState pass.
  useEffect(() => {
    const persisted = readPersistedLayout();
    setLayoutState(persisted);
  }, []);

  // Keep graphRef in sync so the unmount cleanup always sees the latest value.
  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  // Close the AudioContext on unmount so leaving the page doesn't leak a
  // suspended context (browsers warn about this in devtools).
  useEffect(() => {
    return () => {
      const g = graphRef.current;
      // `close` is always present on a real AudioGraph; tests may inject a
      // partial mock, so guard the call rather than assuming the shape.
      if (g && typeof g.close === 'function') {
        try {
          const p = g.close();
          if (p && typeof p.catch === 'function') {
            p.catch(() => {
              // ignore — context may already be closed.
            });
          }
        } catch {
          // ignore — best-effort cleanup.
        }
      }
    };
  }, []);

  const setLayout = useCallback((next: LiveStudioLayout) => {
    setLayoutState(next);
    persistLayout(next);
  }, []);

  const enableAudio = useCallback(() => {
    if (graph) return; // already enabled
    try {
      const g = createAudioGraph();
      setGraph(g);
      setAudioError(null);
    } catch (err) {
      setAudioError(err instanceof Error ? err.message : 'Failed to enable audio');
    }
  }, [graph]);

  const handleMixerError = useCallback((err: Error) => {
    setAudioError(err.message);
  }, []);

  const subtitle = t('liveStudio.subtitle');

  return (
    <div className="app-page-narrow" data-testid="live-studio-page" data-layout={layout}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Radio className="h-6 w-6 text-primary" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t('liveStudio.title')}
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>

        <LayoutPicker layout={layout} onChange={setLayout} />
      </header>

      {!graph && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border/60 bg-muted/30 px-3 py-2">
          <Button
            type="button"
            data-testid="live-studio-enable-audio"
            variant="default"
            size="sm"
            onClick={enableAudio}
            className="gap-2"
          >
            <Power className="h-4 w-4" aria-hidden="true" />
            {t('liveStudio.title')} — Enable audio
          </Button>
          <span className="text-xs text-muted-foreground">
            {t('liveStudio.mixer.title') ?? 'Mixer'}
          </span>
        </div>
      )}

      {audioError && (
        <div
          role="alert"
          data-testid="live-studio-audio-error"
          className="mb-4 rounded-lg border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {audioError}
        </div>
      )}

      <LiveStudioBody layout={layout} graph={graph} onMixerError={handleMixerError} />

      <LiveStudioHotkeys />
    </div>
  );
}

interface LayoutPickerProps {
  layout: LiveStudioLayout;
  onChange: (layout: LiveStudioLayout) => void;
}

function LayoutPicker({ layout, onChange }: LayoutPickerProps) {
  const { t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t('liveStudio.layout.title')}
      data-testid="live-studio-layout-picker"
      className="inline-flex items-center rounded-md border border-border bg-muted/30 p-0.5"
    >
      {LAYOUT_VALUES.map((value) => {
        const active = layout === value;
        return (
          <button
            key={value}
            type="button"
            data-testid={`live-studio-layout-${value}`}
            data-active={active ? 'true' : 'false'}
            onClick={() => onChange(value)}
            className={cn(
              'rounded-sm px-3 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`liveStudio.layout.${value}` as const)}
          </button>
        );
      })}
    </div>
  );
}

interface LiveStudioBodyProps {
  layout: LiveStudioLayout;
  graph: AudioGraph | null;
  onMixerError: (err: Error) => void;
}

function LiveStudioBody({ layout, graph, onMixerError }: LiveStudioBodyProps) {
  // Minimal layout: collapse the mixer entirely; only show the strip + health
  // + VT placeholder. Compact and wide both show everything but rearrange.
  if (layout === 'minimal') {
    return (
      <div className="space-y-4">
        <NowNextQueueStrip layout="minimal" />
        <HealthStrip />
        <QuickVTPanel />
      </div>
    );
  }

  if (layout === 'wide') {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <NowNextQueueStrip layout="wide" />
          <Mixer graph={graph} onError={onMixerError} />
        </div>
        <HealthStrip />
        <QuickVTPanel />
      </div>
    );
  }

  // compact (default)
  return (
    <div className="space-y-4">
      <NowNextQueueStrip layout="compact" />
      <Mixer graph={graph} onError={onMixerError} />
      <div className="grid gap-4 md:grid-cols-2">
        <HealthStrip />
        <QuickVTPanel />
      </div>
    </div>
  );
}

export default LiveStudioPage;
