"use client";
import { useEffect, useMemo, useState } from 'react';
import { mockStationBreak } from '@/lib/mock-data';
import { useMergedTracks } from '@/lib/library';
import { generateRotationPlaylist, generateRotationPlaylistWithBreaks, uniqueGenres } from '@/lib/playlist-generator';
import { usePlayerStore } from '@/lib/store';
import { formatDuration, formatHMS } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sparkles, ListMusic, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

export default function PlaylistGeneratorPage() {
  const { t } = useTranslation();
  const setQueue = usePlayerStore((s) => s.setQueue);
  const pool = useMergedTracks();
  const genres = useMemo(() => uniqueGenres(pool), [pool]);
  const [rotation, setRotation] = useState<string[]>([]);

  useEffect(() => {
    setRotation((r) => (r.length === 0 && genres.length > 0 ? [...genres] : r));
  }, [genres]);
  const [targetHours, setTargetHours] = useState('2');
  const [targetMins, setTargetMins] = useState('0');
  const [breakEveryMin, setBreakEveryMin] = useState('0');

  const targetSeconds = useMemo(() => {
    const h = Math.max(0, parseInt(targetHours, 10) || 0);
    const m = Math.max(0, Math.min(59, parseInt(targetMins, 10) || 0));
    return h * 3600 + m * 60;
  }, [targetHours, targetMins]);

  const breakEverySec = useMemo(() => {
    const m = Math.max(0, parseInt(breakEveryMin, 10) || 0);
    return m * 60;
  }, [breakEveryMin]);

  const generated = useMemo(() => {
    if (rotation.length === 0 || pool.length === 0 || targetSeconds <= 0) return [];
    if (breakEverySec <= 0) {
      return generateRotationPlaylist(pool, rotation, targetSeconds);
    }
    return generateRotationPlaylistWithBreaks(
      pool,
      rotation,
      targetSeconds,
      mockStationBreak,
      breakEverySec
    );
  }, [pool, rotation, targetSeconds, breakEverySec]);

  const totalSec = useMemo(() => generated.reduce((a, tr) => a + tr.duration, 0), [generated]);

  const moveGenre = (index: number, dir: -1 | 1) => {
    setRotation((r) => {
      const next = [...r];
      const j = index + dir;
      if (j < 0 || j >= next.length) return r;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const toggleGenreInRotation = (g: string) => {
    setRotation((r) => (r.includes(g) ? r.filter((x) => x !== g) : [...r, g]));
  };

  return (
    <div className="app-page-settings">
      <div className="flex items-center gap-3 mb-2">
        <Sparkles className="w-6 h-6 text-primary" />
        <h1 className="text-3xl font-bold text-foreground">{t('playlistGenerator.title')}</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-8 max-w-xl">{t('playlistGenerator.intro')}</p>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="space-y-4 surface-2 border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground">{t('playlistGenerator.targetLength')}</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="gen-hours">{t('playlistGenerator.hours')}</Label>
              <Input
                id="gen-hours"
                type="number"
                min={0}
                className="w-20"
                value={targetHours}
                onChange={(e) => setTargetHours(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gen-mins">{t('playlistGenerator.minutes')}</Label>
              <Input
                id="gen-mins"
                type="number"
                min={0}
                max={59}
                className="w-20"
                value={targetMins}
                onChange={(e) => setTargetMins(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5 pt-2">
            <Label htmlFor="break-every">{t('playlistGenerator.breakEvery')}</Label>
            <Input
              id="break-every"
              type="number"
              min={0}
              className="w-24"
              value={breakEveryMin}
              onChange={(e) => setBreakEveryMin(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">{t('playlistGenerator.breakHint')}</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('playlistGenerator.targetSummary', {
              target: formatHMS(targetSeconds),
              generated: formatHMS(totalSec),
              count: generated.length,
            })}
          </p>
        </div>

        <div className="space-y-4 surface-2 border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground">{t('playlistGenerator.rotationTitle')}</h2>
          <p className="text-xs text-muted-foreground">{t('playlistGenerator.rotationHint')}</p>
          <div className="flex flex-wrap gap-2">
            {genres.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => toggleGenreInRotation(g)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs border transition-colors',
                  rotation.includes(g)
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/50'
                )}
              >
                {g}
              </button>
            ))}
          </div>
          {rotation.length === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-500">{t('playlistGenerator.selectGenre')}</p>
          )}
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {rotation.map((g, i) => (
              <li
                key={g}
                className="flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-sm"
              >
                <span className="text-muted-foreground tabular-nums w-6">{i + 1}.</span>
                <span className="flex-1 truncate">{g}</span>
                <div className="flex gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={i === 0}
                    onClick={() => moveGenre(i, -1)}
                    aria-label={t('playlistGenerator.moveUp')}
                  >
                    <ChevronUp className="w-4 h-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={i === rotation.length - 1}
                    onClick={() => moveGenre(i, 1)}
                    aria-label={t('playlistGenerator.moveDown')}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={generated.length === 0}
          onClick={() => setQueue(generated, 0)}
          className="gap-2"
        >
          <ListMusic className="w-4 h-4" />
          {t('playlistGenerator.loadQueue')}
        </Button>
      </div>

      {generated.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">{t('playlistGenerator.preview')}</h2>
          <div className="surface-2 border border-border rounded-xl divide-y divide-border max-h-[360px] overflow-y-auto">
            {generated.map((track, i) => (
              <div key={`${track.id}-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="text-muted-foreground font-mono w-6">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">{track.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{track.artist}</p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{track.genre ?? t('playlistGenerator.genreOther')}</span>
                <span className="text-xs font-mono text-muted-foreground w-12 text-right">
                  {formatDuration(track.duration)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
