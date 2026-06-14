import { useEffect } from 'react';
import { usePlayerStore } from '@/lib/store';
import { formatBroadcastMetadata, useBroadcastStore } from '@/lib/broadcast-store';

/** Keeps `lastMetadata` in sync with the current track for the broadcast / encoder panel. */
export function BroadcastMetadataBridge() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const template = useBroadcastStore((s) => s.metadataTemplate);

  useEffect(() => {
    if (!currentTrack) {
      useBroadcastStore.getState().setLastMetadata('');
      return;
    }
    const line = formatBroadcastMetadata(
      template,
      currentTrack.title,
      currentTrack.artist,
      currentTrack.album
    );
    useBroadcastStore.getState().setLastMetadata(line);
  }, [currentTrack, template]);

  return null;
}
