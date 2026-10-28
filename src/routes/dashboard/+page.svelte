<script lang="ts">
	/**
	 * Dashboard: today's timeline, upcoming meetings, stat cards, quick join and the mini
	 * calendar.
	 *
	 * Every number here is derived from the store's occurrence expansion - there is no
	 * separate dashboard cache - so scheduling or ending a meeting anywhere updates all of
	 * it at once.
	 */
	import { goto } from '$app/navigation';
	import { app } from '#lib/stores/app.svelte';
	import { ROUTES } from '#lib/nav';
	import { formatCivilDate, formatDuration, relativeLabel } from '#lib/logic/time';
	import { isOverdue } from '#lib/logic/notes';
	import { normaliseCode } from '#lib/logic/schedule';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import MeetingCard from '#lib/components/MeetingCard.svelte';
	import MiniCalendar from '#lib/components/MiniCalendar.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import Avatar from '#lib/components/Avatar.svelte';

	let joinCode = $state('');
	let joinError = $state('');

	const stats = $derived(app.weekStats);
	const today = $derived(app.todaysOccurrences);
	const upcoming = $derived(app.upcoming(5));
	const live = $derived(app.liveOccurrence);

	/** Meetings on the mini-calendar's selected day, when it is not today. */
	const selectedDay = $derived(app.filters.focusDate);
	const selectedOccurrences = $derived(
		selectedDay === app.today ? [] : app.occurrencesOn(selectedDay)
	);

	/** My open action items, soonest due first - the "what do I owe" list. */
	const myOpenItems = $derived(
		app.actionItems
			.filter((a) => a.status !== 'done' && a.assigneeId === app.meId)
			.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
			.slice(0, 5)
	);

	function startInstant() {
		const meeting = app.startInstantMeeting('Instant meeting');
		goto(`${ROUTES.room}?code=${meeting.code}`);
	}

	function join(event: Event) {
		event.preventDefault();
		const code = normaliseCode(joinCode);
		if (!code) {
			joinError = 'Enter a meeting code.';
			return;
		}
		const meeting = app.meetingByCode(code);
		if (!meeting) {
			joinError = `No meeting found with code ${code}.`;
			return;
		}
		joinError = '';
		goto(`${ROUTES.room}?code=${meeting.code}`);
	}

	const STAT_CARDS = $derived([
		{
			label: 'Meetings this week',
			value: String(stats.meetingsThisWeek),
			icon: 'calendar',
			href: ROUTES.calendar,
			hint: stats.meetingsThisWeek === 0 ? 'Nothing booked yet' : 'Across all your calendars'
		},
		{
			label: 'Hours in meetings',
			value: stats.hoursThisWeek === 0 ? '0' : String(stats.hoursThisWeek),
			icon: 'clock',
			href: ROUTES.history,
			hint: 'Scheduled and actual, this week'
		},
		{
			label: 'Open action items',
			value: String(stats.openActionItems),
			icon: 'check-circle',
			href: ROUTES.actions,
			hint: stats.overdue > 0 ? `${stats.overdue} overdue` : 'Nothing overdue',
			alert: stats.overdue > 0
		},
		{
			label: 'Completion rate',
			// A dash, not 0%, when there is nothing to measure.
			value: stats.completionRate === null ? '—' : `${stats.completionRate}%`,
			icon: 'sparkle',
			href: ROUTES.actions,
			hint: 'Action items marked done'
		}
	]);
</script>

<svelte:head>
	<title>Dashboard · MeetFlow</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
	<PageHeader
		title="Good to see you, {app.settings.profileName.split(' ')[0]}"
		subtitle="{formatCivilDate(app.today)} · {today.length === 0
			? 'nothing scheduled today'
			: `${today.length} meeting${today.length === 1 ? '' : 's'} today`}"
	>
		<button type="button" class="mf-btn mf-btn-secondary" onclick={startInstant}>
			<Icon name="video" size={17} />
			Start instant meeting
		</button>
		<a href={ROUTES.schedule} class="mf-btn mf-btn-primary">
			<Icon name="plus" size={17} />
			Schedule
		</a>
	</PageHeader>

	{#if !app.loaded}
		<!-- Skeleton while the store hydrates from localStorage. -->
		<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
			{#each Array(4) as _}
				<div class="mf-card p-5">
					<div class="mf-skeleton h-3 w-24"></div>
					<div class="mf-skeleton mt-3 h-7 w-16"></div>
				</div>
			{/each}
		</div>
		<div class="mf-skeleton mt-6 h-64 w-full"></div>
	{:else}
		{#if live}
			<div
				class="mf-card mb-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
				style="border-color:var(--accent);background:var(--accent-soft)"
			>
				<div class="flex items-center gap-3">
					<span
						class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
						style="background:var(--danger);color:#fff"
					>
						<Icon name="record" size={16} />
					</span>
					<div class="min-w-0">
						<p class="font-semibold" style="color:var(--accent-soft-text)">
							{live.meeting.title} is happening now
						</p>
						<p class="text-sm" style="color:var(--accent-soft-text);opacity:0.8">
							Started {relativeLabel(live.startsAt, app.now)}
						</p>
					</div>
				</div>
				<a href="{ROUTES.room}?code={live.meeting.code}" class="mf-btn mf-btn-primary shrink-0">
					<Icon name="video" size={17} />
					Join now
				</a>
			</div>
		{/if}

		<!-- ---------------- stat cards ---------------- -->
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			{#each STAT_CARDS as card}
				<a href={card.href} class="mf-card mf-card-hover p-4 sm:p-5">
					<div class="flex items-start justify-between gap-2">
						<p class="text-[0.8125rem] font-medium" style="color:var(--text-muted)">
							{card.label}
						</p>
						<span style="color:var(--text-subtle)"><Icon name={card.icon} size={17} /></span>
					</div>
					<p class="mt-2 text-3xl font-bold tabular-nums">{card.value}</p>
					<p
						class="mt-1 text-xs"
						style="color:{card.alert ? 'var(--danger)' : 'var(--text-subtle)'}"
					>
						{card.hint}
					</p>
				</a>
			{/each}
		</div>

		<div class="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
			<div class="min-w-0 space-y-6">
				<!-- ---------------- quick join ---------------- -->
				<section class="mf-card p-4 sm:p-5">
					<h2 class="text-base font-semibold">Join a meeting</h2>
					<p class="mt-1 text-sm" style="color:var(--text-subtle)">
						Enter the code someone shared with you, or start one of your own.
					</p>
					<form class="mt-3 flex flex-col gap-2 sm:flex-row" onsubmit={join}>
						<div class="flex-1">
							<label class="mf-sr-only" for="mf-join-code">Meeting code</label>
							<input
								id="mf-join-code"
								class="mf-field font-mono tracking-wider uppercase"
								placeholder="ABC-1234"
								bind:value={joinCode}
								oninput={() => (joinError = '')}
								aria-invalid={joinError ? 'true' : undefined}
								aria-describedby={joinError ? 'mf-join-error' : undefined}
								autocomplete="off"
								maxlength="9"
							/>
						</div>
						<button type="submit" class="mf-btn mf-btn-primary">
							<Icon name="video" size={17} />
							Join with code
						</button>
					</form>
					{#if joinError}
						<p id="mf-join-error" class="mt-2 text-sm" style="color:var(--danger)" role="alert">
							{joinError}
						</p>
					{/if}
				</section>

				<!-- ---------------- today's timeline ---------------- -->
				<section>
					<div class="mb-3 flex items-baseline justify-between gap-3">
						<h2 class="text-base font-semibold">Today</h2>
						<a href={ROUTES.calendar} class="text-sm mf-link">Open calendar</a>
					</div>
					{#if today.length === 0}
						<div class="mf-card">
							<EmptyState
								icon="calendar"
								title="Nothing scheduled today"
								description="A clear calendar is a feature, not a bug. Schedule something when you need to, or start an instant meeting."
								actionLabel="Schedule a meeting"
								actionHref={ROUTES.schedule}
							/>
						</div>
					{:else}
						<div class="space-y-2.5">
							{#each today as occurrence (occurrence.meetingId + occurrence.startsAt)}
								<MeetingCard {occurrence} />
							{/each}
						</div>
					{/if}
				</section>

				<!-- ---------------- upcoming ---------------- -->
				<section>
					<h2 class="mb-3 text-base font-semibold">Coming up</h2>
					{#if upcoming.length === 0}
						<div class="mf-card">
							<EmptyState
								compact
								icon="clock"
								title="No upcoming meetings"
								description="Anything you schedule will appear here."
							/>
						</div>
					{:else}
						<div class="space-y-2.5">
							{#each upcoming as occurrence (occurrence.meetingId + occurrence.startsAt)}
								<MeetingCard {occurrence} showDate />
							{/each}
						</div>
					{/if}
				</section>
			</div>

			<!-- ---------------- right rail ---------------- -->
			<aside class="space-y-6">
				<section class="mf-card p-4">
					<MiniCalendar
						value={selectedDay}
						onSelect={(date) => (app.filters.focusDate = date)}
					/>
					{#if selectedDay !== app.today}
						<div class="mt-3 border-t pt-3" style="border-color:var(--border)">
							<p class="text-xs font-semibold" style="color:var(--text-muted)">
								{formatCivilDate(selectedDay)}
							</p>
							{#if selectedOccurrences.length === 0}
								<p class="mt-1.5 text-xs" style="color:var(--text-subtle)">
									Nothing scheduled on this day.
								</p>
							{:else}
								<ul class="mt-2 space-y-1.5">
									{#each selectedOccurrences as o (o.meetingId + o.startsAt)}
										<li class="flex items-start gap-2 text-xs">
											<span
												class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
												style="background:var(--event-{o.meeting.colour % 6})"
											></span>
											<span class="min-w-0 flex-1">
												<span class="font-medium">{o.meeting.title}</span>
												<span style="color:var(--text-subtle)">
													· {formatDuration(o.meeting.durationMinutes)}
												</span>
											</span>
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{/if}
				</section>

				<section class="mf-card p-4">
					<div class="mb-3 flex items-baseline justify-between gap-2">
						<h2 class="text-sm font-semibold">Your action items</h2>
						<a href={ROUTES.actions} class="text-xs mf-link">All</a>
					</div>
					{#if myOpenItems.length === 0}
						<EmptyState
							compact
							icon="check-circle"
							title="All clear"
							description="You have no open action items assigned to you."
						/>
					{:else}
						<ul class="space-y-2">
							{#each myOpenItems as item (item.id)}
								{@const overdue = isOverdue(item, app.today)}
								<li class="flex items-start gap-2.5">
									<button
										type="button"
										class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors"
										style="border-color:var(--border-strong)"
										onclick={() => app.updateActionItem(item.id, { status: 'done' })}
										aria-label="Mark &quot;{item.title}&quot; as done"
									></button>
									<div class="min-w-0 flex-1">
										<p class="text-[0.8125rem] leading-snug mf-clamp-2">{item.title}</p>
										{#if item.dueDate}
											<p
												class="mt-0.5 text-[0.6875rem]"
												style="color:{overdue ? 'var(--danger)' : 'var(--text-subtle)'}"
											>
												{overdue ? 'Overdue · ' : 'Due '}{item.dueDate}
											</p>
										{/if}
									</div>
									{#if item.priority === 'high'}
										<span class="mf-badge mf-badge-danger shrink-0">High</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<section class="mf-card p-4">
					<h2 class="mb-3 text-sm font-semibold">Your team</h2>
					<ul class="space-y-2">
						{#each app.contacts.slice(0, 6) as contact (contact.id)}
							<li class="flex items-center gap-2.5">
								<Avatar name={contact.name} hue={contact.hue} size={28} />
								<div class="min-w-0 flex-1">
									<p class="truncate text-[0.8125rem] font-medium">{contact.name}</p>
									<p class="truncate text-[0.6875rem]" style="color:var(--text-subtle)">
										{contact.title}
									</p>
								</div>
							</li>
						{/each}
					</ul>
					<a href={ROUTES.contacts} class="mf-btn mf-btn-secondary mf-btn-sm mt-3 w-full">
						<Icon name="users" size={15} />
						Contacts and teams
					</a>
				</section>
			</aside>
		</div>
	{/if}
</div>
