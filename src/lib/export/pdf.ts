/**
 * Dependency-free PDF writer for meeting summaries.
 *
 * Writes a minimal but valid PDF 1.4 by hand: objects, an xref table and a trailer, with
 * text drawn in the standard Helvetica fonts that every reader has built in. No pdf-lib, no
 * fonts to ship, and the output opens in Preview, Acrobat and Chrome.
 *
 * WinAnsi only. Helvetica has no Tamil or Devanagari glyphs, so non-Latin characters are
 * transliterated to '?' rather than emitted as broken boxes. `summaryToText` remains the
 * lossless path for those, and the UI says so.
 */

import type { MeetingSummary } from '../logic/notes';
import { htmlToLines } from '../logic/notes';
import { civilDateOf, formatDuration, formatTime } from '../logic/time';

/** Widths (per 1000 units) for Helvetica, used to wrap text at a real measured width. */
const HELVETICA_WIDTHS: Record<string, number> = {
	' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
	'(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
	'0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
	'8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
	'@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
	I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778,
	R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
	'[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333, a: 556, b: 556,
	c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500,
	l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
	u: 556, v: 500, w: 722, x: 500, y: 500, z: 500, '{': 334, '|': 260, '}': 334,
	'~': 584
};

/** Bold is wider; a scale factor is close enough for layout and avoids a second table. */
const BOLD_SCALE = 1.06;

function charWidth(ch: string, bold: boolean): number {
	const base = HELVETICA_WIDTHS[ch] ?? 556;
	return bold ? base * BOLD_SCALE : base;
}

function textWidth(text: string, size: number, bold: boolean): number {
	let total = 0;
	for (const ch of text) total += charWidth(ch, bold);
	return (total / 1000) * size;
}

/** Replace characters Helvetica cannot draw, so the PDF never shows broken glyphs. */
function toWinAnsi(text: string): string {
	return Array.from(text ?? '')
		.map((ch) => {
			const code = ch.codePointAt(0) ?? 63;
			if (code === 10 || code === 13) return ' ';
			if (code >= 32 && code <= 126) return ch;
			// Common typographic characters that do have WinAnsi equivalents.
			const map: Record<string, string> = {
				'\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"',
				'\u2013': '-', '\u2014': '-', '\u2026': '...', '\u00a0': ' ',
				'\u2022': '-', '\u2713': 'x', '\u20b9': 'Rs.'
			};
			return map[ch] ?? '?';
		})
		.join('');
}

/** Escape the characters that are special inside a PDF string literal. */
function escapePdfText(text: string): string {
	return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Greedy word wrap at a measured pixel width. */
function wrap(text: string, size: number, bold: boolean, maxWidth: number): string[] {
	const words = toWinAnsi(text).split(/\s+/).filter(Boolean);
	if (words.length === 0) return [];
	const lines: string[] = [];
	let current = '';

	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (textWidth(candidate, size, bold) <= maxWidth) {
			current = candidate;
		} else {
			if (current) lines.push(current);
			// A single word longer than the line gets hard-split rather than overflowing.
			if (textWidth(word, size, bold) > maxWidth) {
				let chunk = '';
				for (const ch of word) {
					if (textWidth(chunk + ch, size, bold) > maxWidth) {
						lines.push(chunk);
						chunk = ch;
					} else {
						chunk += ch;
					}
				}
				current = chunk;
			} else {
				current = word;
			}
		}
	}
	if (current) lines.push(current);
	return lines;
}

// A4 at 72dpi.
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

interface PageBuilder {
	ops: string[];
	y: number;
}

/** Build the content streams for a summary, paginating as it goes. */
function buildPages(summary: MeetingSummary, timezone: string): string[] {
	const pages: PageBuilder[] = [];
	let page: PageBuilder = { ops: [], y: PAGE_HEIGHT - MARGIN };
	pages.push(page);

	const newPage = () => {
		page = { ops: [], y: PAGE_HEIGHT - MARGIN };
		pages.push(page);
	};

	const space = (needed: number) => {
		if (page.y - needed < MARGIN) newPage();
	};

	const write = (
		text: string,
		options: { size?: number; bold?: boolean; gap?: number; indent?: number; grey?: boolean } = {}
	) => {
		const size = options.size ?? 10;
		const bold = options.bold ?? false;
		const indent = options.indent ?? 0;
		const lineHeight = size * 1.45;
		const lines = wrap(text, size, bold, CONTENT_WIDTH - indent);

		for (const line of lines) {
			space(lineHeight);
			page.ops.push(
				`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${
					options.grey ? '0.42 0.45 0.5 rg' : '0.06 0.09 0.16 rg'
				} 1 0 0 1 ${MARGIN + indent} ${page.y - size} Tm (${escapePdfText(line)}) Tj ET`
			);
			page.y -= lineHeight;
		}
		if (options.gap) page.y -= options.gap;
	};

	const rule = () => {
		space(12);
		page.ops.push(
			`0.85 0.87 0.9 RG 0.8 w ${MARGIN} ${page.y - 4} m ${PAGE_WIDTH - MARGIN} ${page.y - 4} l S`
		);
		page.y -= 14;
	};

	// ---- header ----
	write('MEETFLOW MEETING SUMMARY', { size: 8, bold: true, grey: true, gap: 6 });
	write(summary.meeting.title, { size: 19, bold: true, gap: 4 });

	const when = `${civilDateOf(summary.meeting.startsAt, timezone)} at ${formatTime(
		summary.meeting.startsAt,
		timezone
	)}`;
	write(
		`${when} · ${formatDuration(summary.durationMinutes)} (scheduled ${formatDuration(
			summary.scheduledMinutes
		)}) · code ${summary.meeting.code}`,
		{ size: 9, grey: true, gap: 8 }
	);
	rule();

	// ---- at a glance ----
	const attended = summary.attendees.filter((a) => a.attended).length;
	write('At a glance', { size: 12, bold: true, gap: 4 });
	write(
		`Attendance: ${attended} of ${summary.attendees.length}` +
			(summary.attendanceRate !== null ? ` (${summary.attendanceRate}%)` : '') +
			`   |   Agenda covered: ${summary.topicsCovered} of ${summary.topicsTotal}` +
			`   |   Decisions: ${summary.decisions.length}` +
			`   |   Action items: ${summary.actionItems.length} (${summary.openActionItems} open)`,
		{ size: 9.5, gap: 10 }
	);

	// ---- agenda ----
	if (summary.meeting.agenda.length > 0) {
		write('Agenda', { size: 12, bold: true, gap: 4 });
		for (const topic of summary.meeting.agenda) {
			write(`${topic.covered ? '[x]' : '[ ]'}  ${topic.title}  (${topic.minutes} min)`, {
				size: 9.5,
				indent: 6
			});
		}
		page.y -= 8;
	}

	// ---- attendance ----
	if (summary.attendees.length > 0) {
		write('Attendance', { size: 12, bold: true, gap: 4 });
		for (const attendee of summary.attendees) {
			write(
				`${attendee.attended ? '[x]' : '[ ]'}  ${attendee.contact.name} - ${attendee.role}`,
				{ size: 9.5, indent: 6 }
			);
		}
		page.y -= 8;
	}

	// ---- decisions ----
	if (summary.decisions.length > 0) {
		write('Decisions', { size: 12, bold: true, gap: 4 });
		for (const decision of summary.decisions) {
			write(`-  ${decision.text}`, { size: 9.5, indent: 6 });
		}
		page.y -= 8;
	}

	// ---- action items ----
	if (summary.actionItems.length > 0) {
		write('Action items', { size: 12, bold: true, gap: 4 });
		for (const item of summary.actionItems) {
			const parts = [item.priority.toUpperCase()];
			if (item.dueDate) parts.push(`due ${item.dueDate}`);
			write(
				`${item.status === 'done' ? '[x]' : '[ ]'}  ${item.title}  (${parts.join(', ')})`,
				{ size: 9.5, indent: 6 }
			);
		}
		page.y -= 8;
	}

	// ---- notes ----
	if (summary.notes && summary.noteWords > 0) {
		write('Notes', { size: 12, bold: true, gap: 4 });
		for (const line of htmlToLines(summary.notes.html)) {
			write(line, { size: 9.5, indent: 6 });
		}
	}

	// ---- footer on every page ----
	for (const [index, built] of pages.entries()) {
		built.ops.push(
			`BT /F1 8 Tf 0.55 0.58 0.63 rg 1 0 0 1 ${MARGIN} ${MARGIN - 18} Tm (${escapePdfText(
				`Generated by MeetFlow  ·  page ${index + 1} of ${pages.length}`
			)}) Tj ET`
		);
	}

	return pages.map((p) => p.ops.join('\n'));
}

/** Assemble the PDF file bytes. */
export function buildSummaryPdf(summary: MeetingSummary, timezone: string): Blob {
	const streams = buildPages(summary, timezone);
	const objects: string[] = [];

	const pageCount = streams.length;
	// Object layout: 1 catalog, 2 pages, 3 F1, 4 F2, then per page: page obj + content obj.
	const pageObjIds = streams.map((_, i) => 5 + i * 2);
	const contentObjIds = streams.map((_, i) => 6 + i * 2);

	objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
	objects[2] = `<< /Type /Pages /Count ${pageCount} /Kids [${pageObjIds
		.map((id) => `${id} 0 R`)
		.join(' ')}] >>`;
	objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
	objects[4] =
		'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

	streams.forEach((stream, i) => {
		objects[pageObjIds[i]] =
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(
				2
			)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjIds[i]} 0 R >>`;
		objects[contentObjIds[i]] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
	});

	let pdf = '%PDF-1.4\n';
	const offsets: number[] = [];
	for (let id = 1; id < objects.length; id++) {
		if (!objects[id]) continue;
		offsets[id] = pdf.length;
		pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
	}

	const xrefStart = pdf.length;
	const maxId = objects.length;
	pdf += `xref\n0 ${maxId}\n0000000000 65535 f \n`;
	for (let id = 1; id < maxId; id++) {
		pdf += offsets[id]
			? `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
			: '0000000000 65535 f \n';
	}
	pdf += `trailer\n<< /Size ${maxId} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

	return new Blob([pdf], { type: 'application/pdf' });
}

/** Filename for a summary export: meetflow-summary-sprint-24-planning-2026-03-02.pdf */
export function summaryFilename(summary: MeetingSummary, timezone: string): string {
	const slug = summary.meeting.title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 48) || 'meeting';
	return `meetflow-summary-${slug}-${civilDateOf(summary.meeting.startsAt, timezone)}.pdf`;
}
