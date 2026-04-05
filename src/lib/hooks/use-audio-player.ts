'use client';

import { useEffect, useRef } from 'react';
import { useAudioPlayerStore } from '@/lib/store/audio-player-store';

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const store = useAudioPlayerStore();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const audio = audioRef.current;

    function handleTimeUpdate() {
      useAudioPlayerStore.getState().setCurrentTime(audio.currentTime);
    }
    function handleLoadedMetadata() {
      useAudioPlayerStore.getState().setDuration(audio.duration);
    }
    function handleEnded() {
      useAudioPlayerStore.getState().stop();
    }

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (store.url && store.isPlaying) {
      if (audio.src !== store.url) {
        audio.src = store.url;
        audio.load();
      }
      void audio.play();
    } else if (!store.isPlaying && audio.src) {
      audio.pause();
    }

    if (!store.url) {
      audio.pause();
      audio.src = '';
    }
  }, [store.url, store.isPlaying]);

  function seek(time: number) {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  }

  return { ...store, seek };
}
