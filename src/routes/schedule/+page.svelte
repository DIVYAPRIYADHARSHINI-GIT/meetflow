<script lang="ts">
	/**
	 * Schedule a meeting: details, recurrence, participants, agenda, and the invite block.
	 *
	 * Validation and conflict detection are live but non-blocking where that is the honest
	 * behaviour: a past date or an overrunning agenda is a WARNING (people really do log
	 * meetings after the fact), while a missing title or a zero duration is an error.
	 */
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { AgendaTopic, Meeting, Participant, RecurrenceFreq } from '#lib/types';
	import { app } from '#lib/stores/app.svelte';
	import { ROUTES } from '#lib/nav';
	import {
		buildIcs,
		describeRecurrence,
		generateCode,
		meetingLink,
		validateDraft
	} from '#lib/logic/schedule';
	import {
		COMMON_TIMEZONES,
		civilDateOf,
		formatDateTime,
		instantFromZoned,
		localTimezone,
		timeOfDay,
		zoneLabel
	} from '#lib/logic/time';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import ParticipantPicker from '#lib/components/ParticipantPicker.svelte';
	import AgendaBuilder from '#lib/components/AgendaBuilder.svelte';
	import Icon from '#lib/components/Icon.svelte';

	/** Editing an existing meeting when ?id= is present. */
	const editingId = $derived(page.url.searchParams.get('id'));
	const editing = $derived(app.meeting(editingId));

	let title = $state('');
	let description = $state('');
	let date = $state('');
	let time = $state('10:00');
	let durationMinutes = $state(30);
	let timezone = $state('UTC');
	let freq = $state<RecurrenceFreq>('none');
	let interval = $state(1);
	let endMode = $state<'never' | 'count' | 'until'>('never');
	let count = $state(10);
	let until = $state('');
	let participants = $state<Participant[]>([]);
	let agenda = $state<AgendaTopic[]>([]);
	let code = $state('');
	let submitted = $state(false);
	let savedMeeting = $state<Meeting | null>(null);
	let hydrated = $state(false);

	/**
	 * Seed the form once the store is ready.
	 *
	 * Guarded by `hydrated` so the user's typing is never clobbered by a later store tick -
	 * `app.now` updates every 30 seconds and would otherwise reset the form mid-edit.
	 */
	$effect(() => {
		if (!app.loaded || hydrated) return;
		const zone = app.timezone || localTimezone();

		if (editing) {
			title = editing.title;
			description = editing.description;
			date = civilDateOf(editing.startsAt, editing.timezone);
			time = timeOfDay(editing.startsAt, editing.timezone);
			durationMinutes = editing.durationMinutes;
			timezone = editing.timezone;
			freq = editing.recurrence.freq;
			interval = editing.recurrence.interval;
			if (editing.recurrence.count) {
				endMode = 'count';
				count = editing.recurrence.count;
			} else if (editing.recurrence.until) {
				endMode = 'until';
				until = editing.recurrence.until;
			}
			participants = [...editing.participants];
			agenda = editing.agenda.map((t) => ({ ...t }));
			code = editing.code;
		} else {
			date = app.filters.focusDate || app.today;
			timezone = zone;
			durationMinutes = app.settings.defaultDurationMinutes;
			participants = [{ contactId: app.meId, role: 'host' }];
			code = generateCode();
		}
		hydrated = true;
	});

	const recurrence = $derived({
		freq,
		interval: Math.max(1, interval),
		...(freq !== 'none' && endMode === 'count' ? { count: Math.max(1, count) } : {}),
		...(freq !== 'none' && endMode === 'until' && until ? { until } : {})
	});

	const draft = $derived({
		title,
		date,
		time,
		durationMinutes,
		timezone,
		recurrence,
		participants,
		agenda
	});

	const validation = $derived(validateDraft(draft, app.now));
	const hasErrors = $derived(Object.keys(validation.errors).length > 0);

	/** The candidate meeting, used for live conflict detection against the calendar. */
	const candidate = $derived.by<Meeting | null>(() => {
		if (!date || !time) return null;
		const [h, m] = time.split(':').map(Number);
		if (Number.isNaN(h) || Number.isNaN(m)) return null;
		return {
			id: editingId ?? 'draft',
			title: title || 'Untitled meeting',
			description,
			startsAt: instantFromZoned(date, h, m, timezone),
			durationMinutes,
			timezone,
			recurrence,
			exceptions: editing?.exceptions ?? [],
			participants,
			agenda,
			code,
			status: 'scheduled',
			colour: editing?.colour ?? app.meetings.length % 6,
			createdAt: editing?.createdAt ?? new Date().toISOString()
		};
	});

	const conflicts = $derived(candidate ? app.conflictsFor(candidate) : []);
	const joinLink = $derived(
		meetingLink(code, typeof window === 'undefined' ? '' : window.location.origin)
	);

	const DURATIONS = [15, 25, 30, 45, 60, 90, 120];

	function save() {
		submitted = true;
		if (hasErrors || !candidate) return;

		if (editing) {
			app.updateMeeting(editing.id, {
				title: candidate.title,
				description,
				startsAt: candidate.startsAt,
				durationMinutes,
				timezone,
				recurrence,
				participants,
				agenda
			});
			savedMeeting = app.meeting(editing.id);
			app.showToast('Meeting updated');
		} else {
			const created = app.createMeeting({
				title: candidate.title,
				description,
				startsAt: candidate.startsAt,
				durationMinutes,
				timezone,
				recurrence,
				exceptions: [],
				participants,
				agenda,
				code
			});
			savedMeeting = created;
			app.showToast('Meeting scheduled');
		}
	}

	async function copyInvite() {
		const meeting = savedMeeting ?? candidate;
		if (!meeting) return;
		const text = [
			`${meeting.title}`,
			formatDateTime(meeting.startsAt, timezone) + ` (${zoneLabel(timezone, meeting.startsAt)})`,
			'',
			`Join: ${joinLink}`,
			`Code: ${code}`,
			...(agenda.length
				? ['', 'Agenda:', ...agenda.map((t, i) => `${i + 1}. ${t.title} (${t.minutes}m)`)]
				: [])
		].join('\n');

		try {
			await navigator.clipboard.writeText(text);
			app.showToast('Invite copied to clipboard');
		} catch {
			// Clipboard can be blocked by permissions policy; tell the user rather than failing
			// silently, and leave the text visible on the page so it can be copied by hand.
			app.showToast('Could not access the clipboard - copy the details below', 'error');
		}
	}

	function downloadIcs() {
		const meeting = savedMeeting ?? candidate;
		if (!meeting) return;
		const ics = buildIcs(meeting, app.contacts, {
			origin: typeof window === 'undefined' ? '' : window.location.origin
		});
		const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `${(meeting.title || 'meeting').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`;
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
		app.showToast('Calendar file downloaded');
	}
</script>

<svelte:head>
	<title>{editing ? 'Edit meeting' : 'Schedule a meeting'} · MeetFlow</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
	<PageHeader
		title={editing ? 'Edit meeting' : 'Schedule a meeting'}
		subtitle="Set the time, invite people and plan the agenda. You will get a join link, a code and a calendar file."
	>
		<a href={ROUTES.calendar} class="mf-btn mf-btn-ghost">Cancel</a>
		<button type="button" class="mf-btn mf-btn-primary" onclick={save} disabled={hasErrors && submitted}>
			<Icon name="check" size={17} />
			{editing ? 'Save changes' : 'Schedule meeting'}
		</button>
	</PageHeader>

	{#if savedMeeting}
		<!-- ---------------- success / invite block ---------------- -->
		<div class="mf-card mb-6 p-5" style="border-color:var(--ok);background:var(--ok-soft)">
			<div class="flex items-start gap-3">
				<span style="color:var(--ok)"><Icon name="check-circle" size={22} /></span>
				<div class="min-w-0 flex-1">
					<h2 class="font-semibold" style="color:var(--ok)">
						{editing ? 'Changes saved' : 'Meeting scheduled'}
					</h2>
					<p class="mt-0.5 text-sm" style="color:var(--text-muted)">
						{formatDateTime(savedMeeting.startsAt, timezone)} ({zoneLabel(
							timezone,
							savedMeeting.startsAt
						)}) · {describeRecurrence(recurrence)}
					</p>

					<div class="mt-3 space-y-2">
						<div class="flex flex-wrap items-center gap-2 text-sm">
							<span class="font-medium" style="color:var(--text-muted)">Code</span>
							<code
								class="rounded-md px-2 py-1 font-mono tracking-wider"
								style="background:var(--surface-raised);border:1px solid var(--border)"
							>
								{savedMeeting.code}
							</code>
						</div>
						<div class="flex flex-wrap items-center gap-2 text-sm">
							<span class="font-medium" style="color:var(--text-muted)">Link</span>
							<code
								class="max-w-full truncate rounded-md px-2 py-1 font-mono text-xs"
								style="background:var(--surface-raised);border:1px solid var(--border)"
							>
								{joinLink}
							</code>
						</div>
					</div>

					<div class="mt-4 flex flex-wrap gap-2">
						<a href="{ROUTES.room}?code={savedMeeting.code}" class="mf-btn mf-btn-primary mf-btn-sm">
							<Icon name="video" size={15} />
							Join the room
						</a>
						<button type="button" class="mf-btn mf-btn-secondary mf-btn-sm" onclick={copyInvite}>
							<Icon name="copy" size={15} />
							Copy invite
						</button>
						<button type="button" class="mf-btn mf-btn-secondary mf-btn-sm" onclick={downloadIcs}>
							<Icon name="download" size={15} />
							Add to calendar (.ics)
						</button>
						<a href={ROUTES.dashboard} class="mf-btn mf-btn-ghost mf-btn-sm">Back to dashboard</a>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<!-- ---------------- conflict warning ---------------- -->
	{#if conflicts.length > 0}
		<div
			class="mf-card mb-6 p-4"
			style="border-color:var(--warn);background:var(--warn-soft)"
			role="alert"
		>
			<div class="flex items-start gap-3">
				<span style="color:var(--warn)"><Icon name="warning" size={20} /></span>
				<div class="min-w-0">
					<h2 class="text-sm font-semibold" style="color:var(--warn)">
						{conflicts.length === 1
							? 'This overlaps another meeting'
							: `This overlaps ${conflicts.length} other meetings`}
					</h2>
					<ul class="mt-1.5 space-y-1 text-sm" style="color:var(--text-muted)">
						{#each conflicts.slice(0, 4) as conflict}
							<li>
								<span class="font-medium">{conflict.with.meeting.title}</span>
								· {formatDateTime(conflict.with.startsAt, timezone)}
								· {conflict.overlapMinutes} min overlap
							</li>
						{/each}
						{#if conflicts.length > 4}
							<li style="color:var(--text-subtle)">and {conflicts.length - 4} more</li>
						{/if}
					</ul>
					<p class="mt-2 text-xs" style="color:var(--text-subtle)">
						You can still schedule it - double-booking is sometimes deliberate.
					</p>
				</div>
			</div>
		</div>
	{/if}

	<div class="grid gap-6 lg:grid-cols-[1fr_300px]">
		<div class="min-w-0 space-y-6">
			<!-- ---------------- details ---------------- -->
			<section class="mf-card p-4 sm:p-5">
				<h2 class="mb-4 text-base font-semibold">Meeting details</h2>

				<div class="space-y-4">
					<div>
						<label class="mf-label" for="mf-title">Title</label>
						<input
							id="mf-title"
							class="mf-field"
							placeholder="e.g. Sprint 24 planning"
							bind:value={title}
							maxlength="140"
							aria-invalid={submitted && validation.errors.title ? 'true' : undefined}
							aria-describedby={submitted && validation.errors.title ? 'mf-title-error' : undefined}
						/>
						{#if submitted && validation.errors.title}
							<p id="mf-title-error" class="mt-1.5 text-sm" style="color:var(--danger)">
								{validation.errors.title}
							</p>
						{/if}
					</div>

					<div>
						<label class="mf-label" for="mf-description">Description <span style="color:var(--text-subtle)">(optional)</span></label>
						<textarea
							id="mf-description"
							class="mf-field resize-y"
							rows="2"
							placeholder="What is this meeting for?"
							bind:value={description}
						></textarea>
					</div>

					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label class="mf-label" for="mf-date">Date</label>
							<input id="mf-date" class="mf-field" type="date" bind:value={date} />
							{#if validation.warnings.date}
								<p class="mt-1.5 flex items-center gap-1.5 text-sm" style="color:var(--warn)">
									<Icon name="warning" size={14} />
									{validation.warnings.date}
								</p>
							{/if}
						</div>
						<div>
							<label class="mf-label" for="mf-time">Start time</label>
							<input id="mf-time" class="mf-field" type="time" bind:value={time} />
						</div>
					</div>

					<div class="grid gap-4 sm:grid-cols-2">
						<div>
							<label class="mf-label" for="mf-duration">Duration</label>
							<div class="flex gap-2">
								<select id="mf-duration" class="mf-field" bind:value={durationMinutes}>
									{#each DURATIONS as d}
										<option value={d}>{d} minutes</option>
									{/each}
									{#if !DURATIONS.includes(durationMinutes)}
										<option value={durationMinutes}>{durationMinutes} minutes</option>
									{/if}
								</select>
							</div>
							{#if validation.warnings.duration}
								<p class="mt-1.5 text-sm" style="color:var(--warn)">
									{validation.warnings.duration}
								</p>
							{/if}
						</div>
						<div>
							<label class="mf-label" for="mf-timezone">Timezone</label>
							<select id="mf-timezone" class="mf-field" bind:value={timezone}>
								{#each [...new Set([timezone, app.timezone, ...COMMON_TIMEZONES])] as zone}
									<option value={zone}>{zone} ({zoneLabel(zone)})</option>
								{/each}
							</select>
						</div>
					</div>
				</div>
			</section>

			<!-- ---------------- recurrence ---------------- -->
			<section class="mf-card p-4 sm:p-5">
				<h2 class="mb-1 text-base font-semibold">Repeat</h2>
				<p class="mb-4 text-sm" style="color:var(--text-subtle)">
					{describeRecurrence(recurrence)}
				</p>

				<div class="flex flex-wrap gap-1.5">
					{#each [['none', 'Does not repeat'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']] as [value, label]}
						<button
							type="button"
							class="mf-chip transition-colors"
							style={freq === value
								? 'background:var(--accent);color:var(--accent-contrast);border-color:var(--accent)'
								: ''}
							onclick={() => (freq = value as RecurrenceFreq)}
							aria-pressed={freq === value}
						>
							{label}
						</button>
					{/each}
				</div>

				{#if freq !== 'none'}
					<div class="mt-4 grid gap-4 sm:grid-cols-2">
						<div>
							<label class="mf-label" for="mf-interval">
								Every
							</label>
							<div class="flex items-center gap-2">
								<input
									id="mf-interval"
									class="mf-field w-20 tabular-nums"
									type="number"
									min="1"
									max="52"
									bind:value={interval}
								/>
								<span class="text-sm" style="color:var(--text-muted)">
									{freq === 'daily' ? 'day(s)' : freq === 'weekly' ? 'week(s)' : 'month(s)'}
								</span>
							</div>
						</div>

						<div>
							<label class="mf-label" for="mf-end-mode">Ends</label>
							<select id="mf-end-mode" class="mf-field" bind:value={endMode}>
								<option value="never">Never</option>
								<option value="count">After a number of meetings</option>
								<option value="until">On a date</option>
							</select>
						</div>

						{#if endMode === 'count'}
							<div>
								<label class="mf-label" for="mf-count">Number of meetings</label>
								<input
									id="mf-count"
									class="mf-field w-28 tabular-nums"
									type="number"
									min="1"
									max="400"
									bind:value={count}
								/>
							</div>
						{:else if endMode === 'until'}
							<div>
								<label class="mf-label" for="mf-until">Last date</label>
								<input id="mf-until" class="mf-field" type="date" bind:value={until} />
							</div>
						{/if}
					</div>

					{#if validation.errors.recurrence}
						<p class="mt-2 text-sm" style="color:var(--danger)" role="alert">
							{validation.errors.recurrence}
						</p>
					{/if}

					{#if freq === 'monthly' && date && Number(date.slice(8, 10)) > 28}
						<p class="mt-3 flex items-start gap-1.5 text-xs" style="color:var(--text-subtle)">
							<Icon name="info" size={14} class="mt-px shrink-0" />
							Day {Number(date.slice(8, 10))} does not exist in every month, so those occurrences
							move to the last day of the month.
						</p>
					{/if}
				{/if}
			</section>

			<!-- ---------------- participants ---------------- -->
			<section class="mf-card p-4 sm:p-5">
				<h2 class="mb-1 text-base font-semibold">Participants</h2>
				<p class="mb-3 text-sm" style="color:var(--text-subtle)">
					Availability is shown in each person's own timezone.
				</p>
				<ParticipantPicker
					{participants}
					onChange={(next) => (participants = next)}
					startsAt={candidate?.startsAt}
					{durationMinutes}
				/>
				{#if validation.warnings.participants}
					<p class="mt-2 text-sm" style="color:var(--warn)">{validation.warnings.participants}</p>
				{/if}
			</section>

			<!-- ---------------- agenda ---------------- -->
			<section class="mf-card p-4 sm:p-5">
				<h2 class="mb-1 text-base font-semibold">Agenda</h2>
				<p class="mb-3 text-sm" style="color:var(--text-subtle)">
					Topics run in this order in the meeting room, each with its own countdown.
				</p>
				<AgendaBuilder topics={agenda} {durationMinutes} onChange={(next) => (agenda = next)} />
				{#if submitted && validation.errors.agenda}
					<p class="mt-2 text-sm" style="color:var(--danger)" role="alert">
						{validation.errors.agenda}
					</p>
				{/if}
			</section>
		</div>

		<!-- ---------------- summary rail ---------------- -->
		<aside class="space-y-4">
			<section class="mf-card p-4">
				<h2 class="mb-3 text-sm font-semibold">Invite details</h2>
				<dl class="space-y-2.5 text-sm">
					<div>
						<dt class="text-xs" style="color:var(--text-subtle)">When</dt>
						<dd class="font-medium">
							{candidate ? formatDateTime(candidate.startsAt, timezone) : '—'}
						</dd>
					</div>
					<div>
						<dt class="text-xs" style="color:var(--text-subtle)">Code</dt>
						<dd class="font-mono tracking-wider">{code}</dd>
					</div>
					<div>
						<dt class="text-xs" style="color:var(--text-subtle)">Link</dt>
						<dd class="truncate font-mono text-xs" title={joinLink}>{joinLink}</dd>
					</div>
					<div>
						<dt class="text-xs" style="color:var(--text-subtle)">People</dt>
						<dd class="font-medium">
							{participants.length}
							{participants.length === 1 ? 'person' : 'people'}
						</dd>
					</div>
				</dl>

				<div class="mt-4 space-y-2">
					<button type="button" class="mf-btn mf-btn-secondary mf-btn-sm w-full" onclick={copyInvite}>
						<Icon name="copy" size={15} />
						Copy invite
					</button>
					<button type="button" class="mf-btn mf-btn-secondary mf-btn-sm w-full" onclick={downloadIcs}>
						<Icon name="download" size={15} />
						Add to calendar
					</button>
				</div>
			</section>

			<button type="button" class="mf-btn mf-btn-primary w-full" onclick={save}>
				<Icon name="check" size={17} />
				{editing ? 'Save changes' : 'Schedule meeting'}
			</button>

			{#if submitted && hasErrors}
				<p class="text-sm" style="color:var(--danger)" role="alert">
					Fix the highlighted fields before saving.
				</p>
			{/if}
		</aside>
	</div>
</div>
