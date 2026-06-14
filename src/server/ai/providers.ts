/**
 * Server-side AI provider factories.
 *
 * The pure capability stubs live in `@/lib/ai`. This module is the thin
 * server wrapper that reads provider env vars (OPENAI_API_KEY, ELEVENLABS_API_KEY,
 * ANTHROPIC_API_KEY, DEEPGRAM_API_KEY, ASSEMBLYAI_API_KEY, AUDD_API_KEY, ACR_CLOUD_*)
 * via `process.env` so route handlers don't have to.
 *
 * Tests inject a mock provider directly into the route handlers' `deps`,
 * bypassing these factories entirely so no real network call ever lands.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β7.
 */

import {
  createAnrProvider,
  createTextProvider,
  createTranscribeProvider,
  createVoiceProvider,
  type AnrProvider,
  type TextProvider,
  type TranscribeProvider,
  type VoiceProvider,
} from '@/lib/ai';

/**
 * Returns a Voice (TTS + library) provider configured from `process.env`.
 *
 * Keys consulted: `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`. Never logged.
 */
export function getVoiceProvider(): VoiceProvider {
  return createVoiceProvider({
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });
}

/**
 * Returns a Text (DJ copy) provider configured from `process.env`.
 *
 * Keys consulted: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. Never logged.
 */
export function getTextProvider(): TextProvider {
  return createTextProvider({
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  });
}

/**
 * Returns a Transcribe provider configured from `process.env`.
 *
 * Keys consulted: `DEEPGRAM_API_KEY`, `ASSEMBLYAI_API_KEY`. Never logged.
 */
export function getTranscribeProvider(): TranscribeProvider {
  return createTranscribeProvider({
    DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
    ASSEMBLYAI_API_KEY: process.env.ASSEMBLYAI_API_KEY,
  });
}

/**
 * Returns an ANR (Audio Now-playing Recognition) provider configured from
 * `process.env`.
 *
 * Keys consulted: `AUDD_API_KEY`, `ACR_CLOUD_KEY`, `ACR_CLOUD_SECRET`.
 * Never logged.
 */
export function getAnrProvider(): AnrProvider {
  return createAnrProvider({
    AUDD_API_KEY: process.env.AUDD_API_KEY,
    ACR_CLOUD_KEY: process.env.ACR_CLOUD_KEY,
    ACR_CLOUD_SECRET: process.env.ACR_CLOUD_SECRET,
  });
}
