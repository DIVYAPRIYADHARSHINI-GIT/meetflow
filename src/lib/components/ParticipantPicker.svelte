<script lang="ts">
	/**
	 * Participant chips with email entry, role toggle, team quick-add and availability hints.
	 *
	 * Typing an email and pressing Enter (or comma) creates a chip; an unknown email becomes
	 * a new contact so the invite is real rather than a string.
	 */
	import type { Participant } from '#lib/types';
	import { app } from '#lib/stores/app.svelte';
	import { availabilityFor, isValidEmail, type Availability } from '#lib/logic/schedule';
	import Avatar from './Avatar.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		participants: Participant[];
		onChange: (participants: Participant[]) => void;
		/** When set, availability hints are computed for this slot. */
		startsAt?: string;
		durationMinutes?: number;
	}
	let { participants, onChange, startsAt, durationMinutes = 30 }: Props = $props();

	let entry = $state('');
	let error = $state('');
	let showSuggestions = $state(false);

	const chosenIds = $derived(new Set(participants.map((p) => p.contactId)));

	const suggestions = $derived(
		app.contacts
			.filter((c) => !chosenIds.has(c.id))
			.filter((c) => {
				const needle = entry.trim().toLowerCase();
				if (!needle) return true;
				return (
					c.name.toLowerCase().includes(needle) || c.email.toLowerCase().includes(needle)
				);
			})
			.slice(0, 6)
	);

	const AVAILABILITY_LABEL: Record<Availability, string> = {
		free: 'Free',
		busy: 'Busy',
		'outside-hours': 'Outside hours',
		unknown: ''
	};

	function availability(contactId: string): Availability {
		const contact = app.contact(contactId);
		if (!contact || !startsAt) return 'unknown';
		// Exclude the meeting being edited from the busy check by passing all meetings: the
		// store's conflictsFor handles self-exclusion, and a brand-new meeting is not yet saved.
		return availabilityFor(contact, startsAt, durationMinutes, app.meetings);
	}

	function add(contactId: string) {
		if (chosenIds.has(contactId)) return;
		onChange([...participants, { contactId, role: 'participant' }]);
		entry = '';
		error = '';
		showSuggestions = false;
	}

	function addByEmail() {
		const value = entry.trim().replace(/,$/, '');
		if (!value) return;
		if (!isValidEmail(value)) {
			error = `"${value}" is not a valid email address.`;
			return;
		}
		const contact = app.ensureContactByEmail(value);
		add(contact.id);
	}

	function remove(contactId: string) {
		onChange(participants.filter((p) => p.contactId !== contactId));
	}

	function setRole(contactId: string, role: 'host' | 'participant') {
		onChange(participants.map((p) => (p.contactId === contactId ? { ...p, role } : p)));
	}

	function addTeam(teamId: string) {
		const team = app.teams.find((t) => t.id === teamId);
		if (!team) return;
		const additions = team.memberIds
			.filter((id) => !chosenIds.has(id))
			.map((id) => ({ contactId: id, role: 'participant' as const }));
		onChange([...participants, ...additions]);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			if (suggestions.length === 1 && entry.trim()) add(suggestions[0].id);
			else addByEmail();
		} else if (event.key === 'Backspace' && !entry && participants.length) {
			// Backspace on an empty field removes the last chip, as in every email client.
			remove(participants[participants.length - 1].contactId);
		} else if (event.key === 'Escape') {
			showSuggestions = false;
		}
	}
</script>

<div>
	<!-- chips -->
	{#if participants.length > 0}
		<ul class="mb-2 flex flex-wrap gap-1.5">
			{#each participants as p (p.contactId)}
				{@const contact = app.contact(p.contactId)}
				{#if contact}
					{@const avail = availability(p.contactId)}
					<li
						class="mf-chip gap-2 py-1 pr-1 pl-1.5"
						style={avail === 'busy'
							? 'border-color:var(--danger);background:var(--danger-soft)'
							: avail === 'outside-hours'
								? 'border-color:var(--warn);background:var(--warn-soft)'
								: ''}
					>
						<Avatar name={contact.name} hue={contact.hue} size={20} />
						<span class="max-w-[12rem] truncate" style="color:var(--text)">{contact.name}</span>

						{#if avail !== 'unknown'}
							<span
								class="text-[0.625rem] font-semibold uppercase"
								style="color:{avail === 'busy'
									? 'var(--danger)'
									: avail === 'outside-hours'
										? 'var(--warn)'
										: 'var(--ok)'}"
								title="{contact.name} is {AVAILABILITY_LABEL[avail].toLowerCase()} at this time ({contact.timezone})"
							>
								{AVAILABILITY_LABEL[avail]}
							</span>
						{/if}

						<button
							type="button"
							class="rounded px-1 text-[0.6875rem] font-semibold transition-colors"
							style={p.role === 'host'
								? 'background:var(--accent);color:var(--accent-contrast)'
								: 'color:var(--text-subtle)'}
							onclick={() => setRole(p.contactId, p.role === 'host' ? 'participant' : 'host')}
							aria-label="{p.role === 'host'
								? 'Remove host role from'
								: 'Make host:'} {contact.name}"
							title="Click to toggle host"
						>
							{p.role === 'host' ? 'Host' : 'Guest'}
						</button>

						<button
							type="button"
							class="flex h-5 w-5 items-center justify-center rounded"
							style="color:var(--text-subtle)"
							onclick={() => remove(p.contactId)}
							aria-label="Remove {contact.name}"
						>
							<Icon name="close" size={12} />
						</button>
					</li>
				{/if}
			{/each}
		</ul>
	{/if}

	<!-- entry -->
	<div class="relative">
		<input
			class="mf-field"
			placeholder="Type a name or email, then press Enter"
			bind:value={entry}
			onkeydown={onKeydown}
			onfocus={() => (showSuggestions = true)}
			onblur={() => setTimeout(() => (showSuggestions = false), 160)}
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={error ? 'mf-participants-error' : undefined}
			autocomplete="off"
			aria-label="Add a participant"
		/>

		{#if showSuggestions && suggestions.length > 0}
			<ul
				class="mf-card absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto mf-scroll py-1"
				style="box-shadow:var(--shadow-overlay)"
			>
				{#each suggestions as contact (contact.id)}
					{@const avail = availability(contact.id)}
					<li>
						<button
							type="button"
							class="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--surface-hover)]"
							onclick={() => add(contact.id)}
						>
							<Avatar name={contact.name} hue={contact.hue} size={28} />
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm font-medium">{contact.name}</span>
								<span class="block truncate text-xs" style="color:var(--text-subtle)">
									{contact.title} · {contact.email}
								</span>
							</span>
							{#if avail !== 'unknown'}
								<span
									class="shrink-0 text-[0.625rem] font-semibold uppercase"
									style="color:{avail === 'busy'
										? 'var(--danger)'
										: avail === 'outside-hours'
											? 'var(--warn)'
											: 'var(--ok)'}"
								>
									{AVAILABILITY_LABEL[avail]}
								</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if error}
		<p id="mf-participants-error" class="mt-1.5 text-sm" style="color:var(--danger)" role="alert">
			{error}
		</p>
	{/if}

	<!-- teams -->
	{#if app.teams.length > 0}
		<div class="mt-2.5 flex flex-wrap items-center gap-1.5">
			<span class="text-xs" style="color:var(--text-subtle)">Invite a team:</span>
			{#each app.teams as team (team.id)}
				<button
					type="button"
					class="mf-chip transition-colors hover:border-[var(--accent)]"
					onclick={() => addTeam(team.id)}
					title={team.description}
				>
					<Icon name="team" size={13} />
					{team.name}
					<span style="color:var(--text-subtle)">{team.memberIds.length}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
