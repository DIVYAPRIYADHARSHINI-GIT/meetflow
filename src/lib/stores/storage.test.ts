/**
 * Storage tests.
 *
 * These run in Node, which has no localStorage, so each test installs a fake. That is the
 * point: it lets us simulate the failure modes a real browser throws at us - blocked
 * storage, corrupted JSON, a quota-exceeded write and data from a future version - and
 * prove none of them crash or silently destroy the user's workspace.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistedState } from '../types';
import { buildEmptyState, buildSampleState } from '../data/sample';
import {
	clearState,
	exportBackup,
	loadState,
	parseBackup,
	saveState,
	SCHEMA_VERSION,
	STORAGE_KEY,
	storageAvailable
} from './storage';

/** Minimal in-memory localStorage, with optional failure injection. */
function installStorage(options: { throwOnWrite?: 'quota' | 'other'; blocked?: boolean } = {}) {
	const map = new Map<string, string>();
	const fake = {
		getItem: (key: string) => {
			if (options.blocked) throw new DOMException('blocked', 'SecurityError');
			return map.get(key) ?? null;
		},
		setItem: (key: string, value: string) => {
			if (options.blocked) throw new DOMException('blocked', 'SecurityError');
			if (options.throwOnWrite === 'quota' && key === STORAGE_KEY) {
				throw new DOMException('full', 'QuotaExceededError');
			}
			if (options.throwOnWrite === 'other' && key === STORAGE_KEY) {
				throw new Error('disk on fire');
			}
			map.set(key, value);
		},
		removeItem: (key: string) => {
			map.delete(key);
		},
		clear: () => map.clear()
	};
	vi.stubGlobal('localStorage', fake);
	return map;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('storageAvailable', () => {
	it('is false when there is no localStorage at all', () => {
		vi.stubGlobal('localStorage', undefined);
		expect(storageAvailable()).toBe(false);
	});

	it('is false when storage throws on write (private mode)', () => {
		installStorage({ blocked: true });
		expect(storageAvailable()).toBe(false);
	});

	it('is true for a working storage', () => {
		installStorage();
		expect(storageAvailable()).toBe(true);
	});

	it('cleans up its own probe key', () => {
		const map = installStorage();
		storageAvailable();
		expect(map.size).toBe(0);
	});
});

describe('loadState', () => {
	it('reports unavailable rather than throwing when storage is blocked', () => {
		installStorage({ blocked: true });
		const result = loadState();
		expect(result.state).toBeNull();
		expect(result.status).toBe('unavailable');
		expect(result.message).toContain('blocked');
	});

	it('returns a clean empty result on a first visit', () => {
		installStorage();
		const result = loadState();
		expect(result.state).toBeNull();
		expect(result.status).toBe('ok');
		expect(result.message).toBe('');
	});

	it('round-trips a saved workspace', () => {
		installStorage();
		const state = buildSampleState({ today: '2026-03-02', zone: 'UTC' });
		expect(saveState(state).ok).toBe(true);

		const result = loadState();
		expect(result.status).toBe('ok');
		expect(result.state?.meetings.length).toBe(state.meetings.length);
		expect(result.state?.contacts[0].name).toBe('Divya Priyadharshini');
	});

	it('recovers from corrupted JSON instead of crashing', () => {
		const map = installStorage();
		map.set(STORAGE_KEY, '{not json at all');
		const result = loadState();
		expect(result.state).toBeNull();
		expect(result.status).toBe('corrupt');
		expect(result.message).toContain('sample workspace');
	});

	it('recovers from JSON that is valid but the wrong shape', () => {
		const map = installStorage();
		map.set(STORAGE_KEY, JSON.stringify({ version: 1, meetings: 'not-an-array' }));
		const result = loadState();
		expect(result.state).toBeNull();
		expect(result.status).toBe('corrupt');
	});

	it('rejects data written by a FUTURE version rather than half-parsing it', () => {
		const map = installStorage();
		const future = { ...buildEmptyState(), version: SCHEMA_VERSION + 5 };
		map.set(STORAGE_KEY, JSON.stringify(future));

		const result = loadState();
		expect(result.state).toBeNull();
		expect(result.status).toBe('future-version');
		// Crucially the data is still there: refusing to parse must not delete it.
		expect(map.get(STORAGE_KEY)).toBeTruthy();
	});

	it('migrates an unversioned (v0) blob up to the current version', () => {
		const map = installStorage();
		const v0: Record<string, unknown> = { ...buildEmptyState() };
		delete v0.version;
		delete v0.chat;
		map.set(STORAGE_KEY, JSON.stringify(v0));

		const result = loadState();
		expect(result.status).toBe('ok');
		expect(result.state?.version).toBe(SCHEMA_VERSION);
		expect(Array.isArray(result.state?.chat)).toBe(true);
	});

	it('treats an unmigratable version as corrupt rather than guessing', () => {
		const map = installStorage();
		// Version 0.5 has no migration path registered.
		map.set(STORAGE_KEY, JSON.stringify({ ...buildEmptyState(), version: 0.5 }));
		expect(loadState().status).toBe('corrupt');
	});
});

describe('saveState', () => {
	it('reports a full quota without throwing', () => {
		installStorage({ throwOnWrite: 'quota' });
		const result = saveState(buildEmptyState());
		expect(result.ok).toBe(false);
		expect(result.status).toBe('full');
		expect(result.message).toContain('full');
	});

	it('reports a non-quota write failure without throwing', () => {
		installStorage({ throwOnWrite: 'other' });
		const result = saveState(buildEmptyState());
		expect(result.ok).toBe(false);
		expect(result.status).toBe('unavailable');
	});

	it('reports unavailable when storage is blocked entirely', () => {
		installStorage({ blocked: true });
		expect(saveState(buildEmptyState()).ok).toBe(false);
	});

	it('always stamps the current schema version', () => {
		const map = installStorage();
		saveState({ ...buildEmptyState(), version: 0 } as PersistedState);
		const written = JSON.parse(map.get(STORAGE_KEY) ?? '{}');
		expect(written.version).toBe(SCHEMA_VERSION);
	});

	it('survives emoji and non-Latin content', () => {
		installStorage();
		const state = buildEmptyState();
		state.contacts[0].name = 'தமிழ் 🎉 Divya';
		expect(saveState(state).ok).toBe(true);
		expect(loadState().state?.contacts[0].name).toBe('தமிழ் 🎉 Divya');
	});
});

describe('clearState', () => {
	it('removes the key and does not throw when storage is blocked', () => {
		const map = installStorage();
		saveState(buildEmptyState());
		clearState();
		expect(map.get(STORAGE_KEY)).toBeUndefined();

		installStorage({ blocked: true });
		expect(() => clearState()).not.toThrow();
	});
});

describe('backup export / import', () => {
	it('round-trips a full workspace through the backup format', () => {
		const state = buildSampleState({ today: '2026-03-02', zone: 'UTC' });
		const result = parseBackup(exportBackup(state));
		expect(result.status).toBe('ok');
		expect(result.state?.meetings.length).toBe(state.meetings.length);
		expect(result.state?.actionItems.length).toBe(state.actionItems.length);
	});

	it('rejects a non-JSON file with a readable message', () => {
		const result = parseBackup('this is not a backup');
		expect(result.state).toBeNull();
		expect(result.message).toContain('JSON');
	});

	it('rejects JSON that is not a MeetFlow backup', () => {
		const result = parseBackup(JSON.stringify({ hello: 'world' }));
		expect(result.state).toBeNull();
		expect(result.status).toBe('corrupt');
	});

	it('refuses a backup from a newer version', () => {
		const future = JSON.stringify({ ...buildEmptyState(), version: SCHEMA_VERSION + 1 });
		expect(parseBackup(future).status).toBe('future-version');
	});
});
