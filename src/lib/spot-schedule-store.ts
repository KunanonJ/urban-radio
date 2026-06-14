import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SpotRule } from '@/lib/spot-schedule-engine';
import { getLocalMinuteKey, shouldFireRuleAt } from '@/lib/spot-schedule-engine';
import { resolveTrackById } from '@/lib/resolve-track';
import { usePlayerStore } from '@/lib/store';

type SpotScheduleState = {
  rules: SpotRule[];
  /** ruleId → last minute key we fired (dedupe within same minute) */
  lastFiredMinuteKey: Record<string, string>;
  addRule: (r: Omit<SpotRule, 'id' | 'rotationIndex'>) => void;
  updateRule: (id: string, patch: Partial<Omit<SpotRule, 'id'>>) => void;
  removeRule: (id: string) => void;
  /** Advance rotation after a successful fire */
  bumpRotation: (id: string) => void;
  markFired: (id: string, minuteKey: string) => void;
  /** Insert one spot immediately (preview / test) */
  fireRuleNow: (id: string) => { ok: boolean; error?: string };
};

export const useSpotScheduleStore = create<SpotScheduleState>()(
  persist(
    (set, get) => ({
      rules: [],
      lastFiredMinuteKey: {},

      addRule: (r) =>
        set((s) => ({
          rules: [
            ...s.rules,
            {
              ...r,
              id: crypto.randomUUID(),
              rotationIndex: 0,
            },
          ],
        })),

      updateRule: (id, patch) =>
        set((s) => ({
          rules: s.rules.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        })),

      removeRule: (id) =>
        set((s) => ({
          rules: s.rules.filter((x) => x.id !== id),
          lastFiredMinuteKey: Object.fromEntries(
            Object.entries(s.lastFiredMinuteKey).filter(([k]) => k !== id)
          ),
        })),

      bumpRotation: (id) =>
        set((s) => ({
          rules: s.rules.map((rule) => {
            if (rule.id !== id || rule.trackIds.length === 0) return rule;
            return {
              ...rule,
              rotationIndex: (rule.rotationIndex + 1) % rule.trackIds.length,
            };
          }),
        })),

      markFired: (id, minuteKey) =>
        set((s) => ({
          lastFiredMinuteKey: { ...s.lastFiredMinuteKey, [id]: minuteKey },
        })),

      fireRuleNow: (id) => {
        const rule = get().rules.find((x) => x.id === id);
        if (!rule) return { ok: false, error: 'not_found' };
        if (rule.trackIds.length === 0) return { ok: false, error: 'no_tracks' };
        const idx = rule.rotationIndex % rule.trackIds.length;
        const tid = rule.trackIds[idx];
        const track = resolveTrackById(tid);
        if (!track) return { ok: false, error: 'missing_track' };
        const { playNext, addToQueue } = usePlayerStore.getState();
        if (rule.insertMode === 'playNext') {
          playNext(track);
        } else {
          addToQueue(track);
        }
        get().bumpRotation(id);
        return { ok: true };
      },
    }),
    {
      name: 'sonic-bloom-spot-schedule',
      partialize: (s) => ({
        rules: s.rules,
        lastFiredMinuteKey: s.lastFiredMinuteKey,
      }),
    }
  )
);

export interface SpotScheduleFiredEvent {
  ruleName: string;
  trackTitle: string;
}

export function evaluateSpotRulesTick(now: Date): SpotScheduleFiredEvent[] {
  const { rules, lastFiredMinuteKey, markFired, bumpRotation } = useSpotScheduleStore.getState();
  const { playNext, addToQueue } = usePlayerStore.getState();
  const fired: SpotScheduleFiredEvent[] = [];

  for (const rule of rules) {
    const last = lastFiredMinuteKey[rule.id];
    if (!shouldFireRuleAt(now, rule, last)) continue;

    const minuteKey = getLocalMinuteKey(now);
    if (rule.trackIds.length === 0) {
      markFired(rule.id, minuteKey);
      continue;
    }

    const idx = rule.rotationIndex % rule.trackIds.length;
    const tid = rule.trackIds[idx];
    const track = resolveTrackById(tid);
    markFired(rule.id, minuteKey);

    if (track) {
      if (rule.insertMode === 'playNext') {
        playNext(track);
      } else {
        addToQueue(track);
      }
      bumpRotation(rule.id);
      fired.push({ ruleName: rule.name, trackTitle: track.title });
    }
  }

  return fired;
}
