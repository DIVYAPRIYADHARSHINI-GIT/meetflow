<script lang="ts">
	/**
	 * App shell: sidebar on desktop, bottom bar on mobile, theme toggle, global toast and
	 * the storage notice banner.
	 *
	 * The landing page and the meeting room opt OUT of the chrome - the landing page is a
	 * marketing surface and the room needs the full viewport - so the shell is conditional
	 * on the route rather than duplicated into every other page.
	 */
	import '../app.css';
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { app } from '#lib/stores/app.svelte';
	import { NAV, ROUTES, SHORTCUTS, inSection, isRoute } from '#lib/nav';
	import Icon from '#lib/components/Icon.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import Modal from '#lib/components/Modal.svelte';

	let { children } = $props();

	let shortcutsOpen = $state(false);
	let mobileNavOpen = $state(false);
	/** Set while waiting for the second key of a `g`-prefixed shortcut. */
	let awaitingGoto = $state(false);
	let gotoTimer: ReturnType<typeof setTimeout> | null = null;

	/*
	 * One init for the whole app. Everything else reads from the store.
	 *
	 * `untrack` is essential: `init()` both reads and writes store $state (`loaded`,
	 * `settings`, `filters`), so without it this effect re-runs on the first store change,
	 * tears itself down, and calls `dispose()` - which clears the DEBOUNCED SAVE TIMER before
	 * it ever fires. The symptom was the sample workspace rendering correctly but never
	 * reaching localStorage, so nothing survived a refresh. Caught by the e2e probe.
	 */
	$effect(() => {
		untrack(() => app.init());
		return () => app.dispose();
	});

	const path = $derived(page.url.pathname);
	const isLanding = $derived(isRoute(path, ROUTES.home));
	const isRoom = $derived(inSection(path, ROUTES.room));
	const chromeless = $derived(isLanding || isRoom);

	const isDark = $derived(
		app.settings.theme === 'dark' ||
			(app.settings.theme === 'system' &&
				typeof window !== 'undefined' &&
				window.matchMedia('(prefers-color-scheme: dark)').matches)
	);

	function isActive(href: string): boolean {
		return inSection(path, href);
	}

	/**
	 * Global keyboard shortcuts.
	 *
	 * Deliberately inert while the user is typing: a shortcut that fires inside a note
	 * editor or a search box would be a serious bug, so every handler checks the target
	 * first.
	 */
	function onKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		const typing =
			!!target &&
			(target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.tagName === 'SELECT' ||
				target.isContentEditable);
		if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

		if (event.key === '?') {
			event.preventDefault();
			shortcutsOpen = true;
			return;
		}

		if (awaitingGoto) {
			const item = NAV.find((n) => n.key === event.key.toLowerCase());
			awaitingGoto = false;
			if (gotoTimer) clearTimeout(gotoTimer);
			if (item) {
				event.preventDefault();
				goto(item.href);
			}
			return;
		}

		if (event.key.toLowerCase() === 'g') {
			awaitingGoto = true;
			// Forget the prefix after a moment, so a stray `g` cannot hijack the next keystroke.
			if (gotoTimer) clearTimeout(gotoTimer);
			gotoTimer = setTimeout(() => (awaitingGoto = false), 1600);
			return;
		}

		if (event.key.toLowerCase() === 't' && !isRoom) {
			event.preventDefault();
			app.toggleTheme();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<svelte:head>
	<title>MeetFlow - meetings that actually get things done</title>
</svelte:head>

<a href="#mf-main" class="mf-skip">Skip to main content</a>

{#if chromeless}
	<main id="mf-main" class="min-h-dvh">
		{@render children()}
	</main>
{:else}
	<div class="flex min-h-dvh">
		<!-- ---------------- desktop sidebar ---------------- -->
		<aside
			class="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r lg:flex"
			style="background:var(--surface-raised);border-color:var(--border)"
		>
			<a
				href={ROUTES.home}
				class="flex items-center gap-2.5 px-5 py-5 font-semibold"
				style="color:var(--text)"
			>
				<span
					class="flex h-8 w-8 items-center justify-center rounded-lg"
					style="background:var(--accent);color:var(--accent-contrast)"
				>
					<Icon name="logo" size={18} />
				</span>
				<span class="text-[0.975rem]">MeetFlow</span>
			</a>

			<nav class="flex-1 px-3 py-2" aria-label="Main">
				<ul class="space-y-0.5">
					{#each NAV as item}
						<li>
							<a
								href={item.href}
								class="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
								style={isActive(item.href)
									? 'background:var(--accent-soft);color:var(--accent-soft-text)'
									: 'color:var(--text-muted)'}
								aria-current={isActive(item.href) ? 'page' : undefined}
							>
								<Icon name={item.icon} size={18} />
								{item.label}
							</a>
						</li>
					{/each}
				</ul>
			</nav>

			<div class="border-t px-3 py-3" style="border-color:var(--border)">
				<div class="flex items-center gap-2.5 rounded-lg px-2 py-2">
					<Avatar name={app.settings.profileName} hue={0} size={32} />
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{app.settings.profileName}</p>
						<p class="truncate text-xs" style="color:var(--text-subtle)">
							{app.settings.profileTitle}
						</p>
					</div>
				</div>
				<div class="mt-1 flex gap-1">
					<button
						type="button"
						class="mf-btn mf-btn-ghost mf-btn-sm flex-1"
						onclick={() => app.toggleTheme()}
						aria-label="Switch to {isDark ? 'light' : 'dark'} theme"
					>
						<Icon name={isDark ? 'sun' : 'moon'} size={16} />
						<span class="text-xs">{isDark ? 'Light' : 'Dark'}</span>
					</button>
					<button
						type="button"
						class="mf-btn mf-btn-ghost mf-btn-sm"
						onclick={() => (shortcutsOpen = true)}
						aria-label="Keyboard shortcuts"
					>
						<Icon name="keyboard" size={16} />
					</button>
				</div>
			</div>
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<!-- ---------------- mobile top bar ---------------- -->
			<header
				class="sticky top-0 z-30 flex items-center justify-between gap-3 border-b px-4 py-3 lg:hidden"
				style="background:var(--surface-raised);border-color:var(--border)"
			>
				<a href={ROUTES.home} class="flex items-center gap-2 font-semibold">
					<span
						class="flex h-7 w-7 items-center justify-center rounded-lg"
						style="background:var(--accent);color:var(--accent-contrast)"
					>
						<Icon name="logo" size={16} />
					</span>
					MeetFlow
				</a>
				<div class="flex items-center gap-1">
					<button
						type="button"
						class="mf-btn mf-btn-ghost px-2.5"
						onclick={() => app.toggleTheme()}
						aria-label="Switch to {isDark ? 'light' : 'dark'} theme"
					>
						<Icon name={isDark ? 'sun' : 'moon'} size={18} />
					</button>
					<button
						type="button"
						class="mf-btn mf-btn-ghost px-2.5"
						onclick={() => (mobileNavOpen = !mobileNavOpen)}
						aria-expanded={mobileNavOpen}
						aria-label="More navigation"
					>
						<Icon name={mobileNavOpen ? 'close' : 'list'} size={18} />
					</button>
				</div>
			</header>

			{#if mobileNavOpen}
				<nav
					class="border-b px-3 py-2 lg:hidden"
					style="background:var(--surface-raised);border-color:var(--border)"
					aria-label="All pages"
				>
					<ul class="grid grid-cols-2 gap-1">
						{#each NAV as item}
							<li>
								<a
									href={item.href}
									class="flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium"
									style={isActive(item.href)
										? 'background:var(--accent-soft);color:var(--accent-soft-text)'
										: 'color:var(--text-muted)'}
									onclick={() => (mobileNavOpen = false)}
								>
									<Icon name={item.icon} size={17} />
									{item.label}
								</a>
							</li>
						{/each}
					</ul>
				</nav>
			{/if}

			{#if app.storageNotice}
				<div
					class="flex items-start gap-2.5 border-b px-4 py-2.5 text-sm"
					style="background:var(--warn-soft);color:var(--warn);border-color:var(--border)"
					role="status"
				>
					<Icon name="warning" size={17} class="mt-0.5 shrink-0" />
					<p class="flex-1">{app.storageNotice.message}</p>
					<button
						type="button"
						class="shrink-0 underline"
						onclick={() => (app.storageNotice = null)}
					>
						Dismiss
					</button>
				</div>
			{/if}

			<main id="mf-main" class="flex-1 pb-20 lg:pb-0">
				{@render children()}
			</main>

			<!-- ---------------- mobile bottom bar ---------------- -->
			<nav
				class="fixed inset-x-0 bottom-0 z-30 flex border-t lg:hidden"
				style="background:var(--surface-raised);border-color:var(--border)"
				aria-label="Primary"
			>
				{#each NAV.filter((n) => n.primary) as item}
					<a
						href={item.href}
						class="flex flex-1 flex-col items-center gap-1 py-2.5 text-[0.6875rem] font-medium"
						style={isActive(item.href) ? 'color:var(--accent)' : 'color:var(--text-subtle)'}
						aria-current={isActive(item.href) ? 'page' : undefined}
					>
						<Icon name={item.icon} size={20} />
						{item.label}
					</a>
				{/each}
			</nav>
		</div>
	</div>
{/if}

<!-- ---------------- global toast ---------------- -->
{#if app.toast}
	<div
		class="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 lg:bottom-6"
		role="status"
		aria-live="polite"
	>
		<div
			class="flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium"
			style="background:var(--surface-raised);box-shadow:var(--shadow-overlay);border:1px solid var(--border);color:{app
				.toast.kind === 'error'
				? 'var(--danger)'
				: app.toast.kind === 'success'
					? 'var(--ok)'
					: 'var(--text)'}"
		>
			<Icon
				name={app.toast.kind === 'error' ? 'warning' : app.toast.kind === 'success' ? 'check-circle' : 'info'}
				size={17}
			/>
			{app.toast.text}
		</div>
	</div>
{/if}

<!-- ---------------- shortcuts overlay ---------------- -->
<Modal
	open={shortcutsOpen}
	title="Keyboard shortcuts"
	description="Press ? at any time to open this list."
	onClose={() => (shortcutsOpen = false)}
>
	<div class="space-y-5">
		{#each ['Navigation', 'Actions', 'Meeting room'] as group}
			<section>
				<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide" style="color:var(--text-subtle)">
					{group}
				</h3>
				<ul class="space-y-1.5">
					{#each SHORTCUTS.filter((s) => s.group === group) as shortcut}
						<li class="flex items-center justify-between gap-4 text-sm">
							<span style="color:var(--text-muted)">{shortcut.description}</span>
							<kbd
								class="shrink-0 rounded-md px-2 py-1 font-mono text-xs"
								style="background:var(--surface-hover);border:1px solid var(--border);color:var(--text)"
							>
								{shortcut.keys}
							</kbd>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
</Modal>
