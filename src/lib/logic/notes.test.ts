/**
 * Notes and action-item tests.
 *
 * `sanitiseHtml` and `htmlToLines` have two code paths: a DOMParser path in the browser and
 * a stricter regex fallback on the server. These tests run in Node, so they cover the
 * FALLBACK path; the DOM path is asserted against the real browser in `probes/e2e.probe.ts`
 * (see the "notes editor" group), including the XSS paste cases.
 */

import { describe, expect, it } from 'vitest';
import type { ActionItem, Contact, Decision, Meeting, Note } from '../types';
import {
	buildSummary,
	completionRate,
	escapeHtml,
	filterActionItems,
	groupByStatus,
	htmlToLines,
	htmlToText,
	initialsOf,
	isOverdue,
	makeId,
	sanitiseHtml,
	suggestActionFromLine,
	summaryToText,
	textToHtml,
	wordCount
} from './notes';

const CONTACTS: Contact[] = [
	{
		id: 'c-priya',
		name: 'Priya Sharma',
		email: 'priya@northwind.studio',
		title: 'Design lead',
		hue: 0,
		timezone: 'Asia/Kolkata',
		workingHours: { start: 9, end: 18 }
	},
	{
		id: 'c-marcus',
		name: 'Marcus Webb',
		email: 'marcus@northwind.studio',
		title: 'Engineering manager',
		hue: 1,
		timezone: 'Europe/London',
		workingHours: { start: 9, end: 17 }
	}
];

function makeAction(overrides: Partial<ActionItem> = {}): ActionItem {
	return {
		id: 'a-1',
		meetingId: 'm-1',
		title: 'Send the revised quote',
		assigneeId: 'c-priya',
		dueDate: '2026-03-06',
		priority: 'medium',
		status: 'todo',
		createdAt: '2026-03-02T10:00:00.000Z',
		...overrides
	};
}

describe('escapeHtml', () => {
	it('escapes every dangerous character', () => {
		expect(escapeHtml('<script>alert("x")</script>')).toBe(
			'&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
		);
		expect(escapeHtml("Tom & Jerry's")).toBe('Tom &amp; Jerry&#39;s');
	});

	it('leaves emoji and non-Latin text intact', () => {
		expect(escapeHtml('Diwali 🎉 தமிழ்')).toBe('Diwali 🎉 தமிழ்');
	});
});

describe('sanitiseHtml (server fallback)', () => {
	it('strips script and style blocks with their contents', () => {
		const dirty = '<p>Safe</p><script>steal()</script><style>body{display:none}</style>';
		const clean = sanitiseHtml(dirty);
		expect(clean).toContain('Safe');
		expect(clean).not.toContain('steal()');
		expect(clean).not.toContain('display:none');
	});

	it('removes iframes and embedded objects', () => {
		const clean = sanitiseHtml('<p>Hi</p><iframe src="https://evil.test"></iframe>');
		expect(clean).not.toContain('iframe');
		expect(clean).toContain('Hi');
	});

	it('keeps basic formatting tags', () => {
		const clean = sanitiseHtml('<p>A <strong>bold</strong> and <em>italic</em> note</p>');
		expect(clean).toContain('<strong>');
		expect(clean).toContain('<em>');
	});

	it('returns empty string for empty or whitespace input', () => {
		expect(sanitiseHtml('')).toBe('');
		expect(sanitiseHtml('   ')).toBe('');
	});
});

describe('htmlToLines', () => {
	it('splits block elements into lines', () => {
		expect(htmlToLines('<p>First line</p><p>Second line</p>')).toEqual([
			'First line',
			'Second line'
		]);
	});

	it('splits list items', () => {
		expect(htmlToLines('<ul><li>Ship the beta</li><li>Write the docs</li></ul>')).toEqual([
			'Ship the beta',
			'Write the docs'
		]);
	});

	it('treats <br> as a line break', () => {
		expect(htmlToLines('<p>One<br>Two</p>')).toEqual(['One', 'Two']);
	});

	it('drops empty lines', () => {
		expect(htmlToLines('<p>Real</p><p></p><p><br></p><p>  </p>')).toEqual(['Real']);
	});

	it('decodes entities back to characters', () => {
		expect(htmlToLines('<p>Tom &amp; Jerry&#39;s &quot;plan&quot;</p>')).toEqual([
			'Tom & Jerry\'s "plan"'
		]);
	});

	it('returns an empty array for empty notes', () => {
		expect(htmlToLines('')).toEqual([]);
		expect(htmlToLines('<p><br></p>')).toEqual([]);
	});

	it('preserves emoji and Tamil/Devanagari text', () => {
		expect(htmlToLines('<p>Launch 🚀 தமிழ் परीक्षण</p>')).toEqual(['Launch 🚀 தமிழ் परीक्षण']);
	});
});

describe('textToHtml / htmlToText round trip', () => {
	it('round-trips multi-line plain text', () => {
		const text = 'First line\nSecond line\nThird line';
		expect(htmlToText(textToHtml(text))).toBe(text);
	});

	it('escapes HTML inside plain text instead of executing it', () => {
		const html = textToHtml('<script>alert(1)</script>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).not.toContain('<script>');
	});
});

describe('wordCount', () => {
	it('counts words across blocks', () => {
		expect(wordCount('<p>One two three</p><p>four</p>')).toBe(4);
	});

	it('returns zero for empty notes', () => {
		expect(wordCount('')).toBe(0);
		expect(wordCount('<p><br></p>')).toBe(0);
	});
});

describe('suggestActionFromLine', () => {
	it('strips bullets and TODO markers', () => {
		expect(suggestActionFromLine('- Send the revised quote', CONTACTS).title).toBe(
			'Send the revised quote'
		);
		expect(suggestActionFromLine('TODO: Book the venue', CONTACTS).title).toBe('Book the venue');
		expect(suggestActionFromLine('• Review the designs', CONTACTS).title).toBe(
			'Review the designs'
		);
		expect(suggestActionFromLine('Action item: Ship it', CONTACTS).title).toBe('Ship it');
	});

	it('resolves an @mention to a contact and removes it from the title', () => {
		const s = suggestActionFromLine('@Priya to send the revised quote', CONTACTS);
		expect(s.assigneeId).toBe('c-priya');
		expect(s.title).toBe('to send the revised quote');
	});

	it('matches a full name mention', () => {
		expect(suggestActionFromLine('@Marcus Webb owns the migration', CONTACTS).assigneeId).toBe(
			'c-marcus'
		);
	});

	it('leaves the assignee unset when the mention matches nobody', () => {
		const s = suggestActionFromLine('@Nobody does the thing', CONTACTS);
		expect(s.assigneeId).toBeNull();
		expect(s.title).toContain('@Nobody');
	});

	it('detects urgency keywords', () => {
		expect(suggestActionFromLine('Fix the login bug ASAP', CONTACTS).priority).toBe('high');
		expect(suggestActionFromLine('Tidy the backlog, nice to have', CONTACTS).priority).toBe('low');
		expect(suggestActionFromLine('Write the summary', CONTACTS).priority).toBe('medium');
	});

	it('survives an empty line', () => {
		expect(suggestActionFromLine('', CONTACTS).title).toBe('');
	});
});

describe('filterActionItems', () => {
	const today = '2026-03-04';
	const items: ActionItem[] = [
		makeAction({ id: 'a1', status: 'todo', dueDate: '2026-03-02', assigneeId: 'c-priya' }),
		makeAction({ id: 'a2', status: 'in-progress', dueDate: '2026-03-04', assigneeId: 'c-marcus' }),
		makeAction({ id: 'a3', status: 'done', dueDate: '2026-03-01', assigneeId: 'c-priya' }),
		makeAction({ id: 'a4', status: 'todo', dueDate: '2026-03-09', assigneeId: null, meetingId: 'm-2' }),
		// a5 is deliberately undated AND unassigned, so it exercises the "no due date" and
		// "unassigned" paths without quietly joining the c-priya fixtures above.
		makeAction({ id: 'a5', status: 'todo', dueDate: null, priority: 'high', assigneeId: null })
	];

	it('returns everything with no filters', () => {
		expect(filterActionItems(items, {}, today)).toHaveLength(5);
	});

	it('filters by status', () => {
		expect(filterActionItems(items, { status: 'todo' }, today).map((i) => i.id)).toEqual([
			'a1',
			'a4',
			'a5'
		]);
	});

	it('filters by assignee', () => {
		expect(filterActionItems(items, { assigneeId: 'c-priya' }, today).map((i) => i.id)).toEqual([
			'a1',
			'a3'
		]);
	});

	it('filters by meeting', () => {
		expect(filterActionItems(items, { meetingId: 'm-2' }, today).map((i) => i.id)).toEqual(['a4']);
	});

	it('filters overdue items and excludes completed ones', () => {
		// a1 is overdue and open; a3 is past its date but done, so it is NOT overdue.
		expect(filterActionItems(items, { due: 'overdue' }, today).map((i) => i.id)).toEqual(['a1']);
	});

	it('filters items due today', () => {
		expect(filterActionItems(items, { due: 'today' }, today).map((i) => i.id)).toEqual(['a2']);
	});

	it('filters items due this week, excluding overdue', () => {
		expect(filterActionItems(items, { due: 'week' }, today).map((i) => i.id)).toEqual(['a2', 'a4']);
	});

	it('excludes undated items from every due filter', () => {
		for (const due of ['overdue', 'today', 'week'] as const) {
			expect(filterActionItems(items, { due }, today).map((i) => i.id)).not.toContain('a5');
		}
	});

	it('searches titles case-insensitively', () => {
		expect(filterActionItems(items, { search: 'REVISED' }, today)).toHaveLength(5);
		expect(filterActionItems(items, { search: 'nothing-matches' }, today)).toHaveLength(0);
	});

	it('combines filters', () => {
		const result = filterActionItems(items, { status: 'todo', assigneeId: 'c-priya' }, today);
		expect(result.map((i) => i.id)).toEqual(['a1']);
	});
});

describe('isOverdue', () => {
	it('is true only for open items past their date', () => {
		expect(isOverdue(makeAction({ dueDate: '2026-03-01', status: 'todo' }), '2026-03-04')).toBe(true);
		expect(isOverdue(makeAction({ dueDate: '2026-03-01', status: 'done' }), '2026-03-04')).toBe(false);
		expect(isOverdue(makeAction({ dueDate: '2026-03-04', status: 'todo' }), '2026-03-04')).toBe(false);
		expect(isOverdue(makeAction({ dueDate: null }), '2026-03-04')).toBe(false);
	});
});

describe('groupByStatus', () => {
	it('returns all three columns even when some are empty', () => {
		const groups = groupByStatus([makeAction({ id: 'a1', status: 'todo' })]);
		expect(Object.keys(groups)).toEqual(['todo', 'in-progress', 'done']);
		expect(groups.todo).toHaveLength(1);
		expect(groups['in-progress']).toEqual([]);
		expect(groups.done).toEqual([]);
	});
});

describe('completionRate', () => {
	it('returns null when there is nothing to measure', () => {
		expect(completionRate([])).toBeNull();
	});

	it('computes a rounded percentage', () => {
		expect(
			completionRate([
				makeAction({ id: '1', status: 'done' }),
				makeAction({ id: '2', status: 'todo' })
			])
		).toBe(50);
		expect(
			completionRate([
				makeAction({ id: '1', status: 'done' }),
				makeAction({ id: '2', status: 'done' }),
				makeAction({ id: '3', status: 'todo' })
			])
		).toBe(67);
	});
});

describe('buildSummary', () => {
	const meeting: Meeting = {
		id: 'm-1',
		title: 'Q2 planning',
		description: 'Lock the roadmap',
		startsAt: '2026-03-02T09:00:00.000Z',
		durationMinutes: 60,
		timezone: 'UTC',
		recurrence: { freq: 'none', interval: 1 },
		exceptions: [],
		participants: [
			{ contactId: 'c-priya', role: 'host', attended: true },
			{ contactId: 'c-marcus', role: 'participant', attended: false }
		],
		agenda: [
			{ id: 't1', title: 'Review Q1', minutes: 20, covered: true },
			{ id: 't2', title: 'Plan Q2', minutes: 40, covered: false }
		],
		code: 'QJD-4417',
		status: 'completed',
		colour: 0,
		createdAt: '2026-02-01T00:00:00.000Z',
		endedAt: '2026-03-02T09:45:00.000Z',
		actualMinutes: 45
	};

	const notes: Note[] = [
		{
			id: 'n-1',
			meetingId: 'm-1',
			html: '<p>Agreed to ship the beta first</p>',
			updatedAt: '2026-03-02T09:40:00.000Z',
			authorId: 'c-priya'
		}
	];
	const decisions: Decision[] = [
		{
			id: 'd-1',
			meetingId: 'm-1',
			text: 'Ship the beta before the conference',
			decidedAt: '2026-03-02T09:30:00.000Z',
			decidedBy: 'c-priya'
		}
	];
	const actionItems = [
		makeAction({ id: 'a1', meetingId: 'm-1', status: 'done' }),
		makeAction({ id: 'a2', meetingId: 'm-1', status: 'todo' }),
		makeAction({ id: 'a3', meetingId: 'm-other', status: 'todo' })
	];

	it('summarises attendance, agenda, decisions and actions', () => {
		const s = buildSummary(meeting, { contacts: CONTACTS, notes, decisions, actionItems });
		expect(s.durationMinutes).toBe(45);
		expect(s.scheduledMinutes).toBe(60);
		expect(s.topicsCovered).toBe(1);
		expect(s.topicsTotal).toBe(2);
		expect(s.attendees).toHaveLength(2);
		expect(s.attendanceRate).toBe(50);
		expect(s.decisions).toHaveLength(1);
		expect(s.noteWords).toBe(6);
	});

	it('only counts action items belonging to this meeting', () => {
		const s = buildSummary(meeting, { contacts: CONTACTS, notes, decisions, actionItems });
		expect(s.actionItems.map((a) => a.id)).toEqual(['a1', 'a2']);
		expect(s.openActionItems).toBe(1);
	});

	it('falls back to the scheduled duration when the meeting was never ended', () => {
		const neverEnded = { ...meeting, endedAt: undefined, actualMinutes: undefined };
		const s = buildSummary(neverEnded, { contacts: CONTACTS, notes, decisions, actionItems });
		expect(s.durationMinutes).toBe(60);
	});

	it('handles a meeting with no notes, decisions or attendees', () => {
		const bare = { ...meeting, participants: [], agenda: [] };
		const s = buildSummary(bare, { contacts: CONTACTS, notes: [], decisions: [], actionItems: [] });
		expect(s.notes).toBeNull();
		expect(s.noteWords).toBe(0);
		expect(s.attendanceRate).toBeNull();
		expect(s.topicsTotal).toBe(0);
	});

	it('skips participants whose contact record is gone', () => {
		const ghost = {
			...meeting,
			participants: [{ contactId: 'c-deleted', role: 'participant' as const, attended: true }]
		};
		const s = buildSummary(ghost, { contacts: CONTACTS, notes, decisions, actionItems });
		expect(s.attendees).toHaveLength(0);
		expect(s.attendanceRate).toBeNull();
	});

	it('renders a plain-text summary with every section', () => {
		const s = buildSummary(meeting, { contacts: CONTACTS, notes, decisions, actionItems });
		const text = summaryToText(s, 'UTC');
		expect(text).toContain('Q2 planning');
		expect(text).toContain('AGENDA');
		expect(text).toContain('[x] Review Q1');
		expect(text).toContain('[ ] Plan Q2');
		expect(text).toContain('DECISIONS');
		expect(text).toContain('Ship the beta before the conference');
		expect(text).toContain('ACTION ITEMS');
		expect(text).toContain('NOTES');
		expect(text).toContain('Attendance: 1/2');
	});
});

describe('makeId', () => {
	it('prefixes and never collides across rapid calls', () => {
		const ids = new Set(Array.from({ length: 500 }, () => makeId('m')));
		expect(ids.size).toBe(500);
		expect([...ids][0].startsWith('m-')).toBe(true);
	});
});

describe('initialsOf', () => {
	it('takes the first letter of the first two words', () => {
		expect(initialsOf('Priya Sharma')).toBe('PS');
		expect(initialsOf('Marcus Webb')).toBe('MW');
	});

	it('handles one-word, extra-space and three-word names', () => {
		expect(initialsOf('Cher')).toBe('C');
		expect(initialsOf('  Ana   Lima  ')).toBe('AL');
		expect(initialsOf('Maria del Carmen')).toBe('MD');
	});

	it('handles non-Latin names and emoji without splitting a code point', () => {
		expect(initialsOf('தமிழ் அரசு')).toBe('தஅ');
		expect(initialsOf('🎉 Party')).toBe('🎉P');
	});

	it('falls back to ? for an empty name', () => {
		expect(initialsOf('')).toBe('?');
		expect(initialsOf('   ')).toBe('?');
	});
});
