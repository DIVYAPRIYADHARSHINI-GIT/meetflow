<script lang="ts">
	/**
	 * Contacts and teams, with availability hints.
	 *
	 * Availability is computed in each contact's OWN timezone against their real booked
	 * meetings, so "outside hours" means outside their day, not yours.
	 */
	import type { Contact } from '#lib/types';
	import { app } from '#lib/stores/app.svelte';
	import { ROUTES } from '#lib/nav';
	import { availabilityFor, isValidEmail } from '#lib/logic/schedule';
	import { COMMON_TIMEZONES, formatTime, timeOfDay, zoneLabel } from '#lib/logic/time';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';

	let tab = $state<'contacts' | 'teams'>('contacts');
	let contactDialog = $state(false);
	let teamDialog = $state(false);
	let editingContact = $state<Contact | null>(null);
	let editingTeamId = $state<string | null>(null);

	// contact form
	let cName = $state('');
	let cEmail = $state('');
	let cTitle = $state('');
	let cZone = $state('');
	let cStart = $state(9);
	let cEnd = $state(18);
	let cError = $state('');

	// team form
	let tName = $state('');
	let tDescription = $state('');
	let tMembers = $state<string[]>([]);

	/** The slot used for the availability preview: now, for the default meeting length. */
	const previewStart = $derived(app.now.toISOString());

	function openContact(contact: Contact | null) {
		editingContact = contact;
		cName = contact?.name ?? '';
		cEmail = contact?.email ?? '';
		cTitle = contact?.title ?? '';
		cZone = contact?.timezone ?? app.timezone;
		cStart = contact?.workingHours.start ?? 9;
		cEnd = contact?.workingHours.end ?? 18;
		cError = '';
		contactDialog = true;
	}

	function saveContact() {
		if (!cName.trim()) {
			cError = 'Enter a name.';
			return;
		}
		if (!isValidEmail(cEmail)) {
			cError = 'Enter a valid email address.';
			return;
		}
		if (cEnd <= cStart) {
			cError = 'The working day must end after it starts.';
			return;
		}

		if (editingContact) {
			app.updateContact(editingContact.id, {
				name: cName.trim(),
				email: cEmail.trim(),
				title: cTitle.trim() || 'Team member',
				timezone: cZone,
				workingHours: { start: cStart, end: cEnd }
			});
			app.showToast('Contact updated');
		} else {
			const contact = app.ensureContactByEmail(cEmail, cName);
			app.updateContact(contact.id, {
				name: cName.trim(),
				title: cTitle.trim() || 'Team member',
				timezone: cZone,
				workingHours: { start: cStart, end: cEnd }
			});
			app.showToast('Contact added');
		}
		contactDialog = false;
	}

	function openTeam(teamId: string | null) {
		editingTeamId = teamId;
		const team = teamId ? app.teams.find((t) => t.id === teamId) : null;
		tName = team?.name ?? '';
		tDescription = team?.description ?? '';
		tMembers = team ? [...team.memberIds] : [];
		teamDialog = true;
	}

	function saveTeam() {
		if (!tName.trim()) return;
		if (editingTeamId) {
			app.updateTeam(editingTeamId, {
				name: tName.trim(),
				description: tDescription.trim(),
				memberIds: tMembers
			});
			app.showToast('Team updated');
		} else {
			app.createTeam(tName, tDescription, tMembers);
			app.showToast('Team created');
		}
		teamDialog = false;
	}

	const AVAIL_STYLE: Record<string, string> = {
		free: 'mf-badge-ok',
		busy: 'mf-badge-danger',
		'outside-hours': 'mf-badge-warn',
		unknown: 'mf-badge-neutral'
	};
	const AVAIL_LABEL: Record<string, string> = {
		free: 'Free now',
		busy: 'In a meeting',
		'outside-hours': 'Outside hours',
		unknown: 'Unknown'
	};
</script>

<svelte:head>
	<title>Contacts and teams · MeetFlow</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
	<PageHeader
		title="Contacts and teams"
		subtitle="{app.contacts.length} people · {app.teams.length} teams"
	>
		{#if tab === 'contacts'}
			<button type="button" class="mf-btn mf-btn-primary" onclick={() => openContact(null)}>
				<Icon name="plus" size={17} />
				Add contact
			</button>
		{:else}
			<button type="button" class="mf-btn mf-btn-primary" onclick={() => openTeam(null)}>
				<Icon name="plus" size={17} />
				New team
			</button>
		{/if}
	</PageHeader>

	<div class="mb-5 flex rounded-lg p-0.5" style="background:var(--surface-hover)" role="tablist">
		{#each [['contacts', 'Contacts'], ['teams', 'Teams']] as [value, label]}
			<button
				type="button"
				role="tab"
				aria-selected={tab === value}
				class="flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors sm:flex-none sm:px-6"
				style={tab === value
					? 'background:var(--surface-raised);color:var(--text);box-shadow:var(--shadow-card)'
					: 'color:var(--text-muted)'}
				onclick={() => (tab = value as 'contacts' | 'teams')}
			>
				{label}
			</button>
		{/each}
	</div>

	{#if tab === 'contacts'}
		<div class="grid gap-3 sm:grid-cols-2">
			{#each app.contacts as contact (contact.id)}
				{@const avail = availabilityFor(
					contact,
					previewStart,
					app.settings.defaultDurationMinutes,
					app.meetings
				)}
				{@const upcomingCount = app
					.upcoming(50)
					.filter((o) => o.meeting.participants.some((p) => p.contactId === contact.id)).length}
				<article class="mf-card mf-card-hover p-4">
					<div class="flex items-start gap-3">
						<Avatar name={contact.name} hue={contact.hue} size={42} />
						<div class="min-w-0 flex-1">
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<h2 class="truncate text-[0.9375rem] font-semibold">
										{contact.name}
										{#if contact.id === app.meId}
											<span class="mf-badge mf-badge-accent ml-1">You</span>
										{/if}
									</h2>
									<p class="truncate text-xs" style="color:var(--text-subtle)">{contact.title}</p>
								</div>
								<span class="mf-badge shrink-0 {AVAIL_STYLE[avail]}">{AVAIL_LABEL[avail]}</span>
							</div>

							<p class="mt-1.5 truncate text-xs" style="color:var(--text-muted)">
								{contact.email}
							</p>
							<p class="mt-0.5 text-xs" style="color:var(--text-subtle)">
								{contact.timezone} ({zoneLabel(contact.timezone)}) · local time
								{formatTime(previewStart, contact.timezone)} · works
								{String(contact.workingHours.start).padStart(2, '0')}:00–{String(
									contact.workingHours.end
								).padStart(2, '0')}:00
							</p>
							{#if upcomingCount > 0}
								<p class="mt-0.5 text-xs" style="color:var(--text-subtle)">
									{upcomingCount} upcoming {upcomingCount === 1 ? 'meeting' : 'meetings'}
								</p>
							{/if}

							<div class="mt-2.5 flex flex-wrap gap-1.5">
								<button
									type="button"
									class="mf-btn mf-btn-ghost mf-btn-sm px-2"
									onclick={() => openContact(contact)}
									aria-label="Edit {contact.name}"
								>
									<Icon name="edit" size={14} />
								</button>
								<a
									href="{ROUTES.actions}"
									class="mf-btn mf-btn-ghost mf-btn-sm px-2 text-xs"
									onclick={() => (app.filters.assigneeId = contact.id)}
								>
									Their tasks
								</a>
								{#if contact.id !== app.meId}
									<button
										type="button"
										class="mf-btn mf-btn-ghost mf-btn-sm ml-auto px-2"
										style="color:var(--danger)"
										onclick={() => {
											app.deleteContact(contact.id);
											app.showToast(`${contact.name} removed`);
										}}
										aria-label="Remove {contact.name}"
									>
										<Icon name="trash" size={14} />
									</button>
								{/if}
							</div>
						</div>
					</div>
				</article>
			{/each}
		</div>
	{:else if app.teams.length === 0}
		<div class="mf-card">
			<EmptyState
				icon="team"
				title="No teams yet"
				description="Group people together so you can invite them to a meeting in one click."
				actionLabel="Create a team"
				onAction={() => openTeam(null)}
			/>
		</div>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2">
			{#each app.teams as team (team.id)}
				<article class="mf-card mf-card-hover p-4">
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0">
							<h2 class="truncate text-[0.9375rem] font-semibold">{team.name}</h2>
							<p class="mt-0.5 text-xs" style="color:var(--text-subtle)">{team.description}</p>
						</div>
						<span class="mf-badge mf-badge-neutral shrink-0">{team.memberIds.length}</span>
					</div>

					<ul class="mt-3 flex flex-wrap gap-1.5">
						{#each team.memberIds as memberId (memberId)}
							{@const member = app.contact(memberId)}
							{#if member}
								<li class="mf-chip py-1 pl-1">
									<Avatar name={member.name} hue={member.hue} size={18} />
									<span class="text-xs">{member.name.split(' ')[0]}</span>
								</li>
							{/if}
						{/each}
					</ul>

					<div class="mt-3 flex gap-1.5">
						<button
							type="button"
							class="mf-btn mf-btn-secondary mf-btn-sm"
							onclick={() => openTeam(team.id)}
						>
							<Icon name="edit" size={14} />
							Edit
						</button>
						<a href={ROUTES.schedule} class="mf-btn mf-btn-ghost mf-btn-sm text-xs">
							Schedule with them
						</a>
						<button
							type="button"
							class="mf-btn mf-btn-ghost mf-btn-sm ml-auto px-2"
							style="color:var(--danger)"
							onclick={() => {
								app.deleteTeam(team.id);
								app.showToast('Team deleted');
							}}
							aria-label="Delete {team.name}"
						>
							<Icon name="trash" size={14} />
						</button>
					</div>
				</article>
			{/each}
		</div>
	{/if}
</div>

<!-- ---------------- contact dialog ---------------- -->
<Modal
	open={contactDialog}
	title={editingContact ? 'Edit contact' : 'Add contact'}
	onClose={() => (contactDialog = false)}
>
	<div class="space-y-4">
		<div>
			<label class="mf-label" for="mf-c-name">Name</label>
			<input id="mf-c-name" class="mf-field" bind:value={cName} placeholder="Full name" />
		</div>
		<div>
			<label class="mf-label" for="mf-c-email">Email</label>
			<input
				id="mf-c-email"
				class="mf-field"
				type="email"
				bind:value={cEmail}
				placeholder="name@company.com"
				disabled={!!editingContact}
			/>
		</div>
		<div>
			<label class="mf-label" for="mf-c-title">Role</label>
			<input id="mf-c-title" class="mf-field" bind:value={cTitle} placeholder="e.g. Design lead" />
		</div>
		<div>
			<label class="mf-label" for="mf-c-zone">Timezone</label>
			<select id="mf-c-zone" class="mf-field" bind:value={cZone}>
				{#each [...new Set([cZone, app.timezone, ...COMMON_TIMEZONES])] as zone}
					<option value={zone}>{zone} ({zoneLabel(zone)})</option>
				{/each}
			</select>
		</div>
		<div class="grid grid-cols-2 gap-4">
			<div>
				<label class="mf-label" for="mf-c-start">Working day starts</label>
				<input
					id="mf-c-start"
					class="mf-field tabular-nums"
					type="number"
					min="0"
					max="23"
					bind:value={cStart}
				/>
			</div>
			<div>
				<label class="mf-label" for="mf-c-end">Ends</label>
				<input
					id="mf-c-end"
					class="mf-field tabular-nums"
					type="number"
					min="1"
					max="24"
					bind:value={cEnd}
				/>
			</div>
		</div>
		{#if cError}
			<p class="text-sm" style="color:var(--danger)" role="alert">{cError}</p>
		{/if}
	</div>

	{#snippet footer()}
		<button type="button" class="mf-btn mf-btn-ghost" onclick={() => (contactDialog = false)}>
			Cancel
		</button>
		<button type="button" class="mf-btn mf-btn-primary" onclick={saveContact}>
			{editingContact ? 'Save changes' : 'Add contact'}
		</button>
	{/snippet}
</Modal>

<!-- ---------------- team dialog ---------------- -->
<Modal
	open={teamDialog}
	title={editingTeamId ? 'Edit team' : 'New team'}
	onClose={() => (teamDialog = false)}
>
	<div class="space-y-4">
		<div>
			<label class="mf-label" for="mf-t-name">Team name</label>
			<input id="mf-t-name" class="mf-field" bind:value={tName} placeholder="e.g. Launch squad" />
		</div>
		<div>
			<label class="mf-label" for="mf-t-desc">Description</label>
			<input
				id="mf-t-desc"
				class="mf-field"
				bind:value={tDescription}
				placeholder="What do they meet about?"
			/>
		</div>
		<div>
			<span class="mf-label">Members</span>
			<ul class="space-y-1.5">
				{#each app.contacts as contact (contact.id)}
					<li>
						<label class="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1">
							<input
								type="checkbox"
								class="h-4 w-4"
								checked={tMembers.includes(contact.id)}
								onchange={(e) => {
									tMembers = e.currentTarget.checked
										? [...tMembers, contact.id]
										: tMembers.filter((id) => id !== contact.id);
								}}
							/>
							<Avatar name={contact.name} hue={contact.hue} size={26} />
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm">{contact.name}</span>
								<span class="block truncate text-xs" style="color:var(--text-subtle)">
									{contact.title}
								</span>
							</span>
						</label>
					</li>
				{/each}
			</ul>
		</div>
	</div>

	{#snippet footer()}
		<button type="button" class="mf-btn mf-btn-ghost" onclick={() => (teamDialog = false)}>
			Cancel
		</button>
		<button type="button" class="mf-btn mf-btn-primary" onclick={saveTeam} disabled={!tName.trim()}>
			{editingTeamId ? 'Save changes' : 'Create team'}
		</button>
	{/snippet}
</Modal>
