import { afterEach, describe, expect, test } from 'vitest';
import {
  CART_SLOT_COUNT,
  MAX_GRID,
  MAX_TABS,
  MIN_GRID,
  defaultHotkeyForSlot,
  hotkeyLabelForSlot,
  useCartStore,
  type CartTab,
} from '@/lib/cart-store';
import { mockTracks } from '@/lib/mock-data';

function makeTab(overrides: Partial<CartTab> = {}): CartTab {
  const cols = overrides.gridCols ?? 4;
  const rows = overrides.gridRows ?? 3;
  const total = cols * rows;
  return {
    id: overrides.id ?? 'test-tab-1',
    name: overrides.name ?? 'Main',
    gridCols: cols,
    gridRows: rows,
    slots: overrides.slots ?? Array.from({ length: total }, () => null),
    hotkeyMap: overrides.hotkeyMap,
  };
}

const fresh = () => {
  const tab = makeTab({ id: 'fresh-tab' });
  useCartStore.setState({
    tabs: [tab],
    activeTabId: tab.id,
    auditionMode: false,
    slots: tab.slots,
  });
};

afterEach(fresh);

describe('useCartStore initial shape', () => {
  test('given fresh store > slots length matches CART_SLOT_COUNT', () => {
    fresh();
    expect(useCartStore.getState().slots).toHaveLength(CART_SLOT_COUNT);
  });

  test('given fresh store > every slot is null', () => {
    fresh();
    expect(useCartStore.getState().slots.every((s) => s === null)).toBe(true);
  });

  test('given fresh store > has exactly one default tab', () => {
    fresh();
    expect(useCartStore.getState().tabs).toHaveLength(1);
  });

  test('given fresh store > auditionMode is false', () => {
    fresh();
    expect(useCartStore.getState().auditionMode).toBe(false);
  });
});

describe('useCartStore.setSlot', () => {
  test('given valid index > stores track at that slot only', () => {
    useCartStore.getState().setSlot(3, mockTracks[0]);
    const { slots } = useCartStore.getState();
    expect(slots[3]).toBe(mockTracks[0]);
    expect(slots.filter((s) => s !== null)).toHaveLength(1);
  });

  test('given negative index > does not mutate slots', () => {
    const before = useCartStore.getState().slots;
    useCartStore.getState().setSlot(-1, mockTracks[0]);
    expect(useCartStore.getState().slots).toEqual(before);
  });

  test('given index above CART_SLOT_COUNT > does not mutate slots', () => {
    const before = useCartStore.getState().slots;
    useCartStore.getState().setSlot(CART_SLOT_COUNT, mockTracks[0]);
    expect(useCartStore.getState().slots).toEqual(before);
  });

  test('given setSlot to null > clears that slot', () => {
    useCartStore.getState().setSlot(0, mockTracks[0]);
    useCartStore.getState().setSlot(0, null);
    expect(useCartStore.getState().slots[0]).toBeNull();
  });

  test('given setSlot > does not mutate previous slots array (immutability)', () => {
    const before = useCartStore.getState().slots;
    useCartStore.getState().setSlot(0, mockTracks[0]);
    const after = useCartStore.getState().slots;
    expect(after).not.toBe(before);
  });
});

describe('useCartStore.clearSlot', () => {
  test('given existing track > clears specified slot only', () => {
    useCartStore.getState().setSlot(2, mockTracks[0]);
    useCartStore.getState().setSlot(5, mockTracks[1]);
    useCartStore.getState().clearSlot(2);
    const { slots } = useCartStore.getState();
    expect(slots[2]).toBeNull();
    expect(slots[5]).toBe(mockTracks[1]);
  });

  test('given out-of-range index > does not mutate slots', () => {
    useCartStore.getState().setSlot(0, mockTracks[0]);
    const before = useCartStore.getState().slots;
    useCartStore.getState().clearSlot(CART_SLOT_COUNT + 10);
    expect(useCartStore.getState().slots).toEqual(before);
  });
});

describe('useCartStore migration from legacy shape', () => {
  test('given legacy state { slots: Track[12] } > normalizes into { tabs: [{slots: same 12}] }', () => {
    // Simulate the post-rehydrate effect by calling normalizePersistedState via setState.
    // We import normalizePersistedState indirectly by re-creating the path:
    // the public API to "run migration" is migrateLegacy, but it preserves an already-valid shape.
    // So we directly emulate the persisted-rehydrate by overwriting state without tabs first.
    const legacySlots = Array.from({ length: CART_SLOT_COUNT }, (_, i) =>
      i < 3 ? mockTracks[i] : null,
    );
    // Bypass typing to mimic the persisted shape rehydration.
    (useCartStore.setState as unknown as (s: Record<string, unknown>) => void)({
      tabs: [],
      activeTabId: '',
      slots: legacySlots,
      auditionMode: false,
    });
    useCartStore.getState().migrateLegacy();
    const state = useCartStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].slots.length).toBeGreaterThanOrEqual(CART_SLOT_COUNT);
    expect(state.activeTabId).toBe(state.tabs[0].id);
  });

  test('given already-new shape > migrateLegacy is a no-op', () => {
    const before = useCartStore.getState().tabs;
    useCartStore.getState().migrateLegacy();
    expect(useCartStore.getState().tabs).toBe(before);
  });
});

describe('useCartStore.addTab', () => {
  test('given valid name > appends a new tab', () => {
    const sizeBefore = useCartStore.getState().tabs.length;
    useCartStore.getState().addTab('Sweepers', 6, 4);
    const tabs = useCartStore.getState().tabs;
    expect(tabs).toHaveLength(sizeBefore + 1);
    expect(tabs[tabs.length - 1].name).toBe('Sweepers');
    expect(tabs[tabs.length - 1].gridCols).toBe(6);
    expect(tabs[tabs.length - 1].gridRows).toBe(4);
    expect(tabs[tabs.length - 1].slots).toHaveLength(24);
  });

  test('given default gridCols/gridRows > defaults to 4x4', () => {
    useCartStore.getState().addTab('IDs');
    const tabs = useCartStore.getState().tabs;
    const created = tabs[tabs.length - 1];
    expect(created.gridCols).toBe(4);
    expect(created.gridRows).toBe(4);
    expect(created.slots).toHaveLength(16);
  });

  test('given grid above MAX_GRID > clamps to MAX_GRID', () => {
    useCartStore.getState().addTab('Huge', 99, 99);
    const tabs = useCartStore.getState().tabs;
    const created = tabs[tabs.length - 1];
    expect(created.gridCols).toBe(MAX_GRID);
    expect(created.gridRows).toBe(MAX_GRID);
  });

  test('given MAX_TABS reached > does not append', () => {
    for (let i = 0; i < MAX_TABS + 2; i++) {
      useCartStore.getState().addTab(`extra-${i}`);
    }
    expect(useCartStore.getState().tabs.length).toBeLessThanOrEqual(MAX_TABS);
  });

  test('given addTab > switches activeTabId to the new tab', () => {
    useCartStore.getState().addTab('New');
    const state = useCartStore.getState();
    const last = state.tabs[state.tabs.length - 1];
    expect(state.activeTabId).toBe(last.id);
  });
});

describe('useCartStore.removeTab', () => {
  test('given last remaining tab > does not remove', () => {
    const before = useCartStore.getState().tabs;
    useCartStore.getState().removeTab(before[0].id);
    expect(useCartStore.getState().tabs).toHaveLength(1);
  });

  test('given non-last tab > removes it', () => {
    useCartStore.getState().addTab('Extra');
    const state = useCartStore.getState();
    expect(state.tabs).toHaveLength(2);
    const extraId = state.tabs[1].id;
    useCartStore.getState().removeTab(extraId);
    expect(useCartStore.getState().tabs).toHaveLength(1);
  });

  test('given active tab removed > activeTabId falls back to first remaining', () => {
    useCartStore.getState().addTab('Extra');
    const active = useCartStore.getState().activeTabId;
    useCartStore.getState().removeTab(active);
    const state = useCartStore.getState();
    expect(state.tabs.some((t) => t.id === active)).toBe(false);
    expect(state.activeTabId).toBe(state.tabs[0].id);
  });
});

describe('useCartStore.renameTab', () => {
  test('given new name > updates tab name', () => {
    const id = useCartStore.getState().tabs[0].id;
    useCartStore.getState().renameTab(id, 'Renamed Tab');
    expect(useCartStore.getState().tabs[0].name).toBe('Renamed Tab');
  });

  test('given empty name > does not mutate', () => {
    const id = useCartStore.getState().tabs[0].id;
    const before = useCartStore.getState().tabs[0].name;
    useCartStore.getState().renameTab(id, '   ');
    expect(useCartStore.getState().tabs[0].name).toBe(before);
  });
});

describe('useCartStore.resizeTab', () => {
  test('given 6x6 > slots length becomes 36, existing slots preserved', () => {
    useCartStore.getState().setSlot(0, mockTracks[0]);
    useCartStore.getState().setSlot(5, mockTracks[1]);
    const tabId = useCartStore.getState().tabs[0].id;
    useCartStore.getState().resizeTab(tabId, 6, 6);
    const tab = useCartStore.getState().tabs[0];
    expect(tab.slots).toHaveLength(36);
    expect(tab.slots[0]).toBe(mockTracks[0]);
    expect(tab.slots[5]).toBe(mockTracks[1]);
  });

  test('given resize below MIN_GRID > clamps to MIN_GRID', () => {
    const tabId = useCartStore.getState().tabs[0].id;
    useCartStore.getState().resizeTab(tabId, 1, 1);
    const tab = useCartStore.getState().tabs[0];
    expect(tab.gridCols).toBe(MIN_GRID);
    expect(tab.gridRows).toBe(MIN_GRID);
  });

  test('given shrink > truncates extra slots gracefully', () => {
    const tabId = useCartStore.getState().tabs[0].id;
    useCartStore.getState().resizeTab(tabId, 8, 8); // 64
    useCartStore.getState().setSlot(50, mockTracks[0]);
    useCartStore.getState().resizeTab(tabId, 4, 4); // 16
    const tab = useCartStore.getState().tabs[0];
    expect(tab.slots).toHaveLength(16);
  });
});

describe('useCartStore.setActiveTab', () => {
  test('given valid tab id > switches and slots getter reflects new tab', () => {
    useCartStore.getState().setSlot(0, mockTracks[0]);
    const firstTabId = useCartStore.getState().tabs[0].id;
    useCartStore.getState().addTab('Second', 4, 4);
    const secondTabId = useCartStore.getState().activeTabId;
    expect(secondTabId).not.toBe(firstTabId);
    expect(useCartStore.getState().slots.every((s) => s === null)).toBe(true);

    useCartStore.getState().setActiveTab(firstTabId);
    expect(useCartStore.getState().slots[0]).toBe(mockTracks[0]);
  });

  test('given unknown tab id > does not change activeTabId', () => {
    const before = useCartStore.getState().activeTabId;
    useCartStore.getState().setActiveTab('does-not-exist');
    expect(useCartStore.getState().activeTabId).toBe(before);
  });
});

describe('useCartStore.setAuditionMode', () => {
  test('given true > flips auditionMode on', () => {
    useCartStore.getState().setAuditionMode(true);
    expect(useCartStore.getState().auditionMode).toBe(true);
  });

  test('given false > flips auditionMode off', () => {
    useCartStore.getState().setAuditionMode(true);
    useCartStore.getState().setAuditionMode(false);
    expect(useCartStore.getState().auditionMode).toBe(false);
  });
});

describe('hotkey helpers', () => {
  test('defaultHotkeyForSlot > slot 0 is A', () => {
    expect(defaultHotkeyForSlot(0)).toBe('A');
  });

  test('defaultHotkeyForSlot > slot 25 is Z', () => {
    expect(defaultHotkeyForSlot(25)).toBe('Z');
  });

  test('defaultHotkeyForSlot > slot 26 is 1', () => {
    expect(defaultHotkeyForSlot(26)).toBe('1');
  });

  test('defaultHotkeyForSlot > slot 35 is 0', () => {
    expect(defaultHotkeyForSlot(35)).toBe('0');
  });

  test('defaultHotkeyForSlot > slot 36 is F1', () => {
    expect(defaultHotkeyForSlot(36)).toBe('F1');
  });

  test('defaultHotkeyForSlot > slot 47 is F12', () => {
    expect(defaultHotkeyForSlot(47)).toBe('F12');
  });

  test('defaultHotkeyForSlot > slot 48 is null', () => {
    expect(defaultHotkeyForSlot(48)).toBeNull();
  });

  test('hotkeyLabelForSlot > uses tab hotkeyMap override when present', () => {
    const tab = makeTab({ hotkeyMap: { 0: 'SPACE' } });
    expect(hotkeyLabelForSlot(tab, 0)).toBe('SPACE');
    expect(hotkeyLabelForSlot(tab, 1)).toBe('B'); // falls through to default
  });
});
