<script lang="ts">
	/**
	 * Agenda builder: add topics with time allocations, reorder, and check the total against
	 * the meeting duration.
	 *
	 * Reordering has TWO complete paths, because drag-and-drop alone is not accessible:
	 *  - pointer drag via the HTML5 drag events on the grip handle
	 *  - keyboard: focus a row's move buttons, or press Alt+ArrowUp / Alt+ArrowDown anywhere
	 *    in the row
	 * Both call the same `reorder()` helper, so they cannot drift apart. Both are tested.
	 */
	import type { AgendaTopic } from '#lib/types';
	import { app } from '#lib/stores/app.svelte';
	import { agendaOffsets, agendaTiming, reorder } from '#lib/logic/schedule';
	import { formatDuration } from '#lib/logic/time';
	import { makeId } from '#lib/logic/notes';
	import Icon from './Icon.svelte';
	import EmptyState from './EmptyState.svelte';

	interface Props {
		topics: AgendaTopic[];
		durationMinutes: number;
		onChange: (topics: AgendaTopic[]) => void;
	}
	let { topics, durationMinutes, onChange }: Props = $props();

	let newTitle = $state('');
	let newMinutes = $state(10);
	let dragIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);
	/** Announced to screen readers after a keyboard move. */
	let liveMessage = $state('');

	const timing = $derived(agendaTiming(topics, durationMinutes));
	const offsets = $derived(agendaOffsets(topics));

	function addTopic() {
		const title = newTitle.trim();
		if (!title) return;
		onChange([
			...topics,
			{ id: makeId('t'), title, minutes: Math.max(1, Math.round(newMinutes) || 5) }
		]);
		newTitle = '';
		newMinutes = 10;
	}

	function updateTopic(id: string, patch: Partial<AgendaTopic>) {
		onChange(topics.map((t) => (t.id === id ? { ...t, ...patch } : t)));
	}

	function removeTopic(id: string) {
		onChange(topics.filter((t) => t.id !== id));
	}

	function move(from: number, to: number) {
		if (to < 0 || to >= topics.length) return;
		onChange(reorder(topics, from, to));
		liveMessage = `${topics[from].title} moved to position ${to + 1} of ${topics.length}.`;
		// Keep focus on the moved row's handle so repeated presses keep working.
		requestAnimationFrame(() => {
			document.querySelector<HTMLElement>(`[data-mf-agenda-row="${to}"] [data-mf-move-up]`)?.focus();
		});
	}

	function onRowKeydown(event: KeyboardEvent, index: number) {
		// Alt+Arrow is the documented keyboard alternative to dragging.
		if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
			event.preventDefault();
			move(index, index + (event.key === 'ArrowUp' ? -1 : 1));
		}
	}

	function onDragStart(event: DragEvent, index: number) {
		dragIndex = index;
		event.dataTransfer?.setData('text/plain', String(index));
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function onDragOver(event: DragEvent, index: number) {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dragOverIndex = index;
	}

	function onDrop(event: DragEvent, index: number) {
		event.preventDefault();
		const from = dragIndex ?? Number(event.dataTransfer?.getData('text/plain'));
		if (Number.isInteger(from)) move(from, index);
		dragIndex = null;
		dragOverIndex = null;
	}

	function onDragEnd() {
		dragIndex = null;
		dragOverIndex = null;
	}
</script>

<div>
	<!-- ---------------- timing summary ---------------- -->
	<div
		class="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm"
		style="background:{timing.status === 'over'
			? 'var(--warn-soft)'
			: 'var(--surface-sunken)'};color:{timing.status === 'over' ? 'var(--warn)' : 'var(--text-muted)'}"
		role="status"
	>
		<span class="flex items-center gap-2 font-medium">
			{#if timing.status === 'over'}
				<Icon name="warning" size={16} />
			{:else if timing.status === 'exact'}
				<Icon name="check-circle" size={16} />
			{:else}
				<Icon name="clock" size={16} />
			{/if}
			{timing.message}
		</span>
		<span class="tabular-nums">
			{formatDuration(timing.allocatedMinutes)} of {formatDuration(durationMinutes)} allocated
		</span>
	</div>

	<!-- ---------------- topic rows ---------------- -->
	{#if topics.length === 0}
		<div class="mf-card mb-3">
			<EmptyState
				compact
				icon="list"
				title="No agenda yet"
				description="Meetings with an agenda finish on time more often. Add your first topic below."
			/>
		</div>
	{:else}
		<ul class="mb-3 space-y-1.5">
			{#each topics as topic, index (topic.id)}
				<li data-mf-agenda-row={index}>
					<!--
						Drag/key handlers live on this inner group rather than the <li> itself: a list
						item is non-interactive semantics, so attaching them there is an a11y error.
						The group is labelled and contains the real controls (text inputs and the move
						buttons) that keyboard users operate; dragging is a pointer-only enhancement.
					-->
					<div
						role="group"
						aria-label="Agenda topic {index + 1}: {topic.title || 'untitled'}"
						class="mf-card flex items-start gap-2 p-2 {dragIndex === index
							? 'mf-dragging'
							: ''} {dragOverIndex === index && dragIndex !== index ? 'mf-drop-target' : ''}"
						draggable="true"
						ondragstart={(e) => onDragStart(e, index)}
						ondragover={(e) => onDragOver(e, index)}
						ondrop={(e) => onDrop(e, index)}
						ondragend={onDragEnd}
					>
					<!-- grip + keyboard move buttons -->
					<div class="flex shrink-0 flex-col items-center">
						<span
							class="cursor-grab px-1 pt-1"
							style="color:var(--text-subtle)"
							aria-hidden="true"
							title="Drag to reorder"
						>
							<Icon name="grip" size={16} />
						</span>
						<div class="flex flex-col">
							<button
								type="button"
								data-mf-move-up
								class="px-1 transition-colors disabled:opacity-25"
								style="color:var(--text-subtle)"
								onclick={() => move(index, index - 1)}
								onkeydown={(e) => onRowKeydown(e, index)}
								disabled={index === 0}
								aria-label="Move &quot;{topic.title}&quot; up"
							>
								<Icon name="chevron-up" size={13} />
							</button>
							<button
								type="button"
								class="px-1 transition-colors disabled:opacity-25"
								style="color:var(--text-subtle)"
								onclick={() => move(index, index + 1)}
								onkeydown={(e) => onRowKeydown(e, index)}
								disabled={index === topics.length - 1}
								aria-label="Move &quot;{topic.title}&quot; down"
							>
								<Icon name="chevron-down" size={13} />
							</button>
						</div>
					</div>

					<div class="min-w-0 flex-1 space-y-1.5">
						<input
							class="mf-field"
							style="min-height:2.25rem"
							value={topic.title}
							oninput={(e) => updateTopic(topic.id, { title: e.currentTarget.value })}
							onkeydown={(e) => onRowKeydown(e, index)}
							placeholder="Topic title"
							aria-label="Topic {index + 1} title"
						/>
						<div class="flex flex-wrap items-center gap-2">
							<label class="flex items-center gap-1.5 text-xs" style="color:var(--text-subtle)">
								<span class="mf-sr-only">Minutes for {topic.title}</span>
								<input
									class="mf-field w-20 tabular-nums"
									style="min-height:2rem"
									type="number"
									min="1"
									max="480"
									value={topic.minutes}
									oninput={(e) =>
										updateTopic(topic.id, {
											minutes: Math.max(1, Number(e.currentTarget.value) || 1)
										})}
								/>
								min
							</label>

							<label class="flex items-center gap-1.5 text-xs" style="color:var(--text-subtle)">
								<span class="mf-sr-only">Owner of {topic.title}</span>
								<select
									class="mf-field w-auto"
									style="min-height:2rem"
									value={topic.owner ?? ''}
									onchange={(e) =>
										updateTopic(topic.id, { owner: e.currentTarget.value || undefined })}
								>
									<option value="">No owner</option>
									{#each app.contacts as contact (contact.id)}
										<option value={contact.id}>{contact.name}</option>
									{/each}
								</select>
							</label>

							<span class="ml-auto text-xs tabular-nums" style="color:var(--text-subtle)">
								starts +{formatDuration(offsets[index])}
							</span>
						</div>
					</div>

					<button
						type="button"
						class="mf-btn mf-btn-ghost shrink-0 px-2"
						style="min-height:2.25rem"
						onclick={() => removeTopic(topic.id)}
							aria-label="Remove &quot;{topic.title}&quot;"
						>
							<Icon name="trash" size={15} />
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<!-- ---------------- add row ---------------- -->
	<div class="flex flex-col gap-2 sm:flex-row">
		<div class="flex-1">
			<label class="mf-sr-only" for="mf-new-topic">New topic title</label>
			<input
				id="mf-new-topic"
				class="mf-field"
				placeholder="Add a topic, e.g. Review last sprint"
				bind:value={newTitle}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						addTopic();
					}
				}}
			/>
		</div>
		<label class="flex items-center gap-1.5 text-sm" style="color:var(--text-subtle)" for="mf-new-topic-minutes">
			<span class="mf-sr-only">Minutes for the new topic</span>
			<input
				id="mf-new-topic-minutes"
				class="mf-field w-20 tabular-nums"
				type="number"
				min="1"
				max="480"
				bind:value={newMinutes}
				aria-label="Minutes for the new topic"
			/>
			min
		</label>
		<button type="button" class="mf-btn mf-btn-secondary" onclick={addTopic} disabled={!newTitle.trim()}>
			<Icon name="plus" size={16} />
			Add topic
		</button>
	</div>

	<p class="mt-2 text-xs" style="color:var(--text-subtle)">
		Drag the handle to reorder, or focus a row and press Alt + arrow up / down.
	</p>

	<!-- Keyboard moves are announced, since the visual reorder is not perceivable otherwise. -->
	<p class="mf-sr-only" role="status" aria-live="polite">{liveMessage}</p>
</div>
