/**
 * THE store. One source of truth for the whole app (Svelte 5 runes).
 *
 * Architectural rule, enforced by convention and by the e2e probes: no view keeps its own
 * copy of a meeting, note, action item or filter. The calendar, dashboard, board, room,
 * history and summary all read from here and all write through these methods, which is why
 * creating an action item from a note line instantly changes the dashboard stat cards and
 * the summary page without any wiring between those components.
 *
 * Persistence is write-through: every mutation calls `persist()`, which is debounced and
 * never throws (see stores/storage.ts). A failed save surfaces as `storageNotice` rather
 * than losing the user's edit silently.
 */

import { browser } from '$app/env';
import type {
	ActionItem,
	ActionStatus,
	ChatMessage,
	Contact,
	Decision,
	Meeting,
	Note,
	Occurrence,
	PersistedState,
	Priority,
	Settings,
	Team
} from '../types';
import {
	buildEmptyState,
	buildSampleState,
	DEFAULT_SETTINGS
} from '../data/sample';
import {
	clearState,
	exportBackup,
	loadState,
	parseBackup,
	saveState,
	type StorageStatus
} from './storage';
import {
	addDays,
	addMinutes,
	civilDateOf,
	diffDays,
	instantFromZoned,
	localTimezone,
	minutesBetween,
	startOfWeek,
	timeOfDay
} from '../logic/time';
import {
	agendaTiming,
	expandOccurrences,
	findConflicts,
	generateCode,
	occurrencesInRange,
	occurrencesOnDate,
	type Conflict
} from '../logic/schedule';
import {
	buildSummary,
	completionRate,
	filterActionItems,
	makeId,
	sanitiseHtml,
	type ActionFilters,
	type MeetingSummary
} from '../logic/notes';

/** Filters that are shared across views, so a selection follows the user around. */
export interface GlobalFilters extends ActionFilters {
	/** Civil date the calendar and dashboard mini-calendar are focused on. */
	focusDate: string;
	/** Free-text search used by the history page. */
	historySearch: string;
}

class AppStore {
	// ---- persisted state ----
	contacts = $state<Contact[]>([]);
	teams = $state<Team[]>([]);
	meetings = $state<Meeting[]>([]);
	notes = $state<Note[]>([]);
	decisions = $state<Decision[]>([]);
	actionItems = $state<ActionItem[]>([]);
	chat = $state<ChatMessage[]>([]);
	settings = $state<Settings>({ ...DEFAULT_SETTINGS });
	meId = $state('c-you');

	// ---- UI / session state (not persisted) ----
	loaded = $state(false);
	/** Shown as a dismissible banner when storage misbehaves. */
	storageNotice = $state<{ status: StorageStatus; message: string } | null>(null);
	/** Transient toast, e.g. "Invite copied". */
	toast = $state<{ text: string; kind: 'info' | 'success' | 'error' } | null>(null);

	filters = $state<GlobalFilters>({
		focusDate: civilDateOf(new Date().toISOString(), localTimezone()),
		historySearch: '',
		meetingId: null,
		assigneeId: null,
		status: null,
		priority: null,
		due: null,
		search: ''
	});

	/** `now`, ticked once a minute so "live" badges and timers stay honest. */
	now = $state(new Date());

	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private tickTimer: ReturnType<typeof setInterval> | null = null;

	// ---------------------------------------------------------------- lifecycle

	/**
	 * Load persisted state, falling back to the sample workspace.
	 *
	 * Called once from the root layout. Safe to call twice - the `loaded` guard means a
	 * client-side navigation cannot wipe in-memory edits.
	 */
	init(): void {
		if (this.loaded || !browser) return;

		const result = loadState();
		if (result.state) {
			this.hydrate(result.state);
		} else {
			if (result.status !== 'ok') {
				this.storageNotice = { status: result.status, message: result.message };
			}
			// First visit (or unreadable data): start from the sample workspace so the product
			// is immediately explorable instead of showing eight empty screens.
			this.hydrate(buildSampleState());
			if (result.status === 'ok') this.persist();
		}

		this.loaded = true;
		this.applyTheme();

		this.tickTimer = setInterval(() => {
			this.now = new Date();
		}, 30_000);
	}

	dispose(): void {
		if (this.tickTimer) clearInterval(this.tickTimer);
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.tickTimer = null;
		this.saveTimer = null;
	}

	private hydrate(state: PersistedState): void {
		this.contacts = state.contacts;
		this.teams = state.teams;
		this.meetings = state.meetings;
		this.notes = state.notes;
		this.decisions = state.decisions;
		this.actionItems = state.actionItems;
		this.chat = state.chat;
		this.settings = { ...DEFAULT_SETTINGS, ...state.settings };
		this.meId = state.meId;
		this.filters.focusDate = civilDateOf(new Date().toISOString(), this.settings.timezone);
	}

	snapshot(): PersistedState {
		return {
			version: 1,
			contacts: this.contacts,
			teams: this.teams,
			meetings: this.meetings,
			notes: this.notes,
			decisions: this.decisions,
			actionItems: this.actionItems,
			chat: this.chat,
			settings: this.settings,
			meId: this.meId
		};
	}

	/** Debounced write-through. Autosave in the notes editor leans on this. */
	persist(): void {
		if (!browser) return;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => {
			const result = saveState(this.snapshot());
			if (!result.ok) this.storageNotice = { status: result.status, message: result.message };
			else if (this.storageNotice?.status === 'full') this.storageNotice = null;
		}, 150);
	}

	/** Write immediately - used before navigating away from the room. */
	persistNow(): void {
		if (!browser) return;
		if (this.saveTimer) clearTimeout(this.saveTimer);
		const result = saveState(this.snapshot());
		if (!result.ok) this.storageNotice = { status: result.status, message: result.message };
	}

	showToast(text: string, kind: 'info' | 'success' | 'error' = 'success'): void {
		this.toast = { text, kind };
		setTimeout(() => {
			if (this.toast?.text === text) this.toast = null;
		}, 3200);
	}

	// ---------------------------------------------------------------- derived reads

	get timezone(): string {
		return this.settings.timezone || localTimezone();
	}

	get today(): string {
		return civilDateOf(this.now.toISOString(), this.timezone);
	}

	contact(id: string | null | undefined): Contact | null {
		if (!id) return null;
		return this.contacts.find((c) => c.id === id) ?? null;
	}

	contactName(id: string | null | undefined): string {
		return this.contact(id)?.name ?? 'Unknown';
	}

	meeting(id: string | null | undefined): Meeting | null {
		if (!id) return null;
		return this.meetings.find((m) => m.id === id) ?? null;
	}

	meetingByCode(code: string): Meeting | null {
		const needle = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
		return (
			this.meetings.find((m) => m.code.replace(/[^A-Z0-9]/g, '') === needle) ?? null
		);
	}

	/** Occurrences for one civil date, in the user's zone. */
	occurrencesOn(civilDate: string): Occurrence[] {
		return occurrencesOnDate(this.meetings, civilDate, this.timezone);
	}

	/** Occurrences within an instant window. */
	occurrencesBetween(from: string, to: string): Occurrence[] {
		return occurrencesInRange(this.meetings, from, to);
	}

	/** Today's meetings, sorted, including ones already finished today. */
	get todaysOccurrences(): Occurrence[] {
		return this.occurrencesOn(this.today);
	}

	/** The next N upcoming occurrences after now, across all meetings. */
	upcoming(limit = 5): Occurrence[] {
		const from = this.now.toISOString();
		const to = addMinutes(from, 60 * 24 * 60); // 60-day horizon
		return this.occurrencesBetween(from, to)
			.filter((o) => new Date(o.startsAt).getTime() >= this.now.getTime())
			.slice(0, limit);
	}

	/** Anything running right now, used for the "rejoin" affordance. */
	get liveOccurrence(): Occurrence | null {
		const t = this.now.getTime();
		return (
			this.todaysOccurrences.find(
				(o) => t >= new Date(o.startsAt).getTime() && t < new Date(o.endsAt).getTime()
			) ?? null
		);
	}

	/**
	 * Past occurrences, newest first, for the history page.
	 *
	 * "Past" means finished, which is NOT the same as "earlier than now": a meeting that was
	 * ended in the room is finished even if its scheduled slot is still in the future (you
	 * ended it early, or it was rescheduled later and then wrapped up). Filtering on time
	 * alone hid those from history entirely - caught by the e2e probe. So the window is
	 * widened to cover scheduled-but-completed meetings, and an occurrence qualifies if it
	 * has either elapsed or been explicitly completed.
	 */
	pastOccurrences(limit = 100): Occurrence[] {
		const from = instantFromZoned(addDays(this.today, -180), 0, 0, this.timezone);
		const to = addDays(this.today, 180);
		return this.occurrencesBetween(from, instantFromZoned(to, 0, 0, this.timezone))
			.filter(
				(o) =>
					o.meeting.status === 'completed' || new Date(o.endsAt).getTime() <= this.now.getTime()
			)
			.reverse()
			.slice(0, limit);
	}

	/** Dashboard stat cards. All four derive from the same occurrence expansion. */
	get weekStats(): {
		meetingsThisWeek: number;
		hoursThisWeek: number;
		openActionItems: number;
		completionRate: number | null;
		overdue: number;
	} {
		const weekStart = startOfWeek(this.today);
		const from = instantFromZoned(weekStart, 0, 0, this.timezone);
		const to = instantFromZoned(addDays(weekStart, 7), 0, 0, this.timezone);
		const occurrences = this.occurrencesBetween(from, to);

		const minutes = occurrences.reduce(
			(sum, o) => sum + (o.meeting.actualMinutes ?? o.meeting.durationMinutes),
			0
		);

		return {
			meetingsThisWeek: occurrences.length,
			hoursThisWeek: Math.round((minutes / 60) * 10) / 10,
			openActionItems: this.actionItems.filter((a) => a.status !== 'done').length,
			completionRate: completionRate(this.actionItems),
			overdue: this.actionItems.filter(
				(a) => a.status !== 'done' && a.dueDate && diffDays(this.today, a.dueDate) < 0
			).length
		};
	}

	/** Action items after the global filters - the board and the dashboard share this. */
	get filteredActionItems(): ActionItem[] {
		return filterActionItems(this.actionItems, this.filters, this.today);
	}

	notesFor(meetingId: string): Note | null {
		return this.notes.find((n) => n.meetingId === meetingId) ?? null;
	}

	decisionsFor(meetingId: string): Decision[] {
		return this.decisions.filter((d) => d.meetingId === meetingId);
	}

	actionItemsFor(meetingId: string): ActionItem[] {
		return this.actionItems.filter((a) => a.meetingId === meetingId);
	}

	chatFor(meetingId: string): ChatMessage[] {
		return this.chat.filter((c) => c.meetingId === meetingId);
	}

	summaryFor(meetingId: string): MeetingSummary | null {
		const meeting = this.meeting(meetingId);
		if (!meeting) return null;
		return buildSummary(meeting, {
			contacts: this.contacts,
			notes: this.notes,
			decisions: this.decisions,
			actionItems: this.actionItems
		});
	}

	/** Conflicts for a draft meeting, against everything else on the calendar. */
	conflictsFor(candidate: Meeting): Conflict[] {
		return findConflicts(candidate, this.meetings);
	}

	agendaCheck(meeting: Meeting) {
		return agendaTiming(meeting.agenda, meeting.durationMinutes);
	}

	// ---------------------------------------------------------------- mutations

	createMeeting(input: Omit<Meeting, 'id' | 'code' | 'createdAt' | 'status' | 'colour'> & {
		code?: string;
		colour?: number;
		status?: Meeting['status'];
	}): Meeting {
		const meeting: Meeting = {
			...input,
			id: makeId('m'),
			code: input.code ?? this.uniqueCode(),
			status: input.status ?? 'scheduled',
			colour: input.colour ?? this.meetings.length % 6,
			createdAt: new Date().toISOString()
		};
		this.meetings = [...this.meetings, meeting];
		this.persist();
		return meeting;
	}

	/** Codes must be unique or "join with code" becomes ambiguous. */
	private uniqueCode(): string {
		for (let attempt = 0; attempt < 50; attempt++) {
			const code = generateCode();
			if (!this.meetings.some((m) => m.code === code)) return code;
		}
		return `${generateCode()}`;
	}

	updateMeeting(id: string, patch: Partial<Meeting>): void {
		this.meetings = this.meetings.map((m) => (m.id === id ? { ...m, ...patch } : m));
		this.persist();
	}

	deleteMeeting(id: string): void {
		this.meetings = this.meetings.filter((m) => m.id !== id);
		// Cascade: orphaned notes/decisions/chat would otherwise linger in storage forever.
		this.notes = this.notes.filter((n) => n.meetingId !== id);
		this.decisions = this.decisions.filter((d) => d.meetingId !== id);
		this.chat = this.chat.filter((c) => c.meetingId !== id);
		// Action items survive but lose their meeting link, because the work still exists.
		this.actionItems = this.actionItems.map((a) =>
			a.meetingId === id ? { ...a, meetingId: null } : a
		);
		this.persist();
	}

	cancelMeeting(id: string): void {
		this.updateMeeting(id, { status: 'cancelled' });
	}

	/**
	 * Reschedule by drag (calendar) or by keyboard.
	 *
	 * For a one-off meeting the start instant moves. For a SERIES, only the dragged
	 * occurrence moves, recorded as an exception, so the rest of the series stays put -
	 * dragging one standup must not move every standup.
	 */
	rescheduleOccurrence(
		meetingId: string,
		originalStart: string,
		newCivilDate: string,
		newTime?: string
	): void {
		const meeting = this.meeting(meetingId);
		if (!meeting) return;

		const wall = newTime ?? timeOfDay(originalStart, meeting.timezone);
		const [h, m] = wall.split(':').map(Number);
		const newStart = instantFromZoned(newCivilDate, h, m, meeting.timezone);

		if (meeting.recurrence.freq === 'none') {
			this.updateMeeting(meetingId, { startsAt: newStart });
			return;
		}

		const exceptions = meeting.exceptions.filter((e) => e.originalStart !== originalStart);
		this.updateMeeting(meetingId, {
			exceptions: [...exceptions, { originalStart, newStart }]
		});
	}

	/** Cancel one occurrence of a series without touching the rest. */
	cancelOccurrence(meetingId: string, originalStart: string): void {
		const meeting = this.meeting(meetingId);
		if (!meeting) return;
		if (meeting.recurrence.freq === 'none') {
			this.cancelMeeting(meetingId);
			return;
		}
		const exceptions = meeting.exceptions.filter((e) => e.originalStart !== originalStart);
		this.updateMeeting(meetingId, {
			exceptions: [...exceptions, { originalStart, newStart: null }]
		});
	}

	/** Start an instant meeting: created, marked live and ready to join immediately. */
	startInstantMeeting(title = 'Instant meeting'): Meeting {
		const now = new Date();
		const zone = this.timezone;
		return this.createMeeting({
			title,
			description: '',
			startsAt: now.toISOString(),
			durationMinutes: this.settings.defaultDurationMinutes,
			timezone: zone,
			recurrence: { freq: 'none', interval: 1 },
			exceptions: [],
			participants: [{ contactId: this.meId, role: 'host' }],
			agenda: [],
			status: 'live'
		});
	}

	/**
	 * End a meeting from the room.
	 *
	 * Records the real duration and attendance, which is exactly what the summary page and
	 * the "hours in meetings" stat read - so ending a meeting updates both with no extra
	 * wiring.
	 */
	endMeeting(meetingId: string, attendedIds: string[], startedAt: string): void {
		const meeting = this.meeting(meetingId);
		if (!meeting) return;
		const endedAt = new Date().toISOString();
		this.updateMeeting(meetingId, {
			status: 'completed',
			endedAt,
			actualMinutes: Math.max(1, minutesBetween(startedAt, endedAt)),
			participants: meeting.participants.map((p) => ({
				...p,
				attended: attendedIds.includes(p.contactId)
			}))
		});
		this.persistNow();
	}

	toggleTopicCovered(meetingId: string, topicId: string): void {
		const meeting = this.meeting(meetingId);
		if (!meeting) return;
		this.updateMeeting(meetingId, {
			agenda: meeting.agenda.map((t) => (t.id === topicId ? { ...t, covered: !t.covered } : t))
		});
	}

	// ---- notes ----

	/** Upsert notes for a meeting. HTML is sanitised on the way in, always. */
	saveNotes(meetingId: string, html: string): void {
		const clean = sanitiseHtml(html);
		const existing = this.notes.find((n) => n.meetingId === meetingId);
		const updatedAt = new Date().toISOString();
		if (existing) {
			this.notes = this.notes.map((n) =>
				n.meetingId === meetingId ? { ...n, html: clean, updatedAt } : n
			);
		} else {
			this.notes = [
				...this.notes,
				{ id: makeId('n'), meetingId, html: clean, updatedAt, authorId: this.meId }
			];
		}
		this.persist();
	}

	addDecision(meetingId: string, text: string): Decision | null {
		const trimmed = text.trim();
		if (!trimmed) return null;
		const decision: Decision = {
			id: makeId('d'),
			meetingId,
			text: trimmed,
			decidedAt: new Date().toISOString(),
			decidedBy: this.meId
		};
		this.decisions = [...this.decisions, decision];
		this.persist();
		return decision;
	}

	removeDecision(id: string): void {
		this.decisions = this.decisions.filter((d) => d.id !== id);
		this.persist();
	}

	// ---- action items ----

	createActionItem(input: {
		meetingId: string | null;
		title: string;
		assigneeId?: string | null;
		dueDate?: string | null;
		priority?: Priority;
		status?: ActionStatus;
		sourceLine?: string;
	}): ActionItem | null {
		const title = input.title.trim();
		if (!title) return null;
		const item: ActionItem = {
			id: makeId('a'),
			meetingId: input.meetingId,
			title,
			assigneeId: input.assigneeId ?? null,
			dueDate: input.dueDate ?? null,
			priority: input.priority ?? 'medium',
			status: input.status ?? 'todo',
			createdAt: new Date().toISOString(),
			...(input.sourceLine ? { sourceLine: input.sourceLine } : {})
		};
		this.actionItems = [...this.actionItems, item];
		this.persist();
		return item;
	}

	updateActionItem(id: string, patch: Partial<ActionItem>): void {
		this.actionItems = this.actionItems.map((a) => {
			if (a.id !== id) return a;
			const next = { ...a, ...patch };
			// Keep completedAt consistent with status, wherever the change came from.
			if (patch.status === 'done' && !next.completedAt) next.completedAt = new Date().toISOString();
			if (patch.status && patch.status !== 'done') delete next.completedAt;
			return next;
		});
		this.persist();
	}

	moveActionItem(id: string, status: ActionStatus): void {
		this.updateActionItem(id, { status });
	}

	deleteActionItem(id: string): void {
		this.actionItems = this.actionItems.filter((a) => a.id !== id);
		this.persist();
	}

	// ---- chat ----

	sendChat(meetingId: string, text: string, authorId = this.meId): ChatMessage | null {
		const trimmed = text.trim();
		if (!trimmed) return null;
		const message: ChatMessage = {
			id: makeId('ch'),
			meetingId,
			authorId,
			text: trimmed,
			sentAt: new Date().toISOString()
		};
		this.chat = [...this.chat, message];
		this.persist();
		return message;
	}

	// ---- contacts and teams ----

	/** Find a contact by email, creating one when the email is new (invite by email chip). */
	ensureContactByEmail(email: string, name?: string): Contact {
		const normalised = email.trim().toLowerCase();
		const existing = this.contacts.find((c) => c.email.toLowerCase() === normalised);
		if (existing) return existing;

		const derived =
			name?.trim() ||
			normalised
				.split('@')[0]
				.split(/[._-]+/)
				.filter(Boolean)
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join(' ') ||
			normalised;

		const contact: Contact = {
			id: makeId('c'),
			name: derived,
			email: email.trim(),
			title: 'Guest',
			hue: this.contacts.length % 6,
			timezone: this.timezone,
			workingHours: { start: 9, end: 18 }
		};
		this.contacts = [...this.contacts, contact];
		this.persist();
		return contact;
	}

	updateContact(id: string, patch: Partial<Contact>): void {
		this.contacts = this.contacts.map((c) => (c.id === id ? { ...c, ...patch } : c));
		this.persist();
	}

	deleteContact(id: string): void {
		if (id === this.meId) return; // you cannot delete yourself
		this.contacts = this.contacts.filter((c) => c.id !== id);
		this.teams = this.teams.map((t) => ({
			...t,
			memberIds: t.memberIds.filter((m) => m !== id)
		}));
		this.meetings = this.meetings.map((m) => ({
			...m,
			participants: m.participants.filter((p) => p.contactId !== id)
		}));
		this.actionItems = this.actionItems.map((a) =>
			a.assigneeId === id ? { ...a, assigneeId: null } : a
		);
		this.persist();
	}

	createTeam(name: string, description: string, memberIds: string[]): Team | null {
		const trimmed = name.trim();
		if (!trimmed) return null;
		const team: Team = { id: makeId('t'), name: trimmed, description: description.trim(), memberIds };
		this.teams = [...this.teams, team];
		this.persist();
		return team;
	}

	updateTeam(id: string, patch: Partial<Team>): void {
		this.teams = this.teams.map((t) => (t.id === id ? { ...t, ...patch } : t));
		this.persist();
	}

	deleteTeam(id: string): void {
		this.teams = this.teams.filter((t) => t.id !== id);
		this.persist();
	}

	// ---- settings ----

	updateSettings(patch: Partial<Settings>): void {
		this.settings = { ...this.settings, ...patch };
		if (patch.theme) this.applyTheme();
		this.persist();
	}

	applyTheme(): void {
		if (!browser) return;
		const theme = this.settings.theme;
		const dark =
			theme === 'dark' ||
			(theme === 'system' &&
				window.matchMedia('(prefers-color-scheme: dark)').matches);
		document.documentElement.classList.toggle('dark', dark);
		// Mirror to its own key so the pre-paint script in app.html can read it cheaply.
		try {
			localStorage.setItem('meetflow:theme', theme);
		} catch {
			// Storage blocked: the theme still applies for this session.
		}
	}

	toggleTheme(): void {
		const current = this.settings.theme;
		const isDark =
			current === 'dark' ||
			(current === 'system' &&
				browser &&
				window.matchMedia('(prefers-color-scheme: dark)').matches);
		this.updateSettings({ theme: isDark ? 'light' : 'dark' });
	}

	// ---- workspace management ----

	resetToSample(): void {
		this.hydrate(buildSampleState());
		this.persistNow();
		this.showToast('Sample workspace restored');
	}

	startFresh(): void {
		this.hydrate(buildEmptyState());
		this.persistNow();
		this.showToast('Workspace cleared');
	}

	backup(): string {
		return exportBackup(this.snapshot());
	}

	restore(text: string): boolean {
		const result = parseBackup(text);
		if (!result.state) {
			this.showToast(result.message || 'That backup could not be read', 'error');
			return false;
		}
		this.hydrate(result.state);
		this.persistNow();
		this.showToast('Backup restored');
		return true;
	}

	/** Used by tests and the settings page's destructive action. */
	wipeStorage(): void {
		clearState();
	}
}

export const app = new AppStore();
