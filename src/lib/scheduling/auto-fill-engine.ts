import { selectSong } from './song-selector';
import { selectAd } from './ad-selector';
import { detectConflicts, type ConflictEntry } from './conflict-detector';
import type { ClockSegment } from '@/types/clock-template';
import type { RundownItem, ConflictFlag } from '@/types/rundown';
import type { AutoFillInput, AutoFillResult, PlayHistory, SchedulingContext } from './types';

let itemCounter = 0;
function nextItemId(): string {
  itemCounter += 1;
  return `ri-${Date.now()}-${itemCounter}`;
}

function formatTime(hour: number, offsetSec: number): string {
  const totalSec = hour * 3600 + offsetSec;
  const h = Math.floor(totalSec / 3600) % 24;
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Orchestrates song and ad selectors to fill a rundown.
 * Pre-fetches all data and passes in-memory arrays (zero I/O in engine).
 * Respects pinned/manual items on partial regenerate.
 */
export function autoFill(input: AutoFillInput): AutoFillResult {
  const {
    date,
    hours,
    templates,
    tracks,
    campaigns,
    spots,
    existingItems,
    context,
    history: initialHistory,
  } = input;

  const allItems: RundownItem[] = [];
  const allConflicts: { itemId: string; flags: ConflictFlag[] }[] = [];

  // Build a mutable copy of history that accumulates as we fill
  const mutableHistory = cloneHistory(initialHistory);

  const dayOfWeek = new Date(date + 'T00:00:00').getDay();

  for (const hourConfig of hours) {
    const { hour, clockTemplateId } = hourConfig;
    const template = templates.get(clockTemplateId);
    if (!template) continue;

    const hourContext: SchedulingContext = {
      ...context,
      hour,
      dayOfWeek,
    };

    // Keep manually pinned items for this hour
    const pinnedItems = existingItems.filter(
      (item) => item.hourBlock === hour && item.isManualOverride,
    );

    const hourItems: RundownItem[] = [...pinnedItems];
    let offsetSec = 0;
    let position = 0;

    for (const segment of template.segments) {
      // Skip if a pinned item already covers this position
      const pinned = pinnedItems.find((p) => p.position === position);
      if (pinned) {
        offsetSec += pinned.durationSec;
        position++;
        continue;
      }

      const item = fillSegment(segment, hourContext, tracks, campaigns, spots, mutableHistory, hourItems, hour, offsetSec, position);
      hourItems.push(item);
      offsetSec += item.durationSec;
      position++;

      // Update mutable history with this selection
      if (item.type === 'song' && item.sourceRefId) {
        appendToMapSet(mutableHistory.trackPlays, item.sourceRefId, `${date}T${formatTime(hour, 0)}Z`);
        if (item.artistName) {
          appendToMapSet(mutableHistory.artistPlays, item.artistName, `${date}T${formatTime(hour, 0)}Z`);
        }
      }
      if (item.type === 'ad' && item.advertiserName) {
        appendToMapSet(mutableHistory.advertiserPlays, item.advertiserName, `${date}T${formatTime(hour, 0)}Z`);
        if (item.sourceRefId) {
          const campaignId = findCampaignIdForSpot(item.sourceRefId, spots);
          if (campaignId) {
            const current = mutableHistory.campaignPlayCounts.get(campaignId) ?? 0;
            mutableHistory.campaignPlayCounts.set(campaignId, current + 1);
          }
        }
      }
    }

    allItems.push(...hourItems);

    // Run conflict detection on this hour
    const hourConflicts = detectConflicts(hourItems, hour, {
      sameArtistMinSlots: context.songRules.sameArtistMinSlots,
    });
    for (const c of hourConflicts) {
      allConflicts.push({ itemId: c.itemId, flags: [c.flag] });
    }
  }

  return { items: allItems, conflicts: allConflicts };
}

function fillSegment(
  segment: ClockSegment,
  context: SchedulingContext,
  tracks: AutoFillInput['tracks'],
  campaigns: AutoFillInput['campaigns'],
  spots: AutoFillInput['spots'],
  history: MutableHistory,
  currentHourItems: readonly RundownItem[],
  hour: number,
  offsetSec: number,
  position: number,
): RundownItem {
  const baseItem = {
    id: nextItemId(),
    hourBlock: hour,
    position,
    scheduledStart: formatTime(hour, offsetSec),
    scheduledEnd: formatTime(hour, offsetSec + segment.targetDurationSec),
    isManualOverride: false,
    status: 'scheduled' as const,
  };

  if (segment.type === 'song') {
    const result = selectSong({
      segment,
      tracks,
      context,
      history,
      currentHourItems,
    });
    if (result.track) {
      return {
        ...baseItem,
        type: 'song',
        sourceRefId: result.track.id,
        sourceCollection: 'tracks',
        title: result.track.title,
        artistName: result.track.artistId,
        durationSec: result.track.durationSec,
        conflictFlags: result.conflicts,
      };
    }
    return {
      ...baseItem,
      type: 'song',
      title: `[Empty: ${segment.label}]`,
      durationSec: segment.targetDurationSec,
      conflictFlags: ['NO_VALID_TRACK'],
    };
  }

  if (segment.type === 'ad_break') {
    const slotCount = segment.slotCount ?? 1;
    // For ad breaks with multiple slots, we fill just one slot per segment call.
    // The caller should create multiple segments or handle slot expansion.
    // For simplicity, we handle one ad per ad_break segment.
    const result = selectAd({
      segment,
      campaigns,
      spots,
      context,
      history,
      currentHourItems,
    });
    if (result.spot && result.campaign) {
      return {
        ...baseItem,
        type: 'ad',
        sourceRefId: result.spot.id,
        sourceCollection: `campaigns/${result.campaign.id}/spots`,
        title: result.spot.title,
        advertiserName: result.campaign.advertiserId,
        durationSec: result.spot.durationSec,
        conflictFlags: result.conflicts,
      };
    }
    return {
      ...baseItem,
      type: 'ad',
      title: `[Empty: ${segment.label}]`,
      durationSec: segment.targetDurationSec,
      conflictFlags: ['NO_VALID_AD'],
    };
  }

  // For jingle, news, talk_break, promo, filler — pass through
  return {
    ...baseItem,
    type: segment.type as RundownItem['type'],
    title: segment.label,
    durationSec: segment.targetDurationSec,
    conflictFlags: [],
  };
}

// --- Mutable history helpers ---

interface MutableHistory {
  trackPlays: Map<string, string[]>;
  artistPlays: Map<string, string[]>;
  advertiserPlays: Map<string, string[]>;
  campaignPlayCounts: Map<string, number>;
}

function cloneHistory(h: PlayHistory): MutableHistory {
  return {
    trackPlays: new Map(Array.from(h.trackPlays.entries()).map(([k, v]) => [k, [...v]])),
    artistPlays: new Map(Array.from(h.artistPlays.entries()).map(([k, v]) => [k, [...v]])),
    advertiserPlays: new Map(Array.from(h.advertiserPlays.entries()).map(([k, v]) => [k, [...v]])),
    campaignPlayCounts: new Map(h.campaignPlayCounts),
  };
}

function appendToMapSet(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

function findCampaignIdForSpot(
  spotId: string,
  spots: ReadonlyMap<string, readonly { id: string }[]>,
): string | undefined {
  for (const [campaignId, campaignSpots] of spots.entries()) {
    if (campaignSpots.some((s) => s.id === spotId)) {
      return campaignId;
    }
  }
  return undefined;
}
