/**
 * Accessibility probe: runs axe-core over every page, in both themes, at three widths.
 *
 * Asserts zero SERIOUS or CRITICAL violations. Moderate/minor findings are reported in the
 * output but do not fail the suite, because some of them are judgement calls (colour-contrast
 * on deliberately de-emphasised helper text, for example) rather than defects.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openProbe, type Probe } from './harness';

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PAGES: { path: string; name: string }[] = [
	{ path: '/', name: 'landing' },
	{ path: '/dashboard/', name: 'dashboard' },
	{ path: '/calendar/', name: 'calendar' },
	{ path: '/schedule/', name: 'schedule' },
	{ path: '/actions/', name: 'actions' },
	{ path: '/history/', name: 'history' },
	{ path: '/contacts/', name: 'contacts' },
	{ path: '/settings/', name: 'settings' }
];

const WIDTHS = [
	{ width: 390, height: 844, label: 'mobile' },
	{ width: 1440, height: 900, label: 'desktop' }
];

interface AxeViolation {
	id: string;
	impact: string | null;
	help: string;
	nodes: { target: string[] }[];
}

let probe: Probe;

beforeAll(async () => {
	probe = await openProbe();
}, 300_000);

afterAll(async () => {
	await probe?.close();
});

async function scan(path: string, dark: boolean, viewport: { width: number; height: number }) {
	const { page, origin } = probe;
	await page.setViewportSize(viewport);
	await page.goto(`${origin}${path}`, { waitUntil: 'load' });
	await page.locator('h1').first().waitFor({ timeout: 30_000 });

	await page.evaluate((isDark) => {
		document.documentElement.classList.toggle('dark', isDark);
	}, dark);
	await page.waitForTimeout(350);

	await page.evaluate(AXE_SOURCE);
	return page.evaluate(async () => {
		// @ts-expect-error injected by the axe source above
		const results = await window.axe.run(document, {
			runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
		});
		return results.violations as AxeViolation[];
	});
}

describe('accessibility (axe-core, WCAG 2.1 AA)', () => {
	for (const { path, name } of PAGES) {
		for (const theme of ['light', 'dark'] as const) {
			for (const size of WIDTHS) {
				it(`${name} has no serious violations (${theme}, ${size.label})`, async () => {
					const violations = await scan(path, theme === 'dark', size);
					const blocking = violations.filter(
						(v) => v.impact === 'serious' || v.impact === 'critical'
					);

					if (violations.length > 0) {
						const summary = violations
							.map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} nodes)`)
							.join('\n');
						console.log(`${name} / ${theme} / ${size.label}:\n${summary}`);
					}

					expect(
						blocking.map((v) => `${v.id} @ ${v.nodes[0]?.target?.join(' ')}`),
						`serious/critical a11y violations on ${name}`
					).toEqual([]);
				});
			}
		}
	}
});

describe('keyboard navigation', () => {
	it('exposes a working skip link as the first tab stop', async () => {
		const { page, origin } = probe;
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`${origin}/dashboard/`, { waitUntil: 'load' });
		await page.locator('h1').first().waitFor({ timeout: 30_000 });

		await page.keyboard.press('Tab');
		const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
		expect(focused).toMatch(/Skip to main content/i);
	});

	it('reaches the primary actions by keyboard alone', async () => {
		const { page } = probe;
		// Tab through a bounded number of stops and confirm we hit real controls, never a trap.
		const reached: string[] = [];
		for (let i = 0; i < 25; i++) {
			await page.keyboard.press('Tab');
			const label = await page.evaluate(() => {
				const el = document.activeElement as HTMLElement | null;
				if (!el || el === document.body) return '';
				return (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40);
			});
			if (label) reached.push(label);
		}
		expect(reached.length).toBeGreaterThan(10);
		expect(reached.join(' | ')).toMatch(/Schedule|Dashboard|Calendar/i);
	});

	it('opens and closes the shortcuts dialog with the keyboard', async () => {
		const { page, origin } = probe;
		await page.goto(`${origin}/dashboard/`, { waitUntil: 'load' });
		await page.locator('h1').first().waitFor({ timeout: 30_000 });
		await page.locator('body').click();

		await page.keyboard.press('?');
		await page.waitForTimeout(400);
		expect(await page.getByRole('dialog', { name: /Keyboard shortcuts/i }).isVisible()).toBe(true);

		await page.keyboard.press('Escape');
		await page.waitForTimeout(400);
		expect(await page.getByRole('dialog', { name: /Keyboard shortcuts/i }).count()).toBe(0);
	});

	it('traps focus inside an open dialog', async () => {
		const { page, origin } = probe;
		await page.goto(`${origin}/actions/`, { waitUntil: 'load' });
		await page.locator('h1').first().waitFor({ timeout: 30_000 });
		await page.getByRole('button', { name: /New action item/i }).click();
		await page.waitForTimeout(500);

		// Tab many times; focus must never escape the dialog.
		for (let i = 0; i < 15; i++) await page.keyboard.press('Tab');
		const inside = await page.evaluate(() => {
			const dialog = document.querySelector('[role="dialog"]');
			return !!dialog && dialog.contains(document.activeElement);
		});
		expect(inside).toBe(true);

		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
	});

	it('navigates the mini calendar with arrow keys', async () => {
		const { page, origin } = probe;
		await page.goto(`${origin}/dashboard/`, { waitUntil: 'load' });
		await page.locator('h1').first().waitFor({ timeout: 30_000 });

		const selected = page.locator('[role="gridcell"][aria-selected="true"]');
		await selected.first().focus();
		const before = await selected.first().getAttribute('data-mf-day');

		await page.keyboard.press('ArrowRight');
		await page.waitForTimeout(350);
		const after = await page
			.locator('[role="gridcell"][aria-selected="true"]')
			.first()
			.getAttribute('data-mf-day');

		expect(after).not.toBe(before);
	});
});
