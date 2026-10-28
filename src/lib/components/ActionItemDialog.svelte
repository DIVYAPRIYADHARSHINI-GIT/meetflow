<script lang="ts">
	/**
	 * Create or edit an action item.
	 *
	 * When opened from a note line, the fields are pre-filled by `suggestActionFromLine` and
	 * the original line is stored as `sourceLine` for traceability back to the discussion.
	 */
	import type { ActionItem, Priority } from '#lib/types';
	import { app } from '#lib/stores/app.svelte';
	import { suggestActionFromLine } from '#lib/logic/notes';
	import { addDays } from '#lib/logic/time';
	import Modal from './Modal.svelte';

	interface Props {
		open: boolean;
		meetingId: string | null;
		/** Note line this came from, when created from notes. */
		sourceLine?: string;
		/** Existing item when editing. */
		existing?: ActionItem | null;
		onClose: () => void;
	}
	let { open, meetingId, sourceLine = '', existing = null, onClose }: Props = $props();

	let title = $state('');
	let assigneeId = $state('');
	let dueDate = $state('');
	let priority = $state<Priority>('medium');
	let seededKey = $state('');

	/** Seed when the dialog opens, keyed so reopening with a different line re-seeds. */
	$effect(() => {
		const key = `${open}|${existing?.id ?? ''}|${sourceLine}`;
		if (!open || key === seededKey) return;
		seededKey = key;

		if (existing) {
			title = existing.title;
			assigneeId = existing.assigneeId ?? '';
			dueDate = existing.dueDate ?? '';
			priority = existing.priority;
		} else if (sourceLine) {
			const suggestion = suggestActionFromLine(sourceLine, app.contacts);
			title = suggestion.title;
			assigneeId = suggestion.assigneeId ?? '';
			priority = suggestion.priority;
			// Default to end of week: a due date people actually set, rather than blank.
			dueDate = addDays(app.today, 3);
		} else {
			title = '';
			assigneeId = '';
			priority = 'medium';
			dueDate = addDays(app.today, 3);
		}
	});

	function save() {
		if (!title.trim()) return;
		if (existing) {
			app.updateActionItem(existing.id, {
				title: title.trim(),
				assigneeId: assigneeId || null,
				dueDate: dueDate || null,
				priority
			});
			app.showToast('Action item updated');
		} else {
			app.createActionItem({
				meetingId,
				title,
				assigneeId: assigneeId || null,
				dueDate: dueDate || null,
				priority,
				...(sourceLine ? { sourceLine } : {})
			});
			app.showToast('Action item created');
		}
		onClose();
	}
</script>

<Modal
	{open}
	title={existing ? 'Edit action item' : 'New action item'}
	description={sourceLine ? `From your notes: "${sourceLine.slice(0, 90)}"` : ''}
	{onClose}
>
	<div class="space-y-4">
		<div>
			<label class="mf-label" for="mf-action-title">Task</label>
			<input
				id="mf-action-title"
				class="mf-field"
				bind:value={title}
				placeholder="What needs doing?"
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						save();
					}
				}}
			/>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<div>
				<label class="mf-label" for="mf-action-assignee">Assignee</label>
				<select id="mf-action-assignee" class="mf-field" bind:value={assigneeId}>
					<option value="">Unassigned</option>
					{#each app.contacts as contact (contact.id)}
						<option value={contact.id}>{contact.name}</option>
					{/each}
				</select>
			</div>
			<div>
				<label class="mf-label" for="mf-action-due">Due date</label>
				<input id="mf-action-due" class="mf-field" type="date" bind:value={dueDate} />
			</div>
		</div>

		<div>
			<span class="mf-label">Priority</span>
			<div class="flex gap-1.5" role="group" aria-label="Priority">
				{#each ['low', 'medium', 'high'] as level}
					<button
						type="button"
						class="mf-chip capitalize transition-colors"
						style={priority === level
							? 'background:var(--accent);color:var(--accent-contrast);border-color:var(--accent)'
							: ''}
						onclick={() => (priority = level as Priority)}
						aria-pressed={priority === level}
					>
						{level}
					</button>
				{/each}
			</div>
		</div>

		{#if meetingId}
			<p class="text-xs" style="color:var(--text-subtle)">
				Linked to {app.meeting(meetingId)?.title ?? 'this meeting'}, so it appears on its summary.
			</p>
		{/if}
	</div>

	{#snippet footer()}
		<button type="button" class="mf-btn mf-btn-ghost" onclick={onClose}>Cancel</button>
		<button type="button" class="mf-btn mf-btn-primary" onclick={save} disabled={!title.trim()}>
			{existing ? 'Save changes' : 'Create action item'}
		</button>
	{/snippet}
</Modal>
