/**
 * Shared harness for the headless-Chrome probes.
 *
 * Builds the static site once, serves `build/` over a plain Node static server (exactly how
 * it is deployed), and hands out a Playwright page. Console errors and page exceptions are
 * collected so a probe can assert the app ran CLEAN, not just that the DOM looked right.
 *
 * The browser is launched with a fake camera and microphone, which is what lets the probes
 * exercise the real getUserMedia path - granted AND denied - rather than mocking it.
 */

import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, type Browser, type ConsoleMessage, type Locator, type Page } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const BUILD_DIR = join(ROOT, 'build');
export const SHOTS_DIR = join(ROOT, 'probes', 'screenshots');

const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ics': 'text/calendar; charset=utf-8',
	'.pdf': 'application/pdf',
	'.woff2': 'font/woff2',
	'.woff': 'font/woff'
};

export function buildSite(): void {
	if (!existsSync(join(BUILD_DIR, 'index.html'))) {
		execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
	}
}

/** Static server with SPA fallback, matching a GitHub Pages / Netlify / Vercel style host. */
export async function startServer(): Promise<{ origin: string; close: () => Promise<void> }> {
	const server: Server = createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://localhost');
		let path = decodeURIComponent(url.pathname);
		if (path.endsWith('/')) path += 'index.html';

		// Mirror Vercel exactly: serve a real file when one exists, otherwise rewrite to the
		// SPA fallback. Falling back to index.html here would hide fallback-only bugs, because
		// index.html is the prerendered landing page and happens to boot fine.
		let filePath = join(BUILD_DIR, normalize(path).replace(/^(\.\.[/\\])+/, ''));
		if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
			const htmlPath = `${filePath}.html`;
			if (existsSync(htmlPath)) {
				filePath = htmlPath;
			} else {
				// Unknown asset extensions must 404 rather than return HTML, so a missing asset
				// surfaces as a failed fetch instead of silently parsing markup.
				const ext = extname(filePath);
				if (ext && ext !== '.html') {
					res.writeHead(404, { 'Content-Type': 'text/plain' });
					res.end('Not found');
					return;
				}
				filePath = join(BUILD_DIR, '200.html');
			}
		}

		res.writeHead(200, {
			'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
			'Cache-Control': 'no-store'
		});
		createReadStream(filePath).pipe(res);
	});

	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	const address = server.address();
	const port = typeof address === 'object' && address ? address.port : 0;

	return {
		origin: `http://127.0.0.1:${port}`,
		close: () => new Promise<void>((done) => server.close(() => done()))
	};
}

export type Probe = {
	page: Page;
	origin: string;
	browser: Browser;
	errors: string[];
	/** Open a second page that shares nothing with the first (fresh storage). */
	freshPage: (options?: { grantMedia?: boolean }) => Promise<Page>;
	close: () => Promise<void>;
};

export interface ProbeOptions {
	/** Grant camera/mic permission up front. Default true. */
	grantMedia?: boolean;
	viewport?: { width: number; height: number };
}

export async function openProbe(options: ProbeOptions = {}): Promise<Probe> {
	buildSite();
	mkdirSync(SHOTS_DIR, { recursive: true });
	const { origin, close: closeServer } = await startServer();

	// Fake devices make getUserMedia resolve with a real MediaStream in headless Chrome, so
	// the permission-granted path is genuinely exercised rather than stubbed.
	const browser: Browser = await chromium.launch({
		args: [
			'--use-fake-ui-for-media-stream',
			'--use-fake-device-for-media-stream',
			'--autoplay-policy=no-user-gesture-required'
		]
	});

	const context = await browser.newContext({
		viewport: options.viewport ?? { width: 1440, height: 900 },
		permissions: options.grantMedia === false ? [] : ['camera', 'microphone']
	});
	const page = await context.newPage();

	const errors: string[] = [];
	page.on('console', (msg: ConsoleMessage) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});
	page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

	return {
		page,
		origin,
		browser,
		errors,
		freshPage: async (opts = {}) => {
			const fresh = await browser.newContext({
				viewport: options.viewport ?? { width: 1440, height: 900 },
				permissions: opts.grantMedia === false ? [] : ['camera', 'microphone']
			});
			const freshPageInstance = await fresh.newPage();
			freshPageInstance.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
			return freshPageInstance;
		},
		close: async () => {
			await browser.close();
			await closeServer();
		}
	};
}

/**
 * Text of a locator, waiting for it to exist first.
 * Vitest's `expect` has no Playwright matchers, so probes assert on strings instead.
 */
export async function textOf(locator: Locator): Promise<string> {
	await locator.first().waitFor({ state: 'attached', timeout: 30_000 });
	return (await locator.first().innerText()).trim();
}

/**
 * Whole-page text, after hydration has had a chance to run.
 *
 * textContent rather than innerText: CSS text-transform is baked into innerText, so a
 * heading styled uppercase would never match the sentence case in the source.
 */
export async function bodyText(page: Page): Promise<string> {
	await page.waitForLoadState('networkidle');
	return page.evaluate(() => {
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				const tag = node.parentElement?.tagName;
				return tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE'
					? NodeFilter.FILTER_REJECT
					: NodeFilter.FILTER_ACCEPT;
			}
		});
		const parts: string[] = [];
		while (walker.nextNode()) parts.push(walker.currentNode.nodeValue ?? '');
		return parts.join(' ').replace(/\s+/g, ' ');
	});
}

/** Go to a route and wait for the app shell to hydrate. */
export async function visit(page: Page, origin: string, path: string): Promise<void> {
	await page.goto(`${origin}${path}`, { waitUntil: 'load' });
	// The store hydrates on mount; every inner page renders an <h1> once it has.
	await page.locator('h1').first().waitFor({ state: 'visible', timeout: 30_000 });
}

/** Read MeetFlow's persisted workspace straight out of localStorage. */
export async function readState(page: Page): Promise<Record<string, unknown> | null> {
	return page.evaluate(() => {
		const raw = localStorage.getItem('meetflow:state:v1');
		return raw ? JSON.parse(raw) : null;
	});
}

/** Overwrite the persisted workspace, then reload so the store picks it up. */
export async function writeState(page: Page, state: unknown): Promise<void> {
	await page.evaluate((value) => {
		localStorage.setItem('meetflow:state:v1', JSON.stringify(value));
	}, state);
	await page.reload({ waitUntil: 'load' });
}

export async function shoot(page: Page, name: string): Promise<void> {
	mkdirSync(SHOTS_DIR, { recursive: true });
	await page.screenshot({ path: join(SHOTS_DIR, `${name}.png`), fullPage: false });
}
