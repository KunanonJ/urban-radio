/**
 * Tests for H-11 / M-05: DB error message scrubbing.
 *
 * Verifies that `logAndScrub` returns a generic client-safe message
 * while still logging the original error to the server console.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logAndScrub } from '../internal-error';

describe('logAndScrub', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('returns the default generic message when no publicMessage is provided', () => {
    const err = new Error('relation "radio_tracks" does not exist');
    const result = logAndScrub(err, { tag: 'test/route' });
    expect(result).toBe('Internal server error');
  });

  it('returns the custom publicMessage when provided', () => {
    const err = new Error('column "station_id" of relation "station_members" does not exist');
    const result = logAndScrub(err, { tag: 'requireStation', publicMessage: 'Membership lookup failed' });
    expect(result).toBe('Membership lookup failed');
  });

  it('logs the original error to console.error so ops can debug', () => {
    const pgError = new Error('duplicate key value violates unique constraint "radio_tracks_pkey"');
    logAndScrub(pgError, { tag: 'clocks/insert' });

    expect(consoleSpy).toHaveBeenCalledOnce();
    // The first argument is the tag, the second is the original error
    expect(consoleSpy).toHaveBeenCalledWith('[clocks/insert]', pgError);
  });

  it('does NOT expose the original pg error message to the caller', () => {
    const pgError = new Error('syntax error at or near "DROP TABLE secrets"');
    const result = logAndScrub(pgError, { tag: 'some/route' });
    expect(result).not.toContain('DROP TABLE secrets');
    expect(result).not.toContain('syntax error');
  });

  it('handles non-Error thrown values (e.g. thrown strings) without crashing', () => {
    const result = logAndScrub('something went wrong', { tag: 'some/route' });
    expect(result).toBe('Internal server error');
    expect(consoleSpy).toHaveBeenCalledWith('[some/route]', 'something went wrong');
  });

  it('handles null thrown value without crashing', () => {
    const result = logAndScrub(null, { tag: 'some/route' });
    expect(result).toBe('Internal server error');
  });
});
