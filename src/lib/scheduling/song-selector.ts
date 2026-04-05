import type { Track } from '@/types/track';
import type { RundownItem } from '@/types/rundown';
import {
  ROTATION_COOLDOWNS,
  ROTATION_WEIGHTS,
  DURATION_TOLERANCE_SEC,
  type SongSelectorInput,
  type SongSelectorResult,
} from './types';

/**
 * Pure function: selects the best track for a song segment.
 *
 * Pipeline:
 * 1. Filter active + non-INACTIVE rotation
 * 2. Filter by segment rotation category (if specified)
 * 3. Filter explicit content
 * 4. Apply track cooldown
 * 5. Apply artist separation within current hour
 * 6. Apply duration tolerance
 * 7. Weighted random selection
 */
export function selectSong(input: SongSelectorInput): SongSelectorResult {
  const { segment, tracks, context, history, currentHourItems } = input;

  const segmentRotation = segment.rules?.['rotationCategory'] as string | undefined;

  // 1. Active tracks only
  let candidates = tracks.filter((t) => t.status === 'active');

  // 2. Filter by rotation category
  if (segmentRotation) {
    candidates = candidates.filter((t) => t.rotationCategory === segmentRotation);
  }

  // Filter out INACTIVE rotation
  candidates = candidates.filter((t) => t.rotationCategory !== 'INACTIVE');

  // 3. Explicit content filter
  if (!context.explicitAllowed) {
    candidates = candidates.filter((t) => !t.isExplicit);
  }

  // 4. Track cooldown
  candidates = candidates.filter((t) => {
    const cooldownHours = ROTATION_COOLDOWNS[t.rotationCategory];
    if (cooldownHours === Infinity) return false;
    const plays = history.trackPlays.get(t.id);
    if (!plays || plays.length === 0) return true;
    return isOutsideCooldown(plays, cooldownHours, context.date, context.hour);
  });

  // 5. Artist separation within current hour
  candidates = candidates.filter((t) => {
    return !isArtistTooClose(t, segment.position, currentHourItems, context.songRules.sameArtistMinSlots);
  });

  // 6. Duration tolerance
  candidates = candidates.filter((t) => {
    return Math.abs(t.durationSec - segment.targetDurationSec) <= DURATION_TOLERANCE_SEC;
  });

  if (candidates.length === 0) {
    return { track: null, conflicts: ['NO_VALID_TRACK'] };
  }

  // 7. Weighted random selection
  const selected = weightedRandomSelect(candidates);
  return { track: selected, conflicts: [] };
}

function isOutsideCooldown(
  plays: readonly string[],
  cooldownHours: number,
  date: string,
  hour: number,
): boolean {
  const currentTime = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`).getTime();
  const cooldownMs = cooldownHours * 60 * 60 * 1000;
  return plays.every((play) => {
    const playTime = new Date(play).getTime();
    return currentTime - playTime >= cooldownMs;
  });
}

function isArtistTooClose(
  track: Track,
  currentPosition: number,
  hourItems: readonly RundownItem[],
  minSlots: number,
): boolean {
  // Find songs by the same artist within minSlots distance
  const songItems = hourItems.filter((item) => item.type === 'song');
  for (const item of songItems) {
    if (item.artistName === undefined) continue;
    // We need to match artist by looking at the sourceRefId or artistName
    // Since we're comparing tracks, we look up the artist via the item
    const distance = Math.abs(currentPosition - item.position);
    if (distance < minSlots && distance > 0) {
      // Check if the artist matches - we compare artistId from the track
      // against the item. Items store artistName, so we need to match track's artist.
      // For separation, we match the artistName in the item against the track's artistId.
      // Since we don't have a lookup here, we rely on the fact that the item's
      // sourceRefId is a track ID. We need to check from the items' data.
      // For simplicity, we check if any nearby song item has the same artistName.
      // The caller should populate artistName in RundownItem from the track's artist.
      // We'll also need to match by track.artistId, but since items store artistName
      // we compare by checking if the track's artistId appears in any nearby item.
      // Actually, the item data includes sourceRefId (trackId). We need to look up
      // artist from the existing tracks list. Since this is a pure function with
      // only the data passed in, and items store artistName, let's just look at
      // whether any item within minSlots distance shares the same artistId.
      // Items don't have artistId, but items.sourceCollection === 'tracks'.
      // For accurate separation, we compare the track.artistId.
      // The workaround is: mark item.artistName when creating items.
      // For now, we pass currentHourItems which already has artistName populated.
    }
  }

  // Simpler approach: check distance to nearest item with same artistId
  for (const item of hourItems) {
    if (item.type !== 'song') continue;
    const distance = Math.abs(currentPosition - item.position);
    if (distance > 0 && distance < minSlots) {
      // We need to match artist. Items may have different artist naming.
      // Best we can do: check if the item was created from the same artist's track.
      // We store artistName in RundownItem, and we have track.artistId.
      // Unfortunately we can't directly compare them without a lookup.
      // So we use a convention: store artistId in sourceRefId context or compare names.
      // The pragmatic solution: we'll look at items that have sourceRefId and see if
      // any of the tracks with that sourceRefId share the same artistId.
      // But we don't have the full track list in this check.
      // Final approach: just store artistId somewhere accessible. For now, use
      // a name-based comparison since artistName is set when building items.
      // We'll assume the calling code sets track.artistId as part of the artistName
      // field or that we can key off it. Let's match:
      if (item.sourceRefId) {
        // If this is a track-based item, the artistName should be populated
        // We need to check if track.artistId matches the artist of the item
        // Since we can't look up from here, rely on the _caller_ to set artistName
        // consistently. Then match by artistName being the same.
        // But we have track.artistId and item may have artistName string.
        // This doesn't match directly. We need a different approach.
      }
    }
  }

  // Use the practical approach: treat artistId as a marker
  // Store track.artistId in a temporary map from the input data
  // Since we only have the current track and items, let's simply check
  // if any song item within minSlots shares the same artistName.
  // The auto-fill engine will set artistName = artistId for reliable matching.
  const trackArtistKey = track.artistId;
  for (const item of hourItems) {
    if (item.type !== 'song') continue;
    const distance = Math.abs(currentPosition - item.position);
    if (distance > 0 && distance < minSlots) {
      // Match: the item's artistName is set to artistId by the auto-fill engine
      if (item.artistName === trackArtistKey) {
        return true;
      }
    }
  }

  return false;
}

function weightedRandomSelect(tracks: readonly Track[]): Track {
  const weights = tracks.map((t) => ROTATION_WEIGHTS[t.rotationCategory]);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < tracks.length; i++) {
    random -= weights[i]!;
    if (random <= 0) {
      return tracks[i]!;
    }
  }

  return tracks[tracks.length - 1]!;
}
