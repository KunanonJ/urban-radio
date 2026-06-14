import { describe, expect, it } from 'vitest';
import {
  StubVoiceProvider,
  createVoiceProvider,
} from '@/lib/ai/voice';

describe('StubVoiceProvider.synthesize', () => {
  it('given any text > returns ok with audioBase64', async () => {
    const provider = new StubVoiceProvider();
    const result = await provider.synthesize({
      text: 'Hello world',
      voiceId: 'stock-female-warm',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.data.audioBase64).toBe('string');
      expect(result.data.audioBase64.length).toBeGreaterThan(0);
      expect(result.provider).toBe('stub');
    }
  });

  it('usage reports characters > matches text.length', async () => {
    const provider = new StubVoiceProvider();
    const text = 'Up next, Daft Punk with "One More Time".';
    const result = await provider.synthesize({ text, voiceId: 'cloned-host-mike' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.usage.unit).toBe('characters');
      expect(result.usage.count).toBe(text.length);
    }
  });

  it('usage estimatedCostUsd > deterministic for same text', async () => {
    const provider = new StubVoiceProvider();
    const text = 'Same text, same cost.';
    const a = await provider.synthesize({ text, voiceId: 'stock-female-warm' });
    const b = await provider.synthesize({ text, voiceId: 'stock-female-warm' });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.usage.estimatedCostUsd).toBe(b.usage.estimatedCostUsd);
      expect(a.data.audioBase64).toBe(b.data.audioBase64);
    }
  });
});

describe('StubVoiceProvider.listVoices', () => {
  it('default scope > returns at least one cloned and one stock voice', async () => {
    const provider = new StubVoiceProvider();
    const result = await provider.listVoices();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const scopes = result.data.map((v) => v.scope);
      expect(scopes).toContain('cloned');
      expect(scopes).toContain('stock');
    }
  });

  it('scope=cloned > only cloned voices', async () => {
    const provider = new StubVoiceProvider();
    const result = await provider.listVoices({ scope: 'cloned' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.length).toBeGreaterThan(0);
      for (const voice of result.data) {
        expect(voice.scope).toBe('cloned');
      }
    }
  });
});

describe('createVoiceProvider', () => {
  it('given empty env > returns stub provider', () => {
    const provider = createVoiceProvider({});
    expect(provider.name).toBe('stub');
  });

  it('given ELEVENLABS_API_KEY (real adapter pending) > still falls back to stub', () => {
    /** Until ElevenLabs adapter ships in Wave 6b, factory must safely fall back. */
    const provider = createVoiceProvider({ ELEVENLABS_API_KEY: 'sk_test_xxx' });
    expect(provider.name).toBe('stub');
  });
});
