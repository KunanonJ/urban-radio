import { afterEach, describe, expect, test } from 'vitest';
import {
  formatBroadcastMetadata,
  isDemoEncoder,
  useBroadcastStore,
} from '@/lib/broadcast-store';

const initialState = useBroadcastStore.getState();

afterEach(() => {
  useBroadcastStore.setState({
    ...initialState,
    encoderStatus: 'idle',
    isOnAir: false,
    lastMetadata: '',
    lastError: null,
  });
});

describe('isDemoEncoder', () => {
  test('given undefined encoder URL > returns true', () => {
    expect(isDemoEncoder({})).toBe(true);
  });

  test('given empty encoder URL > returns true', () => {
    expect(isDemoEncoder({ NEXT_PUBLIC_ENCODER_URL: '' })).toBe(true);
  });

  test('given whitespace encoder URL > returns true', () => {
    expect(isDemoEncoder({ NEXT_PUBLIC_ENCODER_URL: '   ' })).toBe(true);
  });

  test('given real https encoder URL > returns false', () => {
    expect(isDemoEncoder({ NEXT_PUBLIC_ENCODER_URL: 'https://encoder.example.com' })).toBe(false);
  });
});

describe('formatBroadcastMetadata', () => {
  test('given template with placeholders > substitutes values', () => {
    const out = formatBroadcastMetadata(
      '{artist} — {title} ({album})',
      'Title',
      'Artist',
      'Album'
    );
    expect(out).toBe('Artist — Title (Album)');
  });

  test('given template without placeholders > returns template unchanged', () => {
    expect(formatBroadcastMetadata('hello', 'T', 'A', 'AL')).toBe('hello');
  });
});

describe('useBroadcastStore', () => {
  test('given fresh store > encoder is idle and not on air', () => {
    expect(useBroadcastStore.getState().encoderStatus).toBe('idle');
    expect(useBroadcastStore.getState().isOnAir).toBe(false);
  });

  test('given mockStartEncoder called > status becomes connecting immediately', () => {
    useBroadcastStore.getState().mockStartEncoder();
    expect(useBroadcastStore.getState().encoderStatus).toBe('connecting');
  });

  test('given setLastError > stores message', () => {
    useBroadcastStore.getState().setLastError('boom');
    expect(useBroadcastStore.getState().lastError).toBe('boom');
  });

  test('given setStreamMount > persists value', () => {
    useBroadcastStore.getState().setStreamMount('/live');
    expect(useBroadcastStore.getState().streamMount).toBe('/live');
  });
});
