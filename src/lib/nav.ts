/**
 * Route helpers and navigation model, shared by the sidebar, mobile bars and shortcuts.
 *
 * SvelteKit 3 replaced the `base` string with `resolve()`, which prefixes the base path and
 * validates the route id at compile time. Centralising the ids here means a renamed route is
 * a build error rather than a dead link, and it is what makes the app work unchanged on a
 * GitHub Pages sub-path as well as at a domain root.
 */

import { resolve } from '$app/paths';

export const ROUTES = {
	home: resolve('/'),
	dashboard: resolve('/dashboard'),
	calendar: resolve('/calendar'),
	schedule: resolve('/schedule'),
	actions: resolve('/actions'),
	history: resolve('/history'),
	contacts: resolve('/contacts'),
	settings: resolve('/settings'),
	room: resolve('/room'),
	meeting: resolve('/meeting')
} as const;

/** Compare a pathname to a route, ignoring the trailing slash the config adds. */
export function isRoute(pathname: string, route: string): boolean {
	const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
	return norm(pathname) === norm(route);
}

/** True when `pathname` is the route or anything beneath it. */
export function inSection(pathname: string, route: string): boolean {
	const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);
	const a = norm(pathname);
	const b = norm(route);
	return a === b || a.startsWith(`${b}/`);
}

export interface NavItem {
	href: string;
	label: string;
	icon: string;
	/** Single-key shortcut, pressed after `g`. */
	key: string;
	/** Shown in the mobile bottom bar. */
	primary?: boolean;
}

export const NAV: NavItem[] = [
	{ href: ROUTES.dashboard, label: 'Dashboard', icon: 'home', key: 'd', primary: true },
	{ href: ROUTES.calendar, label: 'Calendar', icon: 'calendar', key: 'c', primary: true },
	{ href: ROUTES.schedule, label: 'Schedule', icon: 'plus', key: 'n', primary: true },
	{ href: ROUTES.actions, label: 'Action items', icon: 'check-circle', key: 'a', primary: true },
	{ href: ROUTES.history, label: 'History', icon: 'clock', key: 'h' },
	{ href: ROUTES.contacts, label: 'Contacts', icon: 'users', key: 'p' },
	{ href: ROUTES.settings, label: 'Settings', icon: 'settings', key: 's' }
];

export interface Shortcut {
	keys: string;
	description: string;
	group: 'Navigation' | 'Actions' | 'Meeting room';
}

export const SHORTCUTS: Shortcut[] = [
	{ keys: 'g then d', description: 'Go to dashboard', group: 'Navigation' },
	{ keys: 'g then c', description: 'Go to calendar', group: 'Navigation' },
	{ keys: 'g then n', description: 'Schedule a meeting', group: 'Navigation' },
	{ keys: 'g then a', description: 'Go to action items', group: 'Navigation' },
	{ keys: 'g then h', description: 'Go to meeting history', group: 'Navigation' },
	{ keys: 'g then p', description: 'Go to contacts and teams', group: 'Navigation' },
	{ keys: 'g then s', description: 'Go to settings', group: 'Navigation' },
	{ keys: '?', description: 'Show this shortcuts help', group: 'Actions' },
	{ keys: 't', description: 'Toggle light / dark theme', group: 'Actions' },
	{ keys: 'Escape', description: 'Close a dialog or panel', group: 'Actions' },
	{ keys: 'm', description: 'Mute or unmute the microphone', group: 'Meeting room' },
	{ keys: 'v', description: 'Turn the camera on or off', group: 'Meeting room' },
	{ keys: 'r', description: 'Raise or lower your hand', group: 'Meeting room' },
	{ keys: 'c', description: 'Toggle the chat panel', group: 'Meeting room' }
];
