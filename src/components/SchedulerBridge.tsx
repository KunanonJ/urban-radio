import { useEffect, useRef } from 'react';
import { eventRunsToday, useSchedulerStore } from '@/lib/scheduler-store';
import { usePlayerStore } from '@/lib/store';

/** Fires persisted scheduler events once per local minute match. */
export function SchedulerBridge() {
  const lastFireKey = useRef<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = new Date();
      const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
      const hh = now.getHours().toString().padStart(2, '0');
      const mm = now.getMinutes().toString().padStart(2, '0');
      const label = `${hh}:${mm}`;

      const { events } = useSchedulerStore.getState();
      const matches = events.filter(
        (e) => e.time === label && eventRunsToday(e, now)
      );
      if (matches.length === 0) return;
      if (lastFireKey.current === key) return;
      lastFireKey.current = key;

      const { pause, play } = usePlayerStore.getState();
      for (const ev of matches) {
        if (ev.action === 'pause') pause();
        else play();
      }
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  return null;
}
