<script lang="ts">
	/**
	 * Meeting detail / auto-generated summary.
	 *
	 * Every section is derived from `buildSummary`, which reads the same stored records the
	 * room wrote. Nothing is recomputed differently here, so the summary cannot disagree
	 * with the board or the dashboard.
	 */
	import { page } from '$app/state';
	import { app } from '#lib/stores/app.svelte';
	import { ROUTES } from '#lib/nav';
	import { summaryToText } from '#lib/logic/notes';
	import { buildSummaryPdf, summaryFilename } from '#lib/export/pdf';
	import { meetingLink, describeRecurrence } from '#lib/logic/schedule';
	import {
		civilDateOf,
		formatCivilDate,
		formatDuration,
		formatTime,
		zoneLabel
	} from '#lib/logic/time';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import NotesEditor from '#lib/components/NotesEditor.svelte';
	import ActionItemDialog from '#lib/components/ActionItemDialog.svelte';

	const meetingId = $derived(page.url.searchParams.get('id'));
	const meeting = $derived(app.meeting(meetingId));
	const summary = $derived(meetingId ? app.summaryFor(meetingId) : null);

	let actionDialogOpen = $state(false);
	let actionSourceLine = $state('');
	let decisionDraft = $state('');

	const isPastMeeting = $derived(
		!!meeting && (meeting.status === 'completed' || new Date(meeting.startsAt) < app.now)
	);

	function exportPdf() {
		if (!summary) return;
		const blob = buildSummaryPdf(summary, app.timezone);
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = summaryFilename(summary, app.timezone);
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
		app.showToast('Summary PDF downloaded');
	}

	async function copySummary() {
		if (!summary) return;
		try {
			await navigator.clipboard.writeText(summaryToText(summary, app.timezone));
			app.showToast('Summary copied to clipboard');
		} catch {
			app.showToast('Could not access the clipboard', 'error');
		}
	}

	function emailDraft() {
		if (!summary || !meeting) return;
		const to = summary.attendees.map((a) => a.contact.email).join(',');
		const body = summaryToText(summary, app.timezone);
		// mailto has a practical length limit, so the body is trimmed with a pointer to the app.
		const trimmed =
			body.length > 1600 ? `${body.slice(0, 1600)}\n\n[...] Full summary in MeetFlow.` : body;
		window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
			`Summary: ${meeting.title}`
		)}&body=${encodeURIComponent(trimmed)}`;
	}

	async function copyLink() {
		if (!meeting) return;
		try {
			await navigator.clipboard.writeText(meetingLink(meeting.code, window.location.origin));
			app.showToast('Join link copied');
		} catch {
			app.showToast('Could not access the clipboard', 'error');
		}
	}

	function addDecision(event: Event) {
		event.preventDefault();
		if (!meetingId || !decisionDraft.trim()) return;
		app.addDecision(meetingId, decisionDraft);
		decisionDraft = '';
	}
</script>

<svelte:head>
	<title>{meeting?.title ?? 'Meeting'} · MeetFlow</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
	{#if !app.loaded}
		<div class="space-y-4">
			<div class="mf-skeleton h-10 w-2/3"></div>
			<div class="mf-skeleton h-40 w-full"></div>
		</div>
	{:else if !meeting || !summary}
		<!-- A deep link to a deleted meeting must explain itself, not show a blank screen. -->
		<div class="mf-card">
			<EmptyState
				icon="search"
				title="Meeting not found"
				description="This meeting may have been deleted, or the link may be incomplete."
				actionLabel="Back to dashboard"
				actionHref={ROUTES.dashboard}
			/>
		</div>
	{:else}
		<PageHeader
			title={meeting.title}
			subtitle="{formatCivilDate(civilDateOf(meeting.startsAt, app.timezone))} · {formatTime(
				meeting.startsAt,
				app.timezone
			)} {zoneLabel(app.timezone, meeting.startsAt)} · {describeRecurrence(meeting.recurrence)}"
		>
			{#if !isPastMeeting}
				<a href="{ROUTES.room}?code={meeting.code}" class="mf-btn mf-btn-primary">
					<Icon name="video" size={17} />
					Join
				</a>
			{/if}
			<a href="{ROUTES.schedule}?id={meeting.id}" class="mf-btn mf-btn-secondary">
				<Icon name="edit" size={17} />
				Edit
			</a>
		</PageHeader>

		{#if meeting.description}
			<p class="mb-5 text-sm" style="color:var(--text-muted)">{meeting.description}</p>
		{/if}

		<!-- ---------------- at a glance ---------------- -->
		<div class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			{#each [{ label: 'Duration', value: formatDuration(summary.durationMinutes), hint: `scheduled ${formatDuration(summary.scheduledMinutes)}` }, { label: 'Attendance', value: `${summary.attendees.filter((a) => a.attended).length}/${summary.attendees.length}`, hint: summary.attendanceRate === null ? 'nobody invited' : `${summary.attendanceRate}% turnout` }, { label: 'Agenda covered', value: `${summary.topicsCovered}/${summary.topicsTotal}`, hint: summary.topicsTotal === 0 ? 'no agenda set' : 'topics discussed' }, { label: 'Action items', value: String(summary.actionItems.length), hint: `${summary.openActionItems} still open` }] as card}
				<div class="mf-card p-4">
					<p class="text-xs font-medium" style="color:var(--text-muted)">{card.label}</p>
					<p class="mt-1.5 text-2xl font-bold tabular-nums">{card.value}</p>
					<p class="mt-0.5 text-xs" style="color:var(--text-subtle)">{card.hint}</p>
				</div>
			{/each}
		</div>

		<!-- ---------------- export row ---------------- -->
		<div class="mf-card mb-6 flex flex-wrap items-center gap-2 p-3">
			<span class="mr-1 text-sm font-medium" style="color:var(--text-muted)">Share summary</span>
			<button type="button" class="mf-btn mf-btn-secondary mf-btn-sm" onclick={exportPdf}>
				<Icon name="download" size={15} />
				Export PDF
			</button>
			<button type="button" class="mf-btn mf-btn-secondary mf-btn-sm" onclick={copySummary}>
				<Icon name="copy" size={15} />
				Copy summary
			</button>
			<button type="button" class="mf-btn mf-btn-secondary mf-btn-sm" onclick={emailDraft}>
				<Icon name="mail" size={15} />
				Email draft
			</button>
			<button type="button" class="mf-btn mf-btn-secondary mf-btn-sm" onclick={copyLink}>
				<Icon name="link" size={15} />
				Copy join link
			</button>
		</div>

		<div class="grid gap-6 lg:grid-cols-[1fr_280px]">
			<div class="min-w-0 space-y-6">
				<!-- ---------------- agenda ---------------- -->
				<section class="mf-card p-4 sm:p-5">
					<h2 class="mb-3 text-base font-semibold">Agenda</h2>
					{#if meeting.agenda.length === 0}
						<EmptyState
							compact
							icon="list"
							title="No agenda was set"
							description="Add one by editing the meeting."
						/>
					{:else}
						<ol class="space-y-2">
							{#each meeting.agenda as topic (topic.id)}
								<li class="flex items-start gap-2.5">
									<button
										type="button"
										class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border"
										style="border-color:var(--border-strong);{topic.covered
											? 'background:var(--ok);border-color:var(--ok);color:#fff'
											: ''}"
										onclick={() => app.toggleTopicCovered(meeting.id, topic.id)}
										aria-label="Mark &quot;{topic.title}&quot; as {topic.covered
											? 'not covered'
											: 'covered'}"
										aria-pressed={topic.covered}
									>
										{#if topic.covered}<Icon name="check" size={10} />{/if}
									</button>
									<div class="min-w-0 flex-1">
										<p
											class="text-sm font-medium"
											style={topic.covered ? 'text-decoration:line-through;opacity:0.65' : ''}
										>
											{topic.title}
										</p>
										<p class="text-xs" style="color:var(--text-subtle)">
											{topic.minutes} min{#if topic.owner}
												· {app.contactName(topic.owner)}{/if}
										</p>
									</div>
								</li>
							{/each}
						</ol>
					{/if}
				</section>

				<!-- ---------------- decisions ---------------- -->
				<section class="mf-card p-4 sm:p-5">
					<h2 class="mb-3 text-base font-semibold">Decisions ({summary.decisions.length})</h2>
					{#if summary.decisions.length === 0}
						<EmptyState
							compact
							icon="check-circle"
							title="No decisions logged"
							description="Decisions recorded during the meeting show up here, separately from the notes."
						/>
					{:else}
						<ul class="mb-3 space-y-2">
							{#each summary.decisions as decision (decision.id)}
								<li class="flex items-start gap-2.5">
									<span class="mt-0.5 shrink-0" style="color:var(--ok)">
										<Icon name="check-circle" size={16} />
									</span>
									<div class="min-w-0 flex-1">
										<p class="text-sm">{decision.text}</p>
										<p class="text-xs" style="color:var(--text-subtle)">
											{app.contactName(decision.decidedBy)} ·
											{formatTime(decision.decidedAt, app.timezone)}
										</p>
									</div>
									<button
										type="button"
										class="shrink-0 rounded px-1"
										style="color:var(--text-subtle)"
										onclick={() => app.removeDecision(decision.id)}
										aria-label="Remove this decision"
									>
										<Icon name="trash" size={14} />
									</button>
								</li>
							{/each}
						</ul>
					{/if}
					<form class="flex gap-2" onsubmit={addDecision}>
						<label class="mf-sr-only" for="mf-add-decision">New decision</label>
						<input
							id="mf-add-decision"
							class="mf-field"
							style="min-height:2.25rem"
							placeholder="Log a decision made in this meeting"
							bind:value={decisionDraft}
						/>
						<button
							type="submit"
							class="mf-btn mf-btn-secondary mf-btn-sm"
							disabled={!decisionDraft.trim()}
						>
							<Icon name="plus" size={15} />
							Add
						</button>
					</form>
				</section>

				<!-- ---------------- action items ---------------- -->
				<section class="mf-card p-4 sm:p-5">
					<div class="mb-3 flex items-center justify-between gap-3">
						<h2 class="text-base font-semibold">Action items ({summary.actionItems.length})</h2>
						<button
							type="button"
							class="mf-btn mf-btn-secondary mf-btn-sm"
							onclick={() => {
								actionSourceLine = '';
								actionDialogOpen = true;
							}}
						>
							<Icon name="plus" size={15} />
							Add
						</button>
					</div>
					{#if summary.actionItems.length === 0}
						<EmptyState
							compact
							icon="check-circle"
							title="No action items"
							description="Create one from a note line, or add it directly."
						/>
					{:else}
						<ul class="space-y-2">
							{#each summary.actionItems as item (item.id)}
								{@const assignee = app.contact(item.assigneeId)}
								<li class="flex items-start gap-2.5">
									<button
										type="button"
										class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border"
										style="border-color:var(--border-strong);{item.status === 'done'
											? 'background:var(--ok);border-color:var(--ok);color:#fff'
											: ''}"
										onclick={() =>
											app.updateActionItem(item.id, {
												status: item.status === 'done' ? 'todo' : 'done'
											})}
										aria-label="Mark &quot;{item.title}&quot; as {item.status === 'done'
											? 'not done'
											: 'done'}"
										aria-pressed={item.status === 'done'}
									>
										{#if item.status === 'done'}<Icon name="check" size={10} />{/if}
									</button>
									<div class="min-w-0 flex-1">
										<p
											class="text-sm"
											style={item.status === 'done' ? 'text-decoration:line-through;opacity:0.65' : ''}
										>
											{item.title}
										</p>
										<p class="text-xs" style="color:var(--text-subtle)">
											{assignee ? assignee.name : 'Unassigned'}
											{#if item.dueDate}· due {item.dueDate}{/if}
											· {item.priority} priority
										</p>
									</div>
								</li>
							{/each}
						</ul>
						<a href={ROUTES.actions} class="mf-btn mf-btn-ghost mf-btn-sm mt-3">
							Open the board
							<Icon name="chevron-right" size={14} />
						</a>
					{/if}
				</section>

				<!-- ---------------- notes ---------------- -->
				<section class="mf-card flex flex-col p-4 sm:p-5">
					<h2 class="mb-2 text-base font-semibold">Notes</h2>
					<NotesEditor
						meetingId={meeting.id}
						onCreateAction={(line) => {
							actionSourceLine = line;
							actionDialogOpen = true;
						}}
					/>
				</section>
			</div>

			<!-- ---------------- attendance rail ---------------- -->
			<aside class="space-y-4">
				<section class="mf-card p-4">
					<h2 class="mb-3 text-sm font-semibold">
						Attendance
						{#if summary.attendanceRate !== null}
							<span class="mf-badge mf-badge-neutral ml-1">{summary.attendanceRate}%</span>
						{/if}
					</h2>
					{#if summary.attendees.length === 0}
						<p class="text-xs" style="color:var(--text-subtle)">Nobody was invited.</p>
					{:else}
						<ul class="space-y-2">
							{#each summary.attendees as attendee (attendee.contact.id)}
								<li class="flex items-center gap-2.5">
									<Avatar name={attendee.contact.name} hue={attendee.contact.hue} size={28} />
									<div class="min-w-0 flex-1">
										<p class="truncate text-[0.8125rem] font-medium">{attendee.contact.name}</p>
										<p class="truncate text-[0.6875rem]" style="color:var(--text-subtle)">
											{attendee.role}
										</p>
									</div>
									{#if isPastMeeting}
										<span
											class="mf-badge shrink-0 {attendee.attended
												? 'mf-badge-ok'
												: 'mf-badge-neutral'}"
										>
											{attendee.attended ? 'Attended' : 'Absent'}
										</span>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</section>

				<section class="mf-card p-4">
					<h2 class="mb-2.5 text-sm font-semibold">Meeting info</h2>
					<dl class="space-y-2 text-xs">
						<div>
							<dt style="color:var(--text-subtle)">Code</dt>
							<dd class="font-mono tracking-wider">{meeting.code}</dd>
						</div>
						<div>
							<dt style="color:var(--text-subtle)">Status</dt>
							<dd class="capitalize">{meeting.status}</dd>
						</div>
						<div>
							<dt style="color:var(--text-subtle)">Timezone</dt>
							<dd>{meeting.timezone}</dd>
						</div>
						{#if summary.noteWords > 0}
							<div>
								<dt style="color:var(--text-subtle)">Notes</dt>
								<dd>{summary.noteWords} words</dd>
							</div>
						{/if}
					</dl>

					<button
						type="button"
						class="mf-btn mf-btn-ghost mf-btn-sm mt-3 w-full"
						style="color:var(--danger)"
						onclick={() => {
							app.deleteMeeting(meeting.id);
							app.showToast('Meeting deleted');
							window.location.href = ROUTES.dashboard;
						}}
					>
						<Icon name="trash" size={15} />
						Delete meeting
					</button>
				</section>
			</aside>
		</div>
	{/if}
</div>

<ActionItemDialog
	open={actionDialogOpen}
	{meetingId}
	sourceLine={actionSourceLine}
	onClose={() => {
		actionDialogOpen = false;
		actionSourceLine = '';
	}}
/>
