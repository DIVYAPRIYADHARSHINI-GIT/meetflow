<script lang="ts">
	/**
	 * Month-grid mini calendar with a dot per meeting.
	 *
	 * Reads occurrences straight from the store, so a meeting created anywhere in the app
	 * puts a dot here without any wiring. Fully keyboard navigable: arrows move the focused
	 * day, Enter selects.
	 */
	import { untrack } from 'svelte';
	import { app } from '#lib/stores/app.svelte';
	import {
		addDays,
		addMonths,
		civilDateOf,
		formatCivilDate,
		monthGrid,
		startOfMonth
	} from '#lib/logic/time';
	import Icon from './Icon.svelte';

	interface Props {
		/** Selected civil date. */
		value: string;
		onSelect: (date: string) => void;
		class?: string;
	}
	let { value, onSelect, class: klass = '' }: Props = $props();

	/**
	 * The month being displayed, which can differ from the selected date (you can page
	 * through months without selecting a day).
	 *
	 * Initialised from an untracked read of `value`: reading a prop directly in a $state
	 * initialiser captures only its first value, which Svelte warns about. The $effect below
	 * is the real synchronisation path.
	 */
	let viewMonth = $state(startOfMonth(untrack(() => value)));

	// Follow the selection when it jumps to another month (e.g. the "Today" button, or a
	// date chosen on another page - the focus date lives in the store).
	$effect(() => {
		const target = startOfMonth(value);
		if (target !== untrack(() => viewMonth)) viewMonth = target;
	});

	const grid = $derived(monthGrid(viewMonth));
	/** The same 42 days, chunked into the 6 ARIA rows the grid role requires. */
	const weeks = $derived(
		Array.from({ length: 6 }, (_, i) => grid.slice(i * 7, i * 7 + 7))
	);
	const todayDate = $derived(app.today);
	const monthLabel = $derived(
		new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
			new Date(`${viewMonth}T00:00:00.000Z`)
		)
	);

	/** Meeting counts per day for the visible grid. Derived once per month change. */
	const dots = $derived.by(() => {
		const map = new Map<string, number>();
		for (const day of grid) {
			const count = app.occurrencesOn(day).length;
			if (count) map.set(day, count);
		}
		return map;
	});

	function inMonth(day: string): boolean {
		return day.slice(0, 7) === viewMonth.slice(0, 7);
	}

	function onGridKeydown(event: KeyboardEvent, day: string) {
		const moves: Record<string, number> = {
			ArrowLeft: -1,
			ArrowRight: 1,
			ArrowUp: -7,
			ArrowDown: 7
		};
		const delta = moves[event.key];
		if (delta !== undefined) {
			event.preventDefault();
			const next = addDays(day, delta);
			onSelect(next);
			// Move focus with the selection so arrow-key navigation is continuous.
			requestAnimationFrame(() => {
				document.querySelector<HTMLElement>(`[data-mf-day="${next}"]`)?.focus();
			});
		} else if (event.key === 'Home') {
			event.preventDefault();
			onSelect(startOfMonth(day));
		} else if (event.key === 'PageUp' || event.key === 'PageDown') {
			event.preventDefault();
			onSelect(addMonths(day, event.key === 'PageUp' ? -1 : 1));
		}
	}
</script>

<div class={klass}>
	<div class="mb-2 flex items-center justify-between gap-2">
		<h3 class="text-sm font-semibold">{monthLabel}</h3>
		<div class="flex items-center gap-0.5">
			<button
				type="button"
				class="mf-btn mf-btn-ghost px-1.5"
				style="min-height:2rem"
				onclick={() => (viewMonth = addMonths(viewMonth, -1))}
				aria-label="Previous month"
			>
				<Icon name="chevron-left" size={16} />
			</button>
			<button
				type="button"
				class="mf-btn mf-btn-ghost px-2 text-xs"
				style="min-height:2rem"
				onclick={() => onSelect(todayDate)}
			>
				Today
			</button>
			<button
				type="button"
				class="mf-btn mf-btn-ghost px-1.5"
				style="min-height:2rem"
				onclick={() => (viewMonth = addMonths(viewMonth, 1))}
				aria-label="Next month"
			>
				<Icon name="chevron-right" size={16} />
			</button>
		</div>
	</div>

<!--
		ARIA grids require a strict role hierarchy: grid > row > columnheader/gridcell. A flat
		CSS grid with cells as direct children is an aria-required-children AND
		aria-required-parent violation, so the weekday strip and each week are wrapped in
		`role="row"` elements that carry the CSS grid themselves.
	-->
	<div role="grid" aria-label="Calendar">
		<div class="grid grid-cols-7 gap-0.5" role="row">
			{#each ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as label, i}
				<div
					class="pb-1 text-center text-[0.6875rem] font-semibold"
					style="color:var(--text-subtle)"
					role="columnheader"
					aria-label={['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][i]}
				>
					{label}
				</div>
			{/each}
		</div>

		{#each weeks as week}
		<div class="grid grid-cols-7 gap-0.5" role="row">
		{#each week as day}
			{@const count = dots.get(day) ?? 0}
			{@const selected = day === value}
			{@const isToday = day === todayDate}
			<button
				type="button"
				data-mf-day={day}
				role="gridcell"
				aria-selected={selected}
				aria-label="{Number(day.slice(8, 10))} {formatCivilDate(day)}{count
					? `, ${count} meeting${count === 1 ? '' : 's'}`
					: ', no meetings'}"
				tabindex={selected ? 0 : -1}
				class="relative flex aspect-square flex-col items-center justify-center rounded-lg text-[0.8125rem] transition-colors"
				style={selected
					? 'background:var(--accent);color:var(--accent-contrast);font-weight:600'
					: isToday
						? 'background:var(--accent-soft);color:var(--accent-soft-text);font-weight:600'
						: inMonth(day)
							? 'color:var(--text)'
							: 'color:var(--text-subtle)'}
				onclick={() => onSelect(day)}
				onkeydown={(e) => onGridKeydown(e, day)}
			>
				{Number(day.slice(8, 10))}
				{#if count}
					<span class="absolute bottom-1 flex gap-0.5">
						{#each Array(Math.min(count, 3)) as _, i}
							<span
								class="h-1 w-1 rounded-full"
								style="background:{selected ? 'var(--accent-contrast)' : `var(--event-${i % 6})`}"
							></span>
						{/each}
					</span>
				{/if}
			</button>
		{/each}
		</div>
		{/each}
	</div>
</div>
