/**
 * Pentest M-13: SSRF defense for `audioUrl` fields in ANR + transcribe.
 *
 * Allows ONLY:
 *   - protocol `https:` (no http, no file, no ftp, no data)
 *   - hostname not in any private / link-local / loopback / metadata range
 *   - hostname not blocklisted explicitly (e.g. AWS metadata endpoints)
 *
 * Default allowlist of hostname-SUFFIXES is configurable via env
 * `AI_AUDIO_URL_ALLOWED_HOSTS` (comma-separated). When unset, ANY public
 * https hostname passes — only the deny rules apply. Operators tightening
 * SSRF posture should explicitly set this.
 */

export interface UrlAllowlistOptions {
  /** Override the env-derived allowlist (tests). */
  allowedHostSuffixes?: ReadonlyArray<string>;
}

export interface UrlAllowResult {
  ok: boolean;
  reason?: string;
}

export function checkAudioUrl(
  rawUrl: string,
  opts: UrlAllowlistOptions = {},
): UrlAllowResult {
  // Parse — reject any URL that can't be parsed.
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  // Protocol allowlist.
  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'protocol_not_allowed' };
  }

  // Block raw IPs entirely — operators should use hostnames.
  if (isIpLiteral(url.hostname)) {
    return { ok: false, reason: 'ip_literal_blocked' };
  }

  // Block specific malicious hostnames (cloud metadata, localhost variants).
  const lowerHost = url.hostname.toLowerCase();
  if (BLOCKED_HOST_EXACTS.has(lowerHost)) {
    return { ok: false, reason: 'host_blocked' };
  }
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => lowerHost.endsWith(suffix))) {
    return { ok: false, reason: 'host_blocked' };
  }

  // Optional positive allowlist.
  const allowed = opts.allowedHostSuffixes ?? envAllowedHostSuffixes();
  if (allowed.length > 0) {
    const matched = allowed.some((suffix) => lowerHost.endsWith(suffix));
    if (!matched) return { ok: false, reason: 'host_not_in_allowlist' };
  }

  return { ok: true };
}

// Blocked hosts — apply even without an explicit allowlist.
const BLOCKED_HOST_EXACTS = new Set([
  'localhost',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  'instance-data', // AWS metadata legacy hostname
]);

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localdomain'];

function isIpLiteral(host: string): boolean {
  // IPv4 dotted quad.
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // IPv6 — anything with `:` qualifies.
  if (host.includes(':')) return true;
  return false;
}

function envAllowedHostSuffixes(): ReadonlyArray<string> {
  const raw = process.env.AI_AUDIO_URL_ALLOWED_HOSTS?.trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
