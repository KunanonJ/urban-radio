import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SchedulerAction = 'pause' | 'resume';

/** 0 = Sunday … 6 = Saturday (matches `Date#getDay()`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface SchedulerEvent {
  id: string;
  /** Local time HH:MM (24h) */
  time: string;
  action: SchedulerAction;
  label: string;
  /** If omitted or empty, runs every day. Otherwise only on listed weekdays. */
  daysOfWeek?: Weekday[];
}

type SchedulerState = {
  events: SchedulerEvent[];
  addEvent: (e: Omit<SchedulerEvent, 'id'>) => void;
  removeEvent: (id: string) => void;
};

export const useSchedulerStore = create<SchedulerState>()(
  persist(
    (set) => ({
      events: [],
      addEvent: (e) =>
        set((s) => ({
          events: [...s.events, { ...e, id: crypto.randomUUID() }],
        })),
      removeEvent: (id) => set((s) => ({ events: s.events.filter((x) => x.id !== id) })),
    }),
    { name: 'sonic-bloom-scheduler' }
  )
);

export function eventRunsToday(e: SchedulerEvent, date: Date): boolean {
  if (e.daysOfWeek == null || e.daysOfWeek.length === 0) return true;
  const dow = date.getDay() as Weekday;
  return e.daysOfWeek.includes(dow);
}
