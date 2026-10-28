<script lang="ts">
	/**
	 * One meeting occurrence, as shown in the dashboard timeline, upcoming list and history.
	 *
	 * Takes an Occurrence (not a Meeting) because a recurring series has many dated
	 * instances and the card must show THIS one's time.
	 */
	import type { Occurrence } from '#lib/types';
	import { app } from '#lib/stores/app.svelte';
	import { ROUTES } from '#lib/nav';
	import { formatDuration, formatTime, relativeLabel } from '#lib/logic/time';
	import { isLive, isPast } from '#lib/logic/schedule';
	import Avatar from './Avatar.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		occurrence: Occurrence;
		showDate?: boolean;
		compact?: boolean;
	}
	let { occurrence, showDate = false, compact = false }: Props = $props();

	const meeting = $derived(occurrence.meeting);
	const live = $derived(isLive(occurrence, app.now));
	const past = $derived(isPast(occurrence, app.now));
	const participants = $derived(
		meeting.participants.map((p) => ({ ...p, contact: app.contact(p.contactId) }))
	);
	const detailHref = $derived(`${ROUTES.meeting}?id=${meeting.id}&at=${occurrence.startsAt}`);
</script>

<article
	class="mf-card mf-card-hover relative overflow-hidden"
	style="border-left:3px solid var(--event-{meeting.colour % 6})"
>
	<div class="flex items-start gap-3 p-4 {compact ? 'sm:p-4' : 'sm:p-5'}">
		<!-- time column -->
		<div class="w-16 shrink-0 text-left sm:w-20">
			<p class="text-base font-semibold tabular-nums">
				{formatTime(occurrence.startsAt, app.timezone)}
			</p>
			<p class="text-xs" style="color:var(--text-subtle)">
				{formatDuration(meeting.actualMinutes ?? meeting.durationMinutes)}
			</p>
		</div>

		<div class="min-w-0 flex-1">
			<div class="flex flex-wrap items-center gap-2">
				<a href={detailHref} class="min-w-0 text-[0.975rem] font-semibold hover:underline">
					<span class="mf-clamp-2">{meeting.title}</span>
				</a>
				{#if live}
					<span class="mf-badge mf-badge-danger">
						<span class="h-1.5 w-1.5 rounded-full" style="background:currentColor"></span>
						Live
					</span>
				{:else if meeting.status === 'completed'}
					<span class="mf-badge mf-badge-ok">Completed</span>
				{:else if meeting.status === 'cancelled'}
					<span class="mf-badge mf-badge-neutral">Cancelled</span>
				{/if}
				{#if meeting.recurrence.freq !== 'none'}
					<span class="mf-badge mf-badge-neutral" title="Repeating meeting">
						<Icon name="clock" size={11} />
						Repeats
					</span>
				{/if}
			</div>

			{#if showDate}
				<p class="mt-1 text-xs" style="color:var(--text-subtle)">
					{relativeLabel(occurrence.startsAt, app.now)}
				</p>
			{/if}

			{#if meeting.agenda.length && !compact}
				<p class="mt-1.5 text-xs" style="color:var(--text-subtle)">
					{meeting.agenda.length} agenda {meeting.agenda.length === 1 ? 'topic' : 'topics'}
					{#if past && meeting.agenda.some((t) => t.covered)}
						· {meeting.agenda.filter((t) => t.covered).length} covered
					{/if}
				</p>
			{/if}

			<div class="mt-2.5 flex items-center gap-2">
				<div class="flex -space-x-1.5">
					{#each participants.slice(0, 4) as p}
						{#if p.contact}
							<Avatar name={p.contact.name} hue={p.contact.hue} size={24} stacked />
						{/if}
					{/each}
				</div>
				{#if participants.length > 4}
					<span class="text-xs" style="color:var(--text-subtle)">
						+{participants.length - 4}
					</span>
				{/if}
			</div>
		</div>

		<!-- action column -->
		<div class="flex shrink-0 flex-col items-end gap-1.5">
			{#if !past && meeting.status !== 'cancelled'}
				<a
					href="{ROUTES.room}?code={meeting.code}"
					class="mf-btn {live ? 'mf-btn-primary' : 'mf-btn-secondary'} mf-btn-sm"
					aria-label="{live ? 'Join now' : 'Join'}: {meeting.title}"
				>
					<Icon name="video" size={15} />
					<span class="hidden sm:inline">{live ? 'Join now' : 'Join'}</span>
				</a>
			{:else}
				<a
					href={detailHref}
					class="mf-btn mf-btn-secondary mf-btn-sm"
					aria-label="Summary: {meeting.title}"
				>
					<span class="hidden sm:inline">Summary</span>
					<Icon name="chevron-right" size={15} class="sm:hidden" />
				</a>
			{/if}
			<code class="text-[0.6875rem] tabular-nums" style="color:var(--text-subtle)">
				{meeting.code}
			</code>
		</div>
	</div>
</article>
