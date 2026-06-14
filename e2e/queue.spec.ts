import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/** Minimal tracks for the cloud library (resolveTrackById + useMergedTracks). */
const SEED_TRACKS = [
  {
    id: 'e2e-t1',
    title: 'E2E Track One',
    artist: 'E2E Artist',
    artistId: 'e2e-a1',
    album: 'E2E Album',
    albumId: 'e2e-al1',
    duration: 200,
    artwork: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
    source: 'cloud',
    genre: 'Electronic',
    year: 2024,
    trackNumber: 1,
  },
  {
    id: 'e2e-t2',
    title: 'E2E Track Two',
    artist: 'E2E Artist',
    artistId: 'e2e-a1',
    album: 'E2E Album',
    albumId: 'e2e-al1',
    duration: 180,
    artwork: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
    source: 'cloud',
    genre: 'Electronic',
    year: 2024,
    trackNumber: 2,
  },
  {
    id: 'e2e-t3',
    title: 'E2E Track Three',
    artist: 'E2E Artist',
    artistId: 'e2e-a1',
    album: 'E2E Album',
    albumId: 'e2e-al1',
    duration: 220,
    artwork: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
    source: 'cloud',
    genre: 'Electronic',
    year: 2024,
    trackNumber: 3,
  },
];

/**
 * Seeds localStorage before page load so the app boots with a populated queue.
 *
 * - sonic-bloom-cloud-library  → useMergedTracks() returns SEED_TRACKS
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

test.describe('Queue page', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(seedQueueStorage, SEED_TRACKS);
    await page.goto('/app/queue');
  });

  test('shows queue heading and list region when queue has seed tracks', async ({ page }) => {
    const root = page.getByTestId('queue-page');
    await expect(root).toBeVisible();
    await expect(root.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('queue-list')).toBeVisible();

    const handles = page.getByTestId('queue-drag-handle');
    await expect(handles.first()).toBeVisible();
    expect(await handles.count()).toBeGreaterThan(0);
  });

  test('shows reorder hint', async ({ page }) => {
    await expect(page.getByTestId('queue-reorder-hint')).toBeVisible();
  });

  test('drag handle count matches sortable rows', async ({ page }) => {
    await expect(page.getByTestId('queue-list')).toBeVisible();
    const rowCount = await page.getByTestId('queue-list').locator(':scope > div').count();
    const handleCount = await page.getByTestId('queue-drag-handle').count();
    expect(handleCount).toBe(rowCount);
  });

  test('reorder drag activates pointer sensor (smoke)', async ({ page }) => {
    await expect(page.getByTestId('queue-drag-handle').first()).toBeVisible();
    const first = page.getByTestId('queue-drag-handle').first();
    await first.hover();
    await first.dispatchEvent('pointerdown', { button: 0 });
    await expect(first).toBeVisible();
    await page.mouse.up();
  });
});
