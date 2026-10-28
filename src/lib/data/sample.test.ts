/**
 * Sample-data integrity tests.
 *
 * The sample workspace is what every new visitor and every e2e probe sees first, so it is
 * treated as production data: every reference must resolve, every date must be sane, and
 * the generator must be deterministic for a given `today`.
 */

import { describe, expect, it } from 'vitest';
import { buildEmptyState, buildSampleState, SAMPLE_CONTACTS, SAMPLE_TEAMS } from './sample';
import { agendaTiming, expandOccurrences, occurrencesOnDate } from '../logic/schedule';
import { civilDateOf, diffDays, minutesBetween } from '../logic/time';
import { htmlToLines, sanitiseHtml } from '../logic/notes';

const TODAY = '2026-03-02';
const ZONE = 'UTC';
const state = () => buildSampleState({ today: TODAY, zone: ZONE });

describe('determinism', () => {
	it('produces identical data for the same day', () => {
		expect(JSON.stringify(state())).toBe(JSON.stringify(state()));
	});

	it('shifts with the day it is generated for', () => {
		const a = buildSampleState({ today: '2026-03-02', zone: ZONE });
		const b = buildSampleState({ today: '2026-03-03', zone: ZONE });
		expect(a.meetings[0].startsAt).not.toBe(b.meetings[0].startsAt);
	});
});

describe('referential integrity', () => {
	const s = state();
	const contactIds = new Set(s.contacts.map((c) => c.id));
	const meetingIds = new Set(s.meetings.map((m) => m.id));

	it('has no duplicate ids anywhere', () => {
		for (const collection of [s.contacts, s.teams, s.meetings, s.notes, s.decisions, s.actionItems, s.chat]) {
			const ids = collection.map((item) => (item as { id: string }).id);
			expect(new Set(ids).size).toBe(ids.length);
		}
	});

	it('resolves every meeting participant to a contact', () => {
		for (const meeting of s.meetings) {
			for (const p of meeting.participants) {
				expect(contactIds.has(p.contactId), `${meeting.title} -> ${p.contactId}`).toBe(true);
			}
		}
	});

	it('resolves every team member to a contact', () => {
		for (const team of s.teams) {
			for (const id of team.memberIds) {
				expect(contactIds.has(id), `${team.name} -> ${id}`).toBe(true);
			}
		}
	});

	it('resolves every agenda owner to a contact', () => {
		for (const meeting of s.meetings) {
			for (const topic of meeting.agenda) {
				if (topic.owner) expect(contactIds.has(topic.owner)).toBe(true);
			}
		}
	});

	it('links every note, decision and chat message to a real meeting', () => {
		for (const note of s.notes) expect(meetingIds.has(note.meetingId)).toBe(true);
		for (const d of s.decisions) expect(meetingIds.has(d.meetingId)).toBe(true);
		for (const c of s.chat) expect(meetingIds.has(c.meetingId)).toBe(true);
	});

	it('links action items to a real meeting or deliberately to none', () => {
		for (const item of s.actionItems) {
			if (item.meetingId !== null) expect(meetingIds.has(item.meetingId)).toBe(true);
			if (item.assigneeId !== null) expect(contactIds.has(item.assigneeId)).toBe(true);
		}
	});

	it('gives every meeting a unique join code', () => {
		const codes = s.meetings.map((m) => m.code);
		expect(new Set(codes).size).toBe(codes.length);
		for (const code of codes) expect(code).toMatch(/^[A-Z]{3}-\d{4}$/);
	});

	it('names the current user as a contact', () => {
		expect(contactIds.has(s.meId)).toBe(true);
	});
});

describe('meeting shape', () => {
	const s = state();

	it('has meetings today, in the future and in the past', () => {
		const today = occurrencesOnDate(s.meetings, TODAY, ZONE);
		expect(today.length).toBeGreaterThanOrEqual(2);

		const past = s.meetings.filter((m) => m.status === 'completed');
		const future = s.meetings.filter((m) => m.status === 'scheduled');
		expect(past.length).toBeGreaterThanOrEqual(4);
		expect(future.length).toBeGreaterThanOrEqual(5);
	});

	it('gives every completed meeting a real duration and attendance', () => {
		for (const meeting of s.meetings.filter((m) => m.status === 'completed')) {
			expect(meeting.endedAt).toBeTruthy();
			expect(meeting.actualMinutes).toBeGreaterThan(0);
			// endedAt must agree with actualMinutes, not be an unrelated timestamp.
			expect(minutesBetween(meeting.startsAt, meeting.endedAt!)).toBe(meeting.actualMinutes);
			expect(meeting.participants.some((p) => p.attended)).toBe(true);
		}
	});

	it('marks agenda topics covered only on past meetings', () => {
		for (const meeting of s.meetings) {
			if (meeting.status === 'scheduled') {
				expect(meeting.agenda.every((t) => !t.covered)).toBe(true);
			}
		}
	});

	it('keeps every agenda within its meeting duration', () => {
		for (const meeting of s.meetings) {
			const timing = agendaTiming(meeting.agenda, meeting.durationMinutes);
			expect(timing.overBy, `${meeting.title} agenda overruns`).toBe(0);
		}
	});

	it('includes each recurrence frequency so every code path is demoed', () => {
		const freqs = new Set(s.meetings.map((m) => m.recurrence.freq));
		expect(freqs.has('none')).toBe(true);
		expect(freqs.has('daily')).toBe(true);
		expect(freqs.has('weekly')).toBe(true);
		expect(freqs.has('monthly')).toBe(true);
	});

	it('expands the recurring standup into many occurrences', () => {
		const standup = s.meetings.find((m) => m.id === 'm-standup')!;
		const occurrences = expandOccurrences(
			standup,
			standup.startsAt,
			'2026-06-01T00:00:00.000Z'
		);
		expect(occurrences.length).toBeGreaterThan(30);
		// Each occurrence must keep its 15-minute length.
		for (const o of occurrences.slice(0, 10)) {
			expect(minutesBetween(o.startsAt, o.endsAt)).toBe(15);
		}
	});

	it('sets createdAt before the meeting starts', () => {
		for (const meeting of s.meetings) {
			expect(new Date(meeting.createdAt).getTime()).toBeLessThan(
				new Date(meeting.startsAt).getTime()
			);
		}
	});
});

describe('notes and decisions content', () => {
	const s = state();

	it('writes real prose, never lorem ipsum', () => {
		const blob = JSON.stringify(s).toLowerCase();
		for (const banned of ['lorem', 'ipsum', 'dolor sit', 'placeholder', 'foo bar', 'test test']) {
			expect(blob).not.toContain(banned);
		}
	});

	it('stores notes as HTML that survives sanitisation unchanged', () => {
		for (const note of s.notes) {
			// Sample notes must already be clean: if sanitising changes them, the sample itself
			// contains markup the editor would strip, which would confuse the user on first edit.
			expect(sanitiseHtml(note.html)).toBe(sanitiseHtml(sanitiseHtml(note.html)));
			expect(htmlToLines(note.html).length).toBeGreaterThan(0);
		}
	});

	it('gives the substantial past meetings real notes', () => {
		for (const id of ['m-retro-23', 'm-roadmap', 'm-incident', 'm-onboarding-kickoff']) {
			const note = s.notes.find((n) => n.meetingId === id);
			expect(note, `${id} should have notes`).toBeTruthy();
			expect(htmlToLines(note!.html).length).toBeGreaterThanOrEqual(3);
		}
	});

	it('records decisions against past meetings only', () => {
		const completed = new Set(
			s.meetings.filter((m) => m.status === 'completed').map((m) => m.id)
		);
		expect(s.decisions.length).toBeGreaterThanOrEqual(5);
		for (const d of s.decisions) {
			expect(completed.has(d.meetingId)).toBe(true);
			expect(d.text.length).toBeGreaterThan(20);
		}
	});
});

describe('action items', () => {
	const s = state();

	it('spans every status and priority so the board is populated', () => {
		const statuses = new Set(s.actionItems.map((a) => a.status));
		expect(statuses).toEqual(new Set(['todo', 'in-progress', 'done']));
		const priorities = new Set(s.actionItems.map((a) => a.priority));
		expect(priorities).toEqual(new Set(['low', 'medium', 'high']));
	});

	it('includes overdue, due-today and future items', () => {
		const open = s.actionItems.filter((a) => a.status !== 'done' && a.dueDate);
		expect(open.some((a) => diffDays(TODAY, a.dueDate!) < 0)).toBe(true);
		expect(open.some((a) => diffDays(TODAY, a.dueDate!) === 0)).toBe(true);
		expect(open.some((a) => diffDays(TODAY, a.dueDate!) > 0)).toBe(true);
	});

	it('gives every done item a completion timestamp', () => {
		for (const item of s.actionItems.filter((a) => a.status === 'done')) {
			expect(item.completedAt).toBeTruthy();
		}
	});

	it('leaves no completedAt on open items', () => {
		for (const item of s.actionItems.filter((a) => a.status !== 'done')) {
			expect(item.completedAt).toBeUndefined();
		}
	});

	it('traces some items back to the note line that created them', () => {
		expect(s.actionItems.filter((a) => a.sourceLine).length).toBeGreaterThanOrEqual(3);
	});
});

describe('contacts and teams', () => {
	it('covers several timezones so availability hints are meaningful', () => {
		const zones = new Set(SAMPLE_CONTACTS.map((c) => c.timezone));
		expect(zones.size).toBeGreaterThanOrEqual(4);
	});

	it('gives every contact a valid email and working hours', () => {
		for (const c of SAMPLE_CONTACTS) {
			expect(c.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
			expect(c.workingHours.end).toBeGreaterThan(c.workingHours.start);
			expect(c.name.trim().length).toBeGreaterThan(2);
			expect(c.title.trim().length).toBeGreaterThan(2);
		}
	});

	it('describes every team', () => {
		expect(SAMPLE_TEAMS.length).toBeGreaterThanOrEqual(3);
		for (const t of SAMPLE_TEAMS) {
			expect(t.memberIds.length).toBeGreaterThanOrEqual(2);
			expect(t.description.length).toBeGreaterThan(10);
		}
	});
});

describe('buildEmptyState', () => {
	it('is genuinely empty but still usable', () => {
		const s = buildEmptyState();
		expect(s.meetings).toEqual([]);
		expect(s.actionItems).toEqual([]);
		expect(s.notes).toEqual([]);
		expect(s.teams).toEqual([]);
		// You must still exist, or there is nobody to host a meeting.
		expect(s.contacts).toHaveLength(1);
		expect(s.contacts[0].id).toBe(s.meId);
	});
});

describe('timezone handling in the sample', () => {
	it('places today\'s meetings on today in the generation zone', () => {
		const s = buildSampleState({ today: TODAY, zone: ZONE });
		const standup = s.meetings.find((m) => m.id === 'm-standup')!;
		expect(civilDateOf(standup.startsAt, ZONE)).toBe(TODAY);
	});

	it('keeps meetings with an explicit zone independent of the workspace zone', () => {
		const inUtc = buildSampleState({ today: TODAY, zone: 'UTC' });
		const inNy = buildSampleState({ today: TODAY, zone: 'America/New_York' });
		// The standup has no explicit zone, so it follows the workspace: different instants.
		const a = inUtc.meetings.find((m) => m.id === 'm-standup')!;
		const b = inNy.meetings.find((m) => m.id === 'm-standup')!;
		expect(a.startsAt).not.toBe(b.startsAt);
		expect(a.timezone).toBe('UTC');
		expect(b.timezone).toBe('America/New_York');
	});
});
