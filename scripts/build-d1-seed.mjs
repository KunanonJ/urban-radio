/**
 * Writes migrations/0002_seed.sql — mirrors src/lib/mock-data structure for UAT.
 * Run: node scripts/build-d1-seed.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = join(__dirname, '..', 'migrations', '0002_seed.sql');

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

const artists = [
  { id: 'a1', name: 'Midnight Waves', artwork: artistImages[0], genres: ['Electronic', 'Ambient'] },
  { id: 'a2', name: 'Solar Drift', artwork: artistImages[1], genres: ['Synthwave', 'Electronic'] },
  { id: 'a3', name: 'Echo Chamber', artwork: artistImages[2], genres: ['Indie', 'Alternative'] },
  { id: 'a4', name: 'Neon Pulse', artwork: artistImages[3], genres: ['Techno', 'House'] },
  { id: 'a5', name: 'Aurora Borealis', artwork: artistImages[0], genres: ['Classical', 'Ambient'] },
  { id: 'a6', name: 'Velvet Underground', artwork: artistImages[1], genres: ['Rock', 'Experimental'] },
];

const albumNames = [
  'Infinite Loop',
  'Neon Horizons',
  'Dark Patterns',
  'Wavelength',
  'Chromatic',
  'Stellar',
  'Synthesis',
  'Continuum',
];

const ALBUM_ADDED_DAYS_AGO = [1, 1, 2, 4, 7, 14, 21, 45];

const trackNames = [
  'Celestial Highway',
  'Neon Dreams',
  'Afterglow',
  'Digital Rain',
  'Pulse',
  'Horizons',
  'Deep Blue',
  'Starfall',
  'Midnight Run',
  'Vapor Trail',
  'Chrome Heart',
  'Ghost Signal',
  'Waveform',
  'Solstice',
  'Prism',
  'Echo Valley',
  'Dark Matter',
  'Radiance',
  'Flux',
  'Drift',
];

const sources = ['local', 'plex', 'spotify'];

function esc(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function daysAgoIso(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

const lines = [];
lines.push('-- Seed catalog (matches mock-data for UAT). Idempotent re-seed.');
lines.push('DELETE FROM playlist_tracks;');
lines.push('DELETE FROM playlists;');
lines.push('DELETE FROM tracks;');
lines.push('DELETE FROM albums;');
lines.push('DELETE FROM artists;');

for (const a of artists) {
  lines.push(
    `INSERT INTO artists (id, name, artwork, genres_json) VALUES (${esc(a.id)}, ${esc(a.name)}, ${esc(a.artwork)}, ${esc(JSON.stringify(a.genres))});`,
  );
}

const CLOUD_ARTWORK =
  'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop';
lines.push(
  `INSERT INTO artists (id, name, artwork, genres_json) VALUES ('cloud-upload', 'Upload', ${esc(CLOUD_ARTWORK)}, ${esc(JSON.stringify(['Upload']))});`,
);
lines.push(
  `INSERT INTO albums (id, title, artist_id, artwork, year, genre, source, date_added) VALUES ('cloud-lib', 'Cloud library', 'cloud-upload', ${esc(CLOUD_ARTWORK)}, ${new Date().getFullYear()}, 'Upload', 'cloud', ${esc(new Date().toISOString())});`,
);

for (let i = 0; i < 8; i++) {
  const id = `al${i + 1}`;
  const ar = artists[i % 6];
  const days = ALBUM_ADDED_DAYS_AGO[i] ?? 60;
  lines.push(
    `INSERT INTO albums (id, title, artist_id, artwork, year, genre, source, date_added) VALUES (${esc(id)}, ${esc(albumNames[i])}, ${esc(ar.id)}, ${esc(artworks[i % 8])}, ${2020 + (i % 6)}, ${esc(ar.genres[0])}, ${esc(sources[i % 3])}, ${esc(daysAgoIso(days))});`,
  );
}

for (let i = 0; i < 20; i++) {
  const id = `t${i + 1}`;
  const ar = artists[i % 6];
  const albumId = `al${(i % 8) + 1}`;
  const duration = 180 + ((i * 7) % 180);
  lines.push(
    `INSERT INTO tracks (id, title, artist_id, album_id, duration, artwork, source, genre, year, track_number, date_added, media_r2_key, content_hash) VALUES (${esc(id)}, ${esc(trackNames[i])}, ${esc(ar.id)}, ${esc(albumId)}, ${duration}, ${esc(artworks[i % 8])}, ${esc(sources[i % 3])}, ${esc(ar.genres[0])}, ${2020 + (i % 6)}, ${(i % 12) + 1}, NULL, NULL, NULL);`,
  );
}

const playlists = [
  { id: 'p1', title: 'Late Night Coding', description: 'Perfect focus music for deep work sessions', artwork: artworks[0], createdBy: 'You', isPublic: 0 },
  { id: 'p2', title: 'Synthwave Essentials', description: 'The best of modern synthwave', artwork: artworks[1], createdBy: 'You', isPublic: 1 },
  { id: 'p3', title: 'Morning Ambience', description: 'Gentle sounds to start your day', artwork: artworks[2], createdBy: 'You', isPublic: 0 },
  { id: 'p4', title: 'Workout Energy', description: 'High energy tracks to keep you moving', artwork: artworks[3], createdBy: 'You', isPublic: 1 },
  { id: 'p5', title: 'Chill Electronica', description: 'Downtempo electronic vibes', artwork: artworks[4], createdBy: 'You', isPublic: 0 },
  { id: 'p6', title: 'Discover Weekly', description: 'Fresh picks based on your taste', artwork: artworks[5], createdBy: 'System', isPublic: 0 },
];

const slices = [
  [0, 8],
  [4, 12],
  [8, 16],
  [2, 10],
  [6, 14],
  [0, 10],
];

for (const p of playlists) {
  lines.push(
    `INSERT INTO playlists (id, title, description, artwork, created_by, is_public) VALUES (${esc(p.id)}, ${esc(p.title)}, ${esc(p.description)}, ${esc(p.artwork)}, ${esc(p.createdBy)}, ${p.isPublic});`,
  );
}

for (let p = 0; p < 6; p++) {
  const [a, b] = slices[p];
  const pid = `p${p + 1}`;
  let pos = 0;
  for (let i = a; i < b; i++) {
    pos += 1;
    lines.push(
      `INSERT INTO playlist_tracks (playlist_id, track_id, sort_order) VALUES (${esc(pid)}, ${esc(`t${i + 1}`)}, ${pos});`,
    );
  }
}

writeFileSync(out, lines.join('\n') + '\n', 'utf8');
console.log('Wrote', out);
