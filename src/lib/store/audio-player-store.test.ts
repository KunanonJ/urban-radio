import { describe, it, expect, beforeEach } from 'vitest';
import { useAudioPlayerStore } from './audio-player-store';

describe('audioPlayerStore', () => {
  beforeEach(() => {
    useAudioPlayerStore.getState().stop();
  });

  it('initializes with null state', () => {
    const state = useAudioPlayerStore.getState();
    expect(state.trackId).toBeNull();
    expect(state.isPlaying).toBe(false);
    expect(state.url).toBeNull();
  });

  it('sets track and starts playing on play()', () => {
    useAudioPlayerStore.getState().play({
      id: 'track-1',
      title: 'Test Track',
      artistName: 'Test Artist',
      url: 'https://example.com/track.mp3',
    });

    const state = useAudioPlayerStore.getState();
    expect(state.trackId).toBe('track-1');
    expect(state.trackTitle).toBe('Test Track');
    expect(state.artistName).toBe('Test Artist');
    expect(state.url).toBe('https://example.com/track.mp3');
    expect(state.isPlaying).toBe(true);
  });

  it('pauses playback', () => {
    useAudioPlayerStore.getState().play({
      id: 'track-1',
      title: 'Test',
      artistName: 'Artist',
      url: 'https://example.com/t.mp3',
    });
    useAudioPlayerStore.getState().pause();

    expect(useAudioPlayerStore.getState().isPlaying).toBe(false);
    expect(useAudioPlayerStore.getState().trackId).toBe('track-1');
  });

  it('resumes playback', () => {
    useAudioPlayerStore.getState().play({
      id: 'track-1',
      title: 'Test',
      artistName: 'Artist',
      url: 'https://example.com/t.mp3',
    });
    useAudioPlayerStore.getState().pause();
    useAudioPlayerStore.getState().resume();

    expect(useAudioPlayerStore.getState().isPlaying).toBe(true);
  });

  it('stops and clears state', () => {
    useAudioPlayerStore.getState().play({
      id: 'track-1',
      title: 'Test',
      artistName: 'Artist',
      url: 'https://example.com/t.mp3',
    });
    useAudioPlayerStore.getState().stop();

    const state = useAudioPlayerStore.getState();
    expect(state.trackId).toBeNull();
    expect(state.isPlaying).toBe(false);
    expect(state.url).toBeNull();
    expect(state.currentTime).toBe(0);
  });

  it('updates current time', () => {
    useAudioPlayerStore.getState().setCurrentTime(42.5);
    expect(useAudioPlayerStore.getState().currentTime).toBe(42.5);
  });

  it('updates duration', () => {
    useAudioPlayerStore.getState().setDuration(180);
    expect(useAudioPlayerStore.getState().duration).toBe(180);
  });

  it('replaces track when play() called with different track', () => {
    useAudioPlayerStore.getState().play({
      id: 'track-1',
      title: 'First',
      artistName: 'A',
      url: 'https://example.com/1.mp3',
    });
    useAudioPlayerStore.getState().setCurrentTime(60);

    useAudioPlayerStore.getState().play({
      id: 'track-2',
      title: 'Second',
      artistName: 'B',
      url: 'https://example.com/2.mp3',
    });

    const state = useAudioPlayerStore.getState();
    expect(state.trackId).toBe('track-2');
    expect(state.trackTitle).toBe('Second');
    expect(state.currentTime).toBe(0);
  });
});
