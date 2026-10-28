/**
 * Live-site probe: drives the deployed production URL in headless Chrome, anonymously.
 *
 * This is deliberately NOT the same as the e2e probe. The e2e probe builds locally and
 * serves `build/` from a Node static server; this one talks to Vercel over the public
 * internet with a fresh browser profile (no login, no cookies, no storage), so it also
 * covers the things only a real deploy can break: the rewrite rules, asset MIME types,
 * caching headers, HTTPS, and whether Deployment Protection is blocking anonymous users.
 *
 * Target URL comes from MEETFLOW_URL, defaulting to the production alias.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = (process.env.MEETFLOW_URL ?? 'https://meetflow-nu.vercel.app').replace(/\/$/, '');
const SHOTS = join(import.meta.dirname, 'screenshots-live');

let browser: Browser;
let page: Page;
const errors: string[] = [];

/** Console noise that is environment, not application, behaviour. */
function realErrors(): string[] {
	return errors.filter(
		(e) =>
			!/favicon/i.test(e) &&
			!/play\(\) request/i.test(e) &&
			!/ERR_BLOCKED_BY_CLIENT/i.test(e) &&
			!/net::ERR_INTERNET_DISCONNECTED/i.test(e)
	);
}

beforeAll(async () => {
	mkdirSync(SHOTS, { recursive: true });
	browser = await chromium.launch({
		args: [
			'--use-fake-ui-for-media-stream',
			'--use-fake-device-for-media-stream',
			'--autoplay-policy=no-user-gesture-required'
		]
	});
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		permissions: ['camera', 'microphone']
	});
	page = await context.newPage();
	page.on('console', (m: ConsoleMessage) => {
		if (m.type() === 'error') errors.push(`[${page.url()}] ${m.text()}`);
	});
	page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
}, 180_000);

afterAll(async () => {
	await browser?.close();
});

async function text(p: Page): Promise<string> {
	await p.waitForLoadState('networkidle');
	return p.evaluate(() => document.body.innerText);
}

describe('anonymous access', () => {
	it('serves the production alias without an SSO redirect', async () => {
		const response = await page.goto(`${BASE}/`, { waitUntil: 'load' });
		expect(response?.status()).toBe(200);
		// Deployment Protection would bounce us to vercel.com/sso-api.
		expect(page.url()).toContain('meetflow');
		expect(page.url()).not.toContain('sso');
		expect(page.url()).not.toContain('vercel.com/login');
	});

	it('renders the hero headline', async () => {
		expect(await page.locator('h1').first().innerText()).toContain(
			'Meetings that actually get things done'
		);
		await page.screenshot({ path: join(SHOTS, 'live-landing.png') });
	});

	it('serves over HTTPS with security headers', async () => {
		const response = await page.goto(`${BASE}/`, { waitUntil: 'load' });
		expect(BASE.startsWith('https://')).toBe(true);
		const headers = response?.headers() ?? {};
		expect(headers['x-content-type-options']).toBe('nosniff');
	});
});

describe('landing page', () => {
	it('shows both calls to action and the 3-step explainer', async () => {
		const body = await text(page);
		expect(body).toMatch(/Start a meeting/i);
		expect(body).toMatch(/Schedule a meeting/i);
		expect(body).toContain('How it works');
	});
});

describe('dashboard', () => {
	it('loads the sample workspace on a first anonymous visit', async () => {
		await page.goto(`${BASE}/dashboard/`, { waitUntil: 'load' });
		await page.locator('h1').first().waitFor({ timeout: 45_000 });
		const body = await text(page);
		expect(body).toMatch(/Good to see you/i);
		expect(body).toContain('Daily standup');
	});

	it('renders all four stat cards', async () => {
		const body = await text(page);
		for (const label of [
			'Meetings this week',
			'Hours in meetings',
			'Open action items',
			'Completion rate'
		]) {
			expect(body).toContain(label);
		}
		await page.screenshot({ path: join(SHOTS, 'live-dashboard.png') });
	});

	it('persists state to localStorage on the live origin', async () => {
		const stored = await page.evaluate(() => localStorage.getItem('meetflow:state:v1'));
		expect(stored).toBeTruthy();
		expect(JSON.parse(stored!).version).toBe(1);
	});
});

describe('schedule a meeting with an agenda', () => {
	it('creates a meeting and issues a join code', async () => {
		await page.goto(`${BASE}/schedule/`, { waitUntil: 'load' });
		await page.locator('h1').first().waitFor({ timeout: 45_000 });

		await page.locator('#mf-title').fill('Live probe: deploy verification');
		await page.locator('#mf-time').fill('15:30');
		await page.locator('#mf-duration').selectOption('60');

		for (const [t, m] of [
			['Confirm the deploy', '20'],
			['Walk the live site', '25'],
			['Sign off', '15']
		]) {
			await page.locator('#mf-new-topic').fill(t);
			await page.locator('#mf-new-topic-minutes').fill(m);
			await page.getByRole('button', { name: /Add topic/i }).click();
		}

		const body = await text(page);
		expect(body).toContain('Confirm the deploy');
		expect(body).toMatch(/Agenda fits the meeting exactly/i);

		await page.getByRole('button', { name: /^Schedule meeting$/i }).first().click();
		await page.waitForTimeout(800);
		expect(await text(page)).toContain('Meeting scheduled');
		expect(await text(page)).toMatch(/[A-Z]{3}-\d{4}/);
	});

	it('kept the meeting in storage', async () => {
		const titles = await page.evaluate(() => {
			const raw = localStorage.getItem('meetflow:state:v1');
			return raw ? JSON.parse(raw).meetings.map((m: { title: string }) => m.title) : [];
		});
		expect(titles).toContain('Live probe: deploy verification');
	});
});

describe('calendar', () => {
	it('switches month, week and day views', async () => {
		await page.goto(`${BASE}/calendar/`, { waitUntil: 'load' });
		await page.locator('h1').first().waitFor({ timeout: 45_000 });

		for (const view of ['week', 'day', 'month']) {
			await page.getByRole('button', { name: new RegExp(`^${view}$`, 'i') }).click();
			await page.waitForTimeout(350);
			expect(
				await page
					.getByRole('button', { name: new RegExp(`^${view}$`, 'i') })
					.getAttribute('aria-pressed')
			).toBe('true');
		}
		await page.screenshot({ path: join(SHOTS, 'live-calendar.png') });
	});

	it('shows the meeting scheduled a moment ago', async () => {
		expect(await text(page)).toContain('Live probe: deploy verification');
	});
});

describe('meeting room pre-join (permission GRANTED)', () => {
	it('shows the device test screen and acquires a real camera stream', async () => {
		const code = await page.evaluate(() => {
			const raw = localStorage.getItem('meetflow:state:v1');
			const meetings = raw ? JSON.parse(raw).meetings : [];
			return meetings.find((m: { title: string }) => m.title === 'Live probe: deploy verification')
				?.code;
		});
		expect(code).toBeTruthy();

		await page.goto(`${BASE}/room/?code=${code}`, { waitUntil: 'load' });
		await page.getByRole('button', { name: /Join meeting/i }).waitFor({ timeout: 45_000 });
		expect(await text(page)).toContain('Check your devices');

		await page.waitForFunction(
			() => {
				const v = document.querySelector('video') as HTMLVideoElement | null;
				return !!v?.srcObject;
			},
			undefined,
			{ timeout: 45_000 }
		);
		const kinds = await page.evaluate(() => {
			const v = document.querySelector('video') as HTMLVideoElement | null;
			const s = v?.srcObject as MediaStream | null;
			return s ? s.getTracks().map((t) => t.kind) : [];
		});
		expect(kinds).toContain('video');
		await page.screenshot({ path: join(SHOTS, 'live-room-prejoin.png') });
	});

	it('joins, runs the timer, takes notes and creates an action item from a note line', async () => {
		await page.getByRole('button', { name: /Join meeting/i }).click();
		await page.waitForTimeout(1600);
		expect(await page.getByRole('button', { name: /End meeting/i }).isVisible()).toBe(true);

		// Notes + autosave
		const notesTab = page.getByRole('tab', { name: /Notes/i });
		if (await notesTab.count()) await notesTab.first().click();
		await page.waitForTimeout(400);

		const editor = page.getByRole('textbox', { name: 'Meeting notes' });
		await editor.click();
		await page.keyboard.type('Priya to confirm the production alias is public');
		await page.waitForTimeout(1400);

		const noteSaved = await page.evaluate(() => {
			const raw = localStorage.getItem('meetflow:state:v1');
			return raw
				? JSON.parse(raw).notes.some((n: { html: string }) => n.html.includes('production alias'))
				: false;
		});
		expect(noteSaved).toBe(true);

		// Note line -> action item
		await page.getByRole('button', { name: /production alias is public/i }).first().click();
		await page.waitForTimeout(500);
		await page.getByRole('button', { name: /Create action item/i }).click();
		await page.waitForTimeout(600);

		const created = await page.evaluate(() => {
			const raw = localStorage.getItem('meetflow:state:v1');
			return raw
				? JSON.parse(raw).actionItems.some((a: { title: string }) =>
						/production alias/i.test(a.title)
					)
				: false;
		});
		expect(created).toBe(true);
		await page.screenshot({ path: join(SHOTS, 'live-room-joined.png') });
	});

	it('ends the meeting and lands on the summary', async () => {
		await page.getByRole('button', { name: /End meeting/i }).click();
		await page.waitForURL(/\/meeting\//, { timeout: 45_000 });
		await page.locator('h1').first().waitFor({ timeout: 45_000 });
		expect(await page.locator('h1').first().innerText()).toContain('Live probe');
	});

	it('releases the camera on leaving the room', async () => {
		const live = await page.evaluate(() =>
			Array.from(document.querySelectorAll('video')).some((v) => {
				const s = (v as HTMLVideoElement).srcObject as MediaStream | null;
				return !!s?.getTracks().some((t) => t.readyState === 'live');
			})
		);
		expect(live).toBe(false);
	});
});

describe('meeting summary', () => {
	it('reports duration, attendance, agenda coverage and the new action item', async () => {
		const body = await text(page);
		expect(body).toContain('Duration');
		expect(body).toContain('Attendance');
		expect(body).toContain('Agenda covered');
		expect(body).toMatch(/production alias/i);
		await page.screenshot({ path: join(SHOTS, 'live-summary.png') });
	});

	it('exports a real PDF from the live site', async () => {
		const [download] = await Promise.all([
			page.waitForEvent('download', { timeout: 45_000 }),
			page.getByRole('button', { name: /Export PDF/i }).click()
		]);
		const stream = await download.createReadStream();
		const chunks: Buffer[] = [];
		for await (const c of stream) chunks.push(c as Buffer);
		const pdf = Buffer.concat(chunks);
		expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
		expect(pdf.subarray(-6).toString('latin1')).toContain('%%EOF');
	});
});

describe('history and action items', () => {
	it('lists the finished meeting in history', async () => {
		await page.goto(`${BASE}/history/`, { waitUntil: 'load' });
		await page.locator('h1').first().waitFor({ timeout: 45_000 });
		expect(await text(page)).toContain('Live probe: deploy verification');
	});

	it('shows the board columns and the created item', async () => {
		await page.goto(`${BASE}/actions/`, { waitUntil: 'load' });
		await page.locator('h1').first().waitFor({ timeout: 45_000 });
		const body = await text(page);
		expect(body).toContain('To do');
		expect(body).toContain('In progress');
		expect(body).toContain('Done');
		expect(body).toMatch(/production alias/i);
		await page.screenshot({ path: join(SHOTS, 'live-actions.png') });
	});

	it('moves a card by keyboard on the live site', async () => {
		const card = page.getByRole('button', { name: /Mark .*production alias.* as done/i }).first();
		await card.focus();
		await page.keyboard.press('Alt+ArrowRight');
		await page.waitForTimeout(600);

		const status = await page.evaluate(() => {
			const raw = localStorage.getItem('meetflow:state:v1');
			const item = raw
				? JSON.parse(raw).actionItems.find((a: { title: string }) =>
						/production alias/i.test(a.title)
					)
				: null;
			return item?.status;
		});
		expect(status).toBe('in-progress');
	});
});

describe('dark mode', () => {
	it('toggles and survives a reload', async () => {
		await page.goto(`${BASE}/dashboard/`, { waitUntil: 'load' });
		await page.locator('h1').first().waitFor({ timeout: 45_000 });

		await page.getByRole('button', { name: /Switch to dark theme/i }).first().click();
		await page.waitForTimeout(500);
		expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(
			true
		);
		await page.screenshot({ path: join(SHOTS, 'live-dashboard-dark.png') });

		await page.reload({ waitUntil: 'load' });
		await page.waitForTimeout(800);
		// The pre-paint script must re-apply it with no flash.
		expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(
			true
		);

		await page.getByRole('button', { name: /Switch to light theme/i }).first().click();
		await page.waitForTimeout(400);
	});
});

describe('deep links and refresh', () => {
	it('refreshes on every route without a 404 or blank screen', async () => {
		for (const path of [
			'/dashboard/',
			'/calendar/',
			'/schedule/',
			'/actions/',
			'/history/',
			'/contacts/',
			'/settings/'
		]) {
			const response = await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
			expect(response?.status(), `${path} status`).toBe(200);
			const heading = await page.locator('h1').first().innerText();
			expect(heading.length, `${path} heading`).toBeGreaterThan(0);
			const body = await text(page);
			expect(body, `${path} body`).not.toMatch(/\b404\b|NOT_FOUND|Page not found/i);
		}
	});

	it('serves a real 404 for a missing asset rather than the HTML fallback', async () => {
		// This is the regression guard for the rewrite rule: a missing .json must NOT come
		// back as 200 text/html, or any fetch() of a data file would silently parse markup.
		const response = await page.request.get(`${BASE}/definitely-missing-data.json`);
		expect(response.status()).toBe(404);
		expect(response.headers()['content-type'] ?? '').not.toContain('text/html');
	});

	it('serves hashed assets with long-lived immutable caching', async () => {
		await page.goto(`${BASE}/`, { waitUntil: 'load' });
		const asset = await page.evaluate(() => {
			const el = Array.from(document.querySelectorAll('link[href], script[src]')).find((n) =>
				(n.getAttribute('href') ?? n.getAttribute('src') ?? '').includes('_app/immutable')
			);
			return el ? (el.getAttribute('href') ?? el.getAttribute('src')) : null;
		});
		expect(asset).toBeTruthy();

		const url = new URL(asset!.replace(/^\.\//, '/'), `${BASE}/`).toString();
		const response = await page.request.get(url);
		expect(response.status()).toBe(200);
		expect(response.headers()['cache-control'] ?? '').toContain('immutable');
		expect(response.headers()['content-type'] ?? '').toMatch(/javascript|css/);
	});
});

describe('responsive widths', () => {
	for (const [label, width, height] of [
		['mobile', 390, 844],
		['tablet', 820, 1180],
		['desktop', 1440, 900]
	] as const) {
		it(`renders ${label} (${width}px) with no horizontal overflow`, async () => {
			const context = await browser.newContext({ viewport: { width, height } });
			const fresh = await context.newPage();
			fresh.on('pageerror', (e) => errors.push(`[pageerror ${label}] ${e.message}`));
			try {
				await fresh.goto(`${BASE}/dashboard/`, { waitUntil: 'load' });
				await fresh.locator('h1').first().waitFor({ timeout: 45_000 });
				await fresh.waitForTimeout(600);

				const overflow = await fresh.evaluate(
					() => document.documentElement.scrollWidth - document.documentElement.clientWidth
				);
				expect(overflow, `${label} overflow`).toBeLessThanOrEqual(1);
				await fresh.screenshot({ path: join(SHOTS, `live-dashboard-${label}.png`) });
			} finally {
				await fresh.close();
				await context.close();
			}
		});
	}
});

describe('meeting room pre-join (permission DENIED)', () => {
	it('explains a REAL permission denial and still lets the user join', async () => {
		/*
		 * This needs its own browser, not just another context.
		 *
		 * The shared browser is launched with `--use-fake-ui-for-media-stream`, which makes
		 * Chrome auto-ACCEPT every getUserMedia prompt - so a context with `permissions: []`
		 * still gets a working camera and the denial path is never actually exercised.
		 *
		 * Launching without that flag leaves the permission in its default "prompt" state, and
		 * headless Chrome auto-dismisses prompts, which surfaces as a genuine NotAllowedError
		 * from getUserMedia. That is the real path a user hits when they click Block.
		 */
		const strictBrowser = await chromium.launch(); // no fake-UI, no fake device
		const context = await strictBrowser.newContext({ viewport: { width: 1440, height: 900 } });
		const denied = await context.newPage();
		const deniedErrors: string[] = [];
		denied.on('pageerror', (e) => deniedErrors.push(e.message));

		try {
			await denied.goto(`${BASE}/room/?instant=1`, { waitUntil: 'load' });
			await denied.getByRole('button', { name: /Join meeting/i }).waitFor({ timeout: 45_000 });
			await denied.waitForTimeout(3000);

			const body = await denied.locator('body').innerText();

			// The specific, actionable message - not a raw DOMException.
			expect(body).toMatch(/blocked|not found|could not start/i);
			expect(body).not.toMatch(/NotAllowedError|NotFoundError|undefined/);

			// It must still offer a way forward rather than dead-ending.
			expect(body).toMatch(/without a camera|still join|try again/i);

			// No video track may be attached when permission was refused.
			const hasLiveVideo = await denied.evaluate(() =>
				Array.from(document.querySelectorAll('video')).some((v) => {
					const s = (v as HTMLVideoElement).srcObject as MediaStream | null;
					return !!s?.getVideoTracks().some((t) => t.readyState === 'live');
				})
			);
			expect(hasLiveVideo).toBe(false);

			// The controls must agree with the preview: with no stream, neither the mic nor the
			// camera may claim to be "on" while the tile reads "Camera is off".
			const micPressed = await denied
				.getByRole('button', { name: /Mic (on|off)/i })
				.first()
				.getAttribute('aria-pressed');
			const camPressed = await denied
				.getByRole('button', { name: /Camera (on|off)/i })
				.first()
				.getAttribute('aria-pressed');
			expect(micPressed, 'mic must not read as on without a stream').toBe('false');
			expect(camPressed, 'camera must not read as on without a stream').toBe('false');

			await denied.screenshot({ path: join(SHOTS, 'live-room-denied.png') });

			// And joining anyway must work.
			await denied.getByRole('button', { name: /Join meeting/i }).click();
			await denied.waitForTimeout(1800);
			expect(await denied.getByRole('button', { name: /End meeting/i }).isVisible()).toBe(true);
			await denied.screenshot({ path: join(SHOTS, 'live-room-denied-joined.png') });

			expect(deniedErrors, `page errors on the denied path:\n${deniedErrors.join('\n')}`).toEqual(
				[]
			);
		} finally {
			await denied.close();
			await context.close();
			await strictBrowser.close();
		}
	});
});

describe('console hygiene', () => {
	it('recorded no console errors or page exceptions on the live site', () => {
		const real = realErrors();
		expect(real, `console errors:\n${real.join('\n')}`).toEqual([]);
	});
});
