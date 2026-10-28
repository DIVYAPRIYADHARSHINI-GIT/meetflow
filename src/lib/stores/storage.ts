/**
 * localStorage persistence.
 *
 * Every read and write is wrapped: storage can be unavailable (private mode, embedded
 * webview), full (QuotaExceededError), or hold data written by an older version of the app.
 * None of those may crash the UI, so this module always returns a usable value and reports
 * what happened through `lastError` instead of throwing.
 *
 * `SCHEMA_VERSION` guards the saved shape. On load, anything older is run through the
 * migration list; anything newer than this build is refused (and the app falls back to
 * sample data) rather than half-parsed, because a future version may have fields we would
 * silently drop and then overwrite.
 */

import type { PersistedState } from '../types';

export const STORAGE_KEY = 'meetflow:state:v1';
export const SCHEMA_VERSION = 1;

export type StorageStatus = 'ok' | 'unavailable' | 'corrupt' | 'full' | 'future-version';

export interface LoadResult {
	state: PersistedState | null;
	status: StorageStatus;
	message: string;
}

/** Feature-detect storage by actually writing, not by checking for the object. */
export function storageAvailable(): boolean {
	try {
		if (typeof localStorage === 'undefined') return false;
		const probe = '__meetflow_probe__';
		localStorage.setItem(probe, '1');
		localStorage.removeItem(probe);
		return true;
	} catch {
		return false;
	}
}

/** Migrations keyed by the version they upgrade FROM. */
const MIGRATIONS: Record<number, (state: Record<string, unknown>) => Record<string, unknown>> = {
	// v0 was the unversioned pre-release shape. Kept as a worked example of the contract:
	// a migration receives the raw parsed object and returns the next version's shape.
	0: (state) => ({ ...state, version: 1, chat: Array.isArray(state.chat) ? state.chat : [] })
};

function migrate(raw: Record<string, unknown>): Record<string, unknown> {
	let state = raw;
	let version = typeof state.version === 'number' ? state.version : 0;
	while (version < SCHEMA_VERSION) {
		const step = MIGRATIONS[version];
		if (!step) {
			// No path forward: treat as corrupt rather than guessing at the shape.
			throw new Error(`No migration from version ${version}`);
		}
		state = step(state);
		version = typeof state.version === 'number' ? state.version : version + 1;
	}
	return state;
}

/**
 * Validate the loaded shape before trusting it.
 *
 * Only structural checks - every array must be an array and settings must be an object.
 * A corrupted or hand-edited blob then falls back to sample data instead of crashing a
 * component that assumed `.map` existed.
 */
function isUsable(state: unknown): state is PersistedState {
	if (!state || typeof state !== 'object') return false;
	const s = state as Record<string, unknown>;
	const arrays = ['contacts', 'teams', 'meetings', 'notes', 'decisions', 'actionItems', 'chat'];
	for (const key of arrays) {
		if (!Array.isArray(s[key])) return false;
	}
	if (!s.settings || typeof s.settings !== 'object') return false;
	if (typeof s.meId !== 'string') return false;
	return true;
}

export function loadState(): LoadResult {
	if (!storageAvailable()) {
		return {
			state: null,
			status: 'unavailable',
			message: 'Browser storage is blocked, so changes will not survive a refresh.'
		};
	}

	let raw: string | null = null;
	try {
		raw = localStorage.getItem(STORAGE_KEY);
	} catch {
		return {
			state: null,
			status: 'unavailable',
			message: 'Browser storage could not be read.'
		};
	}

	if (!raw) return { state: null, status: 'ok', message: '' };

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			state: null,
			status: 'corrupt',
			message: 'Saved data could not be read, so MeetFlow started from the sample workspace.'
		};
	}

	const version =
		parsed && typeof parsed === 'object' && typeof (parsed as { version?: unknown }).version === 'number'
			? (parsed as { version: number }).version
			: 0;

	if (version > SCHEMA_VERSION) {
		return {
			state: null,
			status: 'future-version',
			message:
				'Saved data was written by a newer version of MeetFlow and was left untouched. Update the app to use it.'
		};
	}

	try {
		const migrated = migrate(parsed as Record<string, unknown>);
		if (!isUsable(migrated)) {
			return {
				state: null,
				status: 'corrupt',
				message: 'Saved data was incomplete, so MeetFlow started from the sample workspace.'
			};
		}
		return { state: migrated, status: 'ok', message: '' };
	} catch {
		return {
			state: null,
			status: 'corrupt',
			message: 'Saved data could not be upgraded, so MeetFlow started from the sample workspace.'
		};
	}
}

export interface SaveResult {
	ok: boolean;
	status: StorageStatus;
	message: string;
}

export function saveState(state: PersistedState): SaveResult {
	if (!storageAvailable()) {
		return {
			ok: false,
			status: 'unavailable',
			message: 'Browser storage is blocked, so changes will not survive a refresh.'
		};
	}
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: SCHEMA_VERSION }));
		return { ok: true, status: 'ok', message: '' };
	} catch (error) {
		// QuotaExceededError is the realistic failure: a long meeting's chat log plus notes can
		// grow past the 5 MB budget. Report it instead of losing the user's current edit.
		const quota =
			error instanceof DOMException &&
			(error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED');
		return {
			ok: false,
			status: quota ? 'full' : 'unavailable',
			message: quota
				? 'Browser storage is full. Export or delete old meetings to save new changes.'
				: 'Changes could not be saved to browser storage.'
		};
	}
}

export function clearState(): void {
	try {
		localStorage.removeItem(STORAGE_KEY);
	} catch {
		// Nothing to do: the caller is resetting anyway.
	}
}

/** Export the whole workspace as a JSON backup string. */
export function exportBackup(state: PersistedState): string {
	return JSON.stringify({ ...state, version: SCHEMA_VERSION }, null, 2);
}

/** Parse a backup file, applying the same validation and migrations as a normal load. */
export function parseBackup(text: string): LoadResult {
	try {
		const parsed = JSON.parse(text) as Record<string, unknown>;
		const version = typeof parsed.version === 'number' ? parsed.version : 0;
		if (version > SCHEMA_VERSION) {
			return {
				state: null,
				status: 'future-version',
				message: 'That backup was written by a newer version of MeetFlow.'
			};
		}
		const migrated = migrate(parsed);
		if (!isUsable(migrated)) {
			return { state: null, status: 'corrupt', message: 'That file is not a MeetFlow backup.' };
		}
		return { state: migrated, status: 'ok', message: '' };
	} catch {
		return { state: null, status: 'corrupt', message: 'That file could not be read as JSON.' };
	}
}
