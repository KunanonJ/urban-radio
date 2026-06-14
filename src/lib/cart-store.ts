import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Track } from '@/lib/types';

/** Default slot count for the first / legacy tab. */
export const CART_SLOT_COUNT = 12;
/** Minimum allowed grid dimension. */
export const MIN_GRID = 4;
/** Maximum allowed grid dimension. */
export const MAX_GRID = 12;
/** Maximum allowed tabs. */
export const MAX_TABS = 8;

export type CartTileState = 'idle' | 'armed' | 'playing' | 'held' | 'ducked';

export interface CartTab {
  id: string;
  name: string;
  /** Columns: clamped to [MIN_GRID, MAX_GRID]. */
  gridCols: number;
  /** Rows: clamped to [MIN_GRID, MAX_GRID]. */
  gridRows: number;
  /** Length === gridCols * gridRows. */
  slots: (Track | null)[];
  /** Optional override for hotkey-per-slot. Indexed by slot index. */
  hotkeyMap?: Record<number, string>;
}

export interface CartState {
  tabs: CartTab[];
  activeTabId: string;
  /** When on, slot fire goes through preview audio rather than the main on-air player. */
  auditionMode: boolean;

  // Backward-compat surface (computed from the active tab).
  /** Read-only: slots of the active tab (length = activeTab.gridCols * activeTab.gridRows). */
  slots: (Track | null)[];
  setSlot: (index: number, track: Track | null) => void;
  clearSlot: (index: number) => void;

  // Tab actions.
  setActiveTab: (id: string) => void;
  addTab: (name: string, gridCols?: number, gridRows?: number) => void;
  removeTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  resizeTab: (id: string, gridCols: number, gridRows: number) => void;
  setAuditionMode: (on: boolean) => void;
  /** Migrate legacy `{ slots: Track[12] }` shape into the first tab. Idempotent. */
  migrateLegacy: () => void;
}

const LEGACY_DEFAULT_TAB_NAME = 'Main';

function clampGrid(value: number): number {
  if (!Number.isFinite(value)) return MIN_GRID;
  return Math.min(MAX_GRID, Math.max(MIN_GRID, Math.round(value)));
}

function makeEmptySlots(count: number): (Track | null)[] {
  return Array.from({ length: Math.max(0, count) }, () => null);
}

function makeTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `tab_${crypto.randomUUID()}`;
  }
  return `tab_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

/** Build a default tab with `count` empty slots arranged into a 4-wide grid (height = ceil(count/4)). */
function makeDefaultTab(name = LEGACY_DEFAULT_TAB_NAME, count = CART_SLOT_COUNT): CartTab {
  const cols = 4;
  const rows = clampGrid(Math.max(MIN_GRID, Math.ceil(count / cols)));
  const total = cols * rows;
  const slots = makeEmptySlots(total);
  return { id: makeTabId(), name, gridCols: cols, gridRows: rows, slots };
}

function resolveActiveIndex(tabs: CartTab[], activeTabId: string): number {
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  return idx >= 0 ? idx : 0;
}

function projectSlots(tabs: CartTab[], activeTabId: string): (Track | null)[] {
  if (tabs.length === 0) return [];
  const tab = tabs[resolveActiveIndex(tabs, activeTabId)];
  return tab.slots;
}

interface LegacyShape {
  slots?: (Track | null)[];
}

/**
 * Convert any unknown persisted state into the current shape.
 * Handles three cases:
 *  - legacy v0: `{ slots: Track[12] }` (no `tabs`)
 *  - v1+: `{ tabs, activeTabId, auditionMode }`
 *  - garbage / partial: fresh defaults
 */
function normalizePersistedState(raw: unknown): { tabs: CartTab[]; activeTabId: string; auditionMode: boolean } {
  if (!raw || typeof raw !== 'object') {
    const fresh = makeDefaultTab();
    return { tabs: [fresh], activeTabId: fresh.id, auditionMode: false };
  }
  const obj = raw as Partial<CartState> & LegacyShape;
  if (Array.isArray(obj.tabs) && obj.tabs.length > 0) {
    const tabs: CartTab[] = obj.tabs.map((t) => {
      const gridCols = clampGrid(t?.gridCols ?? 4);
      const gridRows = clampGrid(t?.gridRows ?? 3);
      const total = gridCols * gridRows;
      const incoming = Array.isArray(t?.slots) ? t.slots : [];
      const slots = makeEmptySlots(total);
      for (let i = 0; i < Math.min(total, incoming.length); i++) {
        slots[i] = incoming[i] ?? null;
      }
      return {
        id: typeof t?.id === 'string' && t.id.length > 0 ? t.id : makeTabId(),
        name: typeof t?.name === 'string' && t.name.length > 0 ? t.name : LEGACY_DEFAULT_TAB_NAME,
        gridCols,
        gridRows,
        slots,
        hotkeyMap: t?.hotkeyMap,
      };
    });
    const activeTabId =
      typeof obj.activeTabId === 'string' && tabs.some((t) => t.id === obj.activeTabId)
        ? obj.activeTabId
        : tabs[0].id;
    return { tabs, activeTabId, auditionMode: Boolean(obj.auditionMode) };
  }
  if (Array.isArray(obj.slots)) {
    // Legacy: pour the 12 (or however many) slots into a single default tab.
    const cols = 4;
    const rows = clampGrid(Math.max(MIN_GRID, Math.ceil(obj.slots.length / cols)));
    const total = cols * rows;
    const slots = makeEmptySlots(total);
    for (let i = 0; i < Math.min(total, obj.slots.length); i++) {
      slots[i] = obj.slots[i] ?? null;
    }
    const tab: CartTab = {
      id: makeTabId(),
      name: LEGACY_DEFAULT_TAB_NAME,
      gridCols: cols,
      gridRows: rows,
      slots,
    };
    return { tabs: [tab], activeTabId: tab.id, auditionMode: false };
  }
  const fresh = makeDefaultTab();
  return { tabs: [fresh], activeTabId: fresh.id, auditionMode: false };
}

function buildInitialState(): { tabs: CartTab[]; activeTabId: string; auditionMode: boolean } {
  const tab = makeDefaultTab();
  return { tabs: [tab], activeTabId: tab.id, auditionMode: false };
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => {
      const initial = buildInitialState();
      return {
        tabs: initial.tabs,
        activeTabId: initial.activeTabId,
        auditionMode: initial.auditionMode,
        slots: projectSlots(initial.tabs, initial.activeTabId),

        setSlot: (index, track) =>
          set((s) => {
            const tabIdx = resolveActiveIndex(s.tabs, s.activeTabId);
            const tab = s.tabs[tabIdx];
            if (!tab) return s;
            if (index < 0 || index >= tab.slots.length) return s;
            const nextSlots = [...tab.slots];
            nextSlots[index] = track;
            const nextTab: CartTab = { ...tab, slots: nextSlots };
            const tabs = s.tabs.map((t, i) => (i === tabIdx ? nextTab : t));
            return { tabs, slots: nextSlots };
          }),

        clearSlot: (index) =>
          set((s) => {
            const tabIdx = resolveActiveIndex(s.tabs, s.activeTabId);
            const tab = s.tabs[tabIdx];
            if (!tab) return s;
            if (index < 0 || index >= tab.slots.length) return s;
            const nextSlots = [...tab.slots];
            nextSlots[index] = null;
            const nextTab: CartTab = { ...tab, slots: nextSlots };
            const tabs = s.tabs.map((t, i) => (i === tabIdx ? nextTab : t));
            return { tabs, slots: nextSlots };
          }),

        setActiveTab: (id) =>
          set((s) => {
            if (!s.tabs.some((t) => t.id === id)) return s;
            return { activeTabId: id, slots: projectSlots(s.tabs, id) };
          }),

        addTab: (name, gridCols, gridRows) =>
          set((s) => {
            if (s.tabs.length >= MAX_TABS) return s;
            const cols = clampGrid(gridCols ?? 4);
            const rows = clampGrid(gridRows ?? 4);
            const trimmed = (name ?? '').trim() || LEGACY_DEFAULT_TAB_NAME;
            const tab: CartTab = {
              id: makeTabId(),
              name: trimmed,
              gridCols: cols,
              gridRows: rows,
              slots: makeEmptySlots(cols * rows),
            };
            const tabs = [...s.tabs, tab];
            return { tabs, activeTabId: tab.id, slots: projectSlots(tabs, tab.id) };
          }),

        removeTab: (id) =>
          set((s) => {
            if (s.tabs.length <= 1) return s; // always keep ≥ 1 tab
            const tabs = s.tabs.filter((t) => t.id !== id);
            if (tabs.length === s.tabs.length) return s;
            const activeTabId = s.activeTabId === id ? tabs[0].id : s.activeTabId;
            return { tabs, activeTabId, slots: projectSlots(tabs, activeTabId) };
          }),

        renameTab: (id, name) =>
          set((s) => {
            const trimmed = (name ?? '').trim();
            if (trimmed.length === 0) return s;
            const tabs = s.tabs.map((t) => (t.id === id ? { ...t, name: trimmed } : t));
            return { tabs };
          }),

        resizeTab: (id, gridCols, gridRows) =>
          set((s) => {
            const cols = clampGrid(gridCols);
            const rows = clampGrid(gridRows);
            const total = cols * rows;
            const tabs = s.tabs.map((t) => {
              if (t.id !== id) return t;
              const nextSlots = makeEmptySlots(total);
              for (let i = 0; i < Math.min(total, t.slots.length); i++) {
                nextSlots[i] = t.slots[i] ?? null;
              }
              return { ...t, gridCols: cols, gridRows: rows, slots: nextSlots };
            });
            return { tabs, slots: projectSlots(tabs, s.activeTabId) };
          }),

        setAuditionMode: (on) => set({ auditionMode: Boolean(on) }),

        migrateLegacy: () => {
          // Idempotent: if we are already in the new shape with a valid active tab, do nothing.
          const s = get();
          if (s.tabs.length > 0 && s.tabs.some((t) => t.id === s.activeTabId)) {
            // Ensure `slots` projection is fresh.
            const slots = projectSlots(s.tabs, s.activeTabId);
            if (slots !== s.slots) set({ slots });
            return;
          }
          const next = buildInitialState();
          set({
            tabs: next.tabs,
            activeTabId: next.activeTabId,
            auditionMode: next.auditionMode,
            slots: projectSlots(next.tabs, next.activeTabId),
          });
        },
      };
    },
    {
      name: 'sonic-bloom-cart',
      version: 1,
      // Only persist the data parts, not the derived projection or actions.
      partialize: (s) => ({
        tabs: s.tabs,
        activeTabId: s.activeTabId,
        auditionMode: s.auditionMode,
      }) as Partial<CartState>,
      migrate: (persistedState, _version) => {
        const normalized = normalizePersistedState(persistedState);
        return normalized as Partial<CartState>;
      },
      // After rehydration, fix up the derived `slots` projection.
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return;
        const normalized = normalizePersistedState({
          tabs: state.tabs,
          activeTabId: state.activeTabId,
          auditionMode: state.auditionMode,
          slots: state.slots,
        });
        state.tabs = normalized.tabs;
        state.activeTabId = normalized.activeTabId;
        state.auditionMode = normalized.auditionMode;
        state.slots = projectSlots(normalized.tabs, normalized.activeTabId);
      },
    },
  ),
);

/**
 * Resolve a default hotkey mapping for the given total slot count.
 * Order: A-Z (slots 0..25), 0-9 (slots 26..35), F1-F12 (slots 36..47).
 */
export function defaultHotkeyForSlot(slotIndex: number): string | null {
  if (slotIndex < 0) return null;
  if (slotIndex < 26) return String.fromCharCode(65 + slotIndex); // A-Z
  if (slotIndex < 36) return String((slotIndex - 26 + 1) % 10); // 1..9,0
  if (slotIndex < 48) return `F${slotIndex - 36 + 1}`; // F1-F12
  return null;
}

/** Pretty label for a hotkey, e.g. 'A', '1', 'F3'. */
export function hotkeyLabelForSlot(tab: CartTab | undefined, slotIndex: number): string | null {
  if (tab?.hotkeyMap && Object.prototype.hasOwnProperty.call(tab.hotkeyMap, slotIndex)) {
    return tab.hotkeyMap[slotIndex];
  }
  return defaultHotkeyForSlot(slotIndex);
}
