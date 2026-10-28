<script lang="ts">
	/**
	 * Settings: profile, meeting defaults, notifications, theme, data and shortcuts help.
	 *
	 * Writes go straight to the store, which persists them, so a change here is visible on
	 * every other page at once.
	 */
	import { app } from '#lib/stores/app.svelte';
	import { SHORTCUTS } from '#lib/nav';
	import { COMMON_TIMEZONES, zoneLabel } from '#lib/logic/time';
	import { STORAGE_KEY, SCHEMA_VERSION, storageAvailable } from '#lib/stores/storage';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Avatar from '#lib/components/Avatar.svelte';

	let fileInput = $state<HTMLInputElement | null>(null);
	let confirmReset = $state<'none' | 'sample' | 'fresh'>('none');

	const DURATIONS = [15, 25, 30, 45, 60, 90];

	/** Rough size of the saved workspace, so "storage full" is understandable. */
	const storageSize = $derived.by(() => {
		if (typeof localStorage === 'undefined') return null;
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (!raw) return 0;
			return Math.round((raw.length / 1024) * 10) / 10;
		} catch {
			return null;
		}
	});

	function downloadBackup() {
		const blob = new Blob([app.backup()], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `meetflow-backup-${app.today}.json`;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
		app.showToast('Backup downloaded');
	}

	async function restoreBackup(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			app.restore(await file.text());
		} catch {
			app.showToast('That file could not be read', 'error');
		}
		input.value = '';
	}
</script>

<svelte:head>
	<title>Settings · MeetFlow</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
	<PageHeader title="Settings" subtitle="Everything is stored in this browser only." />

	<div class="space-y-5">
		<!-- ---------------- profile ---------------- -->
		<section class="mf-card p-4 sm:p-5">
			<h2 class="mb-4 text-base font-semibold">Profile</h2>
			<div class="flex items-start gap-4">
				<Avatar name={app.settings.profileName} hue={0} size={52} />
				<div class="min-w-0 flex-1 space-y-3">
					<div>
						<label class="mf-label" for="mf-profile-name">Name</label>
						<input
							id="mf-profile-name"
							class="mf-field"
							value={app.settings.profileName}
							oninput={(e) => app.updateSettings({ profileName: e.currentTarget.value })}
						/>
					</div>
					<div class="grid gap-3 sm:grid-cols-2">
						<div>
							<label class="mf-label" for="mf-profile-email">Email</label>
							<input
								id="mf-profile-email"
								class="mf-field"
								type="email"
								value={app.settings.profileEmail}
								oninput={(e) => app.updateSettings({ profileEmail: e.currentTarget.value })}
							/>
						</div>
						<div>
							<label class="mf-label" for="mf-profile-title">Role</label>
							<input
								id="mf-profile-title"
								class="mf-field"
								value={app.settings.profileTitle}
								oninput={(e) => app.updateSettings({ profileTitle: e.currentTarget.value })}
							/>
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- ---------------- meeting defaults ---------------- -->
		<section class="mf-card p-4 sm:p-5">
			<h2 class="mb-4 text-base font-semibold">Meeting defaults</h2>
			<div class="space-y-4">
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class="mf-label" for="mf-default-duration">Default duration</label>
						<select
							id="mf-default-duration"
							class="mf-field"
							value={app.settings.defaultDurationMinutes}
							onchange={(e) =>
								app.updateSettings({ defaultDurationMinutes: Number(e.currentTarget.value) })}
						>
							{#each DURATIONS as d}
								<option value={d}>{d} minutes</option>
							{/each}
						</select>
					</div>
					<div>
						<label class="mf-label" for="mf-default-zone">Timezone</label>
						<select
							id="mf-default-zone"
							class="mf-field"
							value={app.settings.timezone}
							onchange={(e) => app.updateSettings({ timezone: e.currentTarget.value })}
						>
							{#each [...new Set([app.settings.timezone, ...COMMON_TIMEZONES])] as zone}
								<option value={zone}>{zone} ({zoneLabel(zone)})</option>
							{/each}
						</select>
					</div>
				</div>

				<div class="space-y-2">
					<label class="flex cursor-pointer items-center justify-between gap-4 py-1">
						<span class="text-sm">
							Join with my microphone muted
							<span class="block text-xs" style="color:var(--text-subtle)">
								Applies the next time you enter a room.
							</span>
						</span>
						<input
							type="checkbox"
							class="h-5 w-5 shrink-0"
							checked={app.settings.joinMuted}
							onchange={(e) => app.updateSettings({ joinMuted: e.currentTarget.checked })}
						/>
					</label>
					<label class="flex cursor-pointer items-center justify-between gap-4 py-1">
						<span class="text-sm">
							Join with my camera off
							<span class="block text-xs" style="color:var(--text-subtle)">
								Your camera is never started until you join.
							</span>
						</span>
						<input
							type="checkbox"
							class="h-5 w-5 shrink-0"
							checked={app.settings.joinCameraOff}
							onchange={(e) => app.updateSettings({ joinCameraOff: e.currentTarget.checked })}
						/>
					</label>
				</div>
			</div>
		</section>

		<!-- ---------------- notifications ---------------- -->
		<section class="mf-card p-4 sm:p-5">
			<h2 class="mb-1 text-base font-semibold">Notifications</h2>
			<p class="mb-3 text-xs" style="color:var(--text-subtle)">
				MeetFlow has no server, so these are in-app preferences rather than real emails.
			</p>
			<div class="space-y-2">
				{#each [{ key: 'emailReminders', label: 'Remind me before a meeting starts' }, { key: 'dailyDigest', label: 'Show a daily digest on the dashboard' }, { key: 'actionItemNudges', label: 'Nudge me about overdue action items' }] as option}
					<label class="flex cursor-pointer items-center justify-between gap-4 py-1">
						<span class="text-sm">{option.label}</span>
						<input
							type="checkbox"
							class="h-5 w-5 shrink-0"
							checked={app.settings.notifications[
								option.key as keyof typeof app.settings.notifications
							] as boolean}
							onchange={(e) =>
								app.updateSettings({
									notifications: { ...app.settings.notifications, [option.key]: e.currentTarget.checked }
								})}
						/>
					</label>
				{/each}

				<div class="pt-1">
					<label class="mf-label" for="mf-reminder-minutes">Reminder lead time</label>
					<select
						id="mf-reminder-minutes"
						class="mf-field w-auto"
						value={app.settings.notifications.reminderMinutes}
						onchange={(e) =>
							app.updateSettings({
								notifications: {
									...app.settings.notifications,
									reminderMinutes: Number(e.currentTarget.value)
								}
							})}
					>
						{#each [5, 10, 15, 30, 60] as minutes}
							<option value={minutes}>{minutes} minutes before</option>
						{/each}
					</select>
				</div>
			</div>
		</section>

		<!-- ---------------- appearance ---------------- -->
		<section class="mf-card p-4 sm:p-5">
			<h2 class="mb-4 text-base font-semibold">Appearance</h2>
			<span class="mf-label">Theme</span>
			<div class="flex gap-1.5" role="group" aria-label="Theme">
				{#each [{ value: 'light', label: 'Light', icon: 'sun' }, { value: 'dark', label: 'Dark', icon: 'moon' }, { value: 'system', label: 'System', icon: 'settings' }] as option}
					<button
						type="button"
						class="mf-chip transition-colors"
						style={app.settings.theme === option.value
							? 'background:var(--accent);color:var(--accent-contrast);border-color:var(--accent)'
							: ''}
						onclick={() => app.updateSettings({ theme: option.value as 'light' | 'dark' | 'system' })}
						aria-pressed={app.settings.theme === option.value}
					>
						<Icon name={option.icon} size={14} />
						{option.label}
					</button>
				{/each}
			</div>
		</section>

		<!-- ---------------- keyboard shortcuts ---------------- -->
		<section class="mf-card p-4 sm:p-5">
			<h2 class="mb-1 text-base font-semibold">Keyboard shortcuts</h2>
			<p class="mb-3 text-xs" style="color:var(--text-subtle)">
				Press <kbd class="rounded px-1" style="background:var(--surface-hover)">?</kbd> anywhere to
				bring this up.
			</p>
			<div class="grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
				{#each SHORTCUTS as shortcut}
					<div class="flex items-center justify-between gap-3 text-sm">
						<span style="color:var(--text-muted)">{shortcut.description}</span>
						<kbd
							class="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs"
							style="background:var(--surface-hover);border:1px solid var(--border)"
						>
							{shortcut.keys}
						</kbd>
					</div>
				{/each}
			</div>
		</section>

		<!-- ---------------- data ---------------- -->
		<section class="mf-card p-4 sm:p-5">
			<h2 class="mb-1 text-base font-semibold">Your data</h2>
			<p class="mb-3 text-xs" style="color:var(--text-subtle)">
				Stored in this browser only (schema v{SCHEMA_VERSION}{storageSize !== null
					? `, about ${storageSize} KB`
					: ''}).
				{#if !storageAvailable()}
					<span style="color:var(--warn)">Browser storage is currently blocked.</span>
				{/if}
			</p>

			<div class="flex flex-wrap gap-2">
				<button type="button" class="mf-btn mf-btn-secondary mf-btn-sm" onclick={downloadBackup}>
					<Icon name="download" size={15} />
					Download backup
				</button>
				<button
					type="button"
					class="mf-btn mf-btn-secondary mf-btn-sm"
					onclick={() => fileInput?.click()}
				>
					<Icon name="copy" size={15} />
					Restore from backup
				</button>
				<input
					bind:this={fileInput}
					type="file"
					accept="application/json,.json"
					class="hidden"
					onchange={restoreBackup}
				/>
			</div>

			<div class="mt-4 border-t pt-4" style="border-color:var(--border)">
				{#if confirmReset === 'none'}
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							class="mf-btn mf-btn-ghost mf-btn-sm"
							onclick={() => (confirmReset = 'sample')}
						>
							Restore sample workspace
						</button>
						<button
							type="button"
							class="mf-btn mf-btn-ghost mf-btn-sm"
							style="color:var(--danger)"
							onclick={() => (confirmReset = 'fresh')}
						>
							<Icon name="trash" size={15} />
							Start fresh
						</button>
					</div>
				{:else}
					<div
						class="rounded-lg p-3"
						style="background:var(--danger-soft);border:1px solid var(--danger)"
						role="alert"
					>
						<p class="text-sm font-medium" style="color:var(--danger)">
							{confirmReset === 'fresh'
								? 'Delete everything and start with an empty workspace?'
								: 'Replace everything with the sample workspace?'}
						</p>
						<p class="mt-0.5 text-xs" style="color:var(--text-muted)">
							This cannot be undone. Download a backup first if you want to keep your meetings.
						</p>
						<div class="mt-2.5 flex gap-2">
							<button
								type="button"
								class="mf-btn mf-btn-danger mf-btn-sm"
								onclick={() => {
									if (confirmReset === 'fresh') app.startFresh();
									else app.resetToSample();
									confirmReset = 'none';
								}}
							>
								Yes, {confirmReset === 'fresh' ? 'delete everything' : 'restore the sample'}
							</button>
							<button
								type="button"
								class="mf-btn mf-btn-ghost mf-btn-sm"
								onclick={() => (confirmReset = 'none')}
							>
								Cancel
							</button>
						</div>
					</div>
				{/if}
			</div>
		</section>

		<section class="mf-card p-4 sm:p-5">
			<h2 class="mb-2 text-base font-semibold">About MeetFlow</h2>
			<p class="text-sm" style="color:var(--text-muted)">
				A meeting workspace that runs entirely in your browser: no account, no server, no data
				leaving your device. The meeting room uses your real camera and microphone through the
				browser's media APIs; other participants and their chat are simulated so the room looks
				realistic in a demo.
			</p>
		</section>
	</div>
</div>
