"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-base";
import {
  CapHitError,
  useGenerateText,
  useGenerateVoice,
  useVoiceList,
  type GenerateTextInput,
  type VoiceListItem,
} from "@/lib/ai-queries";

/** Topics matched against the backend `/api/ai/text/generate` schema. */
const TOPICS = [
  "frontsell",
  "backsell",
  "fun_fact",
  "station_id",
  "weather",
  "news",
  "custom",
] as const;
type Topic = (typeof TOPICS)[number];

const TONES = [
  "energetic",
  "calm",
  "professional",
  "cheeky",
  "morning",
] as const;
type Tone = (typeof TONES)[number];

type Scope = "cloned" | "stock" | "all";

interface SavedVoiceTrack {
  id: string;
  stationId: string;
  recordedBy: string | null;
  storageKey: string;
  durationMs: number;
  transcript: string | null;
  targetClockSlotId: string | null;
  status: string;
  aiGenerated: number | null;
  createdAt: string;
}

export interface VoiceTrackAiDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (track: SavedVoiceTrack) => void;
}

interface CapHitState {
  message: string;
  remainingUsd: number;
}

/**
 * Compute a hint-level cost estimate for the user. Real cost lands in
 * `response.usage` after each call; this is just to give a "this will probably
 * cost ~$X" feel before clicking.
 */
function estimateCostUsd(scriptText: string | null): number {
  /** $0.005 for text generation regardless of length (Anthropic Haiku tokens are tiny). */
  const textCost = 0.005;
  /** $0.10 for voice synthesis when script > 100 chars; $0.05 otherwise. */
  const voiceCost = (scriptText?.length ?? 0) > 100 ? 0.1 : 0.05;
  return Math.round((textCost + voiceCost) * 100) / 100;
}

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function VoiceTrackAiDrawer({
  open,
  onOpenChange,
  onSaved,
}: VoiceTrackAiDrawerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [scope, setScope] = useState<Scope>("all");
  const [voiceId, setVoiceId] = useState<string>("");
  const [topic, setTopic] = useState<Topic>("frontsell");
  const [tone, setTone] = useState<Tone>("energetic");
  const [contextArtist, setContextArtist] = useState("");
  const [contextTitle, setContextTitle] = useState("");
  const [contextTempC, setContextTempC] = useState("");
  const [contextWeatherDesc, setContextWeatherDesc] = useState("");
  const [customPrompt, setCustomPrompt] = useState("");
  const [script, setScript] = useState<string | null>(null);
  const [audioBase64, setAudioBase64] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [capHit, setCapHit] = useState<CapHitState | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const voiceListQuery = useVoiceList(scope);
  // Stabilize the voices reference so the effect below doesn't re-fire on
  // every render that didn't actually change the list contents.
  const voices: VoiceListItem[] = useMemo(
    () => voiceListQuery.data?.voices ?? [],
    [voiceListQuery.data],
  );

  const generateText = useGenerateText();
  const generateVoice = useGenerateVoice();

  // When voice list refreshes and the current voiceId is no longer present,
  // fall back to the first available voice so the Generate audio button has
  // a valid selection to send.
  useEffect(() => {
    if (voices.length === 0) {
      if (voiceId !== "") setVoiceId("");
      return;
    }
    if (!voices.some((v) => v.id === voiceId)) {
      setVoiceId(voices[0].id);
    }
  }, [voices, voiceId]);

  // Reset transient state every time the drawer (re)opens so the user starts
  // fresh — otherwise stale audio from the last open would still be there.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setScript(null);
      setAudioBase64(null);
      setDurationMs(null);
      setCapHit(null);
      setErrorMsg(null);
      setSaving(false);
    }
    wasOpenRef.current = open;
  }, [open]);

  const buildContext = useCallback((): unknown => {
    if (topic === "frontsell" || topic === "backsell") {
      if (!contextArtist && !contextTitle) return undefined;
      return { artist: contextArtist || undefined, title: contextTitle || undefined };
    }
    if (topic === "weather") {
      const tempC = Number(contextTempC);
      if (!Number.isFinite(tempC) && !contextWeatherDesc) return undefined;
      return {
        weather: {
          tempC: Number.isFinite(tempC) ? tempC : 20,
          description: contextWeatherDesc || "",
        },
      };
    }
    if (topic === "custom") {
      if (!customPrompt) return undefined;
      return { custom: customPrompt };
    }
    return undefined;
  }, [topic, contextArtist, contextTitle, contextTempC, contextWeatherDesc, customPrompt]);

  const handleGenerateText = useCallback(async () => {
    setCapHit(null);
    setErrorMsg(null);
    const input: GenerateTextInput = {
      topic,
      tone,
      context: buildContext(),
    };
    try {
      const res = await generateText.mutateAsync(input);
      if (res.ok && res.data?.text) {
        setScript(res.data.text);
        // Clear any prior audio since the script changed.
        setAudioBase64(null);
        setDurationMs(null);
      } else {
        setErrorMsg(res.error ?? "text/generate failed");
      }
    } catch (err) {
      if (err instanceof CapHitError) {
        setCapHit({ message: t("voiceTracks.aiDrawer.capHit"), remainingUsd: err.remainingUsd });
      } else {
        setErrorMsg(err instanceof Error ? err.message : "text/generate failed");
      }
    }
  }, [topic, tone, buildContext, generateText, t]);

  const handleGenerateVoice = useCallback(async () => {
    if (!script || !voiceId) return;
    setCapHit(null);
    setErrorMsg(null);
    try {
      const res = await generateVoice.mutateAsync({ text: script, voiceId });
      if (res.ok && res.data?.audioBase64) {
        setAudioBase64(res.data.audioBase64);
        // durationMs will be filled in by the <audio> loadedmetadata handler.
        setDurationMs(null);
      } else {
        setErrorMsg(res.error ?? "voice/synthesize failed");
      }
    } catch (err) {
      if (err instanceof CapHitError) {
        setCapHit({ message: t("voiceTracks.aiDrawer.capHit"), remainingUsd: err.remainingUsd });
      } else {
        setErrorMsg(err instanceof Error ? err.message : "voice/synthesize failed");
      }
    }
  }, [script, voiceId, generateVoice, t]);

  const handleAudioLoadedMetadata = useCallback(
    (e: React.SyntheticEvent<HTMLAudioElement>) => {
      const audio = e.currentTarget;
      const seconds = Number.isFinite(audio.duration) ? audio.duration : 0;
      setDurationMs(Math.max(0, Math.round(seconds * 1000)));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!audioBase64) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch("/api/voice-tracks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          audioBase64,
          durationMs: durationMs ?? 0,
          transcript: script ?? undefined,
          status: "draft",
          aiGenerated: true,
        }),
      });
      if (!res.ok) {
        const detail = await res
          .json()
          .then((b: { error?: string }) => b?.error)
          .catch(() => undefined);
        throw new Error(detail ?? `Save failed: ${res.status}`);
      }
      const body = (await res.json()) as { voiceTrack: SavedVoiceTrack };
      // Invalidate so the list refetches.
      try {
        await queryClient.invalidateQueries({ queryKey: ["voice-tracks"] });
      } catch {
        /* swallow — invalidation is best-effort */
      }
      onSaved?.(body.voiceTrack);
      onOpenChange(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }, [audioBase64, durationMs, script, onOpenChange, onSaved, queryClient]);

  const costEstimate = useMemo(() => estimateCostUsd(script), [script]);

  // Generate audio is disabled when:
  //   - no script yet
  //   - no voice list / no selected voice (covers stock-only scope returning empty)
  //   - already in flight
  const generateAudioDisabled =
    !script || !voiceId || voices.length === 0 || generateVoice.isPending;

  const saveDisabled = !audioBase64 || saving;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md md:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("voiceTracks.aiDrawer.title")}</SheetTitle>
          <SheetDescription>
            {t("voiceTracks.aiDrawer.costEstimate", { usd: formatUsd(costEstimate) })}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {/* Scope tabs */}
          <Tabs
            value={scope}
            onValueChange={(v: string) => setScope(v as Scope)}
          >
            <TabsList className="w-full">
              <TabsTrigger
                value="cloned"
                onClick={() => setScope("cloned")}
              >
                {t("voiceTracks.aiDrawer.voiceScope.cloned")}
              </TabsTrigger>
              <TabsTrigger
                value="stock"
                onClick={() => setScope("stock")}
              >
                {t("voiceTracks.aiDrawer.voiceScope.stock")}
              </TabsTrigger>
              <TabsTrigger
                value="all"
                onClick={() => setScope("all")}
              >
                {t("voiceTracks.aiDrawer.voiceScope.all")}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Voice select */}
          <div className="space-y-1.5">
            <Label htmlFor="voice-select">
              {t("voiceTracks.aiDrawer.voiceLabel")}
            </Label>
            <Select value={voiceId} onValueChange={setVoiceId}>
              <SelectTrigger id="voice-select" data-field="voice">
                <SelectValue placeholder={t("voiceTracks.aiDrawer.voiceLabel")} />
              </SelectTrigger>
              <SelectContent>
                {voices.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Topic select */}
          <div className="space-y-1.5">
            <Label htmlFor="topic-select">
              {t("voiceTracks.aiDrawer.topicLabel")}
            </Label>
            <Select
              value={topic}
              onValueChange={(v: string) => setTopic(v as Topic)}
            >
              <SelectTrigger id="topic-select" data-field="topic">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TOPICS.map((tp) => (
                  <SelectItem key={tp} value={tp}>
                    {t(`voiceTracks.aiDrawer.topic.${tp}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tone select */}
          <div className="space-y-1.5">
            <Label htmlFor="tone-select">
              {t("voiceTracks.aiDrawer.toneLabel")}
            </Label>
            <Select
              value={tone}
              onValueChange={(v: string) => setTone(v as Tone)}
            >
              <SelectTrigger id="tone-select" data-field="tone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TONES.map((tn) => (
                  <SelectItem key={tn} value={tn}>
                    {t(`voiceTracks.aiDrawer.tone.${tn}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Context-dependent fields */}
          {(topic === "frontsell" || topic === "backsell") && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="ctx-artist">Artist</Label>
                <Input
                  id="ctx-artist"
                  value={contextArtist}
                  onChange={(e) => setContextArtist(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ctx-title">Title</Label>
                <Input
                  id="ctx-title"
                  value={contextTitle}
                  onChange={(e) => setContextTitle(e.target.value)}
                />
              </div>
            </div>
          )}

          {topic === "weather" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="ctx-temp">Temp (°C)</Label>
                <Input
                  id="ctx-temp"
                  type="number"
                  value={contextTempC}
                  onChange={(e) => setContextTempC(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ctx-weather-desc">Description</Label>
                <Input
                  id="ctx-weather-desc"
                  value={contextWeatherDesc}
                  onChange={(e) => setContextWeatherDesc(e.target.value)}
                />
              </div>
            </div>
          )}

          {topic === "custom" && (
            <div className="space-y-1.5">
              <Label htmlFor="custom-prompt">
                {t("voiceTracks.aiDrawer.customPromptLabel")}
              </Label>
              <Textarea
                id="custom-prompt"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={3}
              />
            </div>
          )}

          {/* Generate script */}
          <Button
            type="button"
            onClick={handleGenerateText}
            disabled={generateText.isPending}
            className="w-full"
          >
            {generateText.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {t("voiceTracks.aiDrawer.generateText")}
          </Button>

          {/* Script preview */}
          {script !== null && (
            <div className="space-y-1.5">
              <Label htmlFor="script-preview">
                {t("voiceTracks.aiDrawer.scriptPreview")}
              </Label>
              <Textarea
                id="script-preview"
                data-field="script-preview"
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={4}
              />
            </div>
          )}

          {/* Generate audio */}
          <Button
            type="button"
            onClick={handleGenerateVoice}
            disabled={generateAudioDisabled}
            className="w-full"
          >
            {generateVoice.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {t("voiceTracks.aiDrawer.generateVoice")}
          </Button>

          {/* Audio preview */}
          {audioBase64 && (
            <div className="space-y-1.5">
              <Label>{t("voiceTracks.aiDrawer.audioPreview")}</Label>
              <audio
                data-field="audio-preview"
                src={`data:audio/mpeg;base64,${audioBase64}`}
                controls
                onLoadedMetadata={handleAudioLoadedMetadata}
                className="w-full"
              />
            </div>
          )}

          {/* CapHit & error banners */}
          {capHit && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {capHit.message} ({formatUsd(capHit.remainingUsd)})
            </div>
          )}

          {errorMsg && !capHit && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {errorMsg}
            </div>
          )}
        </div>

        <SheetFooter className="mt-6">
          <Button
            type="button"
            onClick={handleSave}
            disabled={saveDisabled}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("voiceTracks.aiDrawer.save")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default VoiceTrackAiDrawer;
