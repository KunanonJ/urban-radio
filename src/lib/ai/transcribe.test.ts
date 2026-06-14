import { describe, expect, it } from 'vitest';
import {
  StubTranscribeProvider,
  createTranscribeProvider,
} from '@/lib/ai/transcribe';

describe('StubTranscribeProvider.transcribe', () => {
  it('given audioBase64 > returns non-empty transcript', async () => {
    const provider = new StubTranscribeProvider();
    const result = await provider.transcribe({ audioBase64: 'ZmFrZS1hdWRpbw==' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.segments.length).toBeGreaterThan(0);
      expect(result.data.fullText.length).toBeGreaterThan(0);
    }
  });

  it('given audioUrl > returns non-empty transcript', async () => {
    const provider = new StubTranscribeProvider();
    const result = await provider.transcribe({
      audioUrl: 'https://example.com/clip.mp3',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.segments.length).toBeGreaterThan(0);
      expect(result.data.fullText.length).toBeGreaterThan(0);
    }
  });

  it('usage unit is seconds', async () => {
    const provider = new StubTranscribeProvider();
    const result = await provider.transcribe({ audioBase64: 'ZmFrZQ==' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usage.unit).toBe('seconds');
      expect(result.usage.count).toBeGreaterThan(0);
    }
  });

  it('fullText is concatenation of segment texts', async () => {
    const provider = new StubTranscribeProvider();
    const result = await provider.transcribe({ audioUrl: 'https://example.com/a.mp3' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const joined = result.data.segments.map((s) => s.text).join(' ');
      expect(result.data.fullText).toBe(joined);
    }
  });

  it('given no audio input > returns error result', async () => {
    const provider = new StubTranscribeProvider();
    const result = await provider.transcribe({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain('audio');
      expect(result.provider).toBe('stub');
    }
  });
});

describe('createTranscribeProvider', () => {
  it('given empty env > returns stub', () => {
    const provider = createTranscribeProvider({});
    expect(provider.name).toBe('stub');
  });

  it('given DEEPGRAM_API_KEY (real adapter pending) > falls back to stub', () => {
    const provider = createTranscribeProvider({ DEEPGRAM_API_KEY: 'dg_xxx' });
    expect(provider.name).toBe('stub');
  });
});
