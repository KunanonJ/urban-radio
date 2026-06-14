import { describe, test, expect, beforeEach } from 'vitest';
import {
  StubStreamControl,
  getStreamControl,
  __resetStubStreamControlForTests,
} from './stream-control';

beforeEach(() => {
  __resetStubStreamControlForTests();
});

describe('StubStreamControl', () => {
  test('given fresh > status returns connected=false', async () => {
    const adapter = new StubStreamControl();
    const status = await adapter.status('s1');
    expect(status.connected).toBe(false);
    expect(status.listeners).toBe(0);
    expect(status.source).toBe('stub');
  });

  test('given start > status.connected becomes true', async () => {
    const adapter = new StubStreamControl();
    const result = await adapter.start('s1');
    expect(result.ok).toBe(true);
    const status = await adapter.status('s1');
    expect(status.connected).toBe(true);
    expect(status.mountPoint).not.toBeNull();
  });

  test('given start then stop > status returns to connected=false', async () => {
    const adapter = new StubStreamControl();
    await adapter.start('s1');
    const stopResult = await adapter.stop('s1');
    expect(stopResult.ok).toBe(true);
    const status = await adapter.status('s1');
    expect(status.connected).toBe(false);
  });

  test('given updateMetadata > status reflects latest title', async () => {
    const adapter = new StubStreamControl();
    await adapter.start('s1');
    const metaResult = await adapter.updateMetadata('s1', {
      title: 'Song A',
      artist: 'Artist A',
    });
    expect(metaResult.ok).toBe(true);
    const status = await adapter.status('s1');
    // The stub exposes the latest title via the status snapshot for parity
    // with what AzuraCast will eventually return.
    expect(status.connected).toBe(true);
    // For now we expose lastTitle via a known field — the production adapter
    // will mirror this from the upstream ICY now-playing endpoint.
    const snapshot = adapter.snapshot('s1');
    expect(snapshot.lastMetadata?.title).toBe('Song A');
    expect(snapshot.lastMetadata?.artist).toBe('Artist A');
  });

  test('given start with no env URL > uses stub source', async () => {
    const adapter = new StubStreamControl();
    await adapter.start('s1');
    const status = await adapter.status('s1');
    expect(status.source).toBe('stub');
  });

  test('multiple stations isolated', async () => {
    const adapter = new StubStreamControl();
    await adapter.start('s1');
    const s1 = await adapter.status('s1');
    const s2 = await adapter.status('s2');
    expect(s1.connected).toBe(true);
    expect(s2.connected).toBe(false);
  });

  test('start when already on > idempotent ok=true', async () => {
    const adapter = new StubStreamControl();
    const first = await adapter.start('s1');
    const second = await adapter.start('s1');
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    const status = await adapter.status('s1');
    expect(status.connected).toBe(true);
  });

  test('updateMetadata when not started > still ok=true (queued)', async () => {
    const adapter = new StubStreamControl();
    const result = await adapter.updateMetadata('s1', { title: 'Preroll' });
    expect(result.ok).toBe(true);
    const snapshot = adapter.snapshot('s1');
    expect(snapshot.lastMetadata?.title).toBe('Preroll');
  });

  test('status reports increasing uptimeSeconds while connected', async () => {
    const adapter = new StubStreamControl();
    await adapter.start('s1', { now: 1000 });
    const status = await adapter.status('s1', { now: 7000 });
    expect(status.uptimeSeconds).toBe(6);
  });
});

describe('getStreamControl', () => {
  test('given no STREAM_CONTROL_URL > returns StubStreamControl', () => {
    const adapter = getStreamControl({});
    expect(adapter).toBeInstanceOf(StubStreamControl);
  });

  test('given STREAM_CONTROL_URL set > flag is captured (for future Adapter swap)', () => {
    // The AzuraCast adapter isn't shipped yet; the factory MUST still return
    // a StubStreamControl so tests don't break, but it should accept the env
    // shape without throwing. This locks the future swap point.
    const adapter = getStreamControl({
      STREAM_CONTROL_URL: 'https://azuracast.example.com',
      STREAM_CONTROL_KEY: 'sk_test_xxx',
    });
    expect(adapter).toBeDefined();
    // Once AzuraCastAdapter exists, this will change to:
    // expect(adapter).toBeInstanceOf(AzuraCastAdapter);
  });
});
