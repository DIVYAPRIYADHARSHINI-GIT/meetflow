<script lang="ts">
	/**
	 * Landing page. Prerendered to real HTML (not the SPA shell), so the hero copy and
	 * description are in the served markup for first paint and for anything reading it.
	 */
	import { ROUTES } from '#lib/nav';
	import { app } from '#lib/stores/app.svelte';
	import Icon from '#lib/components/Icon.svelte';

	const FEATURES = [
		{
			icon: 'calendar',
			title: 'Schedule with an agenda',
			body: 'Set the topics and their time allocations up front. MeetFlow checks the agenda against the meeting length and warns you before you overrun, not after.'
		},
		{
			icon: 'video',
			title: 'A room that runs the meeting',
			body: 'Test your camera and mic before you join, then follow the agenda live with a per-topic countdown while notes and chat sit beside the video.'
		},
		{
			icon: 'notes',
			title: 'Notes that become actions',
			body: 'Turn any note line into an assigned action item with a due date in one click. It appears on the board and in the summary immediately.'
		},
		{
			icon: 'check-circle',
			title: 'Nothing gets dropped',
			body: 'Decisions and action items are tracked separately from the discussion, so next week starts with what was agreed instead of what was said.'
		},
		{
			icon: 'clock',
			title: 'Summaries without the writing',
			body: 'Every finished meeting gets a summary page: agenda covered, decisions, actions, attendance and real duration. Export it as a PDF.'
		},
		{
			icon: 'users',
			title: 'Teams and availability',
			body: 'Group people for one-click invites, and see free, busy or out-of-hours hints in their own timezone before you pick a slot.'
		}
	];

	const STEPS = [
		{
			n: '1',
			title: 'Schedule it',
			body: 'Pick a time, invite people by email, and build the agenda topic by topic. You get a join link, a code and an .ics file.'
		},
		{
			n: '2',
			title: 'Run it',
			body: 'Join the room, work through the agenda with the timer visible, and take notes as you go. Everything autosaves.'
		},
		{
			n: '3',
			title: 'Finish it',
			body: 'End the meeting and the summary is already written. Assign the actions and they follow the people who own them.'
		}
	];
</script>

<svelte:head>
	<title>MeetFlow - meetings that actually get things done</title>
	<meta
		name="description"
		content="MeetFlow is a meeting workspace: schedule with an agenda, join the room, take notes, assign action items and review the summary afterwards. Runs entirely in your browser."
	/>
</svelte:head>

<div style="background:var(--surface)">
	<!-- ---------------- header ---------------- -->
	<header
		class="sticky top-0 z-30 border-b"
		style="background:color-mix(in srgb, var(--surface) 88%, transparent);backdrop-filter:blur(8px);border-color:var(--border)"
	>
		<div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
			<span class="flex items-center gap-2.5 font-semibold">
				<span
					class="flex h-8 w-8 items-center justify-center rounded-lg"
					style="background:var(--accent);color:var(--accent-contrast)"
				>
					<Icon name="logo" size={18} />
				</span>
				MeetFlow
			</span>
			<div class="flex items-center gap-1.5">
				<button
					type="button"
					class="mf-btn mf-btn-ghost px-2.5"
					onclick={() => app.toggleTheme()}
					aria-label="Toggle light or dark theme"
				>
					<Icon name="moon" size={18} />
				</button>
				<a href={ROUTES.dashboard} class="mf-btn mf-btn-secondary mf-btn-sm">Open workspace</a>
			</div>
		</div>
	</header>

	<!-- ---------------- hero ---------------- -->
	<section class="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:pt-20">
		<div class="mx-auto max-w-3xl text-center">
			<span class="mf-badge mf-badge-accent mb-5">
				<Icon name="sparkle" size={13} />
				Runs entirely in your browser
			</span>
			<h1 class="text-4xl leading-[1.1] font-bold sm:text-5xl md:text-6xl">
				Meetings that actually get things done.
			</h1>
			<p class="mx-auto mt-5 max-w-2xl text-lg" style="color:var(--text-muted)">
				Schedule with a real agenda, run the meeting in a room that keeps time, and leave with
				notes, decisions and assigned action items already written up.
			</p>
			<div class="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
				<a href="{ROUTES.room}?instant=1" class="mf-btn mf-btn-primary w-full sm:w-auto">
					<Icon name="video" size={18} />
					Start a meeting
				</a>
				<a href={ROUTES.schedule} class="mf-btn mf-btn-secondary w-full sm:w-auto">
					<Icon name="calendar" size={18} />
					Schedule a meeting
				</a>
			</div>
			<p class="mt-4 text-sm" style="color:var(--text-subtle)">
				No account, no server. Your meetings stay in this browser.
			</p>
		</div>

		<!-- Product preview: hand-drawn SVG, so the landing page loads nothing heavy. -->
		<div class="mf-card mt-14 overflow-hidden p-2 sm:p-3" style="box-shadow:var(--shadow-raised)">
			<div class="overflow-hidden rounded-xl" style="background:var(--surface-sunken)">
				<svg viewBox="0 0 960 480" class="h-auto w-full" role="img" aria-label="A preview of the MeetFlow dashboard showing today's meetings, stats and a mini calendar">
					<!-- sidebar -->
					<rect width="960" height="480" fill="var(--surface-sunken)" />
					<rect x="0" y="0" width="168" height="480" fill="var(--surface-raised)" />
					<rect x="20" y="22" width="22" height="22" rx="6" fill="var(--accent)" />
					<rect x="50" y="28" width="68" height="10" rx="5" fill="var(--text)" opacity="0.8" />
					{#each [0, 1, 2, 3, 4] as i}
						<rect
							x="14"
							y={70 + i * 34}
							width="140"
							height="26"
							rx="7"
							fill={i === 0 ? 'var(--accent-soft)' : 'transparent'}
						/>
						<circle cx="30" cy={83 + i * 34} r="5" fill={i === 0 ? 'var(--accent)' : 'var(--text-subtle)'} opacity={i === 0 ? 1 : 0.5} />
						<rect
							x="44"
							y={78 + i * 34}
							width={i === 0 ? 62 : 54 + ((i * 13) % 30)}
							height="9"
							rx="4.5"
							fill={i === 0 ? 'var(--accent)' : 'var(--text-subtle)'}
							opacity={i === 0 ? 1 : 0.45}
						/>
					{/each}

					<!-- stat cards -->
					{#each [0, 1, 2, 3] as i}
						<rect x={192 + i * 190} y="28" width="170" height="78" rx="12" fill="var(--surface-raised)" stroke="var(--border)" />
						<rect x={208 + i * 190} y="46" width="76" height="8" rx="4" fill="var(--text-subtle)" opacity="0.55" />
						<rect x={208 + i * 190} y="64" width={44 - i * 6} height="20" rx="5" fill="var(--text)" opacity="0.85" />
					{/each}

					<!-- today's timeline -->
					<rect x="192" y="124" width="480" height="330" rx="14" fill="var(--surface-raised)" stroke="var(--border)" />
					<rect x="212" y="146" width="120" height="11" rx="5.5" fill="var(--text)" opacity="0.8" />
					{#each [0, 1, 2, 3] as i}
						<rect x="212" y={180 + i * 66} width="440" height="52" rx="10" fill="var(--surface-sunken)" />
						<rect x="212" y={180 + i * 66} width="4" height="52" rx="2" fill="var(--event-{i})" />
						<rect x="230" y={194 + i * 66} width="38" height="8" rx="4" fill="var(--text-subtle)" opacity="0.6" />
						<rect x="230" y={210 + i * 66} width={160 + ((i * 37) % 90)} height="10" rx="5" fill="var(--text)" opacity="0.72" />
						{#each [0, 1, 2] as j}
							<circle cx={600 + j * 17} cy={206 + i * 66} r="9" fill="var(--event-{(i + j) % 6})" opacity="0.26" />
						{/each}
					{/each}

					<!-- mini calendar -->
					<rect x="692" y="124" width="248" height="330" rx="14" fill="var(--surface-raised)" stroke="var(--border)" />
					<rect x="712" y="146" width="84" height="11" rx="5.5" fill="var(--text)" opacity="0.8" />
					{#each Array(35) as _, i}
						<rect
							x={714 + (i % 7) * 32}
							y={178 + Math.floor(i / 7) * 32}
							width="26"
							height="26"
							rx="7"
							fill={i === 16 ? 'var(--accent)' : 'transparent'}
						/>
						<rect
							x={721 + (i % 7) * 32}
							y={188 + Math.floor(i / 7) * 32}
							width="12"
							height="6"
							rx="3"
							fill={i === 16 ? 'var(--accent-contrast)' : 'var(--text-subtle)'}
							opacity={i === 16 ? 1 : 0.4}
						/>
						{#if [9, 11, 16, 18, 23, 30].includes(i)}
							<circle cx={727 + (i % 7) * 32} cy={200 + Math.floor(i / 7) * 32} r="2" fill={i === 16 ? 'var(--accent-contrast)' : 'var(--event-' + (i % 6) + ')'} />
						{/if}
					{/each}
					<rect x="712" y="366" width="208" height="68" rx="10" fill="var(--accent-soft)" />
					<rect x="728" y="384" width="96" height="9" rx="4.5" fill="var(--accent)" opacity="0.8" />
					<rect x="728" y="402" width="140" height="8" rx="4" fill="var(--accent)" opacity="0.45" />
				</svg>
			</div>
		</div>
	</section>

	<!-- ---------------- features ---------------- -->
	<section class="border-t py-16" style="border-color:var(--border);background:var(--surface-sunken)">
		<div class="mx-auto max-w-6xl px-5">
			<h2 class="text-center text-3xl font-bold">Everything a meeting needs, in one place</h2>
			<p class="mx-auto mt-3 max-w-2xl text-center" style="color:var(--text-muted)">
				Not another calendar and another notes app and another task tracker. One workspace where
				the agenda, the room, the notes and the follow-ups are the same object.
			</p>
			<div class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each FEATURES as feature}
					<article class="mf-card mf-card-hover p-5">
						<span
							class="mb-3.5 flex h-10 w-10 items-center justify-center rounded-xl"
							style="background:var(--accent-soft);color:var(--accent)"
						>
							<Icon name={feature.icon} size={20} />
						</span>
						<h3 class="text-base font-semibold">{feature.title}</h3>
						<p class="mt-1.5 text-sm leading-relaxed" style="color:var(--text-muted)">
							{feature.body}
						</p>
					</article>
				{/each}
			</div>
		</div>
	</section>

	<!-- ---------------- how it works ---------------- -->
	<section class="py-16" style="background:var(--surface)">
		<div class="mx-auto max-w-5xl px-5">
			<h2 class="text-center text-3xl font-bold">How it works</h2>
			<div class="mt-10 grid gap-6 md:grid-cols-3">
				{#each STEPS as step, i}
					<div class="relative">
						<span
							class="flex h-11 w-11 items-center justify-center rounded-full text-lg font-bold"
							style="background:var(--accent);color:var(--accent-contrast)"
						>
							{step.n}
						</span>
						<h3 class="mt-4 text-lg font-semibold">{step.title}</h3>
						<p class="mt-1.5 text-sm leading-relaxed" style="color:var(--text-muted)">
							{step.body}
						</p>
						{#if i < STEPS.length - 1}
							<span
								class="absolute -right-3 top-5 hidden md:block"
								style="color:var(--border-strong)"
								aria-hidden="true"
							>
								<Icon name="chevron-right" size={20} />
							</span>
						{/if}
					</div>
				{/each}
			</div>

			<div class="mf-card mt-12 flex flex-col items-center gap-4 p-8 text-center sm:p-10">
				<h3 class="text-2xl font-bold">Start with a workspace that already has meetings in it</h3>
				<p class="max-w-xl text-sm" style="color:var(--text-muted)">
					MeetFlow opens on a sample workspace - a real-looking product team with meetings,
					agendas, notes, decisions and an action board - so you can see how it works before you
					schedule anything of your own.
				</p>
				<div class="mt-1 flex flex-col gap-3 sm:flex-row">
					<a href={ROUTES.dashboard} class="mf-btn mf-btn-primary">
						<Icon name="home" size={18} />
						Open the dashboard
					</a>
					<a href={ROUTES.schedule} class="mf-btn mf-btn-secondary">Schedule a meeting</a>
				</div>
			</div>
		</div>
	</section>

	<!-- ---------------- footer ---------------- -->
	<footer class="border-t py-10" style="border-color:var(--border);background:var(--surface-sunken)">
		<div class="mx-auto flex max-w-6xl flex-col gap-6 px-5 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<span class="flex items-center gap-2 font-semibold">
					<span
						class="flex h-7 w-7 items-center justify-center rounded-lg"
						style="background:var(--accent);color:var(--accent-contrast)"
					>
						<Icon name="logo" size={15} />
					</span>
					MeetFlow
				</span>
				<p class="mt-2 max-w-xs text-sm" style="color:var(--text-subtle)">
					A meeting workspace that runs entirely in your browser. No account, no server, no data
					leaving your device.
				</p>
			</div>
			<nav class="flex flex-wrap gap-x-8 gap-y-2 text-sm" aria-label="Footer">
				<a class="mf-link" href={ROUTES.dashboard}>Dashboard</a>
				<a class="mf-link" href={ROUTES.calendar}>Calendar</a>
				<a class="mf-link" href={ROUTES.actions}>Action items</a>
				<a class="mf-link" href={ROUTES.history}>History</a>
				<a class="mf-link" href={ROUTES.settings}>Settings</a>
			</nav>
		</div>
		<p class="mx-auto mt-8 max-w-6xl px-5 text-xs" style="color:var(--text-subtle)">
			Sample data features the fictional Northwind Studio. Any resemblance to a real team's
			Tuesday is a coincidence.
		</p>
	</footer>
</div>
