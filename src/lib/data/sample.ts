/**
 * Sample workspace: the fictional Northwind Studio, a 9-person product team.
 *
 * Two rules here:
 *
 * 1. No lorem ipsum. Every meeting title, agenda topic, note line, decision and action item
 *    reads like something a real product team wrote.
 * 2. Everything is dated RELATIVE to the day the app is first opened, so the dashboard
 *    always has meetings "today", a few earlier this week with real notes and summaries,
 *    and some upcoming. A fixed 2026 date set would look broken the moment it went stale.
 *
 * The generator is deterministic given `today`, which is what lets the e2e probe assert on
 * specific titles and counts.
 */

import type {
	ActionItem,
	ChatMessage,
	Contact,
	Decision,
	Meeting,
	Note,
	PersistedState,
	Settings,
	Team
} from '../types';
import { SCHEMA_VERSION } from '../stores/storage';
import { addDays, addMinutes, civilDateOf, instantFromZoned, localTimezone } from '../logic/time';

export const SAMPLE_CONTACTS: Contact[] = [
	{
		id: 'c-you',
		name: 'Divya Priyadharshini',
		email: 'divya@northwind.studio',
		title: 'Product manager',
		hue: 0,
		timezone: 'Asia/Kolkata',
		workingHours: { start: 9, end: 18 }
	},
	{
		id: 'c-priya',
		name: 'Priya Sharma',
		email: 'priya@northwind.studio',
		title: 'Design lead',
		hue: 1,
		timezone: 'Asia/Kolkata',
		workingHours: { start: 10, end: 19 }
	},
	{
		id: 'c-marcus',
		name: 'Marcus Webb',
		email: 'marcus@northwind.studio',
		title: 'Engineering manager',
		hue: 2,
		timezone: 'Europe/London',
		workingHours: { start: 9, end: 17 }
	},
	{
		id: 'c-aditi',
		name: 'Aditi Rao',
		email: 'aditi@northwind.studio',
		title: 'Senior engineer',
		hue: 3,
		timezone: 'Asia/Kolkata',
		workingHours: { start: 10, end: 19 }
	},
	{
		id: 'c-james',
		name: 'James Okoro',
		email: 'james@northwind.studio',
		title: 'Data analyst',
		hue: 4,
		timezone: 'Europe/Lisbon',
		workingHours: { start: 9, end: 18 }
	},
	{
		id: 'c-elena',
		name: 'Elena Fischer',
		email: 'elena@northwind.studio',
		title: 'QA engineer',
		hue: 5,
		timezone: 'Europe/Berlin',
		workingHours: { start: 8, end: 16 }
	},
	{
		id: 'c-sam',
		name: 'Sam Whitfield',
		email: 'sam@northwind.studio',
		title: 'Customer success',
		hue: 2,
		timezone: 'America/New_York',
		workingHours: { start: 9, end: 17 }
	},
	{
		id: 'c-ravi',
		name: 'Ravi Krishnan',
		email: 'ravi@northwind.studio',
		title: 'Backend engineer',
		hue: 3,
		timezone: 'Asia/Kolkata',
		workingHours: { start: 11, end: 20 }
	},
	{
		id: 'c-nadia',
		name: 'Nadia Haddad',
		email: 'nadia@northwind.studio',
		title: 'Marketing lead',
		hue: 1,
		timezone: 'Asia/Dubai',
		workingHours: { start: 9, end: 18 }
	}
];

export const SAMPLE_TEAMS: Team[] = [
	{
		id: 't-product',
		name: 'Product trio',
		description: 'PM, design and engineering leads who run weekly planning',
		memberIds: ['c-you', 'c-priya', 'c-marcus']
	},
	{
		id: 't-engineering',
		name: 'Engineering',
		description: 'Everyone who ships code',
		memberIds: ['c-marcus', 'c-aditi', 'c-ravi', 'c-elena']
	},
	{
		id: 't-launch',
		name: 'Launch squad',
		description: 'Cross-functional group for the 2.0 release',
		memberIds: ['c-you', 'c-priya', 'c-nadia', 'c-sam', 'c-james']
	},
	{
		id: 't-leadership',
		name: 'Leadership',
		description: 'Monthly business review attendees',
		memberIds: ['c-you', 'c-marcus', 'c-nadia']
	}
];

export const DEFAULT_SETTINGS: Settings = {
	profileName: 'Divya Priyadharshini',
	profileEmail: 'divya@northwind.studio',
	profileTitle: 'Product manager',
	defaultDurationMinutes: 30,
	timezone: 'Asia/Kolkata',
	theme: 'system',
	notifications: {
		emailReminders: true,
		reminderMinutes: 10,
		dailyDigest: true,
		actionItemNudges: true
	},
	joinMuted: false,
	joinCameraOff: false
};

/** Colour tokens used by the calendar; index into `--mf-event-*`. */
export const EVENT_COLOURS = 6;

interface SampleSpec {
	id: string;
	title: string;
	description: string;
	/** Days from today. Negative = past. */
	dayOffset: number;
	/** Wall-clock start in the meeting's zone. */
	time: string;
	durationMinutes: number;
	timezone?: string;
	recurrence?: Meeting['recurrence'];
	participants: { id: string; role: 'host' | 'participant'; attended?: boolean }[];
	agenda: { title: string; minutes: number; owner?: string; covered?: boolean }[];
	code: string;
	status: Meeting['status'];
	colour: number;
	/** Set for past meetings so the summary has a real duration. */
	actualMinutes?: number;
}

const SPECS: SampleSpec[] = [
	{
		id: 'm-standup',
		title: 'Daily standup',
		description: 'Fifteen minutes, blockers first.',
		dayOffset: 0,
		time: '09:30',
		durationMinutes: 15,
		recurrence: { freq: 'daily', interval: 1, count: 60 },
		participants: [
			{ id: 'c-you', role: 'host' },
			{ id: 'c-marcus', role: 'participant' },
			{ id: 'c-aditi', role: 'participant' },
			{ id: 'c-ravi', role: 'participant' },
			{ id: 'c-elena', role: 'participant' }
		],
		agenda: [
			{ title: 'Blockers', minutes: 7, owner: 'c-marcus' },
			{ title: 'Yesterday and today', minutes: 5 },
			{ title: 'Anything for the group', minutes: 3 }
		],
		code: 'STD-2471',
		status: 'scheduled',
		colour: 0
	},
	{
		id: 'm-design-review',
		title: 'Design review: onboarding flow',
		description: 'Walk through the three-screen onboarding and agree the final copy.',
		dayOffset: 0,
		time: '14:00',
		durationMinutes: 45,
		participants: [
			{ id: 'c-priya', role: 'host' },
			{ id: 'c-you', role: 'participant' },
			{ id: 'c-aditi', role: 'participant' },
			{ id: 'c-sam', role: 'participant' }
		],
		agenda: [
			{ title: 'Current prototype walkthrough', minutes: 15, owner: 'c-priya' },
			{ title: 'Empty-state copy', minutes: 10 },
			{ title: 'Mobile breakpoints', minutes: 12, owner: 'c-aditi' },
			{ title: 'Decisions and next steps', minutes: 8 }
		],
		code: 'DSN-8832',
		status: 'scheduled',
		colour: 1
	},
	{
		id: 'm-1on1-priya',
		title: '1:1 Divya / Priya',
		description: 'Fortnightly catch-up.',
		dayOffset: 1,
		time: '11:00',
		durationMinutes: 30,
		recurrence: { freq: 'weekly', interval: 2, count: 12 },
		participants: [
			{ id: 'c-you', role: 'host' },
			{ id: 'c-priya', role: 'participant' }
		],
		agenda: [
			{ title: 'How is the quarter feeling', minutes: 10 },
			{ title: 'Design hiring', minutes: 10 },
			{ title: 'Anything from me', minutes: 10 }
		],
		code: 'ONE-3390',
		status: 'scheduled',
		colour: 2
	},
	{
		id: 'm-sprint-planning',
		title: 'Sprint 24 planning',
		description: 'Size the backlog and commit to the sprint goal.',
		dayOffset: 2,
		time: '10:00',
		durationMinutes: 90,
		participants: [
			{ id: 'c-marcus', role: 'host' },
			{ id: 'c-you', role: 'participant' },
			{ id: 'c-aditi', role: 'participant' },
			{ id: 'c-ravi', role: 'participant' },
			{ id: 'c-elena', role: 'participant' }
		],
		agenda: [
			{ title: 'Sprint goal', minutes: 10, owner: 'c-you' },
			{ title: 'Carry-over from sprint 23', minutes: 15 },
			{ title: 'Estimate new stories', minutes: 45, owner: 'c-marcus' },
			{ title: 'Capacity and leave', minutes: 10 },
			{ title: 'Commit', minutes: 10 }
		],
		code: 'SPR-5514',
		status: 'scheduled',
		colour: 3
	},
	{
		id: 'm-customer-call',
		title: 'Customer call: Brightline Logistics',
		description: 'Renewal conversation plus the reporting feature request.',
		dayOffset: 3,
		time: '18:30',
		durationMinutes: 45,
		participants: [
			{ id: 'c-sam', role: 'host' },
			{ id: 'c-you', role: 'participant' },
			{ id: 'c-nadia', role: 'participant' }
		],
		agenda: [
			{ title: 'How the rollout went', minutes: 15, owner: 'c-sam' },
			{ title: 'Reporting requirements', minutes: 20 },
			{ title: 'Renewal timing', minutes: 10 }
		],
		code: 'CUS-6628',
		status: 'scheduled',
		colour: 4
	},
	{
		id: 'm-launch-sync',
		title: '2.0 launch sync',
		description: 'Weekly cross-functional check on the launch plan.',
		dayOffset: 4,
		time: '16:00',
		durationMinutes: 30,
		recurrence: { freq: 'weekly', interval: 1, count: 8 },
		participants: [
			{ id: 'c-nadia', role: 'host' },
			{ id: 'c-you', role: 'participant' },
			{ id: 'c-priya', role: 'participant' },
			{ id: 'c-sam', role: 'participant' },
			{ id: 'c-james', role: 'participant' }
		],
		agenda: [
			{ title: 'Launch checklist status', minutes: 10, owner: 'c-nadia' },
			{ title: 'Press and blog timing', minutes: 10 },
			{ title: 'Support readiness', minutes: 10, owner: 'c-sam' }
		],
		code: 'LCH-7705',
		status: 'scheduled',
		colour: 5
	},
	{
		id: 'm-board-review',
		title: 'Monthly business review',
		description: 'Revenue, retention and the quarter-to-date plan.',
		dayOffset: 11,
		time: '15:00',
		durationMinutes: 60,
		recurrence: { freq: 'monthly', interval: 1, count: 6 },
		participants: [
			{ id: 'c-you', role: 'host' },
			{ id: 'c-marcus', role: 'participant' },
			{ id: 'c-nadia', role: 'participant' },
			{ id: 'c-james', role: 'participant' }
		],
		agenda: [
			{ title: 'Numbers walkthrough', minutes: 20, owner: 'c-james' },
			{ title: 'Retention deep dive', minutes: 20 },
			{ title: 'Quarter plan changes', minutes: 20 }
		],
		code: 'MBR-9140',
		status: 'scheduled',
		colour: 2
	},
	// ---- Past meetings: these carry notes, decisions, action items and summaries ----
	{
		id: 'm-retro-23',
		title: 'Sprint 23 retrospective',
		description: 'What went well, what did not, what we change.',
		dayOffset: -2,
		time: '16:30',
		durationMinutes: 60,
		participants: [
			{ id: 'c-marcus', role: 'host', attended: true },
			{ id: 'c-you', role: 'participant', attended: true },
			{ id: 'c-aditi', role: 'participant', attended: true },
			{ id: 'c-ravi', role: 'participant', attended: true },
			{ id: 'c-elena', role: 'participant', attended: false }
		],
		agenda: [
			{ title: 'What went well', minutes: 15, covered: true },
			{ title: 'What slowed us down', minutes: 20, covered: true },
			{ title: 'Actions for sprint 24', minutes: 25, covered: true }
		],
		code: 'RET-4418',
		status: 'completed',
		colour: 3,
		actualMinutes: 52
	},
	{
		id: 'm-roadmap',
		title: 'Q2 roadmap workshop',
		description: 'Agree the three themes for next quarter.',
		dayOffset: -5,
		time: '10:30',
		durationMinutes: 120,
		participants: [
			{ id: 'c-you', role: 'host', attended: true },
			{ id: 'c-priya', role: 'participant', attended: true },
			{ id: 'c-marcus', role: 'participant', attended: true },
			{ id: 'c-nadia', role: 'participant', attended: true },
			{ id: 'c-james', role: 'participant', attended: true }
		],
		agenda: [
			{ title: 'What we learned in Q1', minutes: 30, covered: true },
			{ title: 'Theme candidates', minutes: 45, covered: true },
			{ title: 'Trade-offs and sizing', minutes: 30, covered: true },
			{ title: 'Agree the three themes', minutes: 15, covered: false }
		],
		code: 'RDM-2286',
		status: 'completed',
		colour: 1,
		actualMinutes: 134
	},
	{
		id: 'm-incident',
		title: 'Incident review: checkout timeouts',
		description: 'Blameless review of the 40-minute checkout outage.',
		dayOffset: -8,
		time: '17:00',
		durationMinutes: 45,
		participants: [
			{ id: 'c-marcus', role: 'host', attended: true },
			{ id: 'c-ravi', role: 'participant', attended: true },
			{ id: 'c-aditi', role: 'participant', attended: true },
			{ id: 'c-sam', role: 'participant', attended: true },
			{ id: 'c-you', role: 'participant', attended: false }
		],
		agenda: [
			{ title: 'Timeline of the incident', minutes: 15, covered: true },
			{ title: 'Root cause', minutes: 15, covered: true },
			{ title: 'Prevention actions', minutes: 15, covered: true }
		],
		code: 'INC-5063',
		status: 'completed',
		colour: 4,
		actualMinutes: 48
	},
	{
		id: 'm-onboarding-kickoff',
		title: 'Onboarding revamp kickoff',
		description: 'Scope the onboarding work and agree success measures.',
		dayOffset: -12,
		time: '11:30',
		durationMinutes: 60,
		participants: [
			{ id: 'c-priya', role: 'host', attended: true },
			{ id: 'c-you', role: 'participant', attended: true },
			{ id: 'c-james', role: 'participant', attended: true },
			{ id: 'c-sam', role: 'participant', attended: true }
		],
		agenda: [
			{ title: 'Why onboarding, why now', minutes: 15, covered: true },
			{ title: 'Current drop-off data', minutes: 20, covered: true },
			{ title: 'Scope and success measures', minutes: 25, covered: true }
		],
		code: 'ONB-3317',
		status: 'completed',
		colour: 0,
		actualMinutes: 61
	}
];

function buildMeetings(today: string, zone: string): Meeting[] {
	return SPECS.map((spec) => {
		const date = addDays(today, spec.dayOffset);
		const [h, m] = spec.time.split(':').map(Number);
		const tz = spec.timezone ?? zone;
		return {
			id: spec.id,
			title: spec.title,
			description: spec.description,
			startsAt: instantFromZoned(date, h, m, tz),
			durationMinutes: spec.durationMinutes,
			timezone: tz,
			recurrence: spec.recurrence ?? { freq: 'none', interval: 1 },
			exceptions: [],
			participants: spec.participants.map((p) => ({
				contactId: p.id,
				role: p.role,
				...(p.attended === undefined ? {} : { attended: p.attended })
			})),
			agenda: spec.agenda.map((t, i) => ({
				id: `${spec.id}-t${i + 1}`,
				title: t.title,
				minutes: t.minutes,
				...(t.owner ? { owner: t.owner } : {}),
				...(t.covered === undefined ? {} : { covered: t.covered })
			})),
			code: spec.code,
			status: spec.status,
			colour: spec.colour,
			createdAt: instantFromZoned(addDays(date, -7), 9, 0, tz),
			// endedAt is derived by adding minutes to the resolved INSTANT, not by passing
			// `m + actualMinutes` back into instantFromZoned: a minute value over 59 is not a
			// wall clock, and resolving it would confuse the DST verification.
			...(spec.status === 'completed'
				? {
						endedAt: addMinutes(
							instantFromZoned(date, h, m, tz),
							spec.actualMinutes ?? spec.durationMinutes
						),
						actualMinutes: spec.actualMinutes ?? spec.durationMinutes
					}
				: {})
		} satisfies Meeting;
	});
}

function buildNotes(meetings: Meeting[]): Note[] {
	const byId = new Map(meetings.map((m) => [m.id, m]));
	const noteFor = (meetingId: string, authorId: string, html: string): Note => ({
		id: `n-${meetingId}`,
		meetingId,
		html,
		// Falls back to the meeting start for a scheduled meeting's pre-read note, so the
		// generator stays deterministic.
		updatedAt: byId.get(meetingId)?.endedAt ?? byId.get(meetingId)?.startsAt ?? '',
		authorId
	});

	return [
		noteFor(
			'm-retro-23',
			'c-marcus',
			[
				'<h3>What went well</h3>',
				'<ul>',
				'<li>Release went out on Thursday with no rollback, first time in four sprints.</li>',
				'<li>The new PR template cut review turnaround to under a day.</li>',
				'</ul>',
				'<h3>What slowed us down</h3>',
				'<ul>',
				'<li>Staging was broken for a day and a half because nobody owned the migration.</li>',
				'<li>Three stories were still being specced on day two of the sprint.</li>',
				'</ul>',
				'<h3>Actions</h3>',
				'<ul>',
				'<li>Rotate a staging owner each sprint so breakages have a name against them.</li>',
				'<li>Spec every story before planning, @Aditi to add the checklist to the template.</li>',
				'</ul>'
			].join('')
		),
		noteFor(
			'm-roadmap',
			'c-you',
			[
				'<h3>Q1 learnings</h3>',
				'<p>Activation is the bottleneck, not acquisition: 61% of signups never finish setup, and the ones who do retain at nearly three times the rate.</p>',
				'<h3>Theme candidates</h3>',
				'<ul>',
				'<li><strong>Onboarding revamp</strong> - highest confidence, clear data behind it.</li>',
				'<li><strong>Reporting and exports</strong> - most requested by larger accounts, Brightline raised it twice.</li>',
				'<li><strong>Mobile polish</strong> - 38% of sessions, interface still desktop-first.</li>',
				'<li><strong>Integrations marketplace</strong> - parked, too big for one quarter.</li>',
				'</ul>',
				'<h3>Trade-offs</h3>',
				'<p>We cannot do reporting and mobile properly in the same quarter with five engineers. Marcus suggested sequencing reporting first because it unblocks the enterprise pipeline.</p>',
				'<p>Open question: does the onboarding revamp need design research first, or can we ship against the existing drop-off data?</p>'
			].join('')
		),
		noteFor(
			'm-incident',
			'c-marcus',
			[
				'<h3>Timeline</h3>',
				'<ul>',
				'<li>14:02 - checkout latency alert fires, p95 above 8 seconds.</li>',
				'<li>14:09 - Ravi confirms the connection pool is exhausted.</li>',
				'<li>14:31 - pool size raised and the backlog drains.</li>',
				'<li>14:42 - checkout back to normal, 40 minutes of degraded service.</li>',
				'</ul>',
				'<h3>Root cause</h3>',
				'<p>A report query added last week ran without a limit and held connections open. Load testing never covered the reporting path, so it passed review.</p>',
				'<h3>Prevention</h3>',
				'<ul>',
				'<li>Add a statement timeout on the reporting replica.</li>',
				'<li>Alert on pool saturation, not just latency, so we see the cause rather than the symptom.</li>',
				'<li>Add the reporting path to the load test suite before 2.0 ships.</li>',
				'</ul>'
			].join('')
		),
		noteFor(
			'm-onboarding-kickoff',
			'c-priya',
			[
				'<h3>Why now</h3>',
				'<p>Support sees the same three questions every week, all of them about setup. Sam estimates it is a third of inbound tickets.</p>',
				'<h3>Drop-off data</h3>',
				'<p>James walked through the funnel: 61% never complete setup, and the biggest single drop is the workspace-invite step at 28%.</p>',
				'<h3>Scope</h3>',
				'<ul>',
				'<li>Three screens maximum, skippable, with a real empty state behind them.</li>',
				'<li>Success measure: setup completion from 39% to 60% within six weeks of launch.</li>',
				'<li>Out of scope: changing the invite model itself.</li>',
				'</ul>'
			].join('')
		),
		noteFor(
			'm-design-review',
			'c-priya',
			'<p>Pre-read: the prototype is in Figma, third page is the one that needs the most eyes.</p>'
		)
	];
}

function buildDecisions(meetings: Meeting[]): Decision[] {
	const byId = new Map(meetings.map((m) => [m.id, m]));
	const at = (id: string, minutes: number) => {
		const m = byId.get(id);
		if (!m) return '';
		return addMinutes(m.startsAt, minutes);
	};

	return [
		{
			id: 'd-1',
			meetingId: 'm-roadmap',
			text: 'Q2 themes are onboarding revamp, reporting and exports, and mobile polish - in that order.',
			decidedAt: at('m-roadmap', 100),
			decidedBy: 'c-you'
		},
		{
			id: 'd-2',
			meetingId: 'm-roadmap',
			text: 'Integrations marketplace is parked until Q3; too large to start this quarter.',
			decidedAt: at('m-roadmap', 105),
			decidedBy: 'c-you'
		},
		{
			id: 'd-3',
			meetingId: 'm-roadmap',
			text: 'Ship the onboarding revamp against existing drop-off data rather than waiting for new research.',
			decidedAt: at('m-roadmap', 118),
			decidedBy: 'c-priya'
		},
		{
			id: 'd-4',
			meetingId: 'm-retro-23',
			text: 'A named staging owner rotates every sprint, starting with Ravi in sprint 24.',
			decidedAt: at('m-retro-23', 44),
			decidedBy: 'c-marcus'
		},
		{
			id: 'd-5',
			meetingId: 'm-retro-23',
			text: 'Stories must be specced before planning or they do not enter the sprint.',
			decidedAt: at('m-retro-23', 50),
			decidedBy: 'c-marcus'
		},
		{
			id: 'd-6',
			meetingId: 'm-incident',
			text: 'Reporting queries run on the replica with a 5-second statement timeout from now on.',
			decidedAt: at('m-incident', 32),
			decidedBy: 'c-marcus'
		},
		{
			id: 'd-7',
			meetingId: 'm-onboarding-kickoff',
			text: 'Onboarding is capped at three skippable screens; the invite model stays as it is.',
			decidedAt: at('m-onboarding-kickoff', 48),
			decidedBy: 'c-priya'
		}
	];
}

function buildActionItems(today: string, meetings: Meeting[]): ActionItem[] {
	const byId = new Map(meetings.map((m) => [m.id, m]));
	// Timestamps are DERIVED from the meeting they came out of, never from wall-clock `now`.
	// Using Date.now() here made the generator non-deterministic for the same `today`, which
	// the determinism test caught: two calls a millisecond apart produced different data.
	const created = (id: string | null) =>
		(id ? byId.get(id)?.endedAt : null) ?? instantFromZoned(today, 9, 0, 'UTC');
	// A done item was completed shortly after the meeting that raised it.
	const completed = (id: string | null) => addMinutes(created(id), 24 * 60);

	const rows: Omit<ActionItem, 'createdAt'>[] = [
		{
			id: 'a-1',
			meetingId: 'm-retro-23',
			title: 'Add the story-spec checklist to the PR template',
			assigneeId: 'c-aditi',
			dueDate: addDays(today, -1),
			priority: 'medium',
			status: 'done',
			completedAt: completed('m-retro-23'),
			sourceLine: 'Spec every story before planning, add the checklist to the template.'
		},
		{
			id: 'a-2',
			meetingId: 'm-retro-23',
			title: 'Set up the staging owner rotation in the team calendar',
			assigneeId: 'c-ravi',
			dueDate: addDays(today, 2),
			priority: 'medium',
			status: 'in-progress',
			sourceLine: 'Rotate a staging owner each sprint so breakages have a name against them.'
		},
		{
			id: 'a-3',
			meetingId: 'm-incident',
			title: 'Add a 5s statement timeout on the reporting replica',
			assigneeId: 'c-ravi',
			dueDate: addDays(today, -3),
			priority: 'high',
			status: 'done',
			completedAt: completed('m-incident'),
			sourceLine: 'Add a statement timeout on the reporting replica.'
		},
		{
			id: 'a-4',
			meetingId: 'm-incident',
			title: 'Alert on connection pool saturation, not just latency',
			assigneeId: 'c-marcus',
			dueDate: addDays(today, -1),
			priority: 'high',
			status: 'in-progress',
			sourceLine: 'Alert on pool saturation, not just latency.'
		},
		{
			id: 'a-5',
			meetingId: 'm-incident',
			title: 'Cover the reporting path in the load test suite before 2.0',
			assigneeId: 'c-elena',
			dueDate: addDays(today, 5),
			priority: 'high',
			status: 'todo',
			sourceLine: 'Add the reporting path to the load test suite before 2.0 ships.'
		},
		{
			id: 'a-6',
			meetingId: 'm-roadmap',
			title: 'Write the Q2 roadmap one-pager and circulate it',
			assigneeId: 'c-you',
			dueDate: addDays(today, 1),
			priority: 'high',
			status: 'in-progress'
		},
		{
			id: 'a-7',
			meetingId: 'm-roadmap',
			title: 'Size the reporting and exports theme with engineering',
			assigneeId: 'c-marcus',
			dueDate: addDays(today, 4),
			priority: 'medium',
			status: 'todo'
		},
		{
			id: 'a-8',
			meetingId: 'm-onboarding-kickoff',
			title: 'Instrument the setup funnel so we can measure the 39% baseline',
			assigneeId: 'c-james',
			dueDate: addDays(today, 3),
			priority: 'high',
			status: 'in-progress'
		},
		{
			id: 'a-9',
			meetingId: 'm-onboarding-kickoff',
			title: 'Draft onboarding screen copy for review',
			assigneeId: 'c-priya',
			dueDate: addDays(today, 0),
			priority: 'medium',
			status: 'todo'
		},
		{
			id: 'a-10',
			meetingId: 'm-onboarding-kickoff',
			title: 'Pull the top three setup questions from support tickets',
			assigneeId: 'c-sam',
			dueDate: addDays(today, -2),
			priority: 'low',
			status: 'done',
			completedAt: completed('m-onboarding-kickoff')
		},
		{
			id: 'a-11',
			meetingId: 'm-roadmap',
			title: 'Confirm mobile analytics are tracking the new events',
			assigneeId: 'c-james',
			dueDate: addDays(today, 7),
			priority: 'low',
			status: 'todo'
		},
		{
			id: 'a-12',
			meetingId: null,
			title: 'Book the offsite venue for the launch week',
			assigneeId: 'c-nadia',
			dueDate: addDays(today, 9),
			priority: 'medium',
			status: 'todo'
		}
	];

	return rows.map((row) => ({
		...row,
		createdAt: created(row.meetingId)
	}));
}

function buildChat(meetings: Meeting[]): ChatMessage[] {
	const retro = meetings.find((m) => m.id === 'm-retro-23');
	if (!retro) return [];
	const at = (minutes: number) =>
		new Date(new Date(retro.startsAt).getTime() + minutes * 60000).toISOString();

	return [
		{
			id: 'ch-1',
			meetingId: 'm-retro-23',
			authorId: 'c-aditi',
			text: 'Dropping the staging incident doc here for context: it was the migration on Tuesday.',
			sentAt: at(6)
		},
		{
			id: 'ch-2',
			meetingId: 'm-retro-23',
			authorId: 'c-ravi',
			text: 'Happy to take staging owner for sprint 24.',
			sentAt: at(41)
		},
		{
			id: 'ch-3',
			meetingId: 'm-retro-23',
			authorId: 'c-you',
			text: 'Noted, thank you. Adding it as an action.',
			sentAt: at(42)
		}
	];
}

/**
 * Build the full sample workspace.
 *
 * `today` defaults to the real current date in `zone`, which is what makes the dashboard
 * look alive on first open. Tests pass a fixed date to get deterministic data.
 */
export function buildSampleState(
	options: { today?: string; zone?: string } = {}
): PersistedState {
	const zone = options.zone ?? DEFAULT_SETTINGS.timezone;
	const today = options.today ?? civilDateOf(new Date().toISOString(), zone);

	const meetings = buildMeetings(today, zone);

	return {
		version: SCHEMA_VERSION,
		contacts: SAMPLE_CONTACTS,
		teams: SAMPLE_TEAMS,
		meetings,
		notes: buildNotes(meetings),
		decisions: buildDecisions(meetings),
		actionItems: buildActionItems(today, meetings),
		chat: buildChat(meetings),
		settings: { ...DEFAULT_SETTINGS, timezone: options.zone ?? detectZone() },
		meId: 'c-you'
	};
}

/** Prefer the browser's real zone, falling back to the sample default. */
function detectZone(): string {
	const zone = localTimezone();
	return zone && zone !== 'UTC' ? zone : DEFAULT_SETTINGS.timezone;
}

/** An empty workspace, for the "start fresh" button in Settings. */
export function buildEmptyState(): PersistedState {
	return {
		version: SCHEMA_VERSION,
		contacts: [SAMPLE_CONTACTS[0]],
		teams: [],
		meetings: [],
		notes: [],
		decisions: [],
		actionItems: [],
		chat: [],
		settings: { ...DEFAULT_SETTINGS, timezone: detectZone() },
		meId: 'c-you'
	};
}

/** Realistic names for the simulated participants in the meeting room. */
export const SIMULATED_SPEAKERS = [
	'Priya Sharma',
	'Marcus Webb',
	'Aditi Rao',
	'James Okoro',
	'Elena Fischer',
	'Sam Whitfield',
	'Ravi Krishnan',
	'Nadia Haddad'
];
