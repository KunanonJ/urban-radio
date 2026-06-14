// @vitest-environment node
/**
 * Unit tests for the SSRF allowlist helper (pentest M-13).
 *
 * Covers every deny rule and the optional positive allowlist path.
 */

import { describe, test, expect } from 'vitest';
import { checkAudioUrl } from './url-allowlist';

describe('checkAudioUrl', () => {
  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  test('HTTPS public hostname → ok', () => {
    const result = checkAudioUrl('https://cdn.example.com/clip.mp3');
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('HTTPS public hostname with path and query → ok', () => {
    const result = checkAudioUrl('https://audio.storage.io/tracks/1?v=2');
    expect(result.ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Protocol deny rules
  // -------------------------------------------------------------------------

  test('http:// → rejected (protocol_not_allowed)', () => {
    const result = checkAudioUrl('http://example.com/clip.mp3');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('protocol_not_allowed');
  });

  test('ftp:// → rejected (protocol_not_allowed)', () => {
    const result = checkAudioUrl('ftp://example.com/clip.mp3');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('protocol_not_allowed');
  });

  test('file:/// → rejected (protocol_not_allowed)', () => {
    const result = checkAudioUrl('file:///etc/passwd');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('protocol_not_allowed');
  });

  test('data: URI → rejected (protocol_not_allowed)', () => {
    const result = checkAudioUrl('data:audio/mp3;base64,AAAA');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('protocol_not_allowed');
  });

  // -------------------------------------------------------------------------
  // IP literal deny rules
  // -------------------------------------------------------------------------

  test('IPv4 literal (https://1.2.3.4) → rejected (ip_literal_blocked)', () => {
    const result = checkAudioUrl('https://1.2.3.4/foo.mp3');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ip_literal_blocked');
  });

  test('AWS metadata IP (https://169.254.169.254/) → rejected (ip_literal_blocked)', () => {
    const result = checkAudioUrl(
      'https://169.254.169.254/latest/meta-data/iam/security-credentials/',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ip_literal_blocked');
  });

  test('RFC-1918 IPv4 (https://10.0.0.1) → rejected (ip_literal_blocked)', () => {
    const result = checkAudioUrl('https://10.0.0.1/audio.mp3');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ip_literal_blocked');
  });

  test('RFC-1918 IPv4 (https://192.168.1.1) → rejected (ip_literal_blocked)', () => {
    const result = checkAudioUrl('https://192.168.1.1/clip.wav');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ip_literal_blocked');
  });

  test('IPv6 literal (https://[::1]/) → rejected (ip_literal_blocked)', () => {
    const result = checkAudioUrl('https://[::1]/audio.mp3');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ip_literal_blocked');
  });

  test('IPv6 literal (https://[::ffff:127.0.0.1]/) → rejected (ip_literal_blocked)', () => {
    const result = checkAudioUrl('https://[::ffff:127.0.0.1]/audio.mp3');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ip_literal_blocked');
  });

  // -------------------------------------------------------------------------
  // Exact hostname blocklist
  // -------------------------------------------------------------------------

  test('localhost → rejected (host_blocked)', () => {
    const result = checkAudioUrl('https://localhost/audio.mp3');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('host_blocked');
  });

  test('0.0.0.0 is caught by IP literal rule', () => {
    // 0.0.0.0 matches the dotted-quad regex — ip_literal_blocked fires first.
    const result = checkAudioUrl('https://0.0.0.0/audio.mp3');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('ip_literal_blocked');
  });

  test('GCP metadata hostname → rejected (host_blocked)', () => {
    const result = checkAudioUrl(
      'https://metadata.google.internal/computeMetadata/v1/instance/service-accounts/',
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('host_blocked');
  });

  test('instance-data (AWS legacy metadata hostname) → rejected (host_blocked)', () => {
    const result = checkAudioUrl('https://instance-data/latest/meta-data/');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('host_blocked');
  });

  // -------------------------------------------------------------------------
  // Suffix blocklist
  // -------------------------------------------------------------------------

  test('.local suffix → rejected (host_blocked)', () => {
    const result = checkAudioUrl('https://myhost.local/audio.mp3');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('host_blocked');
  });

  test('.internal suffix → rejected (host_blocked)', () => {
    const result = checkAudioUrl('https://service.internal/audio.mp3');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('host_blocked');
  });

  test('.localdomain suffix → rejected (host_blocked)', () => {
    const result = checkAudioUrl('https://host.localdomain/audio.mp3');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('host_blocked');
  });

  // -------------------------------------------------------------------------
  // Positive allowlist (opts.allowedHostSuffixes)
  // -------------------------------------------------------------------------

  test('allowlist set, host suffix in list → ok', () => {
    const result = checkAudioUrl('https://cdn.example.com/clip.mp3', {
      allowedHostSuffixes: ['.example.com', '.trusted.io'],
    });
    expect(result.ok).toBe(true);
  });

  test('allowlist set, exact match in list → ok', () => {
    const result = checkAudioUrl('https://audio.trusted.io/file.mp3', {
      allowedHostSuffixes: ['.example.com', '.trusted.io'],
    });
    expect(result.ok).toBe(true);
  });

  test('allowlist set, host NOT in list → rejected (host_not_in_allowlist)', () => {
    const result = checkAudioUrl('https://cdn.other.com/clip.mp3', {
      allowedHostSuffixes: ['.example.com'],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('host_not_in_allowlist');
  });

  test('allowlist set but deny rules still apply — localhost still rejected', () => {
    const result = checkAudioUrl('https://localhost/audio.mp3', {
      allowedHostSuffixes: ['localhost'],
    });
    // host_blocked fires before allowlist check.
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('host_blocked');
  });

  test('empty allowlist array → behaves like no allowlist (any public host ok)', () => {
    const result = checkAudioUrl('https://any-public-host.net/clip.mp3', {
      allowedHostSuffixes: [],
    });
    expect(result.ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Invalid URL
  // -------------------------------------------------------------------------

  test('non-URL string → rejected (invalid_url)', () => {
    const result = checkAudioUrl('not a url at all');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_url');
  });

  test('empty string → rejected (invalid_url)', () => {
    const result = checkAudioUrl('');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_url');
  });
});
