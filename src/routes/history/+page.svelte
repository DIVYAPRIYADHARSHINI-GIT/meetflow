<script lang="ts">
	/**
	 * Meeting history: past meetings with search and filters.
	 *
	 * Reads past occurrences from the store, so a meeting ended in the room appears here
	 * immediately with its real duration and attendance.
	 */
	import { app } from '#lib/stores/app.svelte';
	import { ROUTES } from '#lib/nav';
	import { formatCivilDate, formatDuration, civilDateOf, diffDays } from '#lib/logic/time';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import MeetingCard from '#lib/components/MeetingCard.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';

	let personFilter = $state('');
	let rangeFilter = $state<'all' | 'week' | 'month'>('all');

	const past = $derived(app.pastOccurrences(200));

	const filtered = $derived.by(() => {
		const needle = app.filters.historySearch.trim().toLowerCase();
		return past.filter((o) => {
			if (needle) {
				const haystack = [
					o.meeting.title,
					o.meeting.description,
					...o.meeting.agenda.map((t) => t.title),
					o.meeting.code
				]
					.join(' ')
					.toLowerCase();
				if (!haystack.includes(needle)) return false;
			}
			if (personFilter && !o.meeting.participants.some((p) => p.contactId === personFilter)) {
				return false;
			}
			if (rangeFilter !== 'all') {
				const days = Math.abs(diffDays(civilDateOf(o.startsAt, app.timezone), app.today));
				if (rangeFilter === 'week' && days > 7) return false;
				if (rangeFilter === 'month' && days > 31) return false;
			}
			return true;
		});
	});

	/** Group by civil date so the list reads as a journal. */
	const grouped = $derived.by(() => {
		const map = new Map<string, typeof filtered>();
		for (const occurrence of filtered) {
			const day = civilDateOf(occurrence.startsAt, app.timezone);
			if (!map.has(day)) map.set(day, []);
			map.get(day)!.push(occurrence);
		}
		return [...map.entries()];
	});

	const totals = $derived.by(() => {
		const minutes = filtered.reduce(
			(sum, o) => sum + (o.meeting.actualMinutes ?? o.meeting.durationMinutes),
			0
		);
		return {
			count: filtered.length,
			hours: Math.round((minutes / 60) * 10) / 10
		};
	});

	const hasFilters = $derived(
		!!(app.filters.historySearch || personFilter || rangeFilter !== 'all')
	);
</script>

<svelte:head>
	<title>Meeting history · MeetFlow</title>
</svelte:head>

<div class="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
	<PageHeader
		title="Meeting history"
		subtitle="{totals.count} {totals.count === 1 ? 'meeting' : 'meetings'} · {totals.hours} hours"
	/>

	<div class="mf-card mb-5 p-3 sm:p-4">
		<div class="flex flex-wrap items-end gap-3">
			<div class="min-w-[12rem] flex-1">
				<label class="mf-label" for="mf-history-search">Search</label>
				<input
					id="mf-history-search"
					class="mf-field"
					style="min-height:2.5rem"
					placeholder="Search titles, agendas and codes"
					bind:value={app.filters.historySearch}
				/>
			</div>
			<div>
				<label class="mf-label" for="mf-history-person">Person</label>
				<select
					id="mf-history-person"
					class="mf-field w-auto"
					style="min-height:2.5rem"
					bind:value={personFilter}
				>
					<option value="">Anyone</option>
					{#each app.contacts as contact (contact.id)}
						<option value={contact.id}>{contact.name}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="mf-label" for="mf-history-range">When</label>
				<select
					id="mf-history-range"
					class="mf-field w-auto"
					style="min-height:2.5rem"
					bind:value={rangeFilter}
				>
					<option value="all">All time</option>
					<option value="week">Last 7 days</option>
					<option value="month">Last month</option>
				</select>
			</div>
			{#if hasFilters}
				<button
					type="button"
					class="mf-btn mf-btn-ghost mf-btn-sm"
					onclick={() => {
						app.filters.historySearch = '';
						personFilter = '';
						rangeFilter = 'all';
					}}
				>
					<Icon name="close" size={15} />
					Clear
				</button>
			{/if}
		</div>
	</div>

	{#if !app.loaded}
		<div class="space-y-2.5">
			{#each Array(4) as _}
				<div class="mf-skeleton h-24 w-full"></div>
			{/each}
		</div>
	{:else if filtered.length === 0}
		<div class="mf-card">
			<EmptyState
				icon="clock"
				title={hasFilters ? 'No meetings match those filters' : 'No past meetings yet'}
				description={hasFilters
					? 'Try a different search, person or date range.'
					: 'Once you have run a meeting, its summary will appear here with the agenda covered, decisions and action items.'}
				actionLabel={hasFilters ? '' : 'Schedule a meeting'}
				actionHref={hasFilters ? '' : ROUTES.schedule}
			/>
		</div>
	{:else}
		<div class="space-y-6">
			{#each grouped as [day, occurrences] (day)}
				<section>
					<h2
						class="mb-2.5 text-xs font-semibold uppercase tracking-wide"
						style="color:var(--text-subtle)"
					>
						{formatCivilDate(day)}
					</h2>
					<div class="space-y-2.5">
						{#each occurrences as occurrence (occurrence.meetingId + occurrence.startsAt)}
							<MeetingCard {occurrence} />
						{/each}
					</div>
				</section>
			{/each}
		</div>
	{/if}
</div>
