<script lang="ts">
	/**
	 * Accessible modal dialog.
	 *
	 * Focus is trapped while open, Escape closes, focus returns to whatever opened it, and
	 * the backdrop click closes too. Used by the action-item composer, invite dialog and
	 * shortcuts overlay.
	 */
	import { tick } from 'svelte';
	import Icon from './Icon.svelte';

	interface Props {
		open: boolean;
		title: string;
		description?: string;
		onClose: () => void;
		size?: 'sm' | 'md' | 'lg';
		children?: import('svelte').Snippet;
		footer?: import('svelte').Snippet;
	}

	let { open, title, description = '', onClose, size = 'md', children, footer }: Props = $props();

	let dialogEl = $state<HTMLDivElement | null>(null);
	let previouslyFocused: HTMLElement | null = null;

	const WIDTHS = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' };

	$effect(() => {
		if (open) {
			previouslyFocused = document.activeElement as HTMLElement;
			document.body.style.overflow = 'hidden';
			tick().then(() => {
				// Focus the first interactive element, or the dialog itself.
				const target = dialogEl?.querySelector<HTMLElement>(
					'input:not([type=hidden]), textarea, select, button, [href], [tabindex]:not([tabindex="-1"])'
				);
				(target ?? dialogEl)?.focus();
			});
		} else {
			document.body.style.overflow = '';
			previouslyFocused?.focus?.();
		}
		return () => {
			document.body.style.overflow = '';
		};
	});

	function onKeydown(event: KeyboardEvent) {
		if (!open) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			onClose();
			return;
		}
		if (event.key !== 'Tab' || !dialogEl) return;

		// Focus trap: cycle within the dialog so Tab can never escape to the page behind.
		const focusables = Array.from(
			dialogEl.querySelectorAll<HTMLElement>(
				'input:not([type=hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
			)
		).filter((el) => el.offsetParent !== null || el === document.activeElement);
		if (focusables.length === 0) return;

		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
	<div class="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
		<!-- Backdrop. Click-to-close is a convenience; Escape is the accessible path. -->
		<button
			type="button"
			class="absolute inset-0 cursor-default"
			style="background:rgb(15 23 42 / 0.45);backdrop-filter:blur(2px)"
			onclick={onClose}
			tabindex="-1"
			aria-label="Close dialog"
		></button>

		<div
			bind:this={dialogEl}
			role="dialog"
			aria-modal="true"
			aria-label={title}
			aria-describedby={description ? 'mf-modal-desc' : undefined}
			tabindex="-1"
			class="mf-card relative w-full {WIDTHS[size]} max-h-[92vh] overflow-y-auto mf-scroll rounded-b-none sm:rounded-b-2xl"
			style="box-shadow:var(--shadow-overlay)"
		>
			<header
				class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b px-5 py-4"
				style="border-color:var(--border);background:var(--surface-raised)"
			>
				<div class="min-w-0">
					<h2 class="text-base font-semibold">{title}</h2>
					{#if description}
						<p id="mf-modal-desc" class="mt-0.5 text-sm" style="color:var(--text-subtle)">
							{description}
						</p>
					{/if}
				</div>
				<button
					type="button"
					class="mf-btn mf-btn-ghost -mr-2 -mt-1 shrink-0 px-2"
					style="min-height:2.25rem"
					onclick={onClose}
					aria-label="Close dialog"
				>
					<Icon name="close" size={18} />
				</button>
			</header>

			<div class="px-5 py-4">
				{@render children?.()}
			</div>

			{#if footer}
				<footer
					class="sticky bottom-0 flex items-center justify-end gap-2 border-t px-5 py-3.5"
					style="border-color:var(--border);background:var(--surface-raised)"
				>
					{@render footer()}
				</footer>
			{/if}
		</div>
	</div>
{/if}
