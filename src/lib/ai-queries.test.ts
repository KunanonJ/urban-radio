import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import React from 'react';

// Mock @/lib/api-base.apiFetch — same pattern as stream-status-queries.test.ts.
const apiFetchMock =
  vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();
vi.mock('@/lib/api-base', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
}));

import {
  CapHitError,
  useGenerateText,
  useGenerateVoice,
  useVoiceList,
} from './ai-queries';

function makeJsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children);
  };
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

afterEach(() => {
  apiFetchMock.mockReset();
});

describe('ai-queries', () => {
  describe('CapHitError', () => {
    test('CapHitError > instance has reason and remainingUsd', () => {
      const err = new CapHitError('monthly_cap', 1.25);
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(CapHitError);
      expect(err.reason).toBe('monthly_cap');
      expect(err.remainingUsd).toBe(1.25);
      expect(err.name).toBe('CapHitError');
    });
  });

  describe('useVoiceList', () => {
    test('useVoiceList > given API returns 2 > resolves with voices array', async () => {
      const payload = {
        ok: true,
        data: [
          { id: 'v1', name: 'Mike', scope: 'cloned' as const, language: 'en' },
          { id: 'v2', name: 'Stock 1', scope: 'stock' as const, language: 'en' },
        ],
        usage: { unit: 'requests', count: 1, estimatedCostUsd: 0 },
        provider: 'stub',
      };
      apiFetchMock.mockResolvedValueOnce(makeJsonResponse(payload));

      const { result } = renderHook(() => useVoiceList('all'), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.voices).toHaveLength(2);
      expect(result.current.data?.voices[0]).toEqual({
        id: 'v1',
        name: 'Mike',
        scope: 'cloned',
        language: 'en',
      });
      // Verify the scope was passed in the URL.
      const [path] = apiFetchMock.mock.calls[0];
      expect(path).toContain('scope=all');
    });

    test('useVoiceList > given non-OK response > sets error', async () => {
      apiFetchMock.mockResolvedValueOnce(
        makeJsonResponse({ error: 'boom' }, { status: 500 }),
      );

      const { result } = renderHook(() => useVoiceList('cloned'), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toBeInstanceOf(Error);
    });
  });

  describe('useGenerateText', () => {
    test('useGenerateText > given 200 > returns ok:true with data.text', async () => {
      const payload = {
        ok: true,
        data: { text: 'Generated DJ script here!' },
        usage: { unit: 'tokens', count: 22, estimatedCostUsd: 0.0008 },
        provider: 'stub',
      };
      apiFetchMock.mockResolvedValueOnce(makeJsonResponse(payload));

      const { result } = renderHook(() => useGenerateText(), {
        wrapper: makeWrapper(),
      });

      const data = await result.current.mutateAsync({
        topic: 'frontsell',
        tone: 'energetic',
      });

      expect(data.ok).toBe(true);
      expect(data.data?.text).toBe('Generated DJ script here!');
      expect(data.provider).toBe('stub');
      // Verify request was POST JSON.
      const [path, init] = apiFetchMock.mock.calls[0];
      expect(path).toBe('/api/ai/text/generate');
      expect(init?.method).toBe('POST');
      expect(init?.headers).toEqual(
        expect.objectContaining({ 'content-type': 'application/json' }),
      );
      const body = JSON.parse(init?.body as string);
      expect(body.topic).toBe('frontsell');
      expect(body.tone).toBe('energetic');
    });

    test('useGenerateText > given 402 > throws CapHitError', async () => {
      const payload = {
        ok: false,
        error: 'cap_hit',
        reason: 'monthly_cap',
        remainingUsd: 0.42,
      };
      apiFetchMock.mockResolvedValueOnce(
        makeJsonResponse(payload, { status: 402 }),
      );

      const { result } = renderHook(() => useGenerateText(), {
        wrapper: makeWrapper(),
      });

      await expect(
        result.current.mutateAsync({ topic: 'frontsell' }),
      ).rejects.toBeInstanceOf(CapHitError);

      // Re-run to inspect properties.
      apiFetchMock.mockResolvedValueOnce(
        makeJsonResponse(payload, { status: 402 }),
      );
      try {
        await result.current.mutateAsync({ topic: 'frontsell' });
        throw new Error('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CapHitError);
        if (err instanceof CapHitError) {
          expect(err.reason).toBe('monthly_cap');
          expect(err.remainingUsd).toBe(0.42);
        }
      }
    });
  });

  describe('useGenerateVoice', () => {
    test('useGenerateVoice > given 200 > returns ok:true with audioBase64', async () => {
      const payload = {
        ok: true,
        data: { audioBase64: 'ZmFrZS1hdWRpbw==' },
        usage: { unit: 'characters', count: 25, estimatedCostUsd: 0.0075 },
        provider: 'stub',
      };
      apiFetchMock.mockResolvedValueOnce(makeJsonResponse(payload));

      const { result } = renderHook(() => useGenerateVoice(), {
        wrapper: makeWrapper(),
      });

      const data = await result.current.mutateAsync({
        text: 'hello world',
        voiceId: 'cloned-host-mike',
      });

      expect(data.ok).toBe(true);
      expect(data.data?.audioBase64).toBe('ZmFrZS1hdWRpbw==');
      const [path, init] = apiFetchMock.mock.calls[0];
      expect(path).toBe('/api/ai/voice/synthesize');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string);
      expect(body.text).toBe('hello world');
      expect(body.voiceId).toBe('cloned-host-mike');
    });

    test('useGenerateVoice > given 502 > throws Error with provider error', async () => {
      apiFetchMock.mockResolvedValueOnce(
        makeJsonResponse(
          { ok: false, error: 'Provider unreachable', provider: 'stub' },
          { status: 502 },
        ),
      );

      const { result } = renderHook(() => useGenerateVoice(), {
        wrapper: makeWrapper(),
      });

      await expect(
        result.current.mutateAsync({ text: 'x', voiceId: 'v1' }),
      ).rejects.toThrow(/Provider unreachable/);
    });

    test('useGenerateVoice > given 402 > throws CapHitError', async () => {
      apiFetchMock.mockResolvedValueOnce(
        makeJsonResponse(
          {
            ok: false,
            error: 'cap_hit',
            reason: 'request_cap',
            remainingUsd: 0,
          },
          { status: 402 },
        ),
      );

      const { result } = renderHook(() => useGenerateVoice(), {
        wrapper: makeWrapper(),
      });

      await expect(
        result.current.mutateAsync({ text: 'x', voiceId: 'v1' }),
      ).rejects.toBeInstanceOf(CapHitError);
    });
  });
});
