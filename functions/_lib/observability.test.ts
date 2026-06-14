import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

import { initObservability, captureError } from './observability';

let infoSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  infoSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('initObservability', () => {
  test('given no SENTRY_DSN > returns null and does not log init', () => {
    const client = initObservability({});
    expect(client).toBeNull();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test('given empty-string SENTRY_DSN > treats as unset and returns null', () => {
    const client = initObservability({ SENTRY_DSN: '' });
    expect(client).toBeNull();
  });

  test('given SENTRY_DSN > returns a client with capture(), logs init with truncated DSN', () => {
    const client = initObservability({
      SENTRY_DSN: 'https://abc123def456@o0.ingest.sentry.io/123',
    });
    expect(client).not.toBeNull();
    expect(typeof client!.capture).toBe('function');
    expect(infoSpy).toHaveBeenCalled();
    const logged = String(infoSpy.mock.calls[0][1] ?? '');
    // Make sure we don't log the entire DSN — only a prefix.
    expect(logged).toContain('https://abc123def456@o0');
    expect(logged).not.toContain('/123');
  });

  test('client.capture(err, ctx) forwards to console.error', () => {
    const client = initObservability({ SENTRY_DSN: 'https://x@s/1' });
    const ctx = { foo: 'bar' };
    const err = new Error('boom');
    client!.capture(err, ctx);
    expect(errorSpy).toHaveBeenCalled();
    const args = errorSpy.mock.calls[0];
    expect(args).toContain(err);
    expect(args).toContain(ctx);
  });
});

describe('captureError', () => {
  test('without DSN > still logs the error via console.error fallback', () => {
    const err = new Error('lonely error');
    captureError({}, err);
    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls[0]).toContain(err);
  });

  test('with DSN > initializes and forwards to client.capture', () => {
    const err = new Error('observed');
    captureError({ SENTRY_DSN: 'https://x@s/1' }, err, { route: '/api/foo' });
    // Both the init line and the capture call hit console (info + error).
    expect(infoSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  test('handles non-Error inputs without crashing (string/object)', () => {
    captureError({}, 'a string failure');
    captureError({}, { code: 500, message: 'nope' });
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});
