<script lang="ts">
	/**
	 * Rich-text notes editor with autosave and per-line action-item creation.
	 *
	 * contenteditable, deliberately: it gives real rich text (bold, lists, headings) with no
	 * dependency. Everything that comes out of it is sanitised through `sanitiseHtml` before
	 * it is stored, so a pasted <script> or <img onerror> cannot survive - that is asserted
	 * in the browser probe, not just in unit tests.
	 *
	 * The editor is UNCONTROLLED once mounted: writing `innerHTML` back on every keystroke
	 * would destroy the caret position. It is seeded once per meeting and thereafter only
	 * read from.
	 */
	import { tick } from 'svelte';
	import { app } from '#lib/stores/app.svelte';
	import { htmlToLines, sanitiseHtml, suggestActionFromLine, wordCount } from '#lib/logic/notes';
	import { formatTime } from '#lib/logic/time';
	import Icon from './Icon.svelte';

	interface Props {
		meetingId: string;
		/** Compact chrome for the room's side panel. */
		compact?: boolean;
		onCreateAction?: (line: string) => void;
	}
	let { meetingId, compact = false, onCreateAction }: Props = $props();

	let editor = $state<HTMLDivElement | null>(null);
	let seededFor = $state<string | null>(null);
	let status = $state<'idle' | 'saving' | 'saved'>('idle');
	let words = $state(0);
	let lines = $state<string[]>([]);
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	const note = $derived(app.notesFor(meetingId));
	const lastSaved = $derived(note?.updatedAt ?? null);

	/** Seed once per meeting, never on every store tick. */
	$effect(() => {
		if (!editor || seededFor === meetingId) return;
		const existing = app.notesFor(meetingId);
		editor.innerHTML = existing?.html ?? '';
		seededFor = meetingId;
		refresh();
	});

	function refresh() {
		if (!editor) return;
		const html = editor.innerHTML;
		words = wordCount(html);
		lines = htmlToLines(html);
	}

	/** Debounced autosave. 600ms is long enough not to thrash, short enough to feel safe. */
	function onInput() {
		refresh();
		status = 'saving';
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			if (!editor) return;
			app.saveNotes(meetingId, editor.innerHTML);
			status = 'saved';
			setTimeout(() => {
				if (status === 'saved') status = 'idle';
			}, 1800);
		}, 600);
	}

	/** Flush immediately - called on blur and before leaving the room. */
	export function flush() {
		if (saveTimer) clearTimeout(saveTimer);
		if (editor) app.saveNotes(meetingId, editor.innerHTML);
		status = 'saved';
	}

	/**
	 * Paste as PLAIN TEXT.
	 *
	 * Pasting from a web page otherwise drags in arbitrary markup, styles and scripts. The
	 * sanitiser would strip it on save, but the editor would briefly render it - so it is
	 * intercepted here as well.
	 */
	function onPaste(event: ClipboardEvent) {
		event.preventDefault();
		const text = event.clipboardData?.getData('text/plain') ?? '';
		document.execCommand('insertText', false, text);
		onInput();
	}

	function format(command: string, value?: string) {
		editor?.focus();
		document.execCommand(command, false, value);
		onInput();
	}

	function onKeydown(event: KeyboardEvent) {
		// Keep the usual rich-text shortcuts working inside the editor.
		if (!(event.metaKey || event.ctrlKey)) return;
		const map: Record<string, string> = { b: 'bold', i: 'italic', u: 'underline' };
		const command = map[event.key.toLowerCase()];
		if (command) {
			event.preventDefault();
			format(command);
		}
	}

	const TOOLS = [
		{ command: 'bold', icon: 'edit', label: 'Bold', text: 'B' },
		{ command: 'italic', icon: 'edit', label: 'Italic', text: 'I' },
		{ command: 'insertUnorderedList', icon: 'list', label: 'Bulleted list', text: '' },
		{ command: 'insertOrderedList', icon: 'list', label: 'Numbered list', text: '' }
	];
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<!-- ---------------- toolbar ---------------- -->
	<div
		class="flex flex-wrap items-center gap-1 border-b pb-2"
		style="border-color:var(--border)"
		role="toolbar"
		aria-label="Text formatting"
	>
		<button
			type="button"
			class="mf-btn mf-btn-ghost mf-btn-sm px-2 font-bold"
			onclick={() => format('bold')}
			aria-label="Bold"
			title="Bold (Ctrl+B)"
		>
			B
		</button>
		<button
			type="button"
			class="mf-btn mf-btn-ghost mf-btn-sm px-2 italic"
			onclick={() => format('italic')}
			aria-label="Italic"
			title="Italic (Ctrl+I)"
		>
			I
		</button>
		<button
			type="button"
			class="mf-btn mf-btn-ghost mf-btn-sm px-2"
			onclick={() => format('formatBlock', 'h3')}
			aria-label="Heading"
			title="Heading"
		>
			H
		</button>
		<button
			type="button"
			class="mf-btn mf-btn-ghost mf-btn-sm px-2"
			onclick={() => format('insertUnorderedList')}
			aria-label="Bulleted list"
			title="Bulleted list"
		>
			<Icon name="list" size={15} />
		</button>

		<span class="ml-auto flex items-center gap-2 text-xs" style="color:var(--text-subtle)">
			{#if status === 'saving'}
				<span class="flex items-center gap-1">
					<span class="h-1.5 w-1.5 animate-pulse rounded-full" style="background:var(--warn)"></span>
					Saving
				</span>
			{:else if status === 'saved'}
				<span class="flex items-center gap-1" style="color:var(--ok)">
					<Icon name="check" size={13} />
					Saved
				</span>
			{:else if lastSaved}
				<span>Saved {formatTime(lastSaved, app.timezone)}</span>
			{/if}
			<span class="tabular-nums">{words} {words === 1 ? 'word' : 'words'}</span>
		</span>
	</div>

	<!-- ---------------- editor ---------------- -->
	<div
		bind:this={editor}
		contenteditable="true"
		role="textbox"
		aria-multiline="true"
		aria-label="Meeting notes"
		tabindex="0"
		class="mf-prose mf-scroll min-h-0 flex-1 overflow-y-auto py-3 focus:outline-none"
		style="min-height:{compact ? '8rem' : '16rem'}"
		oninput={onInput}
		onblur={flush}
		onpaste={onPaste}
		onkeydown={onKeydown}
		data-placeholder="Start typing. Each line can become an action item."
	></div>

	{#if words === 0}
		<p class="-mt-10 pointer-events-none px-0 text-sm" style="color:var(--text-subtle)">
			Start typing. Decisions and action items can be pulled straight from your lines.
		</p>
	{/if}

	<!-- ---------------- line -> action item ---------------- -->
	{#if lines.length > 0 && onCreateAction}
		<div class="border-t pt-2.5" style="border-color:var(--border)">
			<p class="mb-1.5 text-xs font-semibold" style="color:var(--text-subtle)">
				Turn a line into an action item
			</p>
			<ul class="mf-scroll max-h-32 space-y-1 overflow-y-auto">
				{#each lines.slice(0, 20) as line, i (line + i)}
					{@const suggestion = suggestActionFromLine(line, app.contacts)}
					<li>
						<button
							type="button"
							class="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--surface-hover)]"
							onclick={() => onCreateAction?.(line)}
							title="Create an action item from this line"
						>
							<span class="mt-0.5 shrink-0" style="color:var(--accent)">
								<Icon name="plus" size={13} />
							</span>
							<span class="min-w-0 flex-1 truncate">{suggestion.title || line}</span>
							{#if suggestion.assigneeId}
								<span class="mf-badge mf-badge-accent shrink-0">
									{app.contactName(suggestion.assigneeId).split(' ')[0]}
								</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

<style>
	/* Placeholder for the empty contenteditable, since it cannot use ::placeholder. */
	[contenteditable][data-placeholder]:empty::before {
		content: '';
	}
</style>
