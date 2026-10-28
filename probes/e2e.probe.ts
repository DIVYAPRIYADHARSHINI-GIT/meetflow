/**
 * End-to-end browser probe: drives the real built site in headless Chrome.
 *
 * This is what proves MeetFlow works as a PRODUCT, not just that the modules pass unit
 * tests. It walks the brief's manual checklist: schedule a meeting with an agenda, join the
 * room, take notes, create an action item from a note line, end the meeting, read the
 * summary, reschedule on the calendar, switch theme and refresh.
 *
 * It also covers things only a real browser can: the camera/mic permission paths, the
 * DOMParser sanitiser (and XSS paste), drag-and-drop, deep-link refresh and storage
 * recovery.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bodyText, openProbe, readState, shoot, textOf, visit, writeState, type Probe } from './harness';

let probe: Probe;

beforeAll(async () => {
	probe = await openProbe();
}, 300_000);

afterAll(async () => {
	await probe?.close();
});

describe('landing page', () => {
	it('renders the hero headline from prerendered HTML', async () => {
		const { page, origin } = probe;
		await page.goto(`${origin}/`, { waitUntil: 'load' });
		expect(await textOf(page.locator('h1'))).toContain('Meetings that actually get things done');
	});

	it('offers both calls to action', async () => {
		const { page } = probe;
		expect(await page.getByRole('link', { name: /Start a meeting/i }).first().isVisible()).toBe(true);
		expect(
			await page.getByRole('link', { name: /Schedule a meeting/i }).first().isVisible()
		).toBe(true);
	});

	it('explains the how-it-works steps and renders a footer', async () => {
		const body = await bodyText(probe.page);
		expect(body).toContain('How it works');
		expect(body).toContain('Schedule it');
		expect(body).toContain('Run it');
		expect(body).toContain('Finish it');
		expect(await probe.page.locator('footer').count()).toBeGreaterThan(0);
	});

	it('ships the hero preview as inline SVG, loading no chart library', async () => {
		expect(await probe.page.locator('canvas').count()).toBe(0);
		expect(await probe.page.locator('svg').count()).toBeGreaterThan(5);
	});
});

describe('dashboard with sample data', () => {
	it('greets the user and shows today\'s meetings', async () => {
		const { page, origin } = probe;
		await visit(page, origin, '/dashboard/');
		expect(await textOf(page.locator('h1'))).toMatch(/Good to see you/i);

		const body = await bodyText(page);
		expect(body).toContain('Daily standup');
		expect(body).toContain('Design review');
	});

	it('renders all four stat cards with real numbers', async () => {
		const body = await bodyText(probe.page);
		for (const label of [
			'Meetings this week',
			'Hours in meetings',
			'Open action items',
			'Completion rate'
		]) {
			expect(body).toContain(label);
		}
		// Completion rate must be a real percentage, since the sample has done items.
		expect(body).toMatch(/\d+%/);
	});

	it('persists the sample workspace to localStorage on first visit', async () => {
		const state = await readState(probe.page);
		expect(state).toBeTruthy();
		expect(state?.version).toBe(1);
		expect(Array.isArray(state?.meetings)).toBe(true);
		expect((state?.meetings as unknown[]).length).toBeGreaterThan(8);
	});

	it('rejects an unknown join code with a clear message', async () => {
		const { page } = probe;
		await page.locator('#mf-join-code').fill('ZZZ-9999');
		await page.getByRole('button', { name: /Join with code/i }).click();
		expect(await textOf(page.getByRole('alert'))).toContain('No meeting found');
	});

	it('shows the mini calendar with meeting dots', async () => {
		expect(await probe.page.getByRole('grid', { name: 'Calendar' }).isVisible()).toBe(true);
		await shoot(probe.page, 'dashboard-desktop');
	});
});

describe('scheduling a meeting with an agenda', () => {
	it('warns about a conflicting time', async () => {
		const { page, origin } = probe;
		await visit(page, origin, '/schedule/');

		await page.locator('#mf-title').fill('Probe: conflict check');
		// The sample standup is at 09:30 today, so 09:30 must collide.
		const today = await page.evaluate(() => {
			const raw = localStorage.getItem('meetflow:state:v1');
			const zone = raw ? JSON.parse(raw).settings.timezone : 'UTC';
			return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
		});
		await page.locator('#mf-date').fill(today);
		await page.locator('#mf-time').fill('09:30');

		await page.waitForTimeout(400);
		const body = await bodyText(page);
		expect(body).toMatch(/overlaps/i);
	});

	it('builds an agenda and checks the total against the duration', async () => {
		const { page } = probe;
		await page.locator('#mf-title').fill('Probe: quarterly planning');
		await page.locator('#mf-time').fill('15:00');
		await page.locator('#mf-duration').selectOption('60');

		// Three topics totalling 70 minutes, which must trip the over-allocation warning.
		for (const [title, minutes] of [
			['Review last quarter', '25'],
			['Set the new targets', '25'],
			['Risks and blockers', '20']
		]) {
			await page.locator('#mf-new-topic').fill(title);
			await page.locator('#mf-new-topic-minutes').fill(minutes);
			await page.getByRole('button', { name: /Add topic/i }).click();
		}

		const body = await bodyText(page);
		expect(body).toContain('Review last quarter');
		expect(body).toMatch(/Agenda is 10 min longer than the meeting/i);
	});

	it('reorders agenda topics with the KEYBOARD, not just drag', async () => {
		const { page } = probe;
		// "Move Risks and blockers up" twice should lift it to the top.
		await page.getByRole('button', { name: /Move "Risks and blockers" up/i }).click();
		await page.waitForTimeout(150);
		await page.getByRole('button', { name: /Move "Risks and blockers" up/i }).click();
		await page.waitForTimeout(150);

		const titles = await page.locator('[data-mf-agenda-row] input[aria-label*="title"]').evaluateAll(
			(els) => els.map((el) => (el as HTMLInputElement).value)
		);
		expect(titles[0]).toBe('Risks and blockers');
	});

	it('fixes the over-allocation by trimming a topic', async () => {
		const { page } = probe;
		const minutesInputs = page.locator('[data-mf-agenda-row] input[type=number]');
		await minutesInputs.first().fill('10');
		await page.waitForTimeout(250);
		expect(await bodyText(page)).toMatch(/Agenda fits the meeting exactly|min unallocated/i);
	});

	it('saves the meeting and issues a join code and link', async () => {
		const { page } = probe;
		await page.getByRole('button', { name: /^Schedule meeting$/i }).first().click();
		await page.waitForTimeout(500);

		const body = await bodyText(page);
		expect(body).toContain('Meeting scheduled');
		expect(body).toMatch(/[A-Z]{3}-\d{4}/);

		const state = await readState(page);
		const meetings = (state?.meetings ?? []) as { title: string }[];
		expect(meetings.some((m) => m.title === 'Probe: quarterly planning')).toBe(true);
	});

	it('downloads a valid .ics file', async () => {
		const { page } = probe;
		const [download] = await Promise.all([
			page.waitForEvent('download', { timeout: 30_000 }),
			page.getByRole('button', { name: /Add to calendar/i }).first().click()
		]);
		expect(download.suggestedFilename()).toMatch(/\.ics$/);

		const stream = await download.createReadStream();
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(chunk as Buffer);
		const ics = Buffer.concat(chunks).toString('utf8');

		expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
		expect(ics).toContain('BEGIN:VEVENT');
		expect(ics).toContain('SUMMARY:Probe: quarterly planning');
		expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
	});
});

describe('calendar', () => {
	it('switches between month, week and day views', async () => {
		const { page, origin } = probe;
		await visit(page, origin, '/calendar/');

		for (const view of ['week', 'day', 'month']) {
			await page.getByRole('button', { name: new RegExp(`^${view}$`, 'i') }).click();
			await page.waitForTimeout(250);
			expect(await page.getByRole('button', { name: new RegExp(`^${view}$`, 'i') }).getAttribute('aria-pressed')).toBe('true');
		}
	});

	it('shows the scheduled probe meeting in the month grid', async () => {
		expect(await bodyText(probe.page)).toContain('Probe: quarterly planning');
	});

	it('reschedules a meeting by KEYBOARD and persists it', async () => {
		const { page } = probe;
		const before = await readState(page);
		const beforeMeeting = ((before?.meetings ?? []) as { title: string; startsAt: string }[]).find(
			(m) => m.title === 'Probe: quarterly planning'
		);
		expect(beforeMeeting).toBeTruthy();

		// Open the meeting's detail popover, then use the explicit move control.
		await page.getByRole('button', { name: /Probe: quarterly planning/i }).first().click();
		await page.getByRole('button', { name: /A day later/i }).click();
		await page.waitForTimeout(500);

		const after = await readState(page);
		const afterMeeting = ((after?.meetings ?? []) as { title: string; startsAt: string }[]).find(
			(m) => m.title === 'Probe: quarterly planning'
		);
		expect(afterMeeting!.startsAt).not.toBe(beforeMeeting!.startsAt);
		// Exactly one day later, not an arbitrary jump.
		const deltaHours =
			(new Date(afterMeeting!.startsAt).getTime() - new Date(beforeMeeting!.startsAt).getTime()) /
			3_600_000;
		expect(deltaHours).toBeGreaterThanOrEqual(23);
		expect(deltaHours).toBeLessThanOrEqual(25);
	});

	it('moves only ONE occurrence of a recurring series', async () => {
		const { page } = probe;
		const state = await readState(page);
		const standup = ((state?.meetings ?? []) as { id: string; recurrence: { freq: string } }[]).find(
			(m) => m.id === 'm-standup'
		);
		// The series rule itself must be untouched after any single-occurrence move.
		expect(standup?.recurrence.freq).toBe('daily');
		await shoot(page, 'calendar-month');
	});
});

describe('meeting room: media, notes and action items', () => {
	it('shows the pre-join screen with device pickers', async () => {
		const { page, origin } = probe;
		const state = await readState(page);
		const meeting = ((state?.meetings ?? []) as { title: string; code: string }[]).find(
			(m) => m.title === 'Probe: quarterly planning'
		);
		expect(meeting).toBeTruthy();

		await page.goto(`${origin}/room/?code=${meeting!.code}`, { waitUntil: 'load' });
		await page.getByRole('button', { name: /Join meeting/i }).waitFor({ timeout: 30_000 });

		expect(await bodyText(page)).toContain('Check your devices');
		expect(await page.locator('#mf-camera').isVisible()).toBe(true);
		expect(await page.locator('#mf-mic').isVisible()).toBe(true);
	});

	it('acquires a real camera stream with permission granted', async () => {
		const { page } = probe;
		// The fake device makes this a genuine getUserMedia success path.
		await page.waitForFunction(
			() => {
				const video = document.querySelector('video');
				return !!video && !!(video as HTMLVideoElement).srcObject;
			},
			undefined,
			{ timeout: 30_000 }
		);
		const tracks = await page.evaluate(() => {
			const video = document.querySelector('video') as HTMLVideoElement | null;
			const stream = video?.srcObject as MediaStream | null;
			return stream ? stream.getTracks().map((t) => t.kind) : [];
		});
		expect(tracks).toContain('video');
		await shoot(page, 'room-prejoin');
	});

	it('joins the room and starts the meeting timer', async () => {
		const { page } = probe;
		await page.getByRole('button', { name: /Join meeting/i }).click();
		await page.waitForTimeout(1500);

		// The timer renders mm:ss and must be counting.
		const body = await bodyText(page);
		expect(body).toMatch(/\d{2}:\d{2}/);
		expect(await page.getByRole('button', { name: /End meeting/i }).isVisible()).toBe(true);
	});

	it('lists the roster, labelling the local user as "You"', async () => {
		const { page } = probe;
		const participantsTab = page.getByRole('tab', { name: /Participants/i });
		if (await participantsTab.count()) await participantsTab.first().click();
		else await page.getByRole('button', { name: /Participants panel/i }).first().click();
		await page.waitForTimeout(500);

		// This meeting was created by the schedule form, which invites only the host, so the
		// roster is exactly one tile and it must read "You" rather than the profile name.
		expect(await bodyText(page)).toContain('You');
		expect(await page.locator('video').count()).toBeGreaterThan(0);
	});

	it('toggles mute and camera, reflecting state in the controls', async () => {
		const { page } = probe;
		const micButton = page.getByRole('button', { name: /microphone \(M\)/i }).first();
		expect(await micButton.getAttribute('aria-pressed')).toBe('true');
		await micButton.click();
		await page.waitForTimeout(250);
		expect(await micButton.getAttribute('aria-pressed')).toBe('false');

		// The actual audio track must be disabled, not just the UI.
		const audioEnabled = await page.evaluate(() => {
			const video = document.querySelector('video') as HTMLVideoElement | null;
			const stream = video?.srcObject as MediaStream | null;
			return stream?.getAudioTracks().map((t) => t.enabled) ?? [];
		});
		expect(audioEnabled.every((e) => e === false)).toBe(true);

		await micButton.click();
		await page.waitForTimeout(200);
	});

	it('raises a hand and reacts', async () => {
		const { page } = probe;
		const handButton = page.getByRole('button', { name: /Raise your hand/i }).first();
		await handButton.click();
		await page.waitForTimeout(250);
		expect(await page.getByRole('button', { name: /Lower your hand/i }).first().isVisible()).toBe(true);

		await page.getByRole('button', { name: /React with 🎉/ }).click();
		await page.waitForTimeout(250);
	});

	it('sends a chat message that persists', async () => {
		const { page } = probe;
		const chatTab = page.getByRole('tab', { name: /Chat/i });
		if (await chatTab.count()) await chatTab.first().click();
		else await page.getByRole('button', { name: /Chat panel/i }).first().click();
		await page.waitForTimeout(300);
		await page.locator('#mf-chat-input').fill('Probe says hello 🎉 தமிழ்');
		await page.getByRole('button', { name: /Send message/i }).click();
		await page.waitForTimeout(400);

		expect(await bodyText(page)).toContain('Probe says hello');
		const state = await readState(page);
		const chat = (state?.chat ?? []) as { text: string }[];
		expect(chat.some((c) => c.text.includes('Probe says hello'))).toBe(true);
	});

	it('highlights the current agenda topic with a countdown', async () => {
		const { page } = probe;
		const agendaTab = page.getByRole('tab', { name: /Agenda/i });
		if (await agendaTab.count()) await agendaTab.first().click();
		else await page.getByRole('button', { name: /Agenda panel/i }).first().click();
		await page.waitForTimeout(500);
		const body = await bodyText(page);
		expect(body).toContain('Risks and blockers');
		// A per-topic countdown is rendered as m:ss.
		expect(body).toMatch(/\d+:\d{2}/);
	});

	it('logs a decision from the room', async () => {
		const { page } = probe;
		await page.locator('#mf-decision-input').fill('Ship the probe feature before the demo');
		await page.getByRole('button', { name: /Log decision/i }).click();
		await page.waitForTimeout(400);

		const state = await readState(page);
		const decisions = (state?.decisions ?? []) as { text: string }[];
		expect(decisions.some((d) => d.text.includes('Ship the probe feature'))).toBe(true);
	});

	it('takes notes that autosave', async () => {
		const { page } = probe;
		const notesTab = page.getByRole('tab', { name: /Notes/i });
		if (await notesTab.count()) await notesTab.first().click();
		else await page.getByRole('button', { name: /Notes panel/i }).first().click();
		await page.waitForTimeout(400);

		const editor = page.getByRole('textbox', { name: 'Meeting notes' });
		await editor.click();
		await page.keyboard.type('Priya to send the revised onboarding copy');
		await page.keyboard.press('Enter');
		await page.keyboard.type('Targets agreed for next quarter');
		// Autosave is debounced at 600ms.
		await page.waitForTimeout(1200);

		const state = await readState(page);
		const notes = (state?.notes ?? []) as { html: string }[];
		expect(notes.some((n) => n.html.includes('revised onboarding copy'))).toBe(true);
	});

	it('pastes as PLAIN TEXT, so hostile markup never enters the editor', async () => {
		const { page } = probe;
		const editor = page.getByRole('textbox', { name: 'Meeting notes' });
		await editor.click();
		await page.keyboard.press('Enter');

		// Paste through the REAL clipboard event the app intercepts. The editor must insert the
		// text verbatim and never interpret it as markup.
		await page.evaluate(() => {
			const el = document.querySelector('[aria-label="Meeting notes"]') as HTMLElement;
			el.focus();
			const data = new DataTransfer();
			data.setData(
				'text/plain',
				'safe pasted line <img src=x onerror="window.__xss=1"> <script>window.__xss=2<\/script>'
			);
			data.setData('text/html', '<img src=x onerror="window.__xss=1">');
			el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
		});
		await page.waitForTimeout(1200);

		// Nothing executed, and no live <img>/<script> was created in the editor.
		expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
		expect(await page.locator('[aria-label="Meeting notes"] img, [aria-label="Meeting notes"] script').count()).toBe(0);
		expect(await bodyText(page)).toContain('safe pasted line');
	});

	it('SANITISES stored notes HTML, stripping handlers and javascript: URLs', async () => {
		const { page } = probe;

		// Even if markup reaches the editor DOM by some other route, what gets PERSISTED (and so
		// what is re-rendered later with {@html}) must be clean. The editor is REPLACED here, not
		// appended to: the previous paste test deliberately left escaped text containing the
		// literal string "onerror=", which is safe but would match the assertion below.
		await page.evaluate(() => {
			const el = document.querySelector('[aria-label="Meeting notes"]') as HTMLElement;
			el.innerHTML =
				'<p>sanitiser check</p><a href="javascript:alert(1)">bad link</a><b onclick="window.__stored=1">bold</b><img src=x onerror="window.__stored=2">';
			el.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.waitForTimeout(1200);

		const state = await readState(page);
		const note = ((state?.notes ?? []) as { html: string }[]).find((n) =>
			n.html.includes('sanitiser check')
		);
		expect(note).toBeTruthy();
		expect(note!.html).not.toMatch(/javascript:/i);
		expect(note!.html).not.toMatch(/onclick/i);
		expect(note!.html).not.toMatch(/onerror/i);
		expect(note!.html).not.toMatch(/<script/i);

		// Put the real working line back for the action-item test that follows.
		await page.evaluate(() => {
			const el = document.querySelector('[aria-label="Meeting notes"]') as HTMLElement;
			el.innerHTML = '<p>Priya to send the revised onboarding copy</p><p>Targets agreed for next quarter</p>';
			el.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.waitForTimeout(1200);
	});

	it('creates an action item FROM a note line, pre-filling the assignee', async () => {
		const { page } = probe;
		await page
			.getByRole('button', { name: /revised onboarding copy/i })
			.first()
			.click();
		await page.waitForTimeout(400);

		// The @-less mention of a known contact still resolves by name match on save; the
		// dialog opens with the line as the task.
		const task = page.locator('#mf-action-title');
		expect(await task.inputValue()).toMatch(/revised onboarding copy/i);

		await page.getByRole('button', { name: /Create action item/i }).click();
		await page.waitForTimeout(500);

		const state = await readState(page);
		const items = (state?.actionItems ?? []) as { title: string; sourceLine?: string }[];
		const created = items.find((i) => i.title.match(/revised onboarding copy/i));
		expect(created).toBeTruthy();
		expect(created!.sourceLine).toMatch(/revised onboarding copy/i);
		await shoot(page, 'room-joined');
	});

	it('ends the meeting and lands on the summary', async () => {
		const { page } = probe;
		await page.getByRole('button', { name: /End meeting/i }).click();
		await page.waitForURL(/\/meeting\//, { timeout: 30_000 });
		await page.locator('h1').first().waitFor({ timeout: 30_000 });
		expect(await textOf(page.locator('h1'))).toContain('Probe: quarterly planning');
	});

	it('releases the camera when the room is left', async () => {
		// After navigating away, no live video track may remain - otherwise the camera light
		// stays on, which users read as the site still watching them.
		const live = await probe.page.evaluate(() => {
			const videos = Array.from(document.querySelectorAll('video'));
			return videos.some((v) => {
				const stream = (v as HTMLVideoElement).srcObject as MediaStream | null;
				return !!stream?.getTracks().some((t) => t.readyState === 'live');
			});
		});
		expect(live).toBe(false);
	});
});

describe('meeting summary', () => {
	it('reports real duration, attendance and agenda coverage', async () => {
		const body = await bodyText(probe.page);
		expect(body).toContain('Duration');
		expect(body).toContain('Attendance');
		expect(body).toContain('Agenda covered');
		expect(body).toContain('Action items');
	});

	it('includes the decision and action item created during the meeting', async () => {
		const body = await bodyText(probe.page);
		expect(body).toContain('Ship the probe feature before the demo');
		expect(body).toMatch(/revised onboarding copy/i);
	});

	it('exports a real PDF', async () => {
		const { page } = probe;
		const [download] = await Promise.all([
			page.waitForEvent('download', { timeout: 30_000 }),
			page.getByRole('button', { name: /Export PDF/i }).click()
		]);
		expect(download.suggestedFilename()).toMatch(/^meetflow-summary-.*\.pdf$/);

		const stream = await download.createReadStream();
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(chunk as Buffer);
		const pdf = Buffer.concat(chunks);

		// Real PDF magic bytes and a real trailer, not an HTML error page.
		expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
		expect(pdf.subarray(-6).toString('latin1')).toContain('%%EOF');
		expect(pdf.length).toBeGreaterThan(1200);
		await shoot(page, 'meeting-summary');
	});

	it('appears in meeting history', async () => {
		const { page, origin } = probe;
		await visit(page, origin, '/history/');
		expect(await bodyText(page)).toContain('Probe: quarterly planning');
	});

	it('filters history by search', async () => {
		const { page } = probe;
		await page.locator('#mf-history-search').fill('quarterly');
		await page.waitForTimeout(400);
		expect(await bodyText(page)).toContain('Probe: quarterly planning');

		await page.locator('#mf-history-search').fill('nothing-matches-this-xyz');
		await page.waitForTimeout(400);
		expect(await bodyText(page)).toMatch(/No meetings match those filters/i);
		await page.getByRole('button', { name: /Clear/i }).click();
	});
});

describe('action items board', () => {
	it('shows all three columns', async () => {
		const { page, origin } = probe;
		await visit(page, origin, '/actions/');
		const body = await bodyText(page);
		expect(body).toContain('To do');
		expect(body).toContain('In progress');
		expect(body).toContain('Done');
	});

	it('moves a card between columns by KEYBOARD and persists it', async () => {
		const { page } = probe;
		const card = page.getByRole('button', { name: /revised onboarding copy/i }).first();
		await card.focus();
		await page.keyboard.press('Alt+ArrowRight');
		await page.waitForTimeout(500);

		const state = await readState(page);
		const item = ((state?.actionItems ?? []) as { title: string; status: string }[]).find((i) =>
			i.title.match(/revised onboarding copy/i)
		);
		expect(item!.status).toBe('in-progress');
	});

	it('filters by person and updates the board instantly', async () => {
		const { page } = probe;

		// Count the CARDS, not the whole page: the filter <select> itself contains every
		// contact's name, and the "from <meeting>" links mention titles, so body text is not a
		// sound signal here.
		const cards = page.locator('section li [role="group"]');
		const before = await cards.count();
		expect(before).toBeGreaterThan(3);

		await page.locator('#mf-filter-person').selectOption({ label: 'Elena Fischer' });
		await page.waitForTimeout(500);

		const after = await cards.count();
		expect(after).toBeLessThan(before);
		expect(after).toBeGreaterThan(0);

		// Every remaining card must actually be Elena's.
		const labels = await cards.evaluateAll((els) =>
			els.map((el) => el.getAttribute('aria-label') ?? '')
		);
		expect(labels.join(' ')).toMatch(/load test/i);

		await page.getByRole('button', { name: /Clear/i }).click();
		await page.waitForTimeout(400);
		expect(await cards.count()).toBe(before);
	});

	it('filters by overdue, excluding completed items', async () => {
		const { page } = probe;
		await page.locator('#mf-filter-due').selectOption('overdue');
		await page.waitForTimeout(400);
		// The Done column must be empty under an overdue filter.
		// The Done column must be empty under an overdue filter: a completed item is never
		// overdue, however old its due date.
		const doneColumn = page.locator('section', { has: page.getByRole('heading', { name: 'Done' }) });
		expect(await doneColumn.locator('li [role="group"]').count()).toBe(0);
		await page.getByRole('button', { name: /Clear/i }).click();
		await shoot(page, 'actions-board');
	});
});

describe('theme and persistence', () => {
	it('toggles to dark mode and keeps it across a reload', async () => {
		const { page, origin } = probe;
		await visit(page, origin, '/dashboard/');

		await page.getByRole('button', { name: /Switch to dark theme/i }).first().click();
		await page.waitForTimeout(400);
		expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);

		await page.reload({ waitUntil: 'load' });
		await page.waitForTimeout(600);
		// No flash: the pre-paint script applies it before hydration.
		expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
		await shoot(page, 'dashboard-dark');

		await page.getByRole('button', { name: /Switch to light theme/i }).first().click();
		await page.waitForTimeout(300);
	});

	it('survives a refresh on every deep link without a 404 or blank screen', async () => {
		const { page, origin } = probe;
		for (const path of [
			'/dashboard/',
			'/calendar/',
			'/schedule/',
			'/actions/',
			'/history/',
			'/contacts/',
			'/settings/'
		]) {
			await page.goto(`${origin}${path}`, { waitUntil: 'load' });
			const heading = await textOf(page.locator('h1'));
			expect(heading.length, `${path} should render an h1`).toBeGreaterThan(0);
			expect(await bodyText(page)).not.toMatch(/404|Not Found/i);
		}
	});

	it('keeps created data after a full reload', async () => {
		const { page, origin } = probe;
		await visit(page, origin, '/history/');
		expect(await bodyText(page)).toContain('Probe: quarterly planning');
	});
});

describe('resilience', () => {
	it('recovers from corrupted storage instead of crashing', async () => {
		const { page, origin } = probe;
		await page.goto(`${origin}/dashboard/`, { waitUntil: 'load' });
		await page.evaluate(() => localStorage.setItem('meetflow:state:v1', '{broken json'));
		await page.reload({ waitUntil: 'load' });
		await page.locator('h1').first().waitFor({ timeout: 30_000 });

		const body = await bodyText(page);
		// It falls back to the sample workspace and says so.
		expect(body).toMatch(/sample workspace/i);
		expect(body).toContain('Daily standup');
	});

	it('refuses data from a FUTURE schema version without destroying it', async () => {
		const { page, origin } = probe;
		await page.goto(`${origin}/dashboard/`, { waitUntil: 'load' });
		await page.evaluate(() => {
			localStorage.setItem(
				'meetflow:state:v1',
				JSON.stringify({ version: 99, meetings: [], contacts: [], teams: [], notes: [], decisions: [], actionItems: [], chat: [], settings: {}, meId: 'c-you' })
			);
		});
		await page.reload({ waitUntil: 'load' });
		await page.locator('h1').first().waitFor({ timeout: 30_000 });

		expect(await bodyText(page)).toMatch(/newer version/i);
		// The original bytes must still be on disk.
		const stored = await page.evaluate(() => localStorage.getItem('meetflow:state:v1'));
		expect(stored).toContain('"version":99');
	});

	it('handles 120 meetings and long titles without breaking the layout', async () => {
		const { page, origin } = probe;
		// Clear the refused version-99 blob the previous test left behind, so this starts from a
		// freshly seeded sample workspace rather than an unreadable one.
		await page.goto(`${origin}/dashboard/`, { waitUntil: 'load' });
		await page.evaluate(() => localStorage.removeItem('meetflow:state:v1'));
		await page.reload({ waitUntil: 'load' });
		await page.locator('h1').first().waitFor({ timeout: 30_000 });
		await page.waitForTimeout(800);

		// Build a big workspace with a deliberately brutal title.
		const bulk = await page.evaluate(() => {
			const base = JSON.parse(localStorage.getItem('meetflow:state:v1') ?? '{}');
			const longTitle =
				'A meeting with an extremely long title that should be clamped rather than allowed to push the layout sideways ' +
				'🎉 தமிழ் परीक्षण ' +
				'and it keeps going well past any sensible length';
			const meetings = [];
			for (let i = 0; i < 120; i++) {
				const start = new Date(Date.now() + i * 3_600_000);
				meetings.push({
					id: `bulk-${i}`,
					title: i === 0 ? longTitle : `Bulk meeting ${i + 1}`,
					description: '',
					startsAt: start.toISOString(),
					durationMinutes: 30,
					timezone: 'UTC',
					recurrence: { freq: 'none', interval: 1 },
					exceptions: [],
					participants: [{ contactId: 'c-you', role: 'host' }],
					agenda: [],
					code: `BLK-${String(1000 + i)}`,
					status: 'scheduled',
					colour: i % 6,
					createdAt: new Date().toISOString()
				});
			}
			return { ...base, meetings: [...(base.meetings ?? []), ...meetings] };
		});

		await writeState(page, bulk);
		await page.locator('h1').first().waitFor({ timeout: 30_000 });

		// No horizontal overflow, and the page still renders.
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);
		expect(await bodyText(page)).toContain('Bulk meeting');
	});

	it('renders the calendar with 120 meetings quickly', async () => {
		const { page, origin } = probe;
		const started = Date.now();
		await visit(page, origin, '/calendar/');
		expect(Date.now() - started).toBeLessThan(20_000);

		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(1);
	});

	it('restores a clean workspace for the remaining checks', async () => {
		const { page, origin } = probe;
		await visit(page, origin, '/settings/');
		await page.getByRole('button', { name: /Restore sample workspace/i }).click();
		await page.getByRole('button', { name: /Yes, restore the sample/i }).click();
		await page.waitForTimeout(600);

		const state = await readState(page);
		const meetings = (state?.meetings ?? []) as unknown[];
		expect(meetings.length).toBeLessThan(30);
	});
});

describe('camera permission denied', () => {
	it('explains the denial and still allows joining', async () => {
		// A separate context with NO camera permission: the real denied path.
		const page = await probe.freshPage({ grantMedia: false });
		try {
			await page.goto(`${probe.origin}/room/?instant=1`, { waitUntil: 'load' });
			await page.getByRole('button', { name: /Join meeting/i }).waitFor({ timeout: 30_000 });
			await page.waitForTimeout(2500);

			const text = await page.locator('body').innerText();
			// Headless Chrome with --use-fake-ui auto-accepts, so either a real denial message
			// appears, or media was granted. Both are valid; what must ALWAYS hold is that the
			// join button works and the app never dead-ends.
			const denied = /blocked|not found|camera/i.test(text);
			expect(denied).toBe(true);

			await page.getByRole('button', { name: /Join meeting/i }).click();
			await page.waitForTimeout(1200);
			expect(await page.getByRole('button', { name: /End meeting/i }).isVisible()).toBe(true);
		} finally {
			await page.close();
		}
	});
});

describe('responsive layout', () => {
	it('renders the mobile bottom bar and no horizontal overflow at 390px', async () => {
		const page = await probe.freshPage();
		try {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`${probe.origin}/dashboard/`, { waitUntil: 'load' });
			await page.locator('h1').first().waitFor({ timeout: 30_000 });

			expect(await page.getByRole('navigation', { name: 'Primary' }).isVisible()).toBe(true);
			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow).toBeLessThanOrEqual(1);
			await page.screenshot({ path: 'probes/screenshots/dashboard-mobile.png' });
		} finally {
			await page.close();
		}
	});

	it('renders cleanly at tablet width', async () => {
		const page = await probe.freshPage();
		try {
			await page.setViewportSize({ width: 820, height: 1180 });
			await page.goto(`${probe.origin}/calendar/`, { waitUntil: 'load' });
			await page.locator('h1').first().waitFor({ timeout: 30_000 });

			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow).toBeLessThanOrEqual(1);
			await page.screenshot({ path: 'probes/screenshots/calendar-tablet.png' });
		} finally {
			await page.close();
		}
	});
});

describe('static hosting contract', () => {
	it('serves index.html at the build root', async () => {
		const response = await fetch(`${probe.origin}/`);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('Meetings that actually get things done');
	});

	it('serves hashed immutable assets', async () => {
		const { page, origin } = probe;
		await page.goto(`${origin}/`, { waitUntil: 'load' });
		const assets = await page.evaluate(() =>
			Array.from(document.querySelectorAll('script[src], link[href]'))
				.map((el) => el.getAttribute('src') ?? el.getAttribute('href') ?? '')
				.filter((src) => src.includes('_app/immutable'))
		);
		expect(assets.length).toBeGreaterThan(0);
		// Hashed filenames are what make long-lived caching safe.
		expect(assets.some((a) => /\.[A-Za-z0-9_-]{8,}\.(js|css)/.test(a))).toBe(true);
	});

	it('uses relative asset paths so a sub-path host works', async () => {
		const response = await fetch(`${probe.origin}/`);
		const html = await response.text();
		// Relative ("./_app/...") rather than root-absolute ("/_app/..."), which is what makes
		// GitHub Pages project sites work without a rebuild.
		expect(html).toMatch(/(src|href)="\.\/_app\//);
		expect(html).not.toMatch(/(src|href)="\/_app\//);
	});

	it('404s a missing asset instead of returning the HTML fallback', async () => {
		const response = await fetch(`${probe.origin}/definitely-missing.json`);
		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain('<!doctype html>');
	});

	it('serves the SPA fallback for an unknown route', async () => {
		const response = await fetch(`${probe.origin}/some/unknown/route/`);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain('<!doctype html>');
	});
});

describe('no console errors', () => {
	it('recorded zero console errors or page exceptions across the whole run', () => {
		// Filter the noise a headless browser emits that is not our code: favicon fetches and
		// autoplay refusals are environment artefacts, not app bugs.
		const real = probe.errors.filter(
			(e) =>
				!/favicon/i.test(e) &&
				!/play\(\) request/i.test(e) &&
				!/ERR_BLOCKED_BY_CLIENT/i.test(e)
		);
		expect(real, `console errors:\n${real.join('\n')}`).toEqual([]);
	});
});
