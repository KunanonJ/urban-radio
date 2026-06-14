import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { useSpotScheduleStore } from '@/lib/spot-schedule-store';
import { useCloudLibraryStore } from '@/lib/cloud-library-store';
import { usePlayerStore } from '@/lib/store';
import type { Track } from '@/lib/types';

function makeTrack(id: string, title = `t-${id}`): Track {
  return {
    id,
    title,
    artist: 'A',
    artistId: 'aid',
    album: 'AL',
    albumId: 'alid',
    duration: 1,
    artwork: 'art',
    source: 'cloud',
    genre: 'G',
    year: 2026,
    trackNumber: 1,
  };
}

beforeEach(() => {
  useSpotScheduleStore.setState({ rules: [], lastFiredMinuteKey: {} });
  useCloudLibraryStore.setState({ tracks: [], sessionMediaUrls: {}, lastUploadAt: null });
  usePlayerStore.setState({
    currentTrack: null,
    isPlaying: false,
    progress: 0,
    queue: [],
    queueIndex: 0,
    currentTrackStartedAtMs: null,
  });
});

afterEach(() => {
  useSpotScheduleStore.setState({ rules: [], lastFiredMinuteKey: {} });
});

describe('useSpotScheduleStore.addRule', () => {
  test('given new rule > assigns id and zero rotationIndex', () => {
    useSpotScheduleStore.getState().addRule({
      name: 'Top of hour',
      enabled: true,
      minutesPastHour: [0],
      trackIds: ['t1'],
      insertMode: 'playNext',
    });
    const rules = useSpotScheduleStore.getState().rules;
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBeTypeOf('string');
    expect(rules[0].rotationIndex).toBe(0);
    expect(rules[0].name).toBe('Top of hour');
  });
});

describe('useSpotScheduleStore.updateRule', () => {
  test('given existing id > patches matching rule only', () => {
    useSpotScheduleStore.getState().addRule({
      name: 'A',
      enabled: true,
      minutesPastHour: [0],
      trackIds: ['t1'],
      insertMode: 'playNext',
    });
    useSpotScheduleStore.getState().addRule({
      name: 'B',
      enabled: true,
      minutesPastHour: [30],
      trackIds: ['t2'],
      insertMode: 'addToEnd',
    });
    const [a, b] = useSpotScheduleStore.getState().rules;
    useSpotScheduleStore.getState().updateRule(a.id, { name: 'A-renamed' });
    const next = useSpotScheduleStore.getState().rules;
    expect(next.find((r) => r.id === a.id)?.name).toBe('A-renamed');
    expect(next.find((r) => r.id === b.id)?.name).toBe('B');
  });
});

describe('useSpotScheduleStore.removeRule', () => {
  test('given existing id > removes rule and its lastFiredMinuteKey', () => {
    useSpotScheduleStore.getState().addRule({
      name: 'A',
      enabled: true,
      minutesPastHour: [0],
      trackIds: ['t1'],
      insertMode: 'playNext',
    });
    const [r] = useSpotScheduleStore.getState().rules;
    useSpotScheduleStore.getState().markFired(r.id, 'somekey');
    useSpotScheduleStore.getState().removeRule(r.id);
    const state = useSpotScheduleStore.getState();
    expect(state.rules).toHaveLength(0);
    expect(state.lastFiredMinuteKey[r.id]).toBeUndefined();
  });
});

describe('useSpotScheduleStore.bumpRotation', () => {
  test('given rule with 3 tracks > rotationIndex cycles 0→1→2→0', () => {
    useSpotScheduleStore.getState().addRule({
      name: 'A',
      enabled: true,
      minutesPastHour: [0],
      trackIds: ['t1', 't2', 't3'],
      insertMode: 'playNext',
    });
    const [r] = useSpotScheduleStore.getState().rules;
    useSpotScheduleStore.getState().bumpRotation(r.id);
    expect(useSpotScheduleStore.getState().rules[0].rotationIndex).toBe(1);
    useSpotScheduleStore.getState().bumpRotation(r.id);
    expect(useSpotScheduleStore.getState().rules[0].rotationIndex).toBe(2);
    useSpotScheduleStore.getState().bumpRotation(r.id);
    expect(useSpotScheduleStore.getState().rules[0].rotationIndex).toBe(0);
  });

  test('given rule with empty trackIds > rotationIndex stays at 0', () => {
    useSpotScheduleStore.getState().addRule({
      name: 'A',
      enabled: true,
      minutesPastHour: [0],
      trackIds: [],
      insertMode: 'playNext',
    });
    const [r] = useSpotScheduleStore.getState().rules;
    useSpotScheduleStore.getState().bumpRotation(r.id);
    expect(useSpotScheduleStore.getState().rules[0].rotationIndex).toBe(0);
  });
});

describe('useSpotScheduleStore.fireRuleNow', () => {
  test('given unknown ruleId > returns not_found error', () => {
    const result = useSpotScheduleStore.getState().fireRuleNow('nope');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_found');
  });

  test('given rule with empty trackIds > returns no_tracks error', () => {
    useSpotScheduleStore.getState().addRule({
      name: 'A',
      enabled: true,
      minutesPastHour: [0],
      trackIds: [],
      insertMode: 'playNext',
    });
    const [r] = useSpotScheduleStore.getState().rules;
    const result = useSpotScheduleStore.getState().fireRuleNow(r.id);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('no_tracks');
  });

  test('given rule with unresolvable trackId > returns missing_track error', () => {
    useSpotScheduleStore.getState().addRule({
      name: 'A',
      enabled: true,
      minutesPastHour: [0],
      trackIds: ['ghost-id-no-such-track'],
      insertMode: 'playNext',
    });
    const [r] = useSpotScheduleStore.getState().rules;
    const result = useSpotScheduleStore.getState().fireRuleNow(r.id);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('missing_track');
  });

  test('given resolvable track with insertMode=playNext > inserts after current queue position and bumps rotation', () => {
    const t1 = makeTrack('spot-1');
    useCloudLibraryStore.setState({
      tracks: [t1],
      sessionMediaUrls: {},
      lastUploadAt: null,
    });
    useSpotScheduleStore.getState().addRule({
      name: 'A',
      enabled: true,
      minutesPastHour: [0],
      trackIds: [t1.id],
      insertMode: 'playNext',
    });
    const [r] = useSpotScheduleStore.getState().rules;
    const result = useSpotScheduleStore.getState().fireRuleNow(r.id);
    expect(result.ok).toBe(true);
    expect(usePlayerStore.getState().queue.find((t) => t.id === t1.id)).toBeDefined();
    expect(useSpotScheduleStore.getState().rules[0].rotationIndex).toBe(1 % 1);
  });

  test('given resolvable track with insertMode=addToEnd > appends to queue', () => {
    const t1 = makeTrack('spot-2');
    useCloudLibraryStore.setState({
      tracks: [t1],
      sessionMediaUrls: {},
      lastUploadAt: null,
    });
    useSpotScheduleStore.getState().addRule({
      name: 'A',
      enabled: true,
      minutesPastHour: [0],
      trackIds: [t1.id],
      insertMode: 'addToEnd',
    });
    const [r] = useSpotScheduleStore.getState().rules;
    useSpotScheduleStore.getState().fireRuleNow(r.id);
    const queue = usePlayerStore.getState().queue;
    expect(queue[queue.length - 1].id).toBe(t1.id);
  });
});

describe('useSpotScheduleStore.markFired', () => {
  test('given ruleId + minuteKey > records dedupe marker', () => {
    useSpotScheduleStore.getState().markFired('r1', '2026-3-4-10-0');
    expect(useSpotScheduleStore.getState().lastFiredMinuteKey['r1']).toBe('2026-3-4-10-0');
  });
});
