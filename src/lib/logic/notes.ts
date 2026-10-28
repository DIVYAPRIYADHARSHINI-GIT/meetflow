/**
 * Notes, action items, decisions and meeting summaries.
 *
 * The rich-text notes editor is a `contenteditable` region, so everything that comes out of
 * it is treated as untrusted and re-serialised through `sanitiseHtml` before it is stored or
 * re-rendered. Only a tiny tag/attribute allowlist survives; a pasted `<script>`, `<img
 * onerror>` or `javascript:` href is dropped. That is why notes can be rendered with
 * `{@html}` safely.
 */

import type { ActionItem, ActionStatus, Contact, Decision, Meeting, Note, Priority } from '../types';
import { civilDateOf, diffDays, formatDuration, minutesBetween } from './time';

/** Tags the notes editor is allowed to produce. Everything else is unwrapped. */
const ALLOWED_TAGS = new Set([
	'P',
	'BR',
	'B',
	'STRONG',
	'I',
	'EM',
	'U',
	'S',
	'UL',
	'OL',
	'LI',
	'H2',
	'H3',
	'BLOCKQUOTE',
	'CODE',
	'PRE',
	'DIV',
	'SPAN',
	'A'
]);

/** Attributes kept, per tag. Nothing else survives - no style, no event handlers, no id. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
	A: new Set(['href', 'title'])
};

const BLOCK_TAGS = new Set(['P', 'DIV', 'LI', 'H2', 'H3', 'BLOCKQUOTE', 'PRE']);

/** Escape text for safe HTML embedding. */
export function escapeHtml(text: string): string {
	return String(text ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function safeHref(value: string): string | null {
	const trimmed = (value || '').trim();
	// Block javascript:, data: and vbscript: - the classic contenteditable paste vectors.
	if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return null;
	if (/^(https?:\/\/|mailto:|\/|#)/i.test(trimmed)) return trimmed;
	return null;
}

/**
 * Sanitise editor HTML down to the allowlist.
 *
 * Uses DOMParser in the browser. On the server (prerender, unit tests) there is no DOM, so
 * it falls back to a conservative regex strip: tags outside the allowlist are removed and
 * all attributes are dropped. The fallback is stricter than the DOM path, never looser.
 */
export function sanitiseHtml(html: string): string {
	const input = String(html ?? '');
	if (!input.trim()) return '';

	if (typeof DOMParser === 'undefined') return sanitiseWithoutDom(input);

	const doc = new DOMParser().parseFromString(`<body>${input}</body>`, 'text/html');

	const walk = (node: Element) => {
		for (const child of Array.from(node.children)) {
			walk(child);
			if (!ALLOWED_TAGS.has(child.tagName)) {
				// Unwrap rather than delete, so the text inside a <font> or <table> survives.
				child.replaceWith(...Array.from(child.childNodes));
				continue;
			}
			const allowed = ALLOWED_ATTRS[child.tagName] ?? new Set<string>();
			for (const attr of Array.from(child.attributes)) {
				if (!allowed.has(attr.name.toLowerCase())) {
					child.removeAttribute(attr.name);
					continue;
				}
				if (attr.name.toLowerCase() === 'href') {
					const href = safeHref(attr.value);
					if (href === null) child.removeAttribute('href');
					else child.setAttribute('href', href);
				}
			}
			if (child.tagName === 'A') {
				child.setAttribute('rel', 'noopener noreferrer');
				child.setAttribute('target', '_blank');
			}
		}
	};

	walk(doc.body);
	return doc.body.innerHTML;
}

function sanitiseWithoutDom(input: string): string {
	return input
		.replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\/\s*\1\s*>/gi, '')
		.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (_match, rawTag: string) => {
			const tag = rawTag.toUpperCase();
			if (!ALLOWED_TAGS.has(tag) || tag === 'A' || tag === 'SPAN' || tag === 'DIV') {
				return tag === 'BR' ? '<br>' : '';
			}
			return _match.startsWith('</') ? `</${rawTag.toLowerCase()}>` : `<${rawTag.toLowerCase()}>`;
		});
}

/**
 * Split notes HTML into plain-text lines.
 *
 * This is what powers "create an action item from this line": the editor shows one control
 * per block, and the line text it passes back is produced here so the stored
 * `sourceLine` always matches what the user clicked.
 */
export function htmlToLines(html: string): string[] {
	const input = String(html ?? '');
	if (!input.trim()) return [];

	if (typeof DOMParser === 'undefined') {
		return input
			.replace(/<\s*br\s*\/?\s*>/gi, '\n')
			.replace(/<\/\s*(p|div|li|h2|h3|blockquote|pre)\s*>/gi, '\n')
			.replace(/<[^>]+>/g, '')
			.split('\n')
			.map(decodeEntities)
			.map((line) => line.trim())
			.filter(Boolean);
	}

	const doc = new DOMParser().parseFromString(`<body>${input}</body>`, 'text/html');
	const lines: string[] = [];
	const pushBlock = (node: Node) => {
		const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
		if (text) lines.push(text);
	};

	const blocks = doc.body.querySelectorAll('p, div, li, h2, h3, blockquote, pre');
	if (blocks.length === 0) {
		for (const part of (doc.body.textContent ?? '').split('\n')) {
			const text = part.replace(/\s+/g, ' ').trim();
			if (text) lines.push(text);
		}
		return lines;
	}
	for (const block of Array.from(blocks)) {
		// Skip a wrapper whose text is entirely covered by nested blocks, to avoid duplicates.
		if (block.querySelector('p, div, li, h2, h3, blockquote, pre')) continue;
		pushBlock(block);
	}
	return lines;
}

function decodeEntities(text: string): string {
	return text
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

/** Plain text of notes HTML, for word counts and summary export. */
export function htmlToText(html: string): string {
	return htmlToLines(html).join('\n');
}

/** Wrap plain text lines as editor HTML. */
export function textToHtml(text: string): string {
	return String(text ?? '')
		.split(/\r?\n/)
		.map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`)
		.join('');
}

export function wordCount(html: string): number {
	const text = htmlToText(html).trim();
	return text ? text.split(/\s+/).length : 0;
}

/**
 * Guess an action item from a note line.
 *
 * Deliberately simple and explainable, never a language model: strip a leading bullet or
 * "TODO:"/"Action:" marker, detect an @name mention for the assignee, and detect a bare
 * "by Friday"-style hint only when it is unambiguous. The user always sees and can edit
 * the result before it is saved.
 */
export interface ActionSuggestion {
	title: string;
	assigneeId: string | null;
	priority: Priority;
}

export function suggestActionFromLine(line: string, contacts: Contact[]): ActionSuggestion {
	let title = String(line ?? '')
		.replace(/^[\s\-*•\u2022]+/, '')
		.replace(/^(todo|to-do|action|action item|task)\s*[:\-]\s*/i, '')
		.trim();

	// Resolve @mentions by matching against the REAL contact names rather than guessing where
	// a name ends. A regex like /@([\p{L}][\p{L}\s]*)/ swallows the rest of the sentence
	// ("@Priya to send the quote" -> name "Priya to send the quote"), which then deletes the
	// whole title when the mention is stripped. Candidates are tried longest-first so
	// "@Marcus Webb" wins over "@Marcus".
	let assigneeId: string | null = null;
	const candidates = contacts
		.flatMap((c) => {
			const first = c.name.trim().split(/\s+/)[0];
			return [
				{ id: c.id, text: c.name.trim() },
				...(first && first !== c.name.trim() ? [{ id: c.id, text: first }] : [])
			];
		})
		.sort((a, b) => b.text.length - a.text.length);

	for (const candidate of candidates) {
		// Case-insensitive, and the mention must end on a word boundary so "@Ana" does not
		// match inside "@Anastasia".
		const pattern = new RegExp(
			`@${candidate.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`,
			'iu'
		);
		const found = title.match(pattern);
		if (found) {
			assigneeId = candidate.id;
			title = title.replace(found[0], '').replace(/\s{2,}/g, ' ').trim();
			break;
		}
	}

	const priority: Priority = /\b(urgent|asap|critical|blocker|p0)\b/i.test(line)
		? 'high'
		: /\b(whenever|nice to have|low priority|someday)\b/i.test(line)
			? 'low'
			: 'medium';

	return { title: title.replace(/\s*[-–—]\s*$/, '').trim(), assigneeId, priority };
}

export interface ActionFilters {
	meetingId?: string | null;
	assigneeId?: string | null;
	status?: ActionStatus | null;
	priority?: Priority | null;
	/** "overdue" | "today" | "week" | null */
	due?: 'overdue' | 'today' | 'week' | null;
	search?: string;
}

/**
 * Filter action items. One function used by the board, the dashboard stat cards and the
 * summary page, so a filter can never mean different things in different places.
 */
export function filterActionItems(
	items: ActionItem[],
	filters: ActionFilters,
	today: string
): ActionItem[] {
	const search = (filters.search ?? '').trim().toLowerCase();

	return items.filter((item) => {
		if (filters.meetingId && item.meetingId !== filters.meetingId) return false;
		if (filters.assigneeId && item.assigneeId !== filters.assigneeId) return false;
		if (filters.status && item.status !== filters.status) return false;
		if (filters.priority && item.priority !== filters.priority) return false;

		if (filters.due) {
			if (!item.dueDate) return false;
			const delta = diffDays(today, item.dueDate);
			if (filters.due === 'overdue' && !(delta < 0 && item.status !== 'done')) return false;
			if (filters.due === 'today' && delta !== 0) return false;
			if (filters.due === 'week' && (delta < 0 || delta > 7)) return false;
		}

		if (search && !item.title.toLowerCase().includes(search)) return false;
		return true;
	});
}

/** Is this item past its due date and still open? */
export function isOverdue(item: ActionItem, today: string): boolean {
	if (!item.dueDate || item.status === 'done') return false;
	return diffDays(today, item.dueDate) < 0;
}

/** Group items into the three board columns, preserving order within each. */
export function groupByStatus(items: ActionItem[]): Record<ActionStatus, ActionItem[]> {
	const groups: Record<ActionStatus, ActionItem[]> = { todo: [], 'in-progress': [], done: [] };
	for (const item of items) groups[item.status]?.push(item);
	return groups;
}

/**
 * Completion rate as a percentage of all non-cancelled items.
 * Returns null - not 0 - when there is nothing to measure, so the UI can show a dash
 * instead of implying a real 0%.
 */
export function completionRate(items: ActionItem[]): number | null {
	if (items.length === 0) return null;
	const done = items.filter((i) => i.status === 'done').length;
	return Math.round((done / items.length) * 100);
}

export interface MeetingSummary {
	meeting: Meeting;
	/** Minutes actually spent, falling back to the scheduled duration. */
	durationMinutes: number;
	scheduledMinutes: number;
	topicsCovered: number;
	topicsTotal: number;
	attendees: { contact: Contact; role: string; attended: boolean }[];
	attendanceRate: number | null;
	decisions: Decision[];
	actionItems: ActionItem[];
	openActionItems: number;
	notes: Note | null;
	noteWords: number;
}

/**
 * Assemble everything the summary page and the PDF export need.
 *
 * Reads only from the records it is given, so the summary can never disagree with the
 * board, the history list or the dashboard.
 */
export function buildSummary(
	meeting: Meeting,
	data: {
		contacts: Contact[];
		notes: Note[];
		decisions: Decision[];
		actionItems: ActionItem[];
	}
): MeetingSummary {
	const byId = new Map(data.contacts.map((c) => [c.id, c]));

	const attendees = meeting.participants
		.map((p) => {
			const contact = byId.get(p.contactId);
			if (!contact) return null;
			return {
				contact,
				role: p.role === 'host' ? 'Host' : 'Participant',
				attended: p.attended ?? false
			};
		})
		.filter((a): a is NonNullable<typeof a> => a !== null);

	const attended = attendees.filter((a) => a.attended).length;
	const notes = data.notes.find((n) => n.meetingId === meeting.id) ?? null;
	const actionItems = data.actionItems.filter((a) => a.meetingId === meeting.id);

	const actualMinutes =
		meeting.actualMinutes ??
		(meeting.endedAt ? minutesBetween(meeting.startsAt, meeting.endedAt) : null);

	return {
		meeting,
		durationMinutes: actualMinutes ?? meeting.durationMinutes,
		scheduledMinutes: meeting.durationMinutes,
		topicsCovered: meeting.agenda.filter((t) => t.covered).length,
		topicsTotal: meeting.agenda.length,
		attendees,
		attendanceRate: attendees.length ? Math.round((attended / attendees.length) * 100) : null,
		decisions: data.decisions.filter((d) => d.meetingId === meeting.id),
		actionItems,
		openActionItems: actionItems.filter((a) => a.status !== 'done').length,
		notes,
		noteWords: notes ? wordCount(notes.html) : 0
	};
}

/** Plain-text summary used by the "copy" and "email draft" buttons. */
export function summaryToText(summary: MeetingSummary, timezone: string): string {
	const s = summary;
	const lines: string[] = [
		s.meeting.title,
		'='.repeat(Math.min(60, s.meeting.title.length)),
		`When: ${civilDateOf(s.meeting.startsAt, timezone)}`,
		`Duration: ${formatDuration(s.durationMinutes)} (scheduled ${formatDuration(
			s.scheduledMinutes
		)})`,
		`Attendance: ${s.attendees.filter((a) => a.attended).length}/${s.attendees.length}`,
		''
	];

	if (s.meeting.agenda.length) {
		lines.push('AGENDA', ...s.meeting.agenda.map((t) => `  ${t.covered ? '[x]' : '[ ]'} ${t.title} (${t.minutes}m)`), '');
	}
	if (s.decisions.length) {
		lines.push('DECISIONS', ...s.decisions.map((d) => `  - ${d.text}`), '');
	}
	if (s.actionItems.length) {
		lines.push('ACTION ITEMS');
		for (const item of s.actionItems) {
			const due = item.dueDate ? ` (due ${item.dueDate})` : '';
			lines.push(`  [${item.status === 'done' ? 'x' : ' '}] ${item.title}${due}`);
		}
		lines.push('');
	}
	if (s.notes && s.noteWords > 0) {
		lines.push('NOTES', htmlToText(s.notes.html), '');
	}
	return lines.join('\n').trimEnd();
}

/** Stable, readable id. Not a UUID, but unique enough for one browser's data. */
export function makeId(prefix: string, rand: () => number = Math.random): string {
	const stamp = Date.now().toString(36);
	const noise = Math.floor(rand() * 1_679_616)
		.toString(36)
		.padStart(4, '0');
	return `${prefix}-${stamp}${noise}`;
}

/** Initials for an avatar: "Priya Sharma" -> "PS", handling one-word and emoji names. */
export function initialsOf(name: string): string {
	const words = String(name ?? '')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (words.length === 0) return '?';
	const letters = words
		.map((w) => Array.from(w)[0] ?? '')
		.join('')
		.toUpperCase();
	return Array.from(letters).slice(0, 2).join('') || '?';
}
