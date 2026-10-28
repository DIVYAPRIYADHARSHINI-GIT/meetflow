/**
 * Timezone-safe date/time primitives.
 *
 * THE RULE: an instant is a UTC ISO string. A civil date is "YYYY-MM-DD" with no zone. A
 * wall-clock time is {hour, minute} with no zone. You convert between them only through
 * this module, always naming the IANA zone.
 *
 * Why not just `new Date("2026-03-02T09:00")`? Because that parses in the HOST zone, so the
 * same saved meeting lands at a different hour depending on who opens the app. And why not
 * add 24*60*60*1000 to recur daily? Because a DST day is 23 or 25 hours long, so a 09:00
 * standup would drift to 08:00 or 10:00. Recurrence therefore walks CIVIL dates and
 * re-resolves the wall clock in the meeting's own zone for every occurrence.
 *
 * Everything here is pure and uses only `Intl.DateTimeFormat`, which is built into every
 * browser and Node 18+. No date library.
 */

export interface ZonedParts {
	year: number;
	month: number; // 1-12
	day: number; // 1-31
	hour: number; // 0-23
	minute: number;
	second: number;
	/** 0 = Sunday .. 6 = Saturday, in the target zone. */
	weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
	Sun: 0,
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6
};

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
	let fmt = partsCache.get(timeZone);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hour12: false,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			weekday: 'short'
		});
		partsCache.set(timeZone, fmt);
	}
	return fmt;
}

/** True when the string names a zone this runtime can actually resolve. */
export function isValidTimezone(timeZone: string): boolean {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone });
		return true;
	} catch {
		return false;
	}
}

/** The browser/host zone, with a safe fallback. */
export function localTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}

/** Break an instant into wall-clock parts in the given zone. */
export function zonedParts(instant: string | Date, timeZone: string): ZonedParts {
	const date = typeof instant === 'string' ? new Date(instant) : instant;
	if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid instant: ${String(instant)}`);
	const parts = partsFormatter(timeZone).formatToParts(date);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
	// Intl renders midnight as hour "24" in some engines/zones; normalise to 0.
	const rawHour = Number(get('hour'));
	return {
		year: Number(get('year')),
		month: Number(get('month')),
		day: Number(get('day')),
		hour: rawHour === 24 ? 0 : rawHour,
		minute: Number(get('minute')),
		second: Number(get('second')),
		weekday: WEEKDAY_INDEX[get('weekday')] ?? 0
	};
}

/** Offset of `timeZone` at `instant`, in minutes east of UTC (IST = +330). */
export function zoneOffsetMinutes(instant: string | Date, timeZone: string): number {
	const date = typeof instant === 'string' ? new Date(instant) : instant;
	const p = zonedParts(date, timeZone);
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	// Round to the minute: Date.UTC drops the milliseconds the original instant may carry,
	// so the raw difference can be a few hundred ms short of a whole-minute offset.
	return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * Resolve a wall clock in a zone to a UTC instant.
 *
 * Offset-guessing needs care around DST, so this verifies its own answer instead of
 * trusting a fixed number of passes:
 *
 * - Candidate A assumes the offset in force at the naive UTC time.
 * - Candidate B re-resolves using the offset in force at A, which fixes the normal case
 *   where A guessed with the wrong side of a transition.
 * - Whichever candidate actually reads back as the requested wall clock wins. For an
 *   AMBIGUOUS time (01:30 on a fall-back day happens twice) both are valid and the later
 *   pass is returned, matching what calendar apps show.
 * - When NEITHER reads back, the requested time does not exist - it is inside the hour
 *   skipped when clocks spring forward. A naive loop oscillates between the two offsets
 *   forever here; instead candidate A is returned, which shifts the meeting FORWARD into
 *   the new offset (02:30 -> 03:30). That is the RFC 5545 / Google Calendar behaviour, and
 *   it never silently moves a meeting to the day before.
 */
export function instantFromZoned(
	civilDate: string,
	hour: number,
	minute: number,
	timeZone: string
): string {
	const [y, m, d] = civilDate.split('-').map(Number);
	if (!y || !m || !d) throw new RangeError(`Invalid civil date: ${civilDate}`);
	const naive = Date.UTC(y, m - 1, d, hour, minute, 0, 0);

	const candidateA = naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60000;
	const candidateB = naive - zoneOffsetMinutes(new Date(candidateA), timeZone) * 60000;

	const reads = (t: number) => {
		const p = zonedParts(new Date(t), timeZone);
		return p.hour === hour && p.minute === minute && p.day === d && p.month === m;
	};

	if (reads(candidateB)) return new Date(candidateB).toISOString();
	if (reads(candidateA)) return new Date(candidateA).toISOString();
	return new Date(candidateA).toISOString();
}

/** "YYYY-MM-DD" of an instant, in the given zone. */
export function civilDateOf(instant: string | Date, timeZone: string): string {
	const p = zonedParts(instant, timeZone);
	return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Minutes from midnight of an instant, in the given zone. */
export function minutesOfDay(instant: string | Date, timeZone: string): number {
	const p = zonedParts(instant, timeZone);
	return p.hour * 60 + p.minute;
}

/** "HH:MM" of an instant, in the given zone. */
export function timeOfDay(instant: string | Date, timeZone: string): string {
	const p = zonedParts(instant, timeZone);
	return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}
function pad4(n: number): string {
	return String(n).padStart(4, '0');
}

/** Add whole days to a civil date. Pure string maths - no zone involved, so DST-proof. */
export function addDays(civilDate: string, days: number): string {
	const [y, m, d] = civilDate.split('-').map(Number);
	const t = Date.UTC(y, m - 1, d) + days * 86400000;
	const dt = new Date(t);
	return `${pad4(dt.getUTCFullYear())}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Days in a civil month. */
export function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Add whole months to a civil date, clamping to the end of the target month.
 *
 * 2026-01-31 + 1 month = 2026-02-28, not 2026-03-03. This is the behaviour every calendar
 * product uses, and the reason "monthly on the 31st" is tested explicitly.
 */
export function addMonths(civilDate: string, months: number): string {
	const [y, m, d] = civilDate.split('-').map(Number);
	const total = (y * 12 + (m - 1)) + months;
	const ny = Math.floor(total / 12);
	const nm = (total % 12) + 1;
	const nd = Math.min(d, daysInMonth(ny, nm));
	return `${pad4(ny)}-${pad2(nm)}-${pad2(nd)}`;
}

/** Difference in whole days between two civil dates (b - a). */
export function diffDays(a: string, b: string): number {
	const [ay, am, ad] = a.split('-').map(Number);
	const [by, bm, bd] = b.split('-').map(Number);
	return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/** 0 = Sunday .. 6 = Saturday, for a civil date. */
export function weekdayOf(civilDate: string): number {
	const [y, m, d] = civilDate.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Monday-based start of the week containing `civilDate`. */
export function startOfWeek(civilDate: string, weekStartsOn = 1): string {
	const wd = weekdayOf(civilDate);
	const delta = (wd - weekStartsOn + 7) % 7;
	return addDays(civilDate, -delta);
}

/** First civil date of the month containing `civilDate`. */
export function startOfMonth(civilDate: string): string {
	const [y, m] = civilDate.split('-').map(Number);
	return `${pad4(y)}-${pad2(m)}-01`;
}

/** The 6x7 grid of civil dates a month view renders. */
export function monthGrid(civilDate: string, weekStartsOn = 1): string[] {
	const first = startOfMonth(civilDate);
	const gridStart = startOfWeek(first, weekStartsOn);
	return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}

/** Add minutes to an instant. Safe: instants are absolute, so DST cannot interfere. */
export function addMinutes(instant: string, minutes: number): string {
	return new Date(new Date(instant).getTime() + minutes * 60000).toISOString();
}

/** Minutes between two instants (b - a). */
export function minutesBetween(a: string, b: string): number {
	return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

const LABEL_CACHE = new Map<string, Intl.DateTimeFormat>();
function labelFormatter(timeZone: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = `${timeZone}|${JSON.stringify(opts)}`;
	let fmt = LABEL_CACHE.get(key);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat('en-GB', { timeZone, ...opts });
		LABEL_CACHE.set(key, fmt);
	}
	return fmt;
}

/** "09:00" style clock label in a zone. */
export function formatTime(instant: string, timeZone: string): string {
	return labelFormatter(timeZone, { hour: '2-digit', minute: '2-digit', hour12: false }).format(
		new Date(instant)
	);
}

/** "Mon 2 Mar" style short date label in a zone. */
export function formatDateShort(instant: string, timeZone: string): string {
	return labelFormatter(timeZone, {
		weekday: 'short',
		day: 'numeric',
		month: 'short'
	}).format(new Date(instant));
}

/** "Monday, 2 March 2026" style long date label in a zone. */
export function formatDateLong(instant: string, timeZone: string): string {
	return labelFormatter(timeZone, {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	}).format(new Date(instant));
}

/** "2 Mar 2026, 09:00" combined label. */
export function formatDateTime(instant: string, timeZone: string): string {
	return `${labelFormatter(timeZone, { day: 'numeric', month: 'short', year: 'numeric' }).format(
		new Date(instant)
	)}, ${formatTime(instant, timeZone)}`;
}

/** Civil date label like "2 March 2026" without needing an instant. */
export function formatCivilDate(civilDate: string): string {
	const [y, m, d] = civilDate.split('-').map(Number);
	return new Intl.DateTimeFormat('en-GB', {
		timeZone: 'UTC',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	}).format(new Date(Date.UTC(y, m - 1, d)));
}

/** "GMT+5:30" style label for a zone at an instant. */
export function zoneLabel(timeZone: string, instant = new Date().toISOString()): string {
	const mins = zoneOffsetMinutes(instant, timeZone);
	const sign = mins < 0 ? '-' : '+';
	const abs = Math.abs(mins);
	const h = Math.floor(abs / 60);
	const m = abs % 60;
	return `GMT${sign}${h}${m ? `:${pad2(m)}` : ''}`;
}

/** "45m" / "1h 30m" duration label. */
export function formatDuration(minutes: number): string {
	const safe = Math.max(0, Math.round(minutes));
	const h = Math.floor(safe / 60);
	const m = safe % 60;
	if (h && m) return `${h}h ${m}m`;
	if (h) return `${h}h`;
	return `${m}m`;
}

/** "in 2 hours" / "3 days ago" relative label, from `now`. */
export function relativeLabel(instant: string, now = new Date()): string {
	const diffMs = new Date(instant).getTime() - now.getTime();
	const abs = Math.abs(diffMs);
	const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
	const minute = 60000;
	const hour = 60 * minute;
	const day = 24 * hour;
	if (abs < minute) return 'now';
	if (abs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
	if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
	if (abs < 7 * day) return rtf.format(Math.round(diffMs / day), 'day');
	if (abs < 30 * day) return rtf.format(Math.round(diffMs / (7 * day)), 'week');
	return rtf.format(Math.round(diffMs / (30 * day)), 'month');
}

/** A short list of zones offered in the scheduler, plus whatever the user is actually in. */
export const COMMON_TIMEZONES = [
	'Asia/Kolkata',
	'UTC',
	'Europe/London',
	'Europe/Berlin',
	'Europe/Lisbon',
	'America/New_York',
	'America/Chicago',
	'America/Denver',
	'America/Los_Angeles',
	'America/Sao_Paulo',
	'Asia/Dubai',
	'Asia/Singapore',
	'Asia/Tokyo',
	'Australia/Sydney',
	'Pacific/Auckland'
];
