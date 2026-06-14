import { describe, test, expect } from 'vitest';
import {
  buildClocksListQuery,
  buildClockDetailQuery,
  buildClockInsert,
  buildClockUpdate,
  buildClockDelete,
  buildSlotInsert,
  buildSlotUpdate,
  buildSlotDelete,
  buildSlotsReorder,
  SLOT_TYPES,
} from './clock-queries';

describe('SLOT_TYPES', () => {
  test('contains music, sweeper, liner, vt, id, news, weather, spot, bed, custom', () => {
    expect(SLOT_TYPES).toEqual(
      expect.arrayContaining(['music', 'sweeper', 'liner', 'vt', 'id', 'news', 'weather', 'spot', 'bed', 'custom']),
    );
  });
});

describe('buildClocksListQuery', () => {
  test('scopes WHERE station_id = ?', () => {
    const { sql, params } = buildClocksListQuery('urban-radio');
    expect(sql).toMatch(/FROM clocks/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('urban-radio');
  });

  test('orders by created_at ASC, id ASC for determinism', () => {
    const { sql } = buildClocksListQuery('s');
    expect(sql).toMatch(/ORDER BY created_at ASC, id ASC/);
  });

  test('given empty stationId > throws', () => {
    expect(() => buildClocksListQuery('')).toThrow();
  });
});

describe('buildClockDetailQuery', () => {
  test('joins clocks + clock_slots ORDER BY position', () => {
    const { sql, params } = buildClockDetailQuery('s', 'c1');
    expect(sql).toMatch(/FROM clocks/);
    expect(sql).toMatch(/LEFT JOIN clock_slots/);
    expect(sql).toMatch(/ORDER BY .*position/);
    expect(params).toEqual(['s', 'c1']);
  });

  test('filters by station_id AND clock id', () => {
    const { sql } = buildClockDetailQuery('s', 'c1');
    expect(sql).toMatch(/c\.station_id = \?/);
    expect(sql).toMatch(/c\.id = \?/);
  });
});

describe('buildClockInsert', () => {
  test('binds stationId first after id', () => {
    const { sql, params } = buildClockInsert({
      id: 'c1',
      stationId: 'urban-radio',
      name: 'Morning Mix',
      color: '#3b82f6',
      targetDurationMs: 3600000,
    });
    expect(sql).toMatch(/INSERT INTO clocks/);
    expect(params[0]).toBe('c1');
    expect(params[1]).toBe('urban-radio');
    expect(params).toContain('Morning Mix');
    expect(params).toContain('#3b82f6');
    expect(params).toContain(3600000);
  });

  test('defaults missing color/targetDurationMs in SQL', () => {
    const { sql, params } = buildClockInsert({
      id: 'c2',
      stationId: 's',
      name: 'X',
    });
    expect(sql).toMatch(/INSERT INTO clocks/);
    // We still bind 5 values (id, station_id, name, color, target_duration_ms)
    expect(params).toHaveLength(5);
  });
});

describe('buildClockUpdate', () => {
  test('supports partial patches and station scope', () => {
    const { sql, params } = buildClockUpdate({
      stationId: 's',
      clockId: 'c1',
      name: 'New Name',
    });
    expect(sql).toMatch(/UPDATE clocks/);
    expect(sql).toMatch(/SET .*name = \?/);
    expect(sql).toMatch(/WHERE id = \? AND station_id = \?/);
    expect(params).toContain('New Name');
    expect(params).toContain('s');
    expect(params).toContain('c1');
  });

  test('supports patches across multiple fields', () => {
    const { sql, params } = buildClockUpdate({
      stationId: 's',
      clockId: 'c1',
      name: 'N',
      color: '#fff',
      targetDurationMs: 1800000,
    });
    expect(sql).toMatch(/name = \?/);
    expect(sql).toMatch(/color = \?/);
    expect(sql).toMatch(/target_duration_ms = \?/);
    expect(params).toContain(1800000);
  });

  test('given empty patch > throws (no-op rejected)', () => {
    expect(() => buildClockUpdate({ stationId: 's', clockId: 'c1' })).toThrow();
  });
});

describe('buildClockDelete', () => {
  test('scopes station_id', () => {
    const { sql, params } = buildClockDelete('s', 'c1');
    expect(sql).toMatch(/DELETE FROM clocks/);
    expect(sql).toMatch(/WHERE id = \? AND station_id = \?/);
    expect(params).toEqual(['c1', 's']);
  });
});

describe('buildSlotInsert', () => {
  test('inserts with positional binds and rejects invalid slot_type', () => {
    const { sql, params } = buildSlotInsert({
      id: 'sl1',
      clockId: 'c1',
      position: 0,
      slotType: 'music',
      categoryId: 'cat-music',
      durationEstimateMs: 180000,
    });
    expect(sql).toMatch(/INSERT INTO clock_slots/);
    expect(params).toContain('sl1');
    expect(params).toContain('c1');
    expect(params).toContain(0);
    expect(params).toContain('music');
  });

  test('rejects invalid slot_type', () => {
    expect(() =>
      buildSlotInsert({
        id: 'sl1',
        clockId: 'c1',
        position: 0,
        // @ts-expect-error testing invalid input
        slotType: 'banana',
        durationEstimateMs: 1000,
      }),
    ).toThrow();
  });

  test('accepts null categoryId and undefined rulesJson', () => {
    const { params } = buildSlotInsert({
      id: 'sl1',
      clockId: 'c1',
      position: 1,
      slotType: 'sweeper',
      durationEstimateMs: 5000,
    });
    expect(params).toContain(null);
  });
});

describe('buildSlotUpdate', () => {
  test('supports partial patches scoped to clock_id', () => {
    const { sql, params } = buildSlotUpdate({
      clockId: 'c1',
      slotId: 'sl1',
      position: 3,
    });
    expect(sql).toMatch(/UPDATE clock_slots/);
    expect(sql).toMatch(/SET position = \?/);
    expect(sql).toMatch(/WHERE id = \? AND clock_id = \?/);
    expect(params).toContain(3);
    expect(params).toContain('sl1');
    expect(params).toContain('c1');
  });

  test('given empty patch > throws', () => {
    expect(() => buildSlotUpdate({ clockId: 'c1', slotId: 'sl1' })).toThrow();
  });

  test('rejects invalid slot_type in patch', () => {
    expect(() =>
      buildSlotUpdate({
        clockId: 'c1',
        slotId: 'sl1',
        // @ts-expect-error testing invalid input
        slotType: 'banana',
      }),
    ).toThrow();
  });
});

describe('buildSlotDelete', () => {
  test('scopes clock_id', () => {
    const { sql, params } = buildSlotDelete('c1', 'sl1');
    expect(sql).toMatch(/DELETE FROM clock_slots/);
    expect(sql).toMatch(/WHERE id = \? AND clock_id = \?/);
    expect(params).toEqual(['sl1', 'c1']);
  });
});

describe('buildSlotsReorder', () => {
  test('given 5 slots > returns 5 UPDATEs', () => {
    const stmts = buildSlotsReorder('c1', [
      { id: 'a', position: 0 },
      { id: 'b', position: 1 },
      { id: 'c', position: 2 },
      { id: 'd', position: 3 },
      { id: 'e', position: 4 },
    ]);
    expect(stmts).toHaveLength(5);
    for (const s of stmts) {
      expect(s.sql).toMatch(/UPDATE clock_slots/);
      expect(s.sql).toMatch(/SET position = \?/);
      expect(s.sql).toMatch(/WHERE id = \? AND clock_id = \?/);
    }
  });

  test('given empty order list > returns empty array', () => {
    expect(buildSlotsReorder('c1', [])).toEqual([]);
  });

  test('binds clock_id and slot id and new position correctly', () => {
    const stmts = buildSlotsReorder('c1', [{ id: 'a', position: 7 }]);
    expect(stmts[0].params).toEqual([7, 'a', 'c1']);
  });
});
