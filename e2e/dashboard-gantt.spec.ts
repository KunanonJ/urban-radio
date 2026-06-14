import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/** Minimal tracks for the cloud library and queue snapshot. */
const SEED_TRACKS = [
  {
    id: 'e2e-gantt-t1',
    title: 'Gantt Track One',
    artist: 'E2E Artist',
    artistId: 'e2e-a1',
    album: 'E2E Album',
    albumId: 'e2e-al1',
    duration: 240,
    artwork: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
    source: 'cloud',
    genre: 'Electronic',
    year: 2024,
    trackNumber: 1,
  },
  {
    id: 'e2e-gantt-t2',
    title: 'Gantt Track Two',
    artist: 'E2E Artist',
    artistId: 'e2e-a1',
    album: 'E2E Album',
    albumId: 'e2e-al1',
    duration: 200,
    artwork: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
    source: 'cloud',
    genre: 'Electronic',
    year: 2024,
    trackNumber: 2,
  },
];

/**
 * Seeds localStorage before page load so the app boots with a populated queue.
 *
 * - sonic-bloom-cloud-library  → useMergedTracks() and resolveTrackById() find the tracks
 * - sonic-bloom-playback-snapshot → PlaybackRecoveryBridge restores queue from ids
 */
function seedQueueStorage(tracks: typeof SEED_TRACKS) {
  const cloudLibrary = {
    state: { tracks, lastUploadAt: null },
    version: 0,
  };
  const snapshot = {
    v: 1,
    queueTrackIds: tracks.map((t) => t.id),
    queueIndex: 0,
    progress: 0,
    wasPlaying: false,
    currentTrackId: tracks[0].id,
    savedAt: Date.now(),
  };
  localStorage.setItem('sonic-bloom-cloud-library', JSON.stringify(cloudLibrary));
  localStorage.setItem('sonic-bloom-playback-snapshot', JSON.stringify(snapshot));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Dashboard queue Gantt', () => {
  test('Gantt view exposes a scrollable timeline region', async ({ page }) => {
    await page.addInitScript(seedQueueStorage, SEED_TRACKS);
    await page.addInitScript(() => {
      localStorage.setItem('sonic-bloom-locale', 'en');
    });
    // Narrow width so timeline (min ~260px + 520px) overflows horizontally
    await page.setViewportSize({ width: 600, height: 700 });
    await page.goto('/app');

    await page.getByRole('radio', { name: 'Gantt chart' }).click();

    const scroll = page.getByTestId('queue-gantt-scroll');
    await expect(scroll).toBeVisible();

    const dims = await scroll.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));

    // Wide timeline + multiple rows should overflow at least one axis in default mock state
    const scrollable = dims.scrollWidth > dims.clientWidth || dims.scrollHeight > dims.clientHeight;
    expect(scrollable).toBe(true);

    // Smoke: programmatic scroll works (trackpad/wheel use same scroll metrics)
    await scroll.evaluate((el) => {
      el.scrollLeft = Math.min(40, el.scrollWidth - el.clientWidth);
      el.scrollTop = Math.min(20, el.scrollHeight - el.clientHeight);
    });
    const after = await scroll.evaluate((el) => ({ scrollLeft: el.scrollLeft, scrollTop: el.scrollTop }));
    expect(Math.max(after.scrollLeft, after.scrollTop)).toBeGreaterThan(0);
  });
});
