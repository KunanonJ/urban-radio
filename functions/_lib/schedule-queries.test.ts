import { describe, test, expect } from 'vitest';
import {
  buildScheduleListQuery,
  buildScheduleByIdQuery,
  buildScheduleAssignmentInsert,
  buildScheduleAssignmentUpdate,
  buildScheduleAssignmentDelete,
  buildFindOverlappingAssignments,
  validateWeekday,
  validateHour,
} from './schedule-queries';

describe('validateWeekday', () => {
  test('given 0..6 > does not throw', () => {
    for (let i = 0; i <= 6; i++) {
      expect(() => validateWeekday(i)).not.toThrow();
    }
  });

  test('given -1 > throws', () => {
    expect(() => validateWeekday(-1)).toThrow(/weekday/i);
  });

  test('given 7 > throws', () => {
    expect(() => validateWeekday(7)).toThrow(/weekday/i);
  });

  test('given non-integer > throws', () => {
    expect(() => validateWeekday(1.5)).toThrow(/weekday/i);
  });

  test('given non-number > throws', () => {
    expect(() => validateWeekday('1')).toThrow(/weekday/i);
    expect(() => validateWeekday(null)).toThrow(/weekday/i);
  });
});

describe('validateHour', () => {
  test('given 0..23 > does not throw', () => {
    for (let h = 0; h <= 23; h++) {
      expect(() => validateHour(h)).not.toThrow();
    }
  });

  test('given 24 > throws', () => {
    expect(() => validateHour(24)).toThrow(/hour/i);
  });

  test('given -1 > throws', () => {
    expect(() => validateHour(-1)).toThrow(/hour/i);
  });

  test('given non-integer > throws', () => {
    expect(() => validateHour(10.5)).toThrow(/hour/i);
  });
});

describe('buildScheduleListQuery', () => {
  test('given stationId only > scopes station_id', () => {
    const { sql, params } = buildScheduleListQuery('urban-radio');
    expect(sql).toMatch(/FROM schedule_assignments/);
    expect(sql).toMatch(/WHERE station_id = \?/);
    expect(params[0]).toBe('urban-radio');
  });

  test('given weekday filter > adds weekday = ?', () => {
    const { sql, params } = buildScheduleListQuery('s', { weekday: 1 });
    expect(sql).toMatch(/weekday = \?/);
    expect(params).toContain(1);
  });

  test('given hour filter > adds hour = ?', () => {
    const { sql, params } = buildScheduleListQuery('s', { hour: 10 });
    expect(sql).toMatch(/hour = \?/);
    expect(params).toContain(10);
  });

  test('given no stationId > throws', () => {
    expect(() => buildScheduleListQuery('')).toThrow();
  });

  test('orders by weekday, hour for stable grid display', () => {
    const { sql } = buildScheduleListQuery('s');
    expect(sql).toMatch(/ORDER BY weekday ASC, hour ASC/);
  });
});

describe('buildScheduleByIdQuery', () => {
  test('returns SQL with station_id and id binds (station first)', () => {
    const { sql, params } = buildScheduleByIdQuery('s', 'sched-1');
    expect(sql).toMatch(/FROM schedule_assignments/);
    expect(sql).toMatch(/WHERE station_id = \? AND id = \?/);
    expect(params).toEqual(['s', 'sched-1']);
  });
});

describe('buildScheduleAssignmentInsert', () => {
  test('inserts station + clock + weekday + hour', () => {
    const { sql, params } = buildScheduleAssignmentInsert({
      id: 'sched-1',
      stationId: 'urban-radio',
      clockId: 'clk-1',
      weekday: 1,
      hour: 10,
    });
    expect(sql).toMatch(/INSERT INTO schedule_assignments/);
    expect(sql).toMatch(/station_id/);
    expect(sql).toMatch(/clock_id/);
    expect(sql).toMatch(/weekday/);
    expect(sql).toMatch(/hour/);
    expect(params).toContain('urban-radio');
    expect(params).toContain('clk-1');
    expect(params).toContain(1);
    expect(params).toContain(10);
  });

  test('includes optional valid_from, valid_until, rrule', () => {
    const { sql, params } = buildScheduleAssignmentInsert({
      id: 'sched-1',
      stationId: 's',
      clockId: 'clk-1',
      weekday: 1,
      hour: 10,
      validFrom: '2026-01-01T00:00:00Z',
      validUntil: '2026-12-31T00:00:00Z',
      rrule: 'FREQ=WEEKLY',
    });
    expect(sql).toMatch(/valid_from/);
    expect(sql).toMatch(/valid_until/);
    expect(sql).toMatch(/rrule/);
    expect(params).toContain('2026-01-01T00:00:00Z');
    expect(params).toContain('2026-12-31T00:00:00Z');
    expect(params).toContain('FREQ=WEEKLY');
  });

  test('throws if weekday > 6', () => {
    expect(() =>
      buildScheduleAssignmentInsert({
        id: 's1',
        stationId: 's',
        clockId: 'c1',
        weekday: 7,
        hour: 10,
      }),
    ).toThrow(/weekday/i);
  });

  test('throws if hour > 23', () => {
    expect(() =>
      buildScheduleAssignmentInsert({
        id: 's1',
        stationId: 's',
        clockId: 'c1',
        weekday: 1,
        hour: 24,
      }),
    ).toThrow(/hour/i);
  });

  test('throws if stationId empty', () => {
    expect(() =>
      buildScheduleAssignmentInsert({
        id: 's1',
        stationId: '',
        clockId: 'c1',
        weekday: 1,
        hour: 10,
      }),
    ).toThrow();
  });

  test('throws if clockId empty', () => {
    expect(() =>
      buildScheduleAssignmentInsert({
        id: 's1',
        stationId: 's',
        clockId: '',
        weekday: 1,
        hour: 10,
      }),
    ).toThrow();
  });

  test('throws if id empty', () => {
    expect(() =>
      buildScheduleAssignmentInsert({
        id: '',
        stationId: 's',
        clockId: 'c1',
        weekday: 1,
        hour: 10,
      }),
    ).toThrow();
  });
});

describe('buildScheduleAssignmentUpdate', () => {
  test('patches clock_id only', () => {
    const { sql, params } = buildScheduleAssignmentUpdate('s', 'sched-1', {
      clockId: 'clk-2',
    });
    expect(sql).toMatch(/UPDATE schedule_assignments/);
    expect(sql).toMatch(/SET clock_id = \?/);
    expect(sql).toMatch(/WHERE station_id = \? AND id = \?/);
    expect(params).toContain('clk-2');
    expect(params).toContain('s');
    expect(params).toContain('sched-1');
  });

  test('patches weekday and hour together', () => {
    const { sql, params } = buildScheduleAssignmentUpdate('s', 'sched-1', {
      weekday: 2,
      hour: 14,
    });
    expect(sql).toMatch(/weekday = \?/);
    expect(sql).toMatch(/hour = \?/);
    expect(params).toContain(2);
    expect(params).toContain(14);
  });

  test('validates weekday on patch', () => {
    expect(() =>
      buildScheduleAssignmentUpdate('s', 'id1', { weekday: 99 }),
    ).toThrow(/weekday/i);
  });

  test('validates hour on patch', () => {
    expect(() => buildScheduleAssignmentUpdate('s', 'id1', { hour: 99 })).toThrow(
      /hour/i,
    );
  });

  test('rejects empty patch', () => {
    expect(() => buildScheduleAssignmentUpdate('s', 'id1', {})).toThrow(/no fields/i);
  });

  test('allows null rrule clear', () => {
    const { sql, params } = buildScheduleAssignmentUpdate('s', 'sched-1', {
      rrule: null,
    });
    expect(sql).toMatch(/rrule = \?/);
    expect(params).toContain(null);
  });
});

describe('buildScheduleAssignmentDelete', () => {
  test('scopes by station_id and id', () => {
    const { sql, params } = buildScheduleAssignmentDelete('s', 'sched-1');
    expect(sql).toMatch(/DELETE FROM schedule_assignments/);
    expect(sql).toMatch(/WHERE station_id = \? AND id = \?/);
    expect(params).toEqual(['s', 'sched-1']);
  });
});

describe('buildFindOverlappingAssignments', () => {
  test('given weekday=1 hour=10 > returns SELECT scoped to station+weekday+hour', () => {
    const { sql, params } = buildFindOverlappingAssignments('s', 1, 10);
    expect(sql).toMatch(/SELECT/);
    expect(sql).toMatch(/FROM schedule_assignments/);
    expect(sql).toMatch(/WHERE station_id = \? AND weekday = \? AND hour = \?/);
    expect(params).toEqual(['s', 1, 10]);
  });

  test('with excludeId > adds AND id != ?', () => {
    const { sql, params } = buildFindOverlappingAssignments('s', 1, 10, 'sched-1');
    expect(sql).toMatch(/id != \?/);
    expect(params).toContain('sched-1');
  });

  test('without excludeId > no id != clause', () => {
    const { sql } = buildFindOverlappingAssignments('s', 1, 10);
    expect(sql).not.toMatch(/id != \?/);
  });

  test('validates weekday and hour', () => {
    expect(() => buildFindOverlappingAssignments('s', 9, 10)).toThrow(/weekday/i);
    expect(() => buildFindOverlappingAssignments('s', 1, 99)).toThrow(/hour/i);
  });
});
