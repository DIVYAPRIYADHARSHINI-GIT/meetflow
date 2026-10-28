/**
 * Scheduling logic: recurrence expansion, conflict detection, agenda timing, codes/links.
 *
 * Pure functions only - no store, no DOM, no Date.now() unless passed in. That is what
 * makes the risky date behaviour testable and what keeps the calendar, dashboard and
 * scheduler agreeing with each other: they all call these same functions.
 */

import type {
	AgendaTopic,
	Contact,
	Meeting,
	Occurrence,
	Participant,
	Recurrence
} from '../types';
import {
	addDays,
	addMinutes,
	addMonths,
	civilDateOf,
	diffDays,
	instantFromZoned,
	minutesOfDay,
	timeOfDay
} from './time';

/**
 * Hard cap on expanded occurrences for an open-ended series.
 *
 * An open-ended daily meeting is infinite, so every expansion is bounded. 400 covers more
 * than a year of daily standups, which is past any window the UI renders.
 */
export const MAX_OCCURRENCES = 400;

/**
 * Expand a meeting into concrete occurrences overlapping [rangeStart, rangeEnd).
 *
 * Walks CIVIL dates and re-resolves the wall clock in the meeting's own zone for every
 * occurrence, so a 09:00 standup stays 09:00 after a DST change instead of drifting by an
 * hour. Exceptions are applied last: a cancelled occurrence disappears, a moved one keeps
 * its `originalStart` so it can still be matched.
 */
export function expandOccurrences(
	meeting: Meeting,
	rangeStart: string,
	rangeEnd: string
): Occurrence[] {
	const out: Occurrence[] = [];
	if (meeting.status === 'cancelled') return out;

	const zone = meeting.timezone;
	const firstCivil = civilDateOf(meeting.startsAt, zone);
	const wall = timeOfDay(meeting.startsAt, zone);
	const [hour, minute] = wall.split(':').map(Number);
	const rec = meeting.recurrence ?? { freq: 'none', interval: 1 };
	const interval = Math.max(1, Math.floor(rec.interval || 1));

	const rangeStartMs = new Date(rangeStart).getTime();
	const rangeEndMs = new Date(rangeEnd).getTime();
	const limit = rec.freq === 'none' ? 1 : Math.min(rec.count || MAX_OCCURRENCES, MAX_OCCURRENCES);

	for (let i = 0; i < limit; i++) {
		const civil = occurrenceCivilDate(firstCivil, rec.freq, interval, i);
		if (rec.until && diffDays(rec.until, civil) > 0) break;

		const originalStart = instantFromZoned(civil, hour, minute, zone);
		const exception = (meeting.exceptions ?? []).find((e) => e.originalStart === originalStart);
		if (exception && exception.newStart === null) continue; // cancelled occurrence

		const startsAt = exception?.newStart ?? originalStart;
		const endsAt = addMinutes(startsAt, meeting.durationMinutes);

		const startMs = new Date(startsAt).getTime();
		const endMs = new Date(endsAt).getTime();
		// Past the window and marching away from it: stop early rather than expanding 400.
		if (startMs >= rangeEndMs && !exception) break;
		if (endMs > rangeStartMs && startMs < rangeEndMs) {
			out.push({ meetingId: meeting.id, startsAt, endsAt, originalStart, index: i, meeting });
		}
	}

	return out;
}

function occurrenceCivilDate(
	firstCivil: string,
	freq: Recurrence['freq'],
	interval: number,
	index: number
): string {
	if (index === 0 || freq === 'none') return firstCivil;
	if (freq === 'daily') return addDays(firstCivil, interval * index);
	if (freq === 'weekly') return addDays(firstCivil, 7 * interval * index);
	return addMonths(firstCivil, interval * index);
}

/** Expand many meetings into a sorted occurrence list for a window. */
export function occurrencesInRange(
	meetings: Meeting[],
	rangeStart: string,
	rangeEnd: string
): Occurrence[] {
	return meetings
		.flatMap((m) => expandOccurrences(m, rangeStart, rangeEnd))
		.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Occurrences falling on one civil date, as seen from `zone`. */
export function occurrencesOnDate(
	meetings: Meeting[],
	civilDate: string,
	zone: string
): Occurrence[] {
	// Widen by a day either side, then filter by the civil date in the viewer's zone: a
	// meeting at 23:30 local can start on the previous UTC day.
	const from = instantFromZoned(addDays(civilDate, -1), 0, 0, zone);
	const to = instantFromZoned(addDays(civilDate, 2), 0, 0, zone);
	return occurrencesInRange(meetings, from, to).filter(
		(o) => civilDateOf(o.startsAt, zone) === civilDate
	);
}

export interface Conflict {
	/** The occurrence being checked. */
	startsAt: string;
	endsAt: string;
	/** What it collides with. */
	with: Occurrence;
	overlapMinutes: number;
}

/**
 * Do two half-open intervals overlap?
 *
 * Half-open [start, end) is deliberate: a 09:00-10:00 and a 10:00-11:00 meeting are
 * back-to-back, NOT a conflict. Getting this wrong flags every tidy calendar as broken.
 */
export function intervalsOverlap(
	aStart: string,
	aEnd: string,
	bStart: string,
	bEnd: string
): boolean {
	return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

export function overlapMinutes(
	aStart: string,
	aEnd: string,
	bStart: string,
	bEnd: string
): number {
	const start = Math.max(new Date(aStart).getTime(), new Date(bStart).getTime());
	const end = Math.min(new Date(aEnd).getTime(), new Date(bEnd).getTime());
	return Math.max(0, Math.round((end - start) / 60000));
}

/**
 * Find conflicts between a candidate meeting and everything already scheduled.
 *
 * Expands BOTH sides: a new one-off meeting can collide with the 14th occurrence of a
 * weekly series, which a naive "compare startsAt" check would miss entirely. Cancelled
 * meetings and the candidate's own id are ignored, so editing a meeting never reports it
 * as conflicting with itself.
 */
export function findConflicts(
	candidate: Meeting,
	existing: Meeting[],
	options: { horizonDays?: number } = {}
): Conflict[] {
	const horizon = options.horizonDays ?? 120;
	const candidateOccurrences = expandOccurrences(
		candidate,
		candidate.startsAt,
		addMinutes(candidate.startsAt, horizon * 24 * 60)
	);
	if (candidateOccurrences.length === 0) return [];

	const windowStart = candidateOccurrences[0].startsAt;
	const windowEnd = candidateOccurrences[candidateOccurrences.length - 1].endsAt;

	const others = existing.filter((m) => m.id !== candidate.id && m.status !== 'cancelled');
	const otherOccurrences = occurrencesInRange(others, windowStart, windowEnd);

	const conflicts: Conflict[] = [];
	for (const mine of candidateOccurrences) {
		for (const theirs of otherOccurrences) {
			if (intervalsOverlap(mine.startsAt, mine.endsAt, theirs.startsAt, theirs.endsAt)) {
				conflicts.push({
					startsAt: mine.startsAt,
					endsAt: mine.endsAt,
					with: theirs,
					overlapMinutes: overlapMinutes(
						mine.startsAt,
						mine.endsAt,
						theirs.startsAt,
						theirs.endsAt
					)
				});
			}
		}
	}
	return conflicts;
}

export interface AgendaTiming {
	allocatedMinutes: number;
	durationMinutes: number;
	/** Positive when the agenda needs more time than the meeting has. */
	overBy: number;
	/** Positive when there is unallocated time left. */
	remaining: number;
	status: 'empty' | 'under' | 'exact' | 'over';
	message: string;
}

/**
 * Compare agenda allocations against the meeting duration.
 *
 * Used by the schedule form's live check and by the room's per-topic countdown, so both
 * show the same numbers.
 */
export function agendaTiming(topics: AgendaTopic[], durationMinutes: number): AgendaTiming {
	const allocated = topics.reduce((sum, t) => sum + Math.max(0, t.minutes || 0), 0);
	const overBy = Math.max(0, allocated - durationMinutes);
	const remaining = Math.max(0, durationMinutes - allocated);

	let status: AgendaTiming['status'] = 'exact';
	let message = 'Agenda fits the meeting exactly.';
	if (topics.length === 0) {
		status = 'empty';
		message = 'No topics yet. Add one to plan the meeting.';
	} else if (overBy > 0) {
		status = 'over';
		message = `Agenda is ${overBy} min longer than the meeting.`;
	} else if (remaining > 0) {
		status = 'under';
		message = `${remaining} min unallocated.`;
	}

	return { allocatedMinutes: allocated, durationMinutes, overBy, remaining, status, message };
}

/** Running start offsets (minutes from meeting start) for each agenda topic. */
export function agendaOffsets(topics: AgendaTopic[]): number[] {
	const offsets: number[] = [];
	let acc = 0;
	for (const t of topics) {
		offsets.push(acc);
		acc += Math.max(0, t.minutes || 0);
	}
	return offsets;
}

/**
 * Which agenda topic should be live at `elapsedMinutes` into the meeting.
 * Returns -1 before the first topic or once the agenda has run out.
 */
export function currentTopicIndex(topics: AgendaTopic[], elapsedMinutes: number): number {
	if (topics.length === 0 || elapsedMinutes < 0) return -1;
	const offsets = agendaOffsets(topics);
	for (let i = topics.length - 1; i >= 0; i--) {
		if (elapsedMinutes >= offsets[i]) {
			const end = offsets[i] + Math.max(0, topics[i].minutes || 0);
			return elapsedMinutes < end ? i : i === topics.length - 1 ? -1 : i + 1;
		}
	}
	return 0;
}

/** Move an array item, returning a new array. Shared by agenda and board reordering. */
export function reorder<T>(items: T[], from: number, to: number): T[] {
	if (from === to || from < 0 || from >= items.length) return items.slice();
	const next = items.slice();
	const [moved] = next.splice(from, 1);
	const target = Math.max(0, Math.min(next.length, to));
	next.splice(target, 0, moved);
	return next;
}

/**
 * Human-friendly meeting code, e.g. "QJD-4417".
 *
 * The alphabet excludes I, O, L, 0 and 1 so a code read aloud or copied by hand cannot be
 * mistyped. `rand` is injectable so tests are deterministic.
 */
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_DIGITS = '23456789';

export function generateCode(rand: () => number = Math.random): string {
	const letters = Array.from(
		{ length: 3 },
		() => CODE_LETTERS[Math.floor(rand() * CODE_LETTERS.length)]
	).join('');
	const digits = Array.from(
		{ length: 4 },
		() => CODE_DIGITS[Math.floor(rand() * CODE_DIGITS.length)]
	).join('');
	return `${letters}-${digits}`;
}

/** Accepts "qjd4417", "QJD-4417", "qjd 4417" and normalises to "QJD-4417". */
export function normaliseCode(input: string): string {
	const cleaned = (input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
	if (cleaned.length < 7) return cleaned;
	return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}`;
}

/** Shareable join link for a meeting code. `origin` keeps it correct on any host. */
export function meetingLink(code: string, origin = ''): string {
	const base = origin || 'https://meetflow.app';
	return `${base.replace(/\/$/, '')}/room/?code=${encodeURIComponent(code)}`;
}

/** Recurrence summary for cards and the schedule form, e.g. "Weekly, 12 times". */
export function describeRecurrence(rec: Recurrence): string {
	if (!rec || rec.freq === 'none') return 'Does not repeat';
	const interval = Math.max(1, rec.interval || 1);
	const unit = { daily: 'day', weekly: 'week', monthly: 'month' }[rec.freq];
	const every = interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`;
	if (rec.count && rec.count > 0) return `${every}, ${rec.count} times`;
	if (rec.until) return `${every} until ${rec.until}`;
	return every;
}

/** Has this occurrence already finished, relative to `now`? */
export function isPast(occurrence: { endsAt: string }, now = new Date()): boolean {
	return new Date(occurrence.endsAt).getTime() < now.getTime();
}

/** Is `now` inside the occurrence? */
export function isLive(
	occurrence: { startsAt: string; endsAt: string },
	now = new Date()
): boolean {
	const t = now.getTime();
	return t >= new Date(occurrence.startsAt).getTime() && t < new Date(occurrence.endsAt).getTime();
}

/**
 * Validate a scheduling form. Returns field-keyed messages so the form can show them
 * inline and the submit button can be disabled on real errors only.
 */
export interface ScheduleDraft {
	title: string;
	date: string;
	time: string;
	durationMinutes: number;
	timezone: string;
	recurrence: Recurrence;
	participants: Participant[];
	agenda: AgendaTopic[];
}

export function validateDraft(
	draft: ScheduleDraft,
	now = new Date()
): { errors: Record<string, string>; warnings: Record<string, string> } {
	const errors: Record<string, string> = {};
	const warnings: Record<string, string> = {};

	if (!draft.title.trim()) errors.title = 'Give the meeting a title.';
	else if (draft.title.trim().length > 140) errors.title = 'Keep the title under 140 characters.';

	if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) errors.date = 'Pick a date.';
	if (!/^\d{2}:\d{2}$/.test(draft.time)) errors.time = 'Pick a start time.';

	if (!(draft.durationMinutes > 0)) errors.duration = 'Duration must be more than 0 minutes.';
	else if (draft.durationMinutes > 8 * 60) warnings.duration = 'That is a very long meeting.';

	if (!errors.date && !errors.time) {
		const [h, m] = draft.time.split(':').map(Number);
		const startsAt = instantFromZoned(draft.date, h, m, draft.timezone);
		// A past date is a WARNING, not an error: logging a meeting that already happened is a
		// real thing people do, and blocking it would make the history page unfillable.
		if (new Date(startsAt).getTime() < now.getTime()) {
			warnings.date = 'This start time is in the past.';
		}
	}

	if (draft.recurrence.freq !== 'none') {
		if (draft.recurrence.interval < 1) errors.recurrence = 'Repeat interval must be at least 1.';
		if (draft.recurrence.count !== undefined && draft.recurrence.count < 0) {
			errors.recurrence = 'Occurrence count cannot be negative.';
		}
		if (draft.recurrence.until && draft.date && diffDays(draft.recurrence.until, draft.date) > 0) {
			errors.recurrence = 'The end date is before the first meeting.';
		}
	}

	if (draft.participants.length === 0) warnings.participants = 'No one is invited yet.';
	if (!draft.participants.some((p) => p.role === 'host')) {
		warnings.participants = 'No host assigned.';
	}

	const timing = agendaTiming(draft.agenda, draft.durationMinutes);
	if (timing.status === 'over') warnings.agenda = timing.message;
	if (draft.agenda.some((t) => !t.title.trim())) errors.agenda = 'Every topic needs a title.';

	return { errors, warnings };
}

/** Basic email check, good enough to keep chips honest without rejecting valid addresses. */
export function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/**
 * Free/busy hint for a contact at a proposed time.
 *
 * Combines their stated working hours (in THEIR zone, so inviting Sydney to a 22:00 IST
 * call is correctly flagged) with meetings they are already in.
 */
export type Availability = 'free' | 'busy' | 'outside-hours' | 'unknown';

export function availabilityFor(
	contact: Contact,
	startsAt: string,
	durationMinutes: number,
	meetings: Meeting[]
): Availability {
	if (!contact) return 'unknown';
	const endsAt = addMinutes(startsAt, durationMinutes);

	const busy = occurrencesInRange(meetings, startsAt, endsAt).some(
		(o) =>
			o.meeting.participants.some((p) => p.contactId === contact.id) &&
			intervalsOverlap(startsAt, endsAt, o.startsAt, o.endsAt)
	);
	if (busy) return 'busy';

	const startMinute = minutesOfDay(startsAt, contact.timezone);
	const endMinute = startMinute + durationMinutes;
	const open = contact.workingHours.start * 60;
	const close = contact.workingHours.end * 60;
	if (startMinute < open || endMinute > close) return 'outside-hours';
	return 'free';
}

/**
 * Build an .ics calendar file for one meeting.
 *
 * Times are emitted as UTC instants (the trailing Z form) so no importing client has to
 * agree with us about zone databases. RRULE mirrors the stored rule rather than listing
 * every occurrence. Text is escaped per RFC 5545 and lines are folded at 75 octets.
 */
export function buildIcs(
	meeting: Meeting,
	contacts: Contact[],
	options: { origin?: string; now?: Date } = {}
): string {
	const now = options.now ?? new Date();
	const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
	const esc = (text: string) =>
		String(text ?? '')
			.replace(/\\/g, '\\\\')
			.replace(/;/g, '\\;')
			.replace(/,/g, '\\,')
			.replace(/\r?\n/g, '\\n');

	const byId = new Map(contacts.map((c) => [c.id, c]));
	const lines: string[] = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//MeetFlow//Meeting Scheduler//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${meeting.id}@meetflow.app`,
		`DTSTAMP:${stamp(now.toISOString())}`,
		`DTSTART:${stamp(meeting.startsAt)}`,
		`DTEND:${stamp(addMinutes(meeting.startsAt, meeting.durationMinutes))}`,
		`SUMMARY:${esc(meeting.title)}`
	];

	const agendaText = meeting.agenda.map((t, i) => `${i + 1}. ${t.title} (${t.minutes}m)`).join('\n');
	const description = [
		meeting.description,
		agendaText ? `Agenda:\n${agendaText}` : '',
		`Join code: ${meeting.code}`,
		meetingLink(meeting.code, options.origin)
	]
		.filter(Boolean)
		.join('\n\n');
	lines.push(`DESCRIPTION:${esc(description)}`);
	lines.push(`LOCATION:${esc(meetingLink(meeting.code, options.origin))}`);

	const rrule = icsRrule(meeting.recurrence);
	if (rrule) lines.push(rrule);

	for (const p of meeting.participants) {
		const contact = byId.get(p.contactId);
		if (!contact) continue;
		const role = p.role === 'host' ? 'CHAIR' : 'REQ-PARTICIPANT';
		lines.push(
			`ATTENDEE;ROLE=${role};CN=${esc(contact.name)}:mailto:${contact.email}`
		);
	}

	lines.push('STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR');
	return lines.map(foldIcsLine).join('\r\n');
}

function icsRrule(rec: Recurrence): string {
	if (!rec || rec.freq === 'none') return '';
	const freq = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' }[rec.freq];
	const parts = [`FREQ=${freq}`];
	const interval = Math.max(1, rec.interval || 1);
	if (interval > 1) parts.push(`INTERVAL=${interval}`);
	if (rec.count && rec.count > 0) parts.push(`COUNT=${rec.count}`);
	else if (rec.until) parts.push(`UNTIL=${rec.until.replace(/-/g, '')}T235959Z`);
	return `RRULE:${parts.join(';')}`;
}

/** RFC 5545 line folding: 75 octets, continuation lines start with a space. */
function foldIcsLine(line: string): string {
	if (line.length <= 75) return line;
	const chunks: string[] = [line.slice(0, 75)];
	let rest = line.slice(75);
	while (rest.length > 74) {
		chunks.push(` ${rest.slice(0, 74)}`);
		rest = rest.slice(74);
	}
	if (rest) chunks.push(` ${rest}`);
	return chunks.join('\r\n');
}
