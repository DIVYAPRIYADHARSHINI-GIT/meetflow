<script lang="ts">
	/**
	 * Initials avatar. No image uploads anywhere in MeetFlow, so this is the only identity chip.
	 *
	 * Contrast: the initials are drawn in a DARKENED mix of the person's hue in light mode and
	 * a LIGHTENED mix in dark mode, rather than the raw hue. The raw accent on a 16%-tinted
	 * background measured 3.0-4.5:1 at 10px, which fails WCAG AA for small text - caught by the
	 * axe probe. Mixing toward the extreme keeps the colour identity while clearing 4.5:1.
	 *
	 * The element is also aria-hidden: every avatar in the app sits next to the person's real
	 * name, so announcing "MW" as well would just be noise.
	 */
	import { initialsOf } from '#lib/logic/notes';

	interface Props {
		name: string;
		hue?: number;
		size?: number;
		class?: string;
		/** Accent ring, used to mark the active speaker. */
		ring?: boolean;
		/** Surface-coloured outline, so overlapping avatars in a stack stay distinguishable. */
		stacked?: boolean;
	}

	let {
		name,
		hue = 0,
		size = 36,
		class: klass = '',
		ring = false,
		stacked = false
	}: Props = $props();

	const initials = $derived(initialsOf(name));
	const colour = $derived(`var(--event-${((hue % 6) + 6) % 6})`);
</script>

<span
	class="mf-avatar inline-flex shrink-0 items-center justify-center rounded-full font-semibold {klass}"
	style="--mf-avatar-hue:{colour};width:{size}px;height:{size}px;font-size:{Math.max(
		10,
		Math.round(size * 0.38)
	)}px;{ring
		? `box-shadow:0 0 0 2px ${colour}`
		: stacked
			? 'box-shadow:0 0 0 2px var(--surface-raised)'
			: ''}"
	title={name}
	aria-hidden="true"
>{initials}</span>

<style>
	.mf-avatar {
		background: color-mix(in srgb, var(--mf-avatar-hue) 15%, transparent);
		/* Darken toward black so small initials clear 4.5:1 on the tinted background. */
		color: color-mix(in srgb, var(--mf-avatar-hue) 62%, #000);
	}

	:global(.dark) .mf-avatar {
		background: color-mix(in srgb, var(--mf-avatar-hue) 22%, transparent);
		/* In dark mode the tint is dark, so the initials move toward white instead. */
		color: color-mix(in srgb, var(--mf-avatar-hue) 45%, #fff);
	}
</style>
