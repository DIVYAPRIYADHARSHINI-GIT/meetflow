<script lang="ts">
	/**
	 * Action items board: To do / In progress / Done, with filters.
	 *
	 * Filters live in the STORE (`app.filters`), not in this component, which is why changing
	 * "assignee" here also changes the counts shown on the dashboard. Moving a card has two
	 * paths - drag, and a keyboard menu on each card - both going through
	 * `app.moveActionItem`.
	 */
	import type { ActionItem, ActionStatus } from '#lib/types';
	import { ACTION_STATUSES, ACTION_STATUS_LABELS } from '#lib/types';
	import { app } from '#lib/stores/app.svelte';
	import { ROUTES } from '#lib/nav';
	import { groupByStatus, isOverdue } from '#lib/logic/notes';
	import { formatCivilDate } from '#lib/logic/time';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import ActionItemDialog from '#lib/components/ActionItemDialog.svelte';

	let dragId = $state<string | null>(null);
	let dragOverColumn = $state<ActionStatus | null>(null);
	let dialogOpen = $state(false);
	let editing = $state<ActionItem | null>(null);
	let liveMessage = $state('');

	const filtered = $derived(app.filteredActionItems);
	const columns = $derived(groupByStatus(filtered));
	const totalOpen = $derived(filtered.filter((i) => i.status !== 'done').length);
	const overdueCount = $derived(filtered.filter((i) => isOverdue(i, app.today)).length);

	/** Meetings that actually have action items, for the filter dropdown. */
	const meetingsWithItems = $derived(
		app.meetings.filter((m) => app.actionItems.some((a) => a.meetingId === m.id))
	);

	function move(item: ActionItem, status: ActionStatus) {
		if (item.status === status) return;
		app.moveActionItem(item.id, status);
		liveMessage = `${item.title} moved to ${ACTION_STATUS_LABELS[status]}.`;
	}

	function onDrop(event: DragEvent, status: ActionStatus) {
		event.preventDefault();
		const id = dragId ?? event.dataTransfer?.getData('text/plain');
		dragId = null;
		dragOverColumn = null;
		const item = app.actionItems.find((a) => a.id === id);
		if (item) move(item, status);
	}

	/** Keyboard alternative to dragging: Alt+Arrow moves between columns. */
	function onCardKeydown(event: KeyboardEvent, item: ActionItem) {
		if (!event.altKey) return;
		const index = ACTION_STATUSES.indexOf(item.status);
		if (event.key === 'ArrowRight' && index < ACTION_STATUSES.length - 1) {
			event.preventDefault();
			move(item, ACTION_STATUSES[index + 1]);
		} else if (event.key === 'ArrowLeft' && index > 0) {
			event.preventDefault();
			move(item, ACTION_STATUSES[index - 1]);
		}
	}

	function clearFilters() {
		app.filters.assigneeId = null;
		app.filters.meetingId = null;
		app.filters.priority = null;
		app.filters.due = null;
		app.filters.search = '';
	}

	const hasFilters = $derived(
		!!(
			app.filters.assigneeId ||
			app.filters.meetingId ||
			app.filters.priority ||
			app.filters.due ||
			app.filters.search
		)
	);

	const PRIORITY_STYLE: Record<string, string> = {
		high: 'mf-badge-danger',
		medium: 'mf-badge-warn',
		low: 'mf-badge-neutral'
	};
</script>

<svelte:head>
	<title>Action items · MeetFlow</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
	<PageHeader
		title="Action items"
		subtitle="{totalOpen} open{overdueCount > 0 ? ` · ${overdueCount} overdue` : ''} · {app
			.actionItems.length} total"
	>
		<button
			type="button"
			class="mf-btn mf-btn-primary"
			onclick={() => {
				editing = null;
				dialogOpen = true;
			}}
		>
			<Icon name="plus" size={17} />
			New action item
		</button>
	</PageHeader>

	<!-- ---------------- filters ---------------- -->
	<div class="mf-card mb-5 p-3 sm:p-4">
		<div class="flex flex-wrap items-end gap-3">
			<div class="min-w-[12rem] flex-1">
				<label class="mf-label" for="mf-search">Search</label>
				<input
					id="mf-search"
					class="mf-field"
					style="min-height:2.5rem"
					placeholder="Search tasks"
					bind:value={app.filters.search}
				/>
			</div>
			<div>
				<label class="mf-label" for="mf-filter-person">Person</label>
				<select
					id="mf-filter-person"
					class="mf-field w-auto"
					style="min-height:2.5rem"
					value={app.filters.assigneeId ?? ''}
					onchange={(e) => (app.filters.assigneeId = e.currentTarget.value || null)}
				>
					<option value="">Anyone</option>
					{#each app.contacts as contact (contact.id)}
						<option value={contact.id}>{contact.name}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="mf-label" for="mf-filter-meeting">Meeting</label>
				<select
					id="mf-filter-meeting"
					class="mf-field w-auto max-w-[14rem]"
					style="min-height:2.5rem"
					value={app.filters.meetingId ?? ''}
					onchange={(e) => (app.filters.meetingId = e.currentTarget.value || null)}
				>
					<option value="">Any meeting</option>
					{#each meetingsWithItems as meeting (meeting.id)}
						<option value={meeting.id}>{meeting.title}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="mf-label" for="mf-filter-due">Due</label>
				<select
					id="mf-filter-due"
					class="mf-field w-auto"
					style="min-height:2.5rem"
					value={app.filters.due ?? ''}
					onchange={(e) =>
						(app.filters.due = (e.currentTarget.value || null) as typeof app.filters.due)}
				>
					<option value="">Any time</option>
					<option value="overdue">Overdue</option>
					<option value="today">Today</option>
					<option value="week">Next 7 days</option>
				</select>
			</div>
			<div>
				<label class="mf-label" for="mf-filter-priority">Priority</label>
				<select
					id="mf-filter-priority"
					class="mf-field w-auto"
					style="min-height:2.5rem"
					value={app.filters.priority ?? ''}
					onchange={(e) =>
						(app.filters.priority = (e.currentTarget.value || null) as typeof app.filters.priority)}
				>
					<option value="">Any</option>
					<option value="high">High</option>
					<option value="medium">Medium</option>
					<option value="low">Low</option>
				</select>
			</div>
			{#if hasFilters}
				<button type="button" class="mf-btn mf-btn-ghost mf-btn-sm" onclick={clearFilters}>
					<Icon name="close" size={15} />
					Clear
				</button>
			{/if}
		</div>
	</div>

	<p class="mb-3 text-xs" style="color:var(--text-subtle)">
		Drag a card between columns, or focus a card and press Alt + arrow left / right.
	</p>

	<!-- ---------------- board ---------------- -->
	<div class="grid gap-3 md:grid-cols-3">
		{#each ACTION_STATUSES as status}
			{@const items = columns[status]}
			<section
				class="mf-card flex min-h-[18rem] flex-col p-3 transition-colors {dragOverColumn === status
					? 'mf-drop-target'
					: ''}"
				ondragover={(e) => {
					e.preventDefault();
					dragOverColumn = status;
				}}
				ondragleave={() => {
					if (dragOverColumn === status) dragOverColumn = null;
				}}
				ondrop={(e) => onDrop(e, status)}
				aria-label="{ACTION_STATUS_LABELS[status]} column, {items.length} items"
			>
				<header class="mb-2.5 flex items-center justify-between gap-2">
					<h2 class="text-sm font-semibold">{ACTION_STATUS_LABELS[status]}</h2>
					<span class="mf-badge mf-badge-neutral tabular-nums">{items.length}</span>
				</header>

				{#if items.length === 0}
					<div class="flex flex-1 items-center justify-center">
						<EmptyState
							compact
							icon={status === 'done' ? 'check-circle' : 'list'}
							title={status === 'done' ? 'Nothing finished yet' : 'Nothing here'}
							description={hasFilters ? 'No items match the current filters.' : ''}
						/>
					</div>
				{:else}
					<ul class="space-y-2">
						{#each items as item (item.id)}
							{@const overdue = isOverdue(item, app.today)}
							{@const assignee = app.contact(item.assigneeId)}
							{@const meeting = app.meeting(item.meetingId)}
							<li>
								<div
									class="mf-card mf-card-hover p-2.5 {dragId === item.id ? 'mf-dragging' : ''}"
									draggable="true"
									role="group"
									aria-label="{item.title} - in {ACTION_STATUS_LABELS[
										item.status
									]}. Press Alt with arrow left or right to move."
									ondragstart={(e) => {
										dragId = item.id;
										e.dataTransfer?.setData('text/plain', item.id);
									}}
									ondragend={() => {
										dragId = null;
										dragOverColumn = null;
									}}
									ondblclick={() => {
										editing = item;
										dialogOpen = true;
									}}
								>
									<div class="flex items-start gap-2">
										<button
											type="button"
											class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors"
											style="border-color:var(--border-strong);{item.status === 'done'
												? 'background:var(--ok);border-color:var(--ok);color:#fff'
												: ''}"
											onclick={() => move(item, item.status === 'done' ? 'todo' : 'done')}
											onkeydown={(e) => onCardKeydown(e, item)}
											aria-label="Mark &quot;{item.title}&quot; as {item.status === 'done'
												? 'not done'
												: 'done'}. In {ACTION_STATUS_LABELS[
												item.status
											]}; press Alt with arrow left or right to move."
											aria-pressed={item.status === 'done'}
										>
											{#if item.status === 'done'}<Icon name="check" size={10} />{/if}
										</button>

										<p
											class="min-w-0 flex-1 text-sm leading-snug"
											style={item.status === 'done' ? 'text-decoration:line-through;opacity:0.65' : ''}
										>
											{item.title}
										</p>
									</div>

									<div class="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
										{#if assignee}
											<span class="flex items-center gap-1">
												<Avatar name={assignee.name} hue={assignee.hue} size={18} />
												<span class="text-[0.6875rem]" style="color:var(--text-subtle)">
													{assignee.name.split(' ')[0]}
												</span>
											</span>
										{:else}
											<span class="mf-badge mf-badge-neutral">Unassigned</span>
										{/if}

										{#if item.dueDate}
											<span
												class="text-[0.6875rem]"
												style="color:{overdue ? 'var(--danger)' : 'var(--text-subtle)'}"
											>
												{overdue ? '⚠ ' : ''}{item.dueDate}
											</span>
										{/if}

										<span class="mf-badge {PRIORITY_STYLE[item.priority]} ml-auto capitalize">
											{item.priority}
										</span>
									</div>

									{#if meeting}
										<a
											href="{ROUTES.meeting}?id={meeting.id}"
											class="mt-1.5 block truncate pl-6 text-[0.625rem] hover:underline"
											style="color:var(--text-subtle)"
										>
											from {meeting.title}
										</a>
									{/if}

									{#if item.sourceLine}
										<p
											class="mt-1 truncate pl-6 text-[0.625rem] italic"
											style="color:var(--text-subtle)"
											title={item.sourceLine}
										>
											“{item.sourceLine}”
										</p>
									{/if}

									<!-- keyboard-accessible move controls -->
									<div class="mt-2 flex items-center gap-1 pl-6">
										{#each ACTION_STATUSES.filter((s) => s !== item.status) as target}
											<button
												type="button"
												class="rounded px-1.5 py-0.5 text-[0.625rem] font-medium transition-colors hover:bg-[var(--surface-hover)]"
												style="color:var(--text-subtle)"
												onclick={() => move(item, target)}
											>
												→ {ACTION_STATUS_LABELS[target]}
											</button>
										{/each}
										<button
											type="button"
											class="ml-auto rounded px-1 py-0.5"
											style="color:var(--text-subtle)"
											onclick={() => {
												editing = item;
												dialogOpen = true;
											}}
											aria-label="Edit &quot;{item.title}&quot;"
										>
											<Icon name="edit" size={13} />
										</button>
										<button
											type="button"
											class="rounded px-1 py-0.5"
											style="color:var(--text-subtle)"
											onclick={() => {
												app.deleteActionItem(item.id);
												app.showToast('Action item deleted');
											}}
											aria-label="Delete &quot;{item.title}&quot;"
										>
											<Icon name="trash" size={13} />
										</button>
									</div>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	</div>

	<p class="mf-sr-only" role="status" aria-live="polite">{liveMessage}</p>
</div>

<ActionItemDialog
	open={dialogOpen}
	meetingId={editing?.meetingId ?? app.filters.meetingId ?? null}
	existing={editing}
	onClose={() => {
		dialogOpen = false;
		editing = null;
	}}
/>
