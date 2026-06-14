"use client";
import { useTranslation } from 'react-i18next';
import { PlayCircle } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePlayerStore } from '@/lib/store';
import {
  usePlaybackPreferencesStore,
  type LosslessQualityKey,
  type SpatialDolbyKey,
  type HdmiPassthroughKey,
  type VideoQualityKey,
} from '@/lib/playback-preferences-store';

function ComingSoonBadge() {
  const { t } = useTranslation();
  return (
    <span className="text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-md border border-border bg-muted/40 text-muted-foreground">
      {t('settings.comingSoon')}
    </span>
  );
}

export function SettingsPlayback() {
  const { t } = useTranslation();

  const crossfadeEnabled = usePlayerStore((s) => s.crossfadeEnabled);
  const crossfadeDurationSec = usePlayerStore((s) => s.crossfadeDurationSec);
  const toggleCrossfade = usePlayerStore((s) => s.toggleCrossfade);
  const setCrossfadeDurationSec = usePlayerStore((s) => s.setCrossfadeDurationSec);
  const autoResumePlayback = usePlayerStore((s) => s.autoResumePlayback);
  const setAutoResumePlayback = usePlayerStore((s) => s.setAutoResumePlayback);

  const soundCheckEnabled = usePlaybackPreferencesStore((s) => s.soundCheckEnabled);
  const setSoundCheck = usePlaybackPreferencesStore((s) => s.setSoundCheck);
  const soundEnhancerEnabled = usePlaybackPreferencesStore((s) => s.soundEnhancerEnabled);
  const setSoundEnhancerEnabled = usePlaybackPreferencesStore((s) => s.setSoundEnhancerEnabled);
  const soundEnhancerLevel = usePlaybackPreferencesStore((s) => s.soundEnhancerLevel);
  const setSoundEnhancerLevel = usePlaybackPreferencesStore((s) => s.setSoundEnhancerLevel);

  const losslessEnabled = usePlaybackPreferencesStore((s) => s.losslessEnabled);
  const setLosslessEnabled = usePlaybackPreferencesStore((s) => s.setLosslessEnabled);
  const losslessStreaming = usePlaybackPreferencesStore((s) => s.losslessStreaming);
  const setLosslessStreaming = usePlaybackPreferencesStore((s) => s.setLosslessStreaming);
  const losslessDownload = usePlaybackPreferencesStore((s) => s.losslessDownload);
  const setLosslessDownload = usePlaybackPreferencesStore((s) => s.setLosslessDownload);

  const spatialDolbyAtmos = usePlaybackPreferencesStore((s) => s.spatialDolbyAtmos);
  const setSpatialDolbyAtmos = usePlaybackPreferencesStore((s) => s.setSpatialDolbyAtmos);
  const hdmiPassthrough = usePlaybackPreferencesStore((s) => s.hdmiPassthrough);
  const setHdmiPassthrough = usePlaybackPreferencesStore((s) => s.setHdmiPassthrough);
  const videoQuality = usePlaybackPreferencesStore((s) => s.videoQuality);
  const setVideoQuality = usePlaybackPreferencesStore((s) => s.setVideoQuality);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <PlayCircle className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold text-foreground">{t('settings.playback.title')}</h2>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">{t('settings.playback.intro')}</p>

      <div className="surface-2 border border-border rounded-xl p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="auto-resume" className="text-foreground">
              {t('settings.playback.autoResumePlayback')}
            </Label>
            <p className="text-xs text-muted-foreground">{t('settings.playback.autoResumePlaybackHint')}</p>
          </div>
          <Switch
            id="auto-resume"
            checked={autoResumePlayback}
            onCheckedChange={setAutoResumePlayback}
          />
        </div>
      </div>

      {/* Song transitions — crossfade wired to player store */}
      <div className="surface-2 border border-border rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-medium text-foreground">{t('settings.playback.sectionTransitions')}</h3>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="song-transitions" className="text-foreground">
              {t('settings.playback.songTransitions')}
            </Label>
            <p className="text-xs text-muted-foreground">{t('settings.playback.songTransitionsHint')}</p>
          </div>
          <Switch
            id="song-transitions"
            checked={crossfadeEnabled}
            onCheckedChange={(v) => {
              if (v !== crossfadeEnabled) toggleCrossfade();
            }}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-muted-foreground">{t('settings.playback.transitionStyle')}</Label>
            <ComingSoonBadge />
          </div>
          <Select disabled value="crossfade">
            <SelectTrigger className="max-w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="crossfade">{t('settings.playback.styleCrossfade')}</SelectItem>
              <SelectItem value="automix">{t('settings.playback.styleAutomix')}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{t('settings.playback.automixSoon')}</p>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="xfade-dur">{t('settings.playback.crossfadeDuration')}</Label>
            <span className="text-xs font-mono text-muted-foreground tabular-nums">
              {crossfadeDurationSec}s
            </span>
          </div>
          <Slider
            id="xfade-dur"
            min={2}
            max={15}
            step={1}
            value={[crossfadeDurationSec]}
            onValueChange={(v) => setCrossfadeDurationSec(v[0] ?? 4)}
            disabled={!crossfadeEnabled}
            className="max-w-md"
          />
          <p className="text-[11px] text-muted-foreground">{t('settings.playback.crossfadeHint')}</p>
        </div>
      </div>

      <Separator />

      {/* Audio enhancement */}
      <div className="surface-2 border border-border rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-medium text-foreground">{t('settings.playback.sectionEnhancement')}</h3>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label htmlFor="sound-check" className="text-foreground">
              {t('settings.playback.soundCheck')}
            </Label>
            <p className="text-xs text-muted-foreground">{t('settings.playback.soundCheckHint')}</p>
          </div>
          <Switch id="sound-check" checked={soundCheckEnabled} onCheckedChange={setSoundCheck} />
        </div>
        <div className="space-y-3 opacity-80">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="sound-enhancer" className="text-foreground">
                  {t('settings.playback.soundEnhancer')}
                </Label>
                <ComingSoonBadge />
              </div>
              <p className="text-xs text-muted-foreground">{t('settings.playback.soundEnhancerHint')}</p>
            </div>
            <Switch
              id="sound-enhancer"
              checked={soundEnhancerEnabled}
              onCheckedChange={setSoundEnhancerEnabled}
              disabled
            />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{t('settings.playback.enhancerLow')}</span>
              <span>{t('settings.playback.enhancerHigh')}</span>
            </div>
            <Slider
              min={0}
              max={100}
              step={1}
              value={[soundEnhancerLevel]}
              onValueChange={(v) => setSoundEnhancerLevel(v[0] ?? 0)}
              disabled
            />
          </div>
        </div>
      </div>

      <Separator />

      {/* Lossless — UI persisted; pipeline coming soon */}
      <div className="surface-2 border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground">{t('settings.playback.sectionLossless')}</h3>
          <ComingSoonBadge />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="lossless-en" className="text-foreground">
            {t('settings.playback.enableLossless')}
          </Label>
          <Switch id="lossless-en" checked={losslessEnabled} onCheckedChange={setLosslessEnabled} />
        </div>
        <p className="text-[11px] text-muted-foreground">{t('settings.playback.losslessHint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('settings.playback.streamingQuality')}</Label>
            <Select
              value={losslessStreaming}
              onValueChange={(v) => setLosslessStreaming(v as LosslessQualityKey)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aac256">{t('settings.playback.qualityAac256')}</SelectItem>
                <SelectItem value="alac">{t('settings.playback.qualityAlac')}</SelectItem>
                <SelectItem value="off">{t('settings.playback.qualityOff')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('settings.playback.downloadQuality')}</Label>
            <Select
              value={losslessDownload}
              onValueChange={(v) => setLosslessDownload(v as LosslessQualityKey)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aac256">{t('settings.playback.qualityAac256')}</SelectItem>
                <SelectItem value="alac">{t('settings.playback.qualityAlac')}</SelectItem>
                <SelectItem value="off">{t('settings.playback.qualityOff')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Separator />

      {/* Spatial */}
      <div className="surface-2 border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground">{t('settings.playback.sectionSpatial')}</h3>
          <ComingSoonBadge />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t('settings.playback.dolbyAtmos')}</Label>
            <Select
              value={spatialDolbyAtmos}
              onValueChange={(v) => setSpatialDolbyAtmos(v as SpatialDolbyKey)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t('settings.playback.spatialAuto')}</SelectItem>
                <SelectItem value="off">{t('settings.playback.spatialOff')}</SelectItem>
                <SelectItem value="always">{t('settings.playback.spatialAlways')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t('settings.playback.hdmiPassthrough')}</Label>
            <Select
              value={hdmiPassthrough}
              onValueChange={(v) => setHdmiPassthrough(v as HdmiPassthroughKey)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">{t('settings.playback.hdmiOff')}</SelectItem>
                <SelectItem value="on">{t('settings.playback.hdmiOn')}</SelectItem>
                <SelectItem value="auto">{t('settings.playback.hdmiAuto')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <Separator />

      {/* Video */}
      <div className="surface-2 border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground">{t('settings.playback.sectionVideo')}</h3>
          <ComingSoonBadge />
        </div>
        <div className="space-y-1.5 max-w-sm">
          <Label>{t('settings.playback.videoQuality')}</Label>
          <Select value={videoQuality} onValueChange={(v) => setVideoQuality(v as VideoQualityKey)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{t('settings.playback.videoAuto')}</SelectItem>
              <SelectItem value="720p">{t('settings.playback.video720')}</SelectItem>
              <SelectItem value="1080p">{t('settings.playback.video1080')}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{t('settings.playback.videoHint')}</p>
        </div>
      </div>
    </div>
  );
}
