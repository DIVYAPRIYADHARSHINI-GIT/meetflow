<script lang="ts">
	/** Friendly empty state. Every list in MeetFlow uses this rather than showing nothing. */
	import Icon from './Icon.svelte';

	interface Props {
		icon?: string;
		title: string;
		description?: string;
		actionLabel?: string;
		actionHref?: string;
		onAction?: () => void;
		compact?: boolean;
	}

	let {
		icon = 'sparkle',
		title,
		description = '',
		actionLabel = '',
		actionHref = '',
		onAction,
		compact = false
	}: Props = $props();
</script>

<div
	class="flex flex-col items-center justify-center text-center {compact ? 'px-4 py-8' : 'px-6 py-14'}"
>
	<span
		class="mb-4 flex items-center justify-center rounded-2xl"
		style="width:{compact ? 40 : 52}px;height:{compact
			? 40
			: 52}px;background:var(--accent-soft);color:var(--accent)"
	>
		<Icon name={icon} size={compact ? 20 : 26} />
	</span>
	<h3 class="{compact ? 'text-sm' : 'text-base'} font-semibold" style="color:var(--text)">
		{title}
	</h3>
	{#if description}
		<p
			class="mt-1.5 max-w-sm {compact ? 'text-xs' : 'text-sm'}"
			style="color:var(--text-subtle)"
		>
			{description}
		</p>
	{/if}
	{#if actionLabel && actionHref}
		<a href={actionHref} class="mf-btn mf-btn-primary mf-btn-sm mt-4">{actionLabel}</a>
	{:else if actionLabel && onAction}
		<button type="button" class="mf-btn mf-btn-primary mf-btn-sm mt-4" onclick={onAction}>
			{actionLabel}
		</button>
	{/if}
</div>
