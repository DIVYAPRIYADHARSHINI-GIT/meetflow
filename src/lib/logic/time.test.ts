/**
 * Timezone / civil-date tests.
 *
 * These are the highest-risk functions in the app: every meeting time, recurrence,
 * conflict check and calendar cell is computed from them. Each test builds its own inputs.
 */

import { describe, expect, it } from 'vitest';
import {
	addDays,
	addMinutes,
	addMonths,
	civilDateOf,
	daysInMonth,
	diffDays,
	formatDuration,
	instantFromZoned,
	isValidTimezone,
	minutesBetween,
	minutesOfDay,
	monthGrid,
	startOfMonth,
	startOfWeek,
	timeOfDay,
	weekdayOf,
	zoneLabel,
	zoneOffsetMinutes,
	zonedParts
} from './time';

describe('zone offsets', () => {
	it('resolves a fixed +05:30 zone', () => {
		expect(zoneOffsetMinutes('2026-03-02T09:00:00.000Z', 'Asia/Kolkata')).toBe(330);
	});

	it('resolves UTC as zero all year', () => {
		expect(zoneOffsetMinutes('2026-01-15T00:00:00.000Z', 'UTC')).toBe(0);
		expect(zoneOffsetMinutes('2026-07-15T00:00:00.000Z', 'UTC')).toBe(0);
	});

	it('tracks US daylight saving across the boundary', () => {
		// 2026 US DST starts 8 March. Before: EST (-300). After: EDT (-240).
		expect(zoneOffsetMinutes('2026-03-01T12:00:00.000Z', 'America/New_York')).toBe(-300);
		expect(zoneOffsetMinutes('2026-03-15T12:00:00.000Z', 'America/New_York')).toBe(-240);
	});

	it('tracks southern-hemisphere DST in the opposite direction', () => {
		// Sydney is UTC+11 in January (DST) and UTC+10 in July.
		expect(zoneOffsetMinutes('2026-01-15T00:00:00.000Z', 'Australia/Sydney')).toBe(660);
		expect(zoneOffsetMinutes('2026-07-15T00:00:00.000Z', 'Australia/Sydney')).toBe(600);
	});

	it('labels zones with a readable GMT offset', () => {
		expect(zoneLabel('Asia/Kolkata', '2026-03-02T09:00:00.000Z')).toBe('GMT+5:30');
		expect(zoneLabel('UTC', '2026-03-02T09:00:00.000Z')).toBe('GMT+0');
		expect(zoneLabel('America/New_York', '2026-01-02T09:00:00.000Z')).toBe('GMT-5');
	});

	it('validates zone names', () => {
		expect(isValidTimezone('Asia/Kolkata')).toBe(true);
		expect(isValidTimezone('Mars/Olympus_Mons')).toBe(false);
	});
});

describe('instantFromZoned', () => {
	it('round-trips a wall clock through an instant in a fixed-offset zone', () => {
		const instant = instantFromZoned('2026-03-02', 9, 30, 'Asia/Kolkata');
		expect(instant).toBe('2026-03-02T04:00:00.000Z');
		expect(timeOfDay(instant, 'Asia/Kolkata')).toBe('09:30');
		expect(civilDateOf(instant, 'Asia/Kolkata')).toBe('2026-03-02');
	});

	it('keeps the same wall clock either side of a DST change', () => {
		// A 09:00 New York meeting is 09:00 in both March (EST) and April (EDT), even though
		// the UTC instants are an hour apart. This is the test that catches "+24h" recurrence.
		const before = instantFromZoned('2026-03-01', 9, 0, 'America/New_York');
		const after = instantFromZoned('2026-04-01', 9, 0, 'America/New_York');
		expect(before).toBe('2026-03-01T14:00:00.000Z');
		expect(after).toBe('2026-04-01T13:00:00.000Z');
		expect(timeOfDay(before, 'America/New_York')).toBe('09:00');
		expect(timeOfDay(after, 'America/New_York')).toBe('09:00');
	});

	it('resolves midnight without rolling to the previous day', () => {
		const instant = instantFromZoned('2026-03-02', 0, 0, 'Asia/Kolkata');
		expect(civilDateOf(instant, 'Asia/Kolkata')).toBe('2026-03-02');
		expect(minutesOfDay(instant, 'Asia/Kolkata')).toBe(0);
	});

	it('resolves a late-night time that crosses UTC midnight', () => {
		// 23:30 IST on 2 March is 18:00 UTC on 2 March; 01:30 IST on 3 March is 20:00 UTC on
		// the 2nd. The civil date must follow the MEETING zone, not UTC.
		const late = instantFromZoned('2026-03-03', 1, 30, 'Asia/Kolkata');
		expect(late).toBe('2026-03-02T20:00:00.000Z');
		expect(civilDateOf(late, 'Asia/Kolkata')).toBe('2026-03-03');
		expect(civilDateOf(late, 'UTC')).toBe('2026-03-02');
	});

	it('pushes a non-existent spring-forward time into the new offset', () => {
		// 2026-03-08 02:30 America/New_York does not exist: clocks jump 02:00 -> 03:00.
		const instant = instantFromZoned('2026-03-08', 2, 30, 'America/New_York');
		expect(timeOfDay(instant, 'America/New_York')).toBe('03:30');
		expect(civilDateOf(instant, 'America/New_York')).toBe('2026-03-08');
	});

	it('resolves an ambiguous fall-back time to one real instant', () => {
		// 2026-11-01 01:30 happens twice in New York. Either is acceptable; it must be ONE
		// valid instant whose wall clock reads 01:30.
		const instant = instantFromZoned('2026-11-01', 1, 30, 'America/New_York');
		expect(timeOfDay(instant, 'America/New_York')).toBe('01:30');
		expect(Number.isNaN(new Date(instant).getTime())).toBe(false);
	});

	it('rejects a malformed civil date', () => {
		expect(() => instantFromZoned('not-a-date', 9, 0, 'UTC')).toThrow();
	});
});

describe('zonedParts', () => {
	it('reports the weekday in the target zone, not UTC', () => {
		// 2026-03-02T19:00Z is Monday in UTC but already Tuesday in Sydney.
		expect(zonedParts('2026-03-02T19:00:00.000Z', 'UTC').weekday).toBe(1);
		expect(zonedParts('2026-03-02T19:00:00.000Z', 'Australia/Sydney').weekday).toBe(2);
	});

	it('throws on an invalid instant rather than returning NaN parts', () => {
		expect(() => zonedParts('definitely-not-a-date', 'UTC')).toThrow();
	});
});

describe('civil date maths', () => {
	it('adds days across a month boundary', () => {
		expect(addDays('2026-01-30', 3)).toBe('2026-02-02');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
	});

	it('adds days across a leap day', () => {
		expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
		expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
		expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
	});

	it('clamps month-end when adding months', () => {
		expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
		expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
		expect(addMonths('2026-01-31', 3)).toBe('2026-04-30');
		expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
		expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
	});

	it('knows month lengths including leap Februaries', () => {
		expect(daysInMonth(2026, 2)).toBe(28);
		expect(daysInMonth(2024, 2)).toBe(29);
		expect(daysInMonth(2026, 12)).toBe(31);
	});

	it('diffs civil dates in whole days', () => {
		expect(diffDays('2026-03-01', '2026-03-08')).toBe(7);
		expect(diffDays('2026-03-08', '2026-03-01')).toBe(-7);
		// Spanning a DST change must still be whole days, not 6.96.
		expect(diffDays('2026-03-07', '2026-03-09')).toBe(2);
	});

	it('finds Monday-based week starts', () => {
		expect(weekdayOf('2026-03-02')).toBe(1);
		expect(startOfWeek('2026-03-05')).toBe('2026-03-02');
		expect(startOfWeek('2026-03-02')).toBe('2026-03-02');
		// Sunday belongs to the week that started the previous Monday.
		expect(startOfWeek('2026-03-08')).toBe('2026-03-02');
	});

	it('builds a 42-cell month grid starting on a Monday', () => {
		const grid = monthGrid('2026-03-15');
		expect(grid).toHaveLength(42);
		expect(startOfMonth('2026-03-15')).toBe('2026-03-01');
		expect(weekdayOf(grid[0])).toBe(1);
		expect(grid).toContain('2026-03-01');
		expect(grid).toContain('2026-03-31');
	});
});

describe('instant maths', () => {
	it('adds minutes absolutely', () => {
		expect(addMinutes('2026-03-02T09:00:00.000Z', 45)).toBe('2026-03-02T09:45:00.000Z');
		expect(addMinutes('2026-03-02T23:30:00.000Z', 60)).toBe('2026-03-03T00:30:00.000Z');
	});

	it('measures minutes between instants', () => {
		expect(minutesBetween('2026-03-02T09:00:00.000Z', '2026-03-02T10:30:00.000Z')).toBe(90);
		expect(minutesBetween('2026-03-02T10:30:00.000Z', '2026-03-02T09:00:00.000Z')).toBe(-90);
	});

	it('formats durations the way the UI shows them', () => {
		expect(formatDuration(30)).toBe('30m');
		expect(formatDuration(60)).toBe('1h');
		expect(formatDuration(90)).toBe('1h 30m');
		expect(formatDuration(0)).toBe('0m');
		expect(formatDuration(-5)).toBe('0m');
	});
});
