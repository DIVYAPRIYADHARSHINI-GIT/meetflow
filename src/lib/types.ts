/**
 * MeetFlow data models.
 *
 * Design rules that the rest of the app depends on:
 *
 * 1. A meeting's time is stored as ONE UTC instant (`startsAt`, ISO 8601 with Z) plus the
 *    IANA timezone it was scheduled in (`timezone`) and a duration in minutes. Wall-clock
 *    strings are never stored, because "09:00" is meaningless without a zone and breaks
 *    across DST. Everything user-facing is rendered from the instant through `time.ts`.
 * 2. Recurrence is stored as a RULE, never as expanded copies. Occurrences are derived on
 *    demand (see `schedule.ts`), so editing the series cannot leave orphaned rows. A single
 *    occurrence can be overridden or cancelled via `exceptions`.
 * 3. Everything is addressed by id. Notes point at a meeting id, action items point at a
 *    meeting id and a contact id. Nothing embeds a copy of another record.
 * 4. Every persisted shape is versioned by `SCHEMA_VERSION` in `stores/storage.ts`.
 */

/** ISO 8601 instant, always UTC, e.g. "2026-03-02T09:00:00.000Z". */
export type Instant = string;

/** Civil date, "YYYY-MM-DD". Used for due dates, which have no time of day. */
export type CivilDate = string;

export type Role = 'host' | 'participant';

export type MeetingStatus = 'scheduled' | 'live' | 'completed' | 'cancelled';

export type RecurrenceFreq = 'none' | 'daily' | 'weekly' | 'monthly';

export type Priority = 'low' | 'medium' | 'high';

export type ActionStatus = 'todo' | 'in-progress' | 'done';

export interface Contact {
	id: string;
	name: string;
	email: string;
	/** Short role/title shown under the name in pickers. */
	title: string;
	/** Optional accent colour index (0-5) for the initials avatar. */
	hue: number;
	timezone: string;
	/** Rough weekly availability used for the free/busy hints in the scheduler. */
	workingHours: { start: number; end: number };
}

export interface Team {
	id: string;
	name: string;
	description: string;
	memberIds: string[];
}

export interface Participant {
	contactId: string;
	role: Role;
	/** Set when the meeting has been held. */
	attended?: boolean;
}

export interface AgendaTopic {
	id: string;
	title: string;
	/** Time allocation in minutes. */
	minutes: number;
	owner?: string;
	/** Marked true in the room when the topic has been discussed. */
	covered?: boolean;
}

export interface Recurrence {
	freq: RecurrenceFreq;
	/** Every N days/weeks/months. 1 = every one. */
	interval: number;
	/** Number of occurrences including the first. 0 / undefined = open ended (capped). */
	count?: number;
	/** Inclusive civil date after which no occurrence is produced. */
	until?: CivilDate;
}

/** A single occurrence of a recurring series that was moved or cancelled. */
export interface RecurrenceException {
	/** The original occurrence instant this exception replaces. */
	originalStart: Instant;
	/** New instant, or null when the occurrence is cancelled. */
	newStart: Instant | null;
}

export interface Meeting {
	id: string;
	title: string;
	description: string;
	/** UTC instant of the (first) occurrence. */
	startsAt: Instant;
	durationMinutes: number;
	/** IANA zone the meeting was scheduled in, e.g. "Asia/Kolkata". */
	timezone: string;
	recurrence: Recurrence;
	exceptions: RecurrenceException[];
	participants: Participant[];
	agenda: AgendaTopic[];
	/** Short human code for "join with code", e.g. "QJD-4417". */
	code: string;
	status: MeetingStatus;
	/** Colour token index used by the calendar. */
	colour: number;
	createdAt: Instant;
	/** Set when the meeting was actually ended in the room. */
	endedAt?: Instant;
	/** Real attended duration in minutes, set when the room is left. */
	actualMinutes?: number;
}

/** One block of meeting notes. Stored as plain text lines + light inline markup. */
export interface Note {
	id: string;
	meetingId: string;
	/** Rich text stored as sanitised HTML produced only by our own editor. */
	html: string;
	updatedAt: Instant;
	authorId: string;
}

export interface Decision {
	id: string;
	meetingId: string;
	text: string;
	decidedAt: Instant;
	decidedBy: string;
}

export interface ActionItem {
	id: string;
	meetingId: string | null;
	title: string;
	assigneeId: string | null;
	dueDate: CivilDate | null;
	priority: Priority;
	status: ActionStatus;
	createdAt: Instant;
	completedAt?: Instant;
	/** Note line this was created from, for traceability back to the source. */
	sourceLine?: string;
}

export interface ChatMessage {
	id: string;
	meetingId: string;
	authorId: string;
	text: string;
	sentAt: Instant;
	system?: boolean;
}

/** Live, per-room state. Not persisted between sessions except the chat log. */
export interface RoomParticipantState {
	contactId: string;
	muted: boolean;
	cameraOff: boolean;
	handRaised: boolean;
	speaking: boolean;
	reaction?: { emoji: string; at: number };
	/** True for the browser user. */
	isSelf?: boolean;
}

export interface Settings {
	profileName: string;
	profileEmail: string;
	profileTitle: string;
	defaultDurationMinutes: number;
	timezone: string;
	theme: 'light' | 'dark' | 'system';
	notifications: {
		emailReminders: boolean;
		reminderMinutes: number;
		dailyDigest: boolean;
		actionItemNudges: boolean;
	};
	/** Join the room with mic/camera already off. */
	joinMuted: boolean;
	joinCameraOff: boolean;
}

/** Everything that is persisted, under one version number. */
export interface PersistedState {
	version: number;
	contacts: Contact[];
	teams: Team[];
	meetings: Meeting[];
	notes: Note[];
	decisions: Decision[];
	actionItems: ActionItem[];
	chat: ChatMessage[];
	settings: Settings;
	/** Local contact id that represents the person using the browser. */
	meId: string;
}

/** A concrete, dated instance of a meeting - what calendars and lists actually render. */
export interface Occurrence {
	meetingId: string;
	/** Instant of THIS occurrence (may differ from meeting.startsAt for a series). */
	startsAt: Instant;
	endsAt: Instant;
	/** Instant of the un-moved occurrence, used to match exceptions. */
	originalStart: Instant;
	/** 0 for the first occurrence of a series. */
	index: number;
	meeting: Meeting;
}

export const PRIORITIES: Priority[] = ['low', 'medium', 'high'];
export const ACTION_STATUSES: ActionStatus[] = ['todo', 'in-progress', 'done'];
export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
	todo: 'To do',
	'in-progress': 'In progress',
	done: 'Done'
};
