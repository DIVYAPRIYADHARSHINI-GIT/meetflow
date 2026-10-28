<script lang="ts">
	/**
	 * Calendar: month, week and day views with colour-coded meetings.
	 *
	 * Rescheduling has two paths, both going through `app.rescheduleOccurrence`:
	 *  - drag a meeting onto another day
	 *  - select it and press Alt+Arrow (or use the buttons in the detail popover)
	 * For a recurring series only the dragged OCCURRENCE moves, recorded as an exception, so
	 * dragging one standup never moves the whole series.
	 */
	import type { Occurrence } from '#lib/types';
	import { app } from '#lib/stores/app.svelte';
	import { ROUTES } from '#lib/nav';
	import {
		addDays,
		addMonths,
		civilDateOf,
		formatCivilDate,
		formatDuration,
		formatTime,
		instantFromZoned,
		minutesOfDay,
		monthGrid,
		startOfMonth,
		startOfWeek,
		timeOfDay
	} from '#lib/logic/time';
	import { isLive } from '#lib/logic/schedule';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';

	type View = 'month' | 'week' | 'day';
	let view = $state<View>('month');
	let dragging = $state<Occurrence | null>(null);
	let dragOverDay = $state<string | null>(null);
	let selected = $state<Occurrence | null>(null);
	let liveMessage = $state('');

	const focus = $derived(app.filters.focusDate || app.today);

	function setFocus(date: string) {
		app.filters.focusDate = date;
	}

	// ---- range for the current view ----
	const days = $derived.by(() => {
		if (view === 'day') return [focus];
		if (view === 'week') {
			const start = startOfWeek(focus);
			return Array.from({ length: 7 }, (_, i) => addDays(start, i));
		}
		return monthGrid(focus);
	});

	/** Occurrences per visible day. One expansion feeds every view. */
	const byDay = $derived.by(() => {
		const map = new Map<string, Occurrence[]>();
		for (const day of days) map.set(day, app.occurrencesOn(day));
		return map;
	});

	/** The month grid chunked into ARIA rows. */
	const monthWeeks = $derived(
		Array.from({ length: Math.ceil(days.length / 7) }, (_, i) => days.slice(i * 7, i * 7 + 7))
	);

	const title = $derived.by(() => {
		if (view === 'day') return formatCivilDate(focus);
		if (view === 'week') {
			const start = startOfWeek(focus);
			const end = addDays(start, 6);
			return `${formatCivilDate(start)} – ${formatCivilDate(end)}`;
		}
		return new Intl.DateTimeFormat('en-GB', {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(new Date(`${startOfMonth(focus)}T00:00:00.000Z`));
	});

	function step(direction: -1 | 1) {
		if (view === 'day') setFocus(addDays(focus, direction));
		else if (view === 'week') setFocus(addDays(focus, 7 * direction));
		else setFocus(addMonths(focus, direction));
	}

	function inMonth(day: string): boolean {
		return day.slice(0, 7) === focus.slice(0, 7);
	}

	// ---- drag to reschedule ----
	function onDragStart(event: DragEvent, occurrence: Occurrence) {
		dragging = occurrence;
		event.dataTransfer?.setData('text/plain', occurrence.meetingId);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function onDragOver(event: DragEvent, day: string) {
		if (!dragging) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dragOverDay = day;
	}

	function onDrop(event: DragEvent, day: string) {
		event.preventDefault();
		const occurrence = dragging;
		dragging = null;
		dragOverDay = null;
		if (!occurrence) return;

		const from = civilDateOf(occurrence.startsAt, app.timezone);
		if (from === day) return;
		reschedule(occurrence, day);
	}

	/** Shared by drag-drop and the keyboard path. */
	function reschedule(occurrence: Occurrence, day: string) {
		app.rescheduleOccurrence(occurrence.meetingId, occurrence.originalStart, day);
		liveMessage = `${occurrence.meeting.title} moved to ${formatCivilDate(day)}.`;
		app.showToast(`${occurrence.meeting.title} moved to ${formatCivilDate(day)}`);
		selected = null;
	}

	function onOccurrenceKeydown(event: KeyboardEvent, occurrence: Occurrence) {
		// Alt+Arrow moves a meeting by a day without needing a pointer.
		if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
			event.preventDefault();
			const current = civilDateOf(occurrence.startsAt, app.timezone);
			reschedule(occurrence, addDays(current, event.key === 'ArrowLeft' ? -1 : 1));
		} else if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			selected = occurrence;
		}
	}

	/** Day-view grid: 7am to 9pm, which covers every sample meeting without endless scroll. */
	const DAY_START_HOUR = 7;
	const DAY_END_HOUR = 21;
	const HOUR_PX = 56;

	function topFor(occurrence: Occurrence): number {
		const minutes = minutesOfDay(occurrence.startsAt, app.timezone);
		return ((minutes - DAY_START_HOUR * 60) / 60) * HOUR_PX;
	}

	function heightFor(occurrence: Occurrence): number {
		return Math.max(26, (occurrence.meeting.durationMinutes / 60) * HOUR_PX);
	}
</script>

<svelte:head>
	<title>Calendar · MeetFlow</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
	<PageHeader title="Calendar" subtitle={title}>
		<div class="flex rounded-lg p-0.5" style="background:var(--surface-hover)" role="group" aria-label="Calendar view">
			{#each ['month', 'week', 'day'] as option}
				<button
					type="button"
					class="rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors"
					style={view === option
						? 'background:var(--surface-raised);color:var(--text);box-shadow:var(--shadow-card)'
						: 'color:var(--text-muted)'}
					onclick={() => (view = option as View)}
					aria-pressed={view === option}
				>
					{option}
				</button>
			{/each}
		</div>
		<div class="flex items-center gap-0.5">
			<button type="button" class="mf-btn mf-btn-secondary px-2" onclick={() => step(-1)} aria-label="Previous {view}">
				<Icon name="chevron-left" size={17} />
			</button>
			<button type="button" class="mf-btn mf-btn-secondary" onclick={() => setFocus(app.today)}>
				Today
			</button>
			<button type="button" class="mf-btn mf-btn-secondary px-2" onclick={() => step(1)} aria-label="Next {view}">
				<Icon name="chevron-right" size={17} />
			</button>
		</div>
		<a href={ROUTES.schedule} class="mf-btn mf-btn-primary" aria-label="Schedule a meeting">
			<Icon name="plus" size={17} />
			<span class="hidden sm:inline">Schedule</span>
		</a>
	</PageHeader>

	<p class="mb-3 text-xs" style="color:var(--text-subtle)">
		Drag a meeting to another day to reschedule it, or select one and press Alt + arrow left /
		right.
	</p>

	{#if view === 'month'}
		<!-- ---------------- month grid ---------------- -->
		<div class="mf-card overflow-hidden">
			<!-- One role=grid wrapper around BOTH the header row and the week rows. -->
			<div role="group" aria-label="Month view">
			<div class="grid grid-cols-7 border-b" style="border-color:var(--border)">
				{#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as label}
					<div
						class="px-2 py-2 text-center text-xs font-semibold"
						style="color:var(--text-subtle)"
					>
						<span class="hidden sm:inline">{label}</span>
						<span class="sm:hidden">{label.slice(0, 1)}</span>
					</div>
				{/each}
			</div>

				{#each monthWeeks as week}
				<div class="grid grid-cols-7">
				{#each week as day (day)}
					{@const occurrences = byDay.get(day) ?? []}
					{@const isToday = day === app.today}
					<div
						class="min-h-[6rem] border-r border-b p-1.5 transition-colors sm:min-h-[7.5rem] {dragOverDay ===
						day
							? 'mf-drop-target'
							: ''}"
						style="border-color:var(--border);{inMonth(day)
							? ''
							: 'background:var(--surface-sunken)'}"
						ondragover={(e) => onDragOver(e, day)}
						ondrop={(e) => onDrop(e, day)}
						role="group"
						aria-label="{formatCivilDate(day)}, {occurrences.length} meetings"
					>
						<button
							type="button"
							class="mb-1 flex h-6 w-6 items-center justify-center rounded-md text-xs font-semibold transition-colors"
							style={isToday
								? 'background:var(--accent);color:var(--accent-contrast)'
								: 'color:var(--text-muted)'}
							onclick={() => {
								setFocus(day);
								view = 'day';
							}}
							aria-label="{Number(day.slice(8, 10))} - open {formatCivilDate(day)}"
						>
							{Number(day.slice(8, 10))}
						</button>

						<div class="space-y-1">
							{#each occurrences.slice(0, 3) as occurrence (occurrence.meetingId + occurrence.startsAt)}
								<button
									type="button"
									draggable="true"
									ondragstart={(e) => onDragStart(e, occurrence)}
									ondragend={() => {
										dragging = null;
										dragOverDay = null;
									}}
									onclick={() => (selected = occurrence)}
									onkeydown={(e) => onOccurrenceKeydown(e, occurrence)}
									class="block w-full cursor-grab truncate rounded px-1.5 py-1 text-left text-[0.6875rem] leading-tight transition-opacity {dragging ===
									occurrence
										? 'mf-dragging'
										: ''}"
									style="background:color-mix(in srgb, var(--event-{occurrence.meeting.colour %
										6}) 15%, transparent);color:var(--mf-event-ink-{occurrence.meeting.colour % 6})"
									title="{occurrence.meeting.title} · {formatTime(occurrence.startsAt, app.timezone)}"
								>
									<span class="font-semibold tabular-nums">
										{formatTime(occurrence.startsAt, app.timezone)}
									</span>
									<span class="ml-1">{occurrence.meeting.title}</span>
								</button>
							{/each}
							{#if occurrences.length > 3}
								<button
									type="button"
									class="w-full px-1.5 text-left text-[0.625rem] font-medium"
									style="color:var(--text-subtle)"
									onclick={() => {
										setFocus(day);
										view = 'day';
									}}
								>
									+{occurrences.length - 3} more
								</button>
							{/if}
						</div>
					</div>
				{/each}
				</div>
				{/each}
			</div>
		</div>
	{:else if view === 'week'}
		<!-- ---------------- week columns ---------------- -->
		<div class="mf-card overflow-x-auto mf-scroll">
			<div class="grid min-w-[44rem] grid-cols-7">
				{#each days as day (day)}
					{@const occurrences = byDay.get(day) ?? []}
					{@const isToday = day === app.today}
					<div
						class="min-h-[22rem] border-r p-2 transition-colors {dragOverDay === day
							? 'mf-drop-target'
							: ''}"
						style="border-color:var(--border)"
						ondragover={(e) => onDragOver(e, day)}
						ondrop={(e) => onDrop(e, day)}
						role="group"
						aria-label="{formatCivilDate(day)}, {occurrences.length} meetings"
					>
						<div class="mb-2 text-center">
							<p class="text-[0.6875rem] font-semibold" style="color:var(--text-subtle)">
								{new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(
									new Date(`${day}T00:00:00.000Z`)
								)}
							</p>
							<button
								type="button"
								class="mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg text-sm font-semibold"
								style={isToday
									? 'background:var(--accent);color:var(--accent-contrast)'
									: 'color:var(--text)'}
								onclick={() => {
									setFocus(day);
									view = 'day';
								}}
								aria-label="{Number(day.slice(8, 10))} - open {formatCivilDate(day)}"
							>
								{Number(day.slice(8, 10))}
							</button>
						</div>

						<div class="space-y-1.5">
							{#each occurrences as occurrence (occurrence.meetingId + occurrence.startsAt)}
								<button
									type="button"
									draggable="true"
									ondragstart={(e) => onDragStart(e, occurrence)}
									ondragend={() => {
										dragging = null;
										dragOverDay = null;
									}}
									onclick={() => (selected = occurrence)}
									onkeydown={(e) => onOccurrenceKeydown(e, occurrence)}
									class="block w-full cursor-grab rounded-lg p-2 text-left transition-opacity {dragging ===
									occurrence
										? 'mf-dragging'
										: ''}"
									style="background:color-mix(in srgb, var(--event-{occurrence.meeting.colour %
										6}) 13%, transparent);border-left:2px solid var(--event-{occurrence.meeting
										.colour % 6})"
								>
									<span
										class="block text-[0.6875rem] font-semibold tabular-nums"
										style="color:var(--mf-event-ink-{occurrence.meeting.colour % 6})"
									>
										{formatTime(occurrence.startsAt, app.timezone)}
									</span>
									<span class="mf-clamp-2 block text-xs font-medium">
										{occurrence.meeting.title}
									</span>
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<!-- ---------------- day timeline ---------------- -->
		{@const occurrences = byDay.get(focus) ?? []}
		<div class="mf-card overflow-hidden">
			{#if occurrences.length === 0}
				<EmptyState
					icon="calendar"
					title="Nothing on {formatCivilDate(focus)}"
					description="Pick another day, or schedule something for this one."
					actionLabel="Schedule a meeting"
					actionHref={ROUTES.schedule}
				/>
			{:else}
				<div class="relative overflow-y-auto mf-scroll" style="max-height:70vh">
					<div class="relative" style="height:{(DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX}px">
						<!-- hour gridlines -->
						{#each Array(DAY_END_HOUR - DAY_START_HOUR + 1) as _, i}
							<div
								class="absolute inset-x-0 flex items-start gap-2 border-t"
								style="top:{i * HOUR_PX}px;border-color:var(--border)"
							>
								<span
									class="w-14 shrink-0 -translate-y-2 pl-2 text-[0.6875rem] tabular-nums"
									style="color:var(--text-subtle)"
								>
									{String(DAY_START_HOUR + i).padStart(2, '0')}:00
								</span>
							</div>
						{/each}

						<!-- events -->
						{#each occurrences as occurrence (occurrence.meetingId + occurrence.startsAt)}
							{@const live = isLive(occurrence, app.now)}
							<button
								type="button"
								class="absolute left-16 right-3 overflow-hidden rounded-lg p-2 text-left transition-shadow hover:shadow-lg"
								style="top:{topFor(occurrence)}px;height:{heightFor(
									occurrence
								)}px;background:color-mix(in srgb, var(--event-{occurrence.meeting.colour %
									6}) 15%, var(--surface-raised));border-left:3px solid var(--event-{occurrence
									.meeting.colour % 6})"
								onclick={() => (selected = occurrence)}
								onkeydown={(e) => onOccurrenceKeydown(e, occurrence)}
							>
								<span class="flex items-center gap-1.5">
									<span
										class="text-[0.6875rem] font-semibold tabular-nums"
										style="color:var(--mf-event-ink-{occurrence.meeting.colour % 6})"
									>
										{formatTime(occurrence.startsAt, app.timezone)}
									</span>
									{#if live}
										<span class="mf-badge mf-badge-danger">Live</span>
									{/if}
								</span>
								<span class="mf-clamp-2 block text-sm font-semibold">
									{occurrence.meeting.title}
								</span>
								{#if heightFor(occurrence) > 56}
									<span class="mt-1 flex -space-x-1.5">
										{#each occurrence.meeting.participants.slice(0, 5) as p}
											{@const contact = app.contact(p.contactId)}
											{#if contact}
												<Avatar name={contact.name} hue={contact.hue} size={20} stacked />
											{/if}
										{/each}
									</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}

	<p class="mf-sr-only" role="status" aria-live="polite">{liveMessage}</p>
</div>

<!-- ---------------- detail popover ---------------- -->
{#if selected}
	<div class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
		<button
			type="button"
			class="absolute inset-0 cursor-default"
			style="background:rgb(15 23 42 / 0.45)"
			onclick={() => (selected = null)}
			aria-label="Close meeting details"
		></button>
		<div
			class="mf-card relative w-full max-w-md p-5"
			style="box-shadow:var(--shadow-overlay)"
			role="dialog"
			aria-modal="true"
			aria-label="{selected.meeting.title} details"
		>
			<div class="flex items-start justify-between gap-3">
				<div class="min-w-0">
					<h2 class="text-lg font-semibold">{selected.meeting.title}</h2>
					<p class="mt-0.5 text-sm" style="color:var(--text-muted)">
						{formatCivilDate(civilDateOf(selected.startsAt, app.timezone))} ·
						{formatTime(selected.startsAt, app.timezone)} ·
						{formatDuration(selected.meeting.durationMinutes)}
					</p>
				</div>
				<button
					type="button"
					class="mf-btn mf-btn-ghost -mr-2 -mt-1 px-2"
					style="min-height:2.25rem"
					onclick={() => (selected = null)}
					aria-label="Close"
				>
					<Icon name="close" size={18} />
				</button>
			</div>

			{#if selected.meeting.description}
				<p class="mt-3 text-sm" style="color:var(--text-muted)">{selected.meeting.description}</p>
			{/if}

			{#if selected.meeting.agenda.length}
				<div class="mt-4">
					<h3 class="mb-1.5 text-xs font-semibold uppercase" style="color:var(--text-subtle)">
						Agenda
					</h3>
					<ol class="space-y-1 text-sm">
						{#each selected.meeting.agenda as topic}
							<li class="flex items-baseline justify-between gap-3">
								<span class="min-w-0 flex-1 truncate">{topic.title}</span>
								<span class="shrink-0 tabular-nums" style="color:var(--text-subtle)">
									{topic.minutes}m
								</span>
							</li>
						{/each}
					</ol>
				</div>
			{/if}

			<div class="mt-4 flex items-center gap-2">
				<div class="flex -space-x-1.5">
					{#each selected.meeting.participants.slice(0, 6) as p}
						{@const contact = app.contact(p.contactId)}
						{#if contact}
							<Avatar name={contact.name} hue={contact.hue} size={26} stacked />
						{/if}
					{/each}
				</div>
				<span class="text-xs" style="color:var(--text-subtle)">
					{selected.meeting.participants.length} invited
				</span>
			</div>

			<!-- Keyboard reschedule, mirroring what drag does. -->
			<div class="mt-4 flex items-center gap-2 border-t pt-4" style="border-color:var(--border)">
				<span class="text-xs font-medium" style="color:var(--text-muted)">Move</span>
				<button
					type="button"
					class="mf-btn mf-btn-secondary mf-btn-sm"
					onclick={() =>
						selected && reschedule(selected, addDays(civilDateOf(selected.startsAt, app.timezone), -1))}
				>
					<Icon name="chevron-left" size={14} />
					A day earlier
				</button>
				<button
					type="button"
					class="mf-btn mf-btn-secondary mf-btn-sm"
					onclick={() =>
						selected && reschedule(selected, addDays(civilDateOf(selected.startsAt, app.timezone), 1))}
				>
					A day later
					<Icon name="chevron-right" size={14} />
				</button>
			</div>

			<div class="mt-3 flex flex-wrap gap-2">
				<a
					href="{ROUTES.room}?code={selected.meeting.code}"
					class="mf-btn mf-btn-primary mf-btn-sm"
				>
					<Icon name="video" size={15} />
					Join
				</a>
				<a
					href="{ROUTES.meeting}?id={selected.meeting.id}&at={selected.startsAt}"
					class="mf-btn mf-btn-secondary mf-btn-sm"
				>
					Details
				</a>
				<a href="{ROUTES.schedule}?id={selected.meeting.id}" class="mf-btn mf-btn-secondary mf-btn-sm">
					<Icon name="edit" size={15} />
					Edit
				</a>
				<button
					type="button"
					class="mf-btn mf-btn-ghost mf-btn-sm ml-auto"
					style="color:var(--danger)"
					onclick={() => {
						if (!selected) return;
						app.cancelOccurrence(selected.meetingId, selected.originalStart);
						app.showToast('Meeting cancelled');
						selected = null;
					}}
				>
					Cancel meeting
				</button>
			</div>
		</div>
	</div>
{/if}
