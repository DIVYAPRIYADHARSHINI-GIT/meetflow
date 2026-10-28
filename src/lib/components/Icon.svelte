<script lang="ts">
	/**
	 * Inline SVG icon set. Hand-drawn paths, no icon dependency.
	 * Decorative by default (aria-hidden); pass a `title` when the icon is the only label.
	 */
	interface Props {
		name: string;
		size?: number;
		title?: string;
		class?: string;
		strokeWidth?: number;
	}

	let { name, size = 20, title, class: klass = '', strokeWidth = 1.75 }: Props = $props();

	const PATHS: Record<string, string> = {
		calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
		clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
		video: 'M16 10.5 22 7v10l-6-3.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z',
		'video-off': 'M16 10.5 22 7v10M2 2l20 20M4 6h8m4 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8',
		mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v4M8 22h8',
		'mic-off': 'M2 2l20 20M9 9v3a3 3 0 0 0 5.1 2.1M15 11V5a3 3 0 0 0-5.9-.8M5 11a7 7 0 0 0 10.3 6.2M12 18v4M8 22h8',
		screen: 'M8 21h8M12 17v4M4 3h16a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1Z',
		hand: 'M18 11V6a1.5 1.5 0 0 0-3 0m0 0V4.5a1.5 1.5 0 0 0-3 0V11m3-5v5M12 11V5.5a1.5 1.5 0 0 0-3 0V13m0-4.5a1.5 1.5 0 0 0-3 0V15a7 7 0 0 0 7 7h1a7 7 0 0 0 7-7v-4',
		chat: 'M8 10h8M8 14h5M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z',
		users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
		notes: 'M14 2v6h6M9 13h6M9 17h3M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z',
		list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
		check: 'm4 12 5 5L20 6',
		'check-circle': 'm9 12 2 2 4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
		plus: 'M12 5v14M5 12h14',
		close: 'M18 6 6 18M6 6l12 12',
		'chevron-left': 'm15 18-6-6 6-6',
		'chevron-right': 'm9 18 6-6-6-6',
		'chevron-down': 'm6 9 6 6 6-6',
		'chevron-up': 'm18 15-6-6-6 6',
		search: 'm21 21-4.3-4.3M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',
		settings:
			'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
		home: 'm3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2V10Z',
		sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
		moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z',
		copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2ZM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
		download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
		link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
		mail: 'm22 7-10 6L2 7M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
		trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6',
		edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
		warning: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
		info: 'M12 16v-4M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
		sparkle: 'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8',
		grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
		logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
		phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z',
		record: 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z',
		filter: 'M3 4h18l-7 8v7l-4-2v-5L3 4Z',
		team: 'M17 20h5v-2a3 3 0 0 0-5.4-1.8M9 20H2v-2a5 5 0 0 1 9-3M16 3.1a4 4 0 0 1 0 7.8M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
		keyboard:
			'M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M8 16h8M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
		logo: 'M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9ZM12 12l8-4.5M12 12v9M12 12 4 7.5'
	};

	const d = $derived(PATHS[name] ?? PATHS.info);
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	class={klass}
	aria-hidden={title ? undefined : 'true'}
	role={title ? 'img' : undefined}
	aria-label={title}
>
	{#if title}<title>{title}</title>{/if}
	{#each d.split(' M').map((part, i) => (i === 0 ? part : `M${part}`)) as segment}
		<path d={segment} />
	{/each}
</svg>
