/**
 * Scheduling tests: recurrence, conflicts, agenda timing, codes and .ics.
 *
 * Every test builds its own meetings through `makeMeeting`, so no test can be affected by
 * another one's data.
 */

import { describe, expect, it } from 'vitest';
import type { Contact, Meeting, Recurrence } from '../types';
import { addMinutes, civilDateOf, timeOfDay } from './time';
import {
	MAX_OCCURRENCES,
	agendaOffsets,
	agendaTiming,
	availabilityFor,
	buildIcs,
	currentTopicIndex,
	describeRecurrence,
	expandOccurrences,
	findConflicts,
	generateCode,
	intervalsOverlap,
	isLive,
	isPast,
	isValidEmail,
	meetingLink,
	normaliseCode,
	occurrencesInRange,
	occurrencesOnDate,
	overlapMinutes,
	reorder,
	validateDraft
} from './schedule';

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
	return {
		id: overrides.id ?? 'm-test',
		title: 'Test meeting',
		description: '',
		startsAt: '2026-03-02T09:00:00.000Z',
		durationMinutes: 60,
		timezone: 'UTC',
		recurrence: { freq: 'none', interval: 1 },
		exceptions: [],
		participants: [],
		agenda: [],
		code: 'QJD-4417',
		status: 'scheduled',
		colour: 0,
		createdAt: '2026-02-01T00:00:00.000Z',
		...overrides
	};
}

const YEAR = ['2026-01-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z'] as const;

describe('expandOccurrences - non-recurring', () => {
	it('returns exactly one occurrence', () => {
		const occ = expandOccurrences(makeMeeting(), ...YEAR);
		expect(occ).toHaveLength(1);
		expect(occ[0].startsAt).toBe('2026-03-02T09:00:00.000Z');
		expect(occ[0].endsAt).toBe('2026-03-02T10:00:00.000Z');
		expect(occ[0].index).toBe(0);
	});

	it('returns nothing outside the requested window', () => {
		const occ = expandOccurrences(
			makeMeeting(),
			'2026-04-01T00:00:00.000Z',
			'2026-05-01T00:00:00.000Z'
		);
		expect(occ).toHaveLength(0);
	});

	it('includes a meeting already in progress at the window start', () => {
		// Window opens at 09:30; a 09:00-10:00 meeting is still running and must be included.
		const occ = expandOccurrences(
			makeMeeting(),
			'2026-03-02T09:30:00.000Z',
			'2026-03-02T11:00:00.000Z'
		);
		expect(occ).toHaveLength(1);
	});

	it('omits cancelled meetings entirely', () => {
		const occ = expandOccurrences(makeMeeting({ status: 'cancelled' }), ...YEAR);
		expect(occ).toHaveLength(0);
	});
});

describe('expandOccurrences - daily', () => {
	it('produces consecutive days', () => {
		const occ = expandOccurrences(
			makeMeeting({ recurrence: { freq: 'daily', interval: 1, count: 5 } }),
			...YEAR
		);
		expect(occ).toHaveLength(5);
		expect(occ.map((o) => civilDateOf(o.startsAt, 'UTC'))).toEqual([
			'2026-03-02',
			'2026-03-03',
			'2026-03-04',
			'2026-03-05',
			'2026-03-06'
		]);
	});

	it('honours an interval greater than one', () => {
		const occ = expandOccurrences(
			makeMeeting({ recurrence: { freq: 'daily', interval: 3, count: 3 } }),
			...YEAR
		);
		expect(occ.map((o) => civilDateOf(o.startsAt, 'UTC'))).toEqual([
			'2026-03-02',
			'2026-03-05',
			'2026-03-08'
		]);
	});

	it('keeps the wall clock stable across a DST change', () => {
		// THE regression test for "+86400000": a 09:00 New York standup must stay 09:00 on
		// every side of the 8 March 2026 spring-forward, even though the UTC hour changes.
		const occ = expandOccurrences(
			makeMeeting({
				startsAt: '2026-03-06T14:00:00.000Z', // 09:00 EST
				timezone: 'America/New_York',
				recurrence: { freq: 'daily', interval: 1, count: 6 }
			}),
			...YEAR
		);
		expect(occ).toHaveLength(6);
		for (const o of occ) {
			expect(timeOfDay(o.startsAt, 'America/New_York')).toBe('09:00');
		}
		// And the underlying instants really did shift by an hour, proving it was re-resolved.
		expect(occ[0].startsAt).toBe('2026-03-06T14:00:00.000Z');
		expect(occ[5].startsAt).toBe('2026-03-11T13:00:00.000Z');
	});

	it('caps an open-ended series', () => {
		const occ = expandOccurrences(
			makeMeeting({ recurrence: { freq: 'daily', interval: 1 } }),
			'2026-01-01T00:00:00.000Z',
			'2040-01-01T00:00:00.000Z'
		);
		expect(occ.length).toBeLessThanOrEqual(MAX_OCCURRENCES);
		expect(occ.length).toBeGreaterThan(100);
	});
});

describe('expandOccurrences - weekly and monthly', () => {
	it('produces the same weekday every week', () => {
		const occ = expandOccurrences(
			makeMeeting({ recurrence: { freq: 'weekly', interval: 1, count: 4 } }),
			...YEAR
		);
		expect(occ.map((o) => civilDateOf(o.startsAt, 'UTC'))).toEqual([
			'2026-03-02',
			'2026-03-09',
			'2026-03-16',
			'2026-03-23'
		]);
	});

	it('handles fortnightly', () => {
		const occ = expandOccurrences(
			makeMeeting({ recurrence: { freq: 'weekly', interval: 2, count: 3 } }),
			...YEAR
		);
		expect(occ.map((o) => civilDateOf(o.startsAt, 'UTC'))).toEqual([
			'2026-03-02',
			'2026-03-16',
			'2026-03-30'
		]);
	});

	it('produces the same day each month', () => {
		const occ = expandOccurrences(
			makeMeeting({
				startsAt: '2026-01-15T09:00:00.000Z',
				recurrence: { freq: 'monthly', interval: 1, count: 4 }
			}),
			...YEAR
		);
		expect(occ.map((o) => civilDateOf(o.startsAt, 'UTC'))).toEqual([
			'2026-01-15',
			'2026-02-15',
			'2026-03-15',
			'2026-04-15'
		]);
	});

	it('clamps a month-end series instead of skipping February', () => {
		// "Monthly on the 31st" is the classic calendar bug. February must become the 28th
		// (or 29th in a leap year), and the series must NOT drift to the 3rd of March.
		const occ = expandOccurrences(
			makeMeeting({
				startsAt: '2026-01-31T09:00:00.000Z',
				recurrence: { freq: 'monthly', interval: 1, count: 4 }
			}),
			...YEAR
		);
		expect(occ.map((o) => civilDateOf(o.startsAt, 'UTC'))).toEqual([
			'2026-01-31',
			'2026-02-28',
			'2026-03-31',
			'2026-04-30'
		]);
	});

	it('clamps to 29 February in a leap year', () => {
		const occ = expandOccurrences(
			makeMeeting({
				startsAt: '2024-01-31T09:00:00.000Z',
				recurrence: { freq: 'monthly', interval: 1, count: 2 }
			}),
			'2024-01-01T00:00:00.000Z',
			'2025-01-01T00:00:00.000Z'
		);
		expect(civilDateOf(occ[1].startsAt, 'UTC')).toBe('2024-02-29');
	});
});

describe('expandOccurrences - limits and exceptions', () => {
	it('stops at the until date', () => {
		const occ = expandOccurrences(
			makeMeeting({ recurrence: { freq: 'daily', interval: 1, until: '2026-03-04' } }),
			...YEAR
		);
		expect(occ.map((o) => civilDateOf(o.startsAt, 'UTC'))).toEqual([
			'2026-03-02',
			'2026-03-03',
			'2026-03-04'
		]);
	});

	it('drops a cancelled occurrence but keeps the rest of the series', () => {
		const occ = expandOccurrences(
			makeMeeting({
				recurrence: { freq: 'daily', interval: 1, count: 4 },
				exceptions: [{ originalStart: '2026-03-03T09:00:00.000Z', newStart: null }]
			}),
			...YEAR
		);
		expect(occ.map((o) => civilDateOf(o.startsAt, 'UTC'))).toEqual([
			'2026-03-02',
			'2026-03-04',
			'2026-03-05'
		]);
	});

	it('moves a single occurrence and remembers where it came from', () => {
		const occ = expandOccurrences(
			makeMeeting({
				recurrence: { freq: 'weekly', interval: 1, count: 3 },
				exceptions: [
					{ originalStart: '2026-03-09T09:00:00.000Z', newStart: '2026-03-10T15:00:00.000Z' }
				]
			}),
			...YEAR
		);
		expect(occ.map((o) => o.startsAt)).toEqual([
			'2026-03-02T09:00:00.000Z',
			'2026-03-10T15:00:00.000Z',
			'2026-03-16T09:00:00.000Z'
		]);
		expect(occ[1].originalStart).toBe('2026-03-09T09:00:00.000Z');
		// The moved occurrence's end time follows its new start.
		expect(occ[1].endsAt).toBe('2026-03-10T16:00:00.000Z');
	});
});

describe('occurrencesOnDate', () => {
	it('groups by the viewer zone, including a late-night meeting', () => {
		// 2026-03-02T19:00Z is 3 March 00:30 in Kolkata, so it belongs to the 3rd there.
		const meetings = [
			makeMeeting({ id: 'a', startsAt: '2026-03-02T19:00:00.000Z' }),
			makeMeeting({ id: 'b', startsAt: '2026-03-02T05:00:00.000Z' })
		];
		const utcDay = occurrencesOnDate(meetings, '2026-03-02', 'UTC');
		expect(utcDay.map((o) => o.meetingId).sort()).toEqual(['a', 'b']);

		const istDay2 = occurrencesOnDate(meetings, '2026-03-02', 'Asia/Kolkata');
		const istDay3 = occurrencesOnDate(meetings, '2026-03-03', 'Asia/Kolkata');
		expect(istDay2.map((o) => o.meetingId)).toEqual(['b']);
		expect(istDay3.map((o) => o.meetingId)).toEqual(['a']);
	});

	it('returns an empty array for a day with nothing on it', () => {
		expect(occurrencesOnDate([makeMeeting()], '2026-06-01', 'UTC')).toEqual([]);
	});
});

describe('occurrencesInRange', () => {
	it('sorts occurrences from several meetings chronologically', () => {
		const meetings = [
			makeMeeting({ id: 'late', startsAt: '2026-03-02T15:00:00.000Z' }),
			makeMeeting({ id: 'early', startsAt: '2026-03-02T08:00:00.000Z' }),
			makeMeeting({ id: 'mid', startsAt: '2026-03-02T11:00:00.000Z' })
		];
		expect(occurrencesInRange(meetings, ...YEAR).map((o) => o.meetingId)).toEqual([
			'early',
			'mid',
			'late'
		]);
	});
});

describe('overlap primitives', () => {
	it('treats back-to-back meetings as NOT overlapping', () => {
		expect(
			intervalsOverlap(
				'2026-03-02T09:00:00.000Z',
				'2026-03-02T10:00:00.000Z',
				'2026-03-02T10:00:00.000Z',
				'2026-03-02T11:00:00.000Z'
			)
		).toBe(false);
	});

	it('detects a partial overlap in both directions', () => {
		const a = ['2026-03-02T09:00:00.000Z', '2026-03-02T10:00:00.000Z'] as const;
		const b = ['2026-03-02T09:30:00.000Z', '2026-03-02T10:30:00.000Z'] as const;
		expect(intervalsOverlap(...a, ...b)).toBe(true);
		expect(intervalsOverlap(...b, ...a)).toBe(true);
		expect(overlapMinutes(...a, ...b)).toBe(30);
	});

	it('detects full containment', () => {
		expect(
			intervalsOverlap(
				'2026-03-02T09:00:00.000Z',
				'2026-03-02T12:00:00.000Z',
				'2026-03-02T10:00:00.000Z',
				'2026-03-02T10:30:00.000Z'
			)
		).toBe(true);
	});

	it('reports zero overlap for disjoint intervals', () => {
		expect(
			overlapMinutes(
				'2026-03-02T09:00:00.000Z',
				'2026-03-02T10:00:00.000Z',
				'2026-03-02T14:00:00.000Z',
				'2026-03-02T15:00:00.000Z'
			)
		).toBe(0);
	});
});

describe('findConflicts', () => {
	it('finds a straightforward double-booking', () => {
		const existing = [makeMeeting({ id: 'standup' })];
		const candidate = makeMeeting({ id: 'review', startsAt: '2026-03-02T09:30:00.000Z' });
		const conflicts = findConflicts(candidate, existing);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].with.meetingId).toBe('standup');
		expect(conflicts[0].overlapMinutes).toBe(30);
	});

	it('reports nothing for back-to-back meetings', () => {
		const existing = [makeMeeting({ id: 'standup' })];
		const candidate = makeMeeting({ id: 'review', startsAt: '2026-03-02T10:00:00.000Z' });
		expect(findConflicts(candidate, existing)).toHaveLength(0);
	});

	it('never reports a meeting as conflicting with itself', () => {
		const meeting = makeMeeting({ id: 'same' });
		expect(findConflicts(meeting, [meeting])).toHaveLength(0);
	});

	it('catches a collision with a LATER occurrence of a weekly series', () => {
		// The series starts 2 March; the candidate is on 23 March. Comparing only startsAt
		// would miss this completely.
		const series = [
			makeMeeting({ id: 'weekly', recurrence: { freq: 'weekly', interval: 1, count: 8 } })
		];
		const candidate = makeMeeting({ id: 'one-off', startsAt: '2026-03-23T09:30:00.000Z' });
		const conflicts = findConflicts(candidate, series);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].with.meetingId).toBe('weekly');
	});

	it('catches a recurring candidate colliding with a one-off meeting', () => {
		const existing = [makeMeeting({ id: 'fixed', startsAt: '2026-03-16T09:15:00.000Z' })];
		const candidate = makeMeeting({
			id: 'new-series',
			recurrence: { freq: 'weekly', interval: 1, count: 6 }
		});
		const conflicts = findConflicts(candidate, existing);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].startsAt).toBe('2026-03-16T09:00:00.000Z');
	});

	it('ignores cancelled meetings', () => {
		const existing = [makeMeeting({ id: 'dead', status: 'cancelled' })];
		const candidate = makeMeeting({ id: 'live', startsAt: '2026-03-02T09:30:00.000Z' });
		expect(findConflicts(candidate, existing)).toHaveLength(0);
	});

	it('does not flag a cancelled occurrence of an otherwise overlapping series', () => {
		const series = [
			makeMeeting({
				id: 'weekly',
				recurrence: { freq: 'weekly', interval: 1, count: 4 },
				exceptions: [{ originalStart: '2026-03-09T09:00:00.000Z', newStart: null }]
			})
		];
		const candidate = makeMeeting({ id: 'one-off', startsAt: '2026-03-09T09:30:00.000Z' });
		expect(findConflicts(candidate, series)).toHaveLength(0);
	});

	it('compares across timezones, not wall clocks', () => {
		// 09:00 UTC and 14:30 Asia/Kolkata (= 09:00 UTC) are the same hour of the day.
		const existing = [makeMeeting({ id: 'utc-call' })];
		const candidate = makeMeeting({
			id: 'ist-call',
			startsAt: '2026-03-02T09:30:00.000Z',
			timezone: 'Asia/Kolkata'
		});
		expect(findConflicts(candidate, existing)).toHaveLength(1);
	});
});

describe('agendaTiming', () => {
	const topics = (...mins: number[]) =>
		mins.map((m, i) => ({ id: `t${i}`, title: `Topic ${i + 1}`, minutes: m }));

	it('reports an exact fit', () => {
		const t = agendaTiming(topics(20, 20, 20), 60);
		expect(t.status).toBe('exact');
		expect(t.allocatedMinutes).toBe(60);
		expect(t.overBy).toBe(0);
		expect(t.remaining).toBe(0);
	});

	it('reports unallocated time', () => {
		const t = agendaTiming(topics(10, 15), 60);
		expect(t.status).toBe('under');
		expect(t.remaining).toBe(35);
		expect(t.message).toContain('35 min unallocated');
	});

	it('reports an over-allocated agenda', () => {
		const t = agendaTiming(topics(30, 30, 30), 60);
		expect(t.status).toBe('over');
		expect(t.overBy).toBe(30);
		expect(t.message).toContain('30 min longer');
	});

	it('handles an empty agenda', () => {
		const t = agendaTiming([], 30);
		expect(t.status).toBe('empty');
		expect(t.allocatedMinutes).toBe(0);
	});

	it('ignores negative allocations instead of crediting time back', () => {
		const t = agendaTiming(topics(30, -10), 30);
		expect(t.allocatedMinutes).toBe(30);
		expect(t.status).toBe('exact');
	});

	it('computes running offsets', () => {
		expect(agendaOffsets(topics(10, 20, 5))).toEqual([0, 10, 30]);
		expect(agendaOffsets([])).toEqual([]);
	});
});

describe('currentTopicIndex', () => {
	const topics = [
		{ id: 'a', title: 'Welcome', minutes: 5 },
		{ id: 'b', title: 'Review', minutes: 20 },
		{ id: 'c', title: 'Next steps', minutes: 10 }
	];

	it('tracks the live topic through the meeting', () => {
		expect(currentTopicIndex(topics, 0)).toBe(0);
		expect(currentTopicIndex(topics, 4)).toBe(0);
		expect(currentTopicIndex(topics, 5)).toBe(1);
		expect(currentTopicIndex(topics, 24)).toBe(1);
		expect(currentTopicIndex(topics, 25)).toBe(2);
		expect(currentTopicIndex(topics, 34)).toBe(2);
	});

	it('returns -1 once the agenda has run out', () => {
		expect(currentTopicIndex(topics, 35)).toBe(-1);
		expect(currentTopicIndex(topics, 120)).toBe(-1);
	});

	it('returns -1 for an empty agenda or a negative elapsed time', () => {
		expect(currentTopicIndex([], 5)).toBe(-1);
		expect(currentTopicIndex(topics, -1)).toBe(-1);
	});
});

describe('reorder', () => {
	it('moves an item forwards and backwards', () => {
		expect(reorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
		expect(reorder(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
	});

	it('is a no-op for the same index and never mutates the input', () => {
		const input = ['a', 'b', 'c'];
		expect(reorder(input, 1, 1)).toEqual(input);
		expect(reorder(input, 0, 2)).not.toBe(input);
		expect(input).toEqual(['a', 'b', 'c']);
	});

	it('clamps an out-of-range target', () => {
		expect(reorder(['a', 'b', 'c'], 0, 99)).toEqual(['b', 'c', 'a']);
		expect(reorder(['a', 'b', 'c'], 99, 0)).toEqual(['a', 'b', 'c']);
	});
});

describe('meeting codes and links', () => {
	it('generates a readable code in the right shape', () => {
		const code = generateCode(() => 0.5);
		expect(code).toMatch(/^[A-Z]{3}-\d{4}$/);
	});

	it('never generates confusable characters', () => {
		// Sweep the whole alphabet deterministically rather than trusting one sample.
		for (let i = 0; i < 100; i++) {
			const code = generateCode(() => i / 100);
			expect(code).not.toMatch(/[IOL01]/);
		}
	});

	it('normalises however the user typed the code', () => {
		expect(normaliseCode('qjd4417')).toBe('QJD-4417');
		expect(normaliseCode('QJD-4417')).toBe('QJD-4417');
		expect(normaliseCode('qjd 4417')).toBe('QJD-4417');
		expect(normaliseCode('  qjd-4417  ')).toBe('QJD-4417');
	});

	it('leaves a partial code alone so the user can keep typing', () => {
		expect(normaliseCode('qjd')).toBe('QJD');
		expect(normaliseCode('')).toBe('');
	});

	it('builds a join link against the current origin', () => {
		expect(meetingLink('QJD-4417', 'https://example.com')).toBe(
			'https://example.com/room/?code=QJD-4417'
		);
		expect(meetingLink('QJD-4417', 'https://example.com/')).toBe(
			'https://example.com/room/?code=QJD-4417'
		);
	});
});

describe('describeRecurrence', () => {
	const cases: [Recurrence, string][] = [
		[{ freq: 'none', interval: 1 }, 'Does not repeat'],
		[{ freq: 'daily', interval: 1 }, 'Every day'],
		[{ freq: 'daily', interval: 3 }, 'Every 3 days'],
		[{ freq: 'weekly', interval: 1, count: 12 }, 'Every week, 12 times'],
		[{ freq: 'monthly', interval: 2 }, 'Every 2 months']
	];

	for (const [rec, expected] of cases) {
		it(`describes ${rec.freq} x${rec.interval} as "${expected}"`, () => {
			expect(describeRecurrence(rec)).toBe(expected);
		});
	}
});

describe('isPast / isLive', () => {
	const occ = {
		startsAt: '2026-03-02T09:00:00.000Z',
		endsAt: '2026-03-02T10:00:00.000Z'
	};

	it('classifies before, during and after', () => {
		expect(isLive(occ, new Date('2026-03-02T08:59:00.000Z'))).toBe(false);
		expect(isLive(occ, new Date('2026-03-02T09:30:00.000Z'))).toBe(true);
		expect(isPast(occ, new Date('2026-03-02T09:30:00.000Z'))).toBe(false);
		expect(isPast(occ, new Date('2026-03-02T10:01:00.000Z'))).toBe(true);
	});

	it('treats the end instant as finished, not live', () => {
		expect(isLive(occ, new Date('2026-03-02T10:00:00.000Z'))).toBe(false);
	});
});

describe('validateDraft', () => {
	const base = {
		title: 'Sprint planning',
		date: '2026-03-02',
		time: '09:00',
		durationMinutes: 60,
		timezone: 'UTC',
		recurrence: { freq: 'none', interval: 1 } as Recurrence,
		participants: [{ contactId: 'c1', role: 'host' as const }],
		agenda: []
	};
	const now = new Date('2026-02-01T00:00:00.000Z');

	it('accepts a well-formed draft', () => {
		const { errors } = validateDraft(base, now);
		expect(errors).toEqual({});
	});

	it('rejects an empty title', () => {
		expect(validateDraft({ ...base, title: '   ' }, now).errors.title).toBeTruthy();
	});

	it('rejects a 141-character title', () => {
		expect(validateDraft({ ...base, title: 'x'.repeat(141) }, now).errors.title).toBeTruthy();
		expect(validateDraft({ ...base, title: 'x'.repeat(140) }, now).errors.title).toBeUndefined();
	});

	it('rejects a zero or negative duration', () => {
		expect(validateDraft({ ...base, durationMinutes: 0 }, now).errors.duration).toBeTruthy();
		expect(validateDraft({ ...base, durationMinutes: -30 }, now).errors.duration).toBeTruthy();
	});

	it('warns about a past start without blocking it', () => {
		const { errors, warnings } = validateDraft(base, new Date('2026-06-01T00:00:00.000Z'));
		expect(errors.date).toBeUndefined();
		expect(warnings.date).toContain('past');
	});

	it('rejects a recurrence end date before the first meeting', () => {
		const draft = {
			...base,
			recurrence: { freq: 'weekly', interval: 1, until: '2026-02-01' } as Recurrence
		};
		expect(validateDraft(draft, now).errors.recurrence).toBeTruthy();
	});

	it('rejects an agenda topic with no title', () => {
		const draft = { ...base, agenda: [{ id: 't1', title: '  ', minutes: 10 }] };
		expect(validateDraft(draft, now).errors.agenda).toBeTruthy();
	});

	it('warns when the agenda is longer than the meeting', () => {
		const draft = {
			...base,
			agenda: [
				{ id: 't1', title: 'Long topic', minutes: 50 },
				{ id: 't2', title: 'Another', minutes: 40 }
			]
		};
		expect(validateDraft(draft, now).warnings.agenda).toContain('longer');
	});

	it('warns when nobody is invited', () => {
		expect(validateDraft({ ...base, participants: [] }, now).warnings.participants).toBeTruthy();
	});
});

describe('isValidEmail', () => {
	it('accepts real addresses', () => {
		for (const email of ['a@b.co', 'priya.sharma@northwind.studio', 'x+tag@sub.domain.org']) {
			expect(isValidEmail(email)).toBe(true);
		}
	});

	it('rejects malformed addresses', () => {
		for (const email of ['', 'nope', 'a@b', 'a b@c.com', '@b.com', 'a@.com']) {
			expect(isValidEmail(email)).toBe(false);
		}
	});
});

describe('availabilityFor', () => {
	const contact: Contact = {
		id: 'c1',
		name: 'Priya Sharma',
		email: 'priya@example.com',
		title: 'Design lead',
		hue: 0,
		timezone: 'Asia/Kolkata',
		workingHours: { start: 9, end: 18 }
	};

	it('reports free inside working hours with nothing booked', () => {
		// 05:00 UTC = 10:30 IST.
		expect(availabilityFor(contact, '2026-03-02T05:00:00.000Z', 30, [])).toBe('free');
	});

	it('reports outside-hours for a late-night slot in the contact zone', () => {
		// 19:00 UTC = 00:30 IST the next day.
		expect(availabilityFor(contact, '2026-03-02T19:00:00.000Z', 30, [])).toBe('outside-hours');
	});

	it('reports outside-hours when the meeting would run past the end of the day', () => {
		// 12:00 UTC = 17:30 IST; a 60-minute meeting ends 18:30, past the 18:00 close.
		expect(availabilityFor(contact, '2026-03-02T12:00:00.000Z', 60, [])).toBe('outside-hours');
	});

	it('reports busy when the contact is already in a meeting', () => {
		const existing = [
			makeMeeting({
				id: 'busy',
				startsAt: '2026-03-02T05:00:00.000Z',
				participants: [{ contactId: 'c1', role: 'participant' }]
			})
		];
		expect(availabilityFor(contact, '2026-03-02T05:30:00.000Z', 30, existing)).toBe('busy');
	});

	it('ignores meetings the contact is not part of', () => {
		const existing = [
			makeMeeting({
				id: 'other',
				startsAt: '2026-03-02T05:00:00.000Z',
				participants: [{ contactId: 'someone-else', role: 'participant' }]
			})
		];
		expect(availabilityFor(contact, '2026-03-02T05:30:00.000Z', 30, existing)).toBe('free');
	});
});

describe('buildIcs', () => {
	const contacts: Contact[] = [
		{
			id: 'c1',
			name: 'Priya Sharma',
			email: 'priya@example.com',
			title: 'Design lead',
			hue: 0,
			timezone: 'Asia/Kolkata',
			workingHours: { start: 9, end: 18 }
		}
	];
	const now = new Date('2026-02-01T00:00:00.000Z');

	it('emits a valid single-event calendar', () => {
		const ics = buildIcs(
			makeMeeting({ participants: [{ contactId: 'c1', role: 'host' }] }),
			contacts,
			{ now }
		);
		expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
		expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
		expect(ics).toContain('DTSTART:20260302T090000Z');
		expect(ics).toContain('DTEND:20260302T100000Z');
		expect(ics).toContain('SUMMARY:Test meeting');
		expect(ics).toContain('ATTENDEE;ROLE=CHAIR;CN=Priya Sharma:mailto:priya@example.com');
		// CRLF line endings are required by RFC 5545.
		expect(ics).toContain('\r\n');
	});

	it('emits an RRULE for a recurring meeting only', () => {
		const once = buildIcs(makeMeeting(), contacts, { now });
		expect(once).not.toContain('RRULE');

		const weekly = buildIcs(
			makeMeeting({ recurrence: { freq: 'weekly', interval: 2, count: 10 } }),
			contacts,
			{ now }
		);
		expect(weekly).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=10');
	});

	it('escapes commas, semicolons and newlines in text fields', () => {
		const ics = buildIcs(
			makeMeeting({ title: 'Q3 review; budget, scope', description: 'Line one\nLine two' }),
			contacts,
			{ now }
		);
		expect(ics).toContain('SUMMARY:Q3 review\\; budget\\, scope');
		expect(ics).toContain('Line one\\nLine two');
	});

	it('folds long lines to 75 octets', () => {
		const ics = buildIcs(makeMeeting({ title: 'A'.repeat(200) }), contacts, { now });
		for (const line of ics.split('\r\n')) {
			expect(line.length).toBeLessThanOrEqual(75);
		}
	});

	it('survives emoji and non-Latin text', () => {
		const ics = buildIcs(
			makeMeeting({ title: 'Diwali planning 🎉 தமிழ் सत्र' }),
			contacts,
			{ now }
		);
		expect(ics).toContain('🎉');
		expect(ics).toContain('தமிழ்');
	});
});
