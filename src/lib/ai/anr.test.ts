import { describe, expect, it } from 'vitest';
import { StubAnrProvider, createAnrProvider } from '@/lib/ai/anr';

describe('StubAnrProvider.recognize', () => {
  it('given audioUrl > returns at least one match', async () => {
    const provider = new StubAnrProvider();
    const result = await provider.recognize({ audioUrl: 'https://example.com/clip.mp3' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.matches.length).toBeGreaterThan(0);
      expect(result.data.matches[0].title).toBeTruthy();
      expect(result.data.matches[0].artist).toBeTruthy();
    }
  });

  it('match confidence is within 0..1', async () => {
    const provider = new StubAnrProvider();
    const result = await provider.recognize({ audioBase64: 'ZmFrZS1hdWRpbw==' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const match of result.data.matches) {
        expect(match.confidence).toBeGreaterThanOrEqual(0);
        expect(match.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  it('usage unit is seconds and equals windowSeconds (default 12)', async () => {
    const provider = new StubAnrProvider();
    const result = await provider.recognize({ audioUrl: 'https://example.com/clip.mp3' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usage.unit).toBe('seconds');
      expect(result.usage.count).toBe(12);
    }
  });

  it('custom windowSeconds reflects in usage', async () => {
    const provider = new StubAnrProvider();
    const result = await provider.recognize({
      audioUrl: 'https://example.com/clip.mp3',
      windowSeconds: 30,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usage.count).toBe(30);
    }
  });

  it('given no audio input > returns error', async () => {
    const provider = new StubAnrProvider();
    const result = await provider.recognize({});
    expect(result.ok).toBe(false);
  });
});

describe('createAnrProvider', () => {
  it('given empty env > returns stub', () => {
    const provider = createAnrProvider({});
    expect(provider.name).toBe('stub');
  });

  it('given AUDD_API_KEY (real adapter pending) > falls back to stub', () => {
    const provider = createAnrProvider({ AUDD_API_KEY: 'audd_xxx' });
    expect(provider.name).toBe('stub');
  });
});
