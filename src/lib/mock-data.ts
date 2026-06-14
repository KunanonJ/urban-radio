import { Track, Album, Artist, Playlist, IntegrationSource, ListeningStat } from './types';

const artworks = [
  'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&h=300&fit=crop',
  'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop',
  'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop',
  'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=300&h=300&fit=crop',
  'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=300&h=300&fit=crop',
  'https://images.unsplash.com/photo-1487180144351-b8472da7d491?w=300&h=300&fit=crop',
  'https://images.unsplash.com/photo-1571330735066-03aaa9429d89?w=300&h=300&fit=crop',
  'https://images.unsplash.com/photo-1446057032654-9d8885db76c6?w=300&h=300&fit=crop',
];

const artistImages = [
  'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=300&h=300&fit=crop',
  'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=300&h=300&fit=crop',
  'https://images.unsplash.com/photo-1598387993281-cecf8b71a8f8?w=300&h=300&fit=crop',
  'https://images.unsplash.com/photo-1460723237483-7a6dc9d0b212?w=300&h=300&fit=crop',
];

export const mockArtists: Artist[] = [
  { id: 'a1', name: 'Midnight Waves', artwork: artistImages[0], genres: ['Electronic', 'Ambient'], albumCount: 4, trackCount: 42, monthlyListeners: 284000 },
  { id: 'a2', name: 'Solar Drift', artwork: artistImages[1], genres: ['Synthwave', 'Electronic'], albumCount: 3, trackCount: 31, monthlyListeners: 156000 },
  { id: 'a3', name: 'Echo Chamber', artwork: artistImages[2], genres: ['Indie', 'Alternative'], albumCount: 5, trackCount: 58, monthlyListeners: 421000 },
  { id: 'a4', name: 'Neon Pulse', artwork: artistImages[3], genres: ['Techno', 'House'], albumCount: 6, trackCount: 72, monthlyListeners: 892000 },
  { id: 'a5', name: 'Aurora Borealis', artwork: artistImages[0], genres: ['Classical', 'Ambient'], albumCount: 2, trackCount: 18, monthlyListeners: 67000 },
  { id: 'a6', name: 'Velvet Underground', artwork: artistImages[1], genres: ['Rock', 'Experimental'], albumCount: 7, trackCount: 84, monthlyListeners: 1200000 },
];

const trackNames = [
  'Celestial Highway', 'Neon Dreams', 'Afterglow', 'Digital Rain', 'Pulse',
  'Horizons', 'Deep Blue', 'Starfall', 'Midnight Run', 'Vapor Trail',
  'Chrome Heart', 'Ghost Signal', 'Waveform', 'Solstice', 'Prism',
  'Echo Valley', 'Dark Matter', 'Radiance', 'Flux', 'Drift',
];

const albumNames = [
  'Infinite Loop', 'Neon Horizons', 'Dark Patterns', 'Wavelength',
  'Chromatic', 'Stellar', 'Synthesis', 'Continuum',
];

// Demo audio source used when local files/integrations are not connected yet.
const DEMO_AUDIO_URL = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';

/** Spread mock “added” dates for Recently added (relative to when the bundle loads). */
function daysAgoIso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

/** Per-album offsets so buckets (yesterday / this week / this month / earlier) are populated. */
const ALBUM_ADDED_DAYS_AGO = [1, 1, 2, 4, 7, 14, 21, 45];

export const mockTracks: Track[] = trackNames.map((title, i) => ({
  id: `t${i + 1}`,
  title,
  artist: mockArtists[i % mockArtists.length].name,
  artistId: mockArtists[i % mockArtists.length].id,
  album: albumNames[i % albumNames.length],
  albumId: `al${(i % albumNames.length) + 1}`,
  /** Deterministic per index so SSR and client bundles match (no `Math.random()` here). */
  duration: 180 + ((i * 73) % 180),
  artwork: artworks[i % artworks.length],
  source: (['local', 'plex', 'spotify'] as const)[i % 3],
  genre: mockArtists[i % mockArtists.length].genres[0],
  year: 2020 + (i % 6),
  trackNumber: (i % 12) + 1,
  mediaUrl: DEMO_AUDIO_URL,
}));

export const mockAlbums: Album[] = albumNames.map((title, i) => ({
  id: `al${i + 1}`,
  title,
  artist: mockArtists[i % mockArtists.length].name,
  artistId: mockArtists[i % mockArtists.length].id,
  artwork: artworks[i % artworks.length],
  year: 2020 + (i % 6),
  genre: mockArtists[i % mockArtists.length].genres[0],
  trackCount: 8 + (i % 6),
  tracks: mockTracks.filter(t => t.albumId === `al${i + 1}`),
  source: (['local', 'plex', 'spotify'] as const)[i % 3],
  dateAdded: daysAgoIso(ALBUM_ADDED_DAYS_AGO[i] ?? 60),
}));

/** Short placeholder for clock-driven breaks (no audio unless you assign `mediaUrl`). */
export const mockStationBreak: Track = {
  id: 'station-break',
  title: 'Station ID / Break',
  artist: 'Sonic Bloom',
  artistId: 'a1',
  album: 'Broadcast',
  albumId: 'al-brk',
  duration: 30,
  artwork: artworks[0],
  source: 'local',
  genre: 'Station',
  year: 2026,
  trackNumber: 0,
  mediaUrl: DEMO_AUDIO_URL,
};

/** Short mock spots for scheduled ad rotation (no audio unless `mediaUrl` is set). */
export const mockSpotAds: Track[] = [
  {
    id: 'spot-ad-1',
    title: 'Spot — Local sponsor A',
    artist: 'Traffic',
    artistId: 'a1',
    album: 'Spots',
    albumId: 'al-spot',
    duration: 30,
    artwork: artworks[3],
    source: 'local',
    genre: 'Spot',
    year: 2026,
    trackNumber: 1,
    mediaUrl: DEMO_AUDIO_URL,
  },
  {
    id: 'spot-ad-2',
    title: 'Spot — Promo weekend',
    artist: 'Traffic',
    artistId: 'a1',
    album: 'Spots',
    albumId: 'al-spot',
    duration: 45,
    artwork: artworks[4],
    source: 'local',
    genre: 'Spot',
    year: 2026,
    trackNumber: 2,
    mediaUrl: DEMO_AUDIO_URL,
  },
  {
    id: 'spot-ad-3',
    title: 'Spot — Station ID',
    artist: 'Traffic',
    artistId: 'a1',
    album: 'Spots',
    albumId: 'al-spot',
    duration: 15,
    artwork: artworks[5],
    source: 'local',
    genre: 'Spot',
    year: 2026,
    trackNumber: 3,
    mediaUrl: DEMO_AUDIO_URL,
  },
];

export const mockPlaylists: Playlist[] = [
  { id: 'p1', title: 'Late Night Coding', description: 'Perfect focus music for deep work sessions', artwork: artworks[0], trackCount: 24, duration: 5400, tracks: mockTracks.slice(0, 8), createdBy: 'You', isPublic: false },
  { id: 'p2', title: 'Synthwave Essentials', description: 'The best of modern synthwave', artwork: artworks[1], trackCount: 36, duration: 7800, tracks: mockTracks.slice(4, 12), createdBy: 'You', isPublic: true },
  { id: 'p3', title: 'Morning Ambience', description: 'Gentle sounds to start your day', artwork: artworks[2], trackCount: 18, duration: 4200, tracks: mockTracks.slice(8, 16), createdBy: 'You', isPublic: false },
  { id: 'p4', title: 'Workout Energy', description: 'High energy tracks to keep you moving', artwork: artworks[3], trackCount: 42, duration: 9600, tracks: mockTracks.slice(2, 10), createdBy: 'You', isPublic: true },
  { id: 'p5', title: 'Chill Electronica', description: 'Downtempo electronic vibes', artwork: artworks[4], trackCount: 30, duration: 6900, tracks: mockTracks.slice(6, 14), createdBy: 'You', isPublic: false },
  { id: 'p6', title: 'Discover Weekly', description: 'Fresh picks based on your taste', artwork: artworks[5], trackCount: 30, duration: 7200, tracks: mockTracks.slice(0, 10), createdBy: 'System', isPublic: false },
];

export const mockIntegrations: IntegrationSource[] = [
  { id: 'apple-music', name: 'Apple Music', icon: '🎧', status: 'not-connected', color: 'hsl(340 80% 55%)' },
  { id: 'spotify', name: 'Spotify', icon: '🎵', status: 'not-connected', color: 'hsl(142 72% 45%)' },
  { id: 'plex', name: 'Plex', icon: '🎬', status: 'not-connected', color: 'hsl(38 92% 50%)' },
  { id: 'youtube', name: 'YouTube Music', icon: '▶️', status: 'not-connected', color: 'hsl(0 80% 45%)' },
];

export const mockStats: ListeningStat[] = [
  { label: 'Hours Listened', value: 247, change: 12, unit: 'hrs' },
  { label: 'Tracks Played', value: 3842, change: 8 },
  { label: 'Artists Discovered', value: 156, change: 23 },
  { label: 'Active Sources', value: 0 },
];

export const mockListeningHistory = [
  { name: 'Mon', hours: 2.4 },
  { name: 'Tue', hours: 3.1 },
  { name: 'Wed', hours: 1.8 },
  { name: 'Thu', hours: 4.2 },
  { name: 'Fri', hours: 3.6 },
  { name: 'Sat', hours: 5.1 },
  { name: 'Sun', hours: 4.8 },
];

export const mockGenreData = [
  { name: 'Electronic', value: 35, fill: 'hsl(142, 72%, 50%)' },
  { name: 'Synthwave', value: 22, fill: 'hsl(270, 60%, 60%)' },
  { name: 'Ambient', value: 18, fill: 'hsl(187, 85%, 53%)' },
  { name: 'Indie', value: 15, fill: 'hsl(38, 92%, 50%)' },
  { name: 'Other', value: 10, fill: 'hsl(0, 0%, 40%)' },
];
