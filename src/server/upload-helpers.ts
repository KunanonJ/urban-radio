/**
 * Pure helpers for the Next-side upload route.
 *
 * Mirrors `functions/_lib/upload-helpers.ts` but stops at the SQL-builder
 * boundary — the Next side uses Drizzle directly so the legacy `buildXxx`
 * functions that return `{ sql, params }` D1 query objects don't apply.
 * The detection / category mapping / filename normalisation logic IS
 * shared and ported here verbatim so the two stacks make identical
 * decisions for the same input.
 *
 * Side-effect-free on purpose; tests can exercise these without spinning
 * up a DB.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β3.
 */

// ---------------------------------------------------------------------------
// H-03: Upload size caps (pentest finding)
// ---------------------------------------------------------------------------

/** Maximum bytes accepted for any single audio upload (50 MB). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Maximum Base64 characters for the JSON-base64 voice-track upload path.
 * ~10 MB of raw audio encoded in Base64 (4/3 overhead) plus a small margin.
 */
export const MAX_VOICE_TRACK_BASE64_CHARS =
  Math.ceil((10 * 1024 * 1024 * 4) / 3) + 100;

// ---------------------------------------------------------------------------
// H-04: MIME allowlist (pentest finding)
// ---------------------------------------------------------------------------

/** Allowed audio MIME types for uploaded audio files. */
export const ALLOWED_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/aac',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/flac',
  'audio/x-flac',
  'audio/ogg',
  'audio/opus',
  'audio/webm',
]);

/**
 * Returns true if the given MIME type is in the audio allowlist.
 * Case-insensitive; strips parameters (e.g. `audio/mpeg; codecs=mp3`).
 */
export function isAllowedAudioType(mimeType: string): boolean {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  return ALLOWED_AUDIO_TYPES.has(base);
}

/**
 * Inspect the first 32 bytes of a file and return the most likely audio
 * MIME type based on magic-byte signatures, or null if no audio format is
 * recognised.
 *
 * Signatures checked (in order):
 *  - ID3 tag (MP3):    49 44 33 (bytes 0-2)
 *  - MP3 sync frame:   FF FB / FF F3 / FF F2 (bytes 0-1)
 *  - ADTS AAC:         FF F1 / FF F9 (bytes 0-1)
 *  - RIFF WAVE:        52 49 46 46 ... 57 41 56 45 (bytes 0-3, 8-11)
 *  - OGG:              4F 67 67 53 (bytes 0-3)
 *  - FLAC:             66 4C 61 43 (bytes 0-3)
 *  - MP4/M4A ftyp box: 66 74 79 70 at byte offset 4 (bytes 4-7)
 */
export function sniffAudioMagicBytes(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;

  const b = bytes;

  // ID3 tag → MP3
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg';

  // MP3 sync frames: FF FB, FF F3, FF F2
  if (
    b[0] === 0xff &&
    (b[1] === 0xfb || b[1] === 0xf3 || b[1] === 0xf2)
  ) {
    return 'audio/mpeg';
  }

  // ADTS AAC: FF F1 or FF F9
  if (b[0] === 0xff && (b[1] === 0xf1 || b[1] === 0xf9)) {
    return 'audio/aac';
  }

  // RIFF WAVE: bytes 0-3 = "RIFF", bytes 8-11 = "WAVE"
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    bytes.length >= 12 &&
    b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45
  ) {
    return 'audio/wav';
  }

  // OGG: "OggS"
  if (
    b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53
  ) {
    return 'audio/ogg';
  }

  // FLAC: "fLaC"
  if (
    b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43
  ) {
    return 'audio/flac';
  }

  // MP4 / M4A: "ftyp" at offset 4
  if (
    bytes.length >= 8 &&
    b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70
  ) {
    return 'audio/mp4';
  }

  return null;
}

export type RadioFileType =
  | 'music'
  | 'jingle'
  | 'sweeper'
  | 'id'
  | 'spot'
  | 'unknown';

/**
 * Best-effort categorisation of an uploaded file from filename hints.
 * The MIME type is accepted for forward compatibility but is currently
 * advisory only — Phase 1 ingest does not parse audio metadata server-side.
 */
export function detectFileType(opts: {
  mime?: string;
  filename: string;
}): RadioFileType {
  const name = opts.filename.toLowerCase();
  // Order matters: "id-" must be checked separately from "spot"/"sweeper"
  // so a filename like "sweeper-id-2024" still maps to sweeper.
  if (
    /(^|[^a-z])sweeper([^a-z]|$)/i.test(name) ||
    name.includes('sweeper_')
  ) {
    return 'sweeper';
  }
  if (
    /(^|[^a-z])jingle([^a-z]|$)/i.test(name) ||
    name.includes('jingle_')
  ) {
    return 'jingle';
  }
  if (/(^|[^a-z])spot([^a-z]|$)/i.test(name) || name.includes('spot_')) {
    return 'spot';
  }
  // "id-" prefix or "_id_" infix — narrow to avoid matching "video" / "rapid".
  if (/(^|[^a-z])id[-_]/i.test(name)) {
    return 'id';
  }
  return 'music';
}

/**
 * Map a file_type label to the seeded category id from migration 0005.
 * Unknown labels (including empty / undefined) fall back to cat-music so
 * the radio_tracks insert always satisfies FK constraints.
 */
export function defaultCategoryIdForFileType(fileType: string): string {
  switch (fileType) {
    case 'music':
      return 'cat-music';
    case 'jingle':
      return 'cat-jingle';
    case 'sweeper':
      return 'cat-sweeper';
    case 'id':
      return 'cat-id';
    case 'spot':
      return 'cat-spot';
    default:
      return 'cat-music';
  }
}

/**
 * Strip the final extension from a filename. Returns "(untitled)" for empty
 * input so the resulting radio_tracks.title is never an empty string (the
 * column is NOT NULL).
 */
export function stripExtension(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) return '(untitled)';
  const withoutExt = trimmed.replace(/\.[^.]+$/, '');
  return withoutExt || '(untitled)';
}

/**
 * Sanitize a filename for safe use in storage keys. Same contract as the
 * legacy Cloudflare handler: collapse non-alphanumerics (allow . _ -) into
 * underscores and cap at 120 chars. Falls back to 'audio.bin' if the result
 * would be empty.
 */
export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'audio.bin';
}

/** Hex-encode an ArrayBuffer (lower-case, no separator). */
export function bufToHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/** SHA-256 hex digest of the buffer. Used to dedup uploads. */
export async function sha256Hex(
  bytes: ArrayBuffer | Uint8Array,
): Promise<string> {
  // `crypto.subtle.digest` accepts both ArrayBuffer and TypedArray views at
  // runtime, but `lib.dom.d.ts` types BufferSource so a `Uint8Array` whose
  // `.buffer` is `ArrayBufferLike` (post-TS-5.7) requires the cast.
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as unknown as BufferSource,
  );
  return bufToHex(digest);
}
