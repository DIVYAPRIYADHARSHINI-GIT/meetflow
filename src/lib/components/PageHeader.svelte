<script lang="ts">
	/** Consistent page heading block. Every inner page uses this so the h1 is never missing. */
	interface Props {
		title: string;
		subtitle?: string;
		children?: import('svelte').Snippet;
	}
	let { title, subtitle = '', children }: Props = $props();
</script>

<header class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
	<div class="min-w-0">
		<h1 class="text-2xl font-bold sm:text-[1.75rem]">{title}</h1>
		{#if subtitle}
			<p class="mt-1 text-sm" style="color:var(--text-muted)">{subtitle}</p>
		{/if}
	</div>
	{#if children}
		<div class="flex flex-wrap items-center gap-2">{@render children()}</div>
	{/if}
</header>
