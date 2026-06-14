import { describe, expect, it } from 'vitest';
import {
  StubTextProvider,
  createTextProvider,
} from '@/lib/ai/text';

describe('StubTextProvider.generate', () => {
  it('frontsell with artist + title > returns string containing both', async () => {
    const provider = new StubTextProvider();
    const result = await provider.generate({
      topic: 'frontsell',
      context: { artist: 'Daft Punk', title: 'One More Time' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.text).toContain('Daft Punk');
      expect(result.data.text).toContain('One More Time');
    }
  });

  it('station_id > returns string containing stationName', async () => {
    const provider = new StubTextProvider();
    const result = await provider.generate({
      topic: 'station_id',
      context: { stationName: 'Urban Radio 101.9' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.text).toContain('Urban Radio 101.9');
    }
  });

  it('weather topic > includes tempC and description', async () => {
    const provider = new StubTextProvider();
    const result = await provider.generate({
      topic: 'weather',
      context: { weather: { tempC: 24, description: 'sunny' } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.text).toContain('24');
      expect(result.data.text).toContain('sunny');
    }
  });

  it('maxChars=50 > result.text.length is ≤ 50', async () => {
    const provider = new StubTextProvider();
    const result = await provider.generate({
      topic: 'fun_fact',
      maxChars: 50,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.text.length).toBeLessThanOrEqual(50);
    }
  });

  it('usage reports tokens at roughly text.length / 4', async () => {
    const provider = new StubTextProvider();
    const result = await provider.generate({
      topic: 'frontsell',
      context: { artist: 'A', title: 'B' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usage.unit).toBe('tokens');
      const approx = Math.max(1, Math.ceil(result.data.text.length / 4));
      expect(result.usage.count).toBe(approx);
    }
  });

  it('determinism > same input twice > same text', async () => {
    const provider = new StubTextProvider();
    const a = await provider.generate({
      topic: 'frontsell',
      context: { artist: 'Daft Punk', title: 'One More Time' },
    });
    const b = await provider.generate({
      topic: 'frontsell',
      context: { artist: 'Daft Punk', title: 'One More Time' },
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.data.text).toBe(b.data.text);
    }
  });
});

describe('createTextProvider', () => {
  it('given empty env > returns stub provider', () => {
    const provider = createTextProvider({});
    expect(provider.name).toBe('stub');
  });

  it('given ANTHROPIC_API_KEY (real adapter pending) > falls back to stub', () => {
    const provider = createTextProvider({ ANTHROPIC_API_KEY: 'sk-ant-xxx' });
    expect(provider.name).toBe('stub');
  });
});
