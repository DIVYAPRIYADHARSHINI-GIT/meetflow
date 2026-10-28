<script lang="ts">
	/**
	 * Meeting room: pre-join device test, then the live room.
	 *
	 * Media handling is the whole point of this screen being careful:
	 *  - the pre-join screen tests the real camera/mic and lets you pick devices
	 *  - every failure mode (denied, no device, in use, insecure origin, unplugged mid-call)
	 *    shows a specific message and a way forward, and you can always join without media
	 *  - streams are stopped on leave AND on page unload, so the camera light goes out
	 *
	 * Participants, chat and the speaker highlight are simulated with real names so the room
	 * looks alive in a demo; notes, agenda and action items are the real stored data.
	 */
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { app } from '#lib/stores/app.svelte';
	import { ROUTES } from '#lib/nav';
	import { RoomSession, REACTIONS } from '#lib/logic/room.svelte';
	import { listDevices, type DeviceOption } from '#lib/logic/media';
	import { agendaOffsets, currentTopicIndex, normaliseCode } from '#lib/logic/schedule';
	import { formatDuration, formatTime } from '#lib/logic/time';
	import { initialsOf } from '#lib/logic/notes';
	import Icon from '#lib/components/Icon.svelte';
	import Avatar from '#lib/components/Avatar.svelte';
	import NotesEditor from '#lib/components/NotesEditor.svelte';
	import ActionItemDialog from '#lib/components/ActionItemDialog.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';

	const room = new RoomSession();

	let devices = $state<DeviceOption[]>([]);
	let panel = $state<'chat' | 'participants' | 'agenda' | 'notes' | null>('agenda');
	let chatDraft = $state('');
	let decisionDraft = $state('');
	let actionDialogOpen = $state(false);
	let actionSourceLine = $state('');
	let videoEl = $state<HTMLVideoElement | null>(null);
	let notesEditor = $state<ReturnType<typeof NotesEditor> | null>(null);
	let resolved = $state(false);

	/** Resolve the meeting from ?code=, or create one for ?instant=1. */
	const codeParam = $derived(page.url.searchParams.get('code') ?? '');
	const instantParam = $derived(page.url.searchParams.get('instant') === '1');
	let meetingId = $state<string | null>(null);
	const meeting = $derived(app.meeting(meetingId));

	$effect(() => {
		if (!app.loaded || resolved) return;
		resolved = true;

		if (codeParam) {
			const found = app.meetingByCode(normaliseCode(codeParam));
			if (found) {
				meetingId = found.id;
				room.seedParticipants(found, app.meId);
				return;
			}
		}
		if (instantParam || !codeParam) {
			const created = app.startInstantMeeting('Instant meeting');
			meetingId = created.id;
			room.seedParticipants(created, app.meId);
			// Keep the URL honest so a refresh rejoins the same room instead of creating another.
			goto(`${ROUTES.room}?code=${created.code}`, { replaceState: true });
		}
	});

	onMount(() => {
		// Default the controls from the user's saved preference before touching hardware.
		room.micOn = !app.settings.joinMuted;
		room.cameraOn = !app.settings.joinCameraOff;
		void room.acquire().then(async () => {
			devices = await listDevices();
		});

		// A tab closed mid-meeting must still release the camera.
		const onUnload = () => room.leave();
		window.addEventListener('pagehide', onUnload);
		return () => {
			window.removeEventListener('pagehide', onUnload);
			room.leave();
		};
	});

	/** Attach the stream to the <video> element whenever either changes. */
	$effect(() => {
		if (videoEl && room.stream) {
			videoEl.srcObject = room.stream;
			videoEl.play?.().catch(() => {
				// Autoplay can be refused until a user gesture; the tile shows initials instead.
			});
		}
	});

	const cameras = $derived(devices.filter((d) => d.kind === 'videoinput'));
	const microphones = $derived(devices.filter((d) => d.kind === 'audioinput'));

	const agenda = $derived(meeting?.agenda ?? []);
	const offsets = $derived(agendaOffsets(agenda));
	const activeTopic = $derived(currentTopicIndex(agenda, room.elapsedMinutes));

	/** Seconds left in the current topic, for the per-topic countdown. */
	const topicRemaining = $derived.by(() => {
		if (activeTopic < 0) return null;
		const endMinutes = offsets[activeTopic] + agenda[activeTopic].minutes;
		return Math.max(0, endMinutes * 60 - room.elapsedSeconds);
	});

	const chat = $derived(meetingId ? app.chatFor(meetingId) : []);
	const decisions = $derived(meetingId ? app.decisionsFor(meetingId) : []);
	const actionItems = $derived(meetingId ? app.actionItemsFor(meetingId) : []);

	function countdownLabel(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	async function switchDevice(kind: 'video' | 'audio', deviceId: string) {
		if (kind === 'video') room.videoDeviceId = deviceId;
		else room.audioDeviceId = deviceId;
		await room.acquire();
	}

	function sendChat(event: Event) {
		event.preventDefault();
		if (!meetingId || !chatDraft.trim()) return;
		app.sendChat(meetingId, chatDraft);
		chatDraft = '';
	}

	function addDecision(event: Event) {
		event.preventDefault();
		if (!meetingId || !decisionDraft.trim()) return;
		app.addDecision(meetingId, decisionDraft);
		decisionDraft = '';
		app.showToast('Decision logged');
	}

	function createActionFromLine(line: string) {
		actionSourceLine = line;
		actionDialogOpen = true;
	}

	/**
	 * End the meeting: flush notes, record attendance and the real duration, release media,
	 * then go to the summary. The summary is already written because every piece of it was
	 * captured as the meeting ran.
	 */
	function endMeeting() {
		if (!meetingId || !room.joinedAt) return;
		notesEditor?.flush?.();
		app.endMeeting(meetingId, room.attendeeIds, room.joinedAt);
		room.leave();
		goto(`${ROUTES.meeting}?id=${meetingId}`);
	}

	function leaveWithoutEnding() {
		notesEditor?.flush?.();
		app.persistNow();
		room.leave();
		goto(ROUTES.dashboard);
	}

	/** Room keyboard shortcuts, inert while typing. */
	function onKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		if (
			target &&
			(target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.isContentEditable)
		) {
			return;
		}
		if (event.metaKey || event.ctrlKey || event.altKey) return;

		const key = event.key.toLowerCase();
		if (key === 'm') {
			event.preventDefault();
			room.toggleMic();
		} else if (key === 'v') {
			event.preventDefault();
			void room.toggleCamera();
		} else if (key === 'r') {
			event.preventDefault();
			room.toggleHand();
		} else if (key === 'c') {
			event.preventDefault();
			panel = panel === 'chat' ? null : 'chat';
		} else if (event.key === 'Escape' && panel) {
			event.preventDefault();
			panel = null;
		}
	}

	const PANELS = [
		{ id: 'chat', label: 'Chat', icon: 'chat' },
		{ id: 'participants', label: 'Participants', icon: 'users' },
		{ id: 'agenda', label: 'Agenda', icon: 'list' },
		{ id: 'notes', label: 'Notes', icon: 'notes' }
	] as const;
</script>

<svelte:head>
	<title>{meeting?.title ?? 'Meeting room'} · MeetFlow</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

{#if !app.loaded || !meeting}
	<div class="flex min-h-dvh items-center justify-center p-6" style="background:var(--ink-950)">
		<div class="w-full max-w-sm space-y-3">
			<div class="mf-skeleton h-48 w-full"></div>
			<div class="mf-skeleton h-10 w-full"></div>
		</div>
	</div>
{:else if room.phase === 'prejoin'}
	<!-- ================= PRE-JOIN ================= -->
	<div class="flex min-h-dvh flex-col items-center justify-center p-4 sm:p-6">
		<div class="w-full max-w-4xl">
			<div class="mb-5 text-center">
				<h1 class="text-2xl font-bold">{meeting.title}</h1>
				<p class="mt-1 text-sm" style="color:var(--text-muted)">
					{formatTime(meeting.startsAt, app.timezone)} ·
					{formatDuration(meeting.durationMinutes)} ·
					code <code class="font-mono tracking-wider">{meeting.code}</code>
				</p>
			</div>

			<div class="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
				<!-- preview -->
				<div
					class="relative aspect-video overflow-hidden rounded-2xl"
					style="background:var(--color-ink-900)"
				>
					{#if room.stream && room.cameraOn}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							bind:this={videoEl}
							class="h-full w-full -scale-x-100 object-cover"
							autoplay
							playsinline
							muted
						></video>
					{:else}
						<div class="flex h-full flex-col items-center justify-center gap-3">
							<span
								class="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-semibold"
								style="background:var(--color-ink-800);color:var(--color-ink-300)"
							>
								{initialsOf(app.settings.profileName)}
							</span>
							<p class="text-sm" style="color:var(--color-ink-400)">
								{room.requesting ? 'Starting your camera…' : 'Camera is off'}
							</p>
						</div>
					{/if}

					<!-- mic level meter, proving the mic actually works before joining -->
					{#if room.micOn && room.stream}
						<div
							class="absolute bottom-3 left-3 flex items-center gap-2 rounded-full px-3 py-1.5"
							style="background:rgb(0 0 0 / 0.5)"
						>
							<Icon name="mic" size={14} class="text-white" />
							<span class="flex h-1.5 w-20 overflow-hidden rounded-full" style="background:rgb(255 255 255 / 0.25)">
								<span
									class="h-full rounded-full transition-[width] duration-100"
									style="width:{Math.round(room.level * 100)}%;background:var(--ok)"
								></span>
							</span>
						</div>
					{/if}
				</div>

				<!-- device controls -->
				<div class="space-y-4">
					{#if room.failure}
						<div
							class="mf-card p-4"
							style="border-color:var(--warn);background:var(--warn-soft)"
							role="alert"
						>
							<div class="flex items-start gap-2.5">
								<span style="color:var(--warn)" class="mt-0.5 shrink-0">
									<Icon name="warning" size={18} />
								</span>
								<div>
									<p class="text-sm font-semibold" style="color:var(--warn)">
										{room.failure.message}
									</p>
									<p class="mt-1 text-xs" style="color:var(--text-muted)">{room.failure.hint}</p>
									<button
										type="button"
										class="mf-btn mf-btn-secondary mf-btn-sm mt-2.5"
										onclick={() => room.acquire({ video: true, audio: true })}
									>
										Try again
									</button>
								</div>
							</div>
						</div>
					{/if}

					<div class="mf-card p-4">
						<h2 class="mb-3 text-sm font-semibold">Check your devices</h2>

						<div class="space-y-3">
							<div>
								<label class="mf-label" for="mf-camera">Camera</label>
								<select
									id="mf-camera"
									class="mf-field"
									value={room.videoDeviceId}
									onchange={(e) => switchDevice('video', e.currentTarget.value)}
									disabled={cameras.length === 0}
								>
									{#if cameras.length === 0}
										<option value="">No camera found</option>
									{:else}
										<option value="">Default camera</option>
										{#each cameras as device (device.deviceId)}
											<option value={device.deviceId}>{device.label}</option>
										{/each}
									{/if}
								</select>
							</div>

							<div>
								<label class="mf-label" for="mf-mic">Microphone</label>
								<select
									id="mf-mic"
									class="mf-field"
									value={room.audioDeviceId}
									onchange={(e) => switchDevice('audio', e.currentTarget.value)}
									disabled={microphones.length === 0}
								>
									{#if microphones.length === 0}
										<option value="">No microphone found</option>
									{:else}
										<option value="">Default microphone</option>
										{#each microphones as device (device.deviceId)}
											<option value={device.deviceId}>{device.label}</option>
										{/each}
									{/if}
								</select>
							</div>
						</div>

						<div class="mt-4 flex gap-2">
							<button
								type="button"
								class="mf-btn {room.micOn ? 'mf-btn-secondary' : 'mf-btn-danger'} mf-btn-sm flex-1"
								onclick={() => room.toggleMic()}
								aria-pressed={room.micOn}
							>
								<Icon name={room.micOn ? 'mic' : 'mic-off'} size={15} />
								{room.micOn ? 'Mic on' : 'Mic off'}
							</button>
							<button
								type="button"
								class="mf-btn {room.cameraOn ? 'mf-btn-secondary' : 'mf-btn-danger'} mf-btn-sm flex-1"
								onclick={() => room.toggleCamera()}
								aria-pressed={room.cameraOn}
							>
								<Icon name={room.cameraOn ? 'video' : 'video-off'} size={15} />
								{room.cameraOn ? 'Camera on' : 'Camera off'}
							</button>
						</div>
					</div>

					<button type="button" class="mf-btn mf-btn-primary w-full" onclick={() => room.join()}>
						<Icon name="video" size={18} />
						Join meeting
					</button>

					<p class="text-center text-xs" style="color:var(--text-subtle)">
						{meeting.participants.length} invited · you can join without a camera or microphone
					</p>
				</div>
			</div>
		</div>
	</div>
{:else}
	<!-- ================= IN THE ROOM ================= -->
	<div class="flex h-dvh flex-col" style="background:var(--color-ink-950)">
		<!-- top bar -->
		<header class="flex shrink-0 items-center justify-between gap-3 px-4 py-2.5">
			<div class="flex min-w-0 items-center gap-3">
				<h1 class="truncate text-sm font-semibold text-white">{meeting.title}</h1>
				{#if room.recording}
					<span class="mf-badge shrink-0" style="background:var(--danger);color:#fff">
						<span class="h-1.5 w-1.5 animate-pulse rounded-full" style="background:#fff"></span>
						REC
					</span>
				{/if}
			</div>
			<div class="flex items-center gap-3">
				<span class="font-mono text-sm tabular-nums" style="color:var(--color-ink-300)">
					{room.timerLabel}
				</span>
				<span class="hidden text-xs sm:inline" style="color:var(--color-ink-400)">
					{room.participants.length} in the room
				</span>
			</div>
		</header>

		<div class="flex min-h-0 flex-1 gap-3 px-3 pb-2">
			<!-- ---------------- video grid ---------------- -->
			<div class="flex min-w-0 flex-1 flex-col gap-3">
				{#if room.failure && room.failure.kind === 'disconnected'}
					<div
						class="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm"
						style="background:var(--warn-soft);color:var(--warn)"
						role="alert"
					>
						<Icon name="warning" size={16} />
						<span class="flex-1">{room.failure.message} {room.failure.hint}</span>
						<button type="button" class="underline" onclick={() => room.acquire()}>Retry</button>
					</div>
				{/if}

				<div
					class="grid min-h-0 flex-1 gap-2.5"
					style="grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))"
				>
					{#each room.participants as participant (participant.contactId)}
						{@const contact = app.contact(participant.contactId)}
						{#if contact}
							<div
								class="relative flex min-h-[7rem] items-center justify-center overflow-hidden rounded-xl transition-shadow"
								style="background:var(--color-ink-900);{participant.speaking
									? 'box-shadow:0 0 0 3px var(--accent)'
									: ''}"
							>
								{#if participant.isSelf && room.stream && room.cameraOn}
									<!-- svelte-ignore a11y_media_has_caption -->
									<video
										bind:this={videoEl}
										class="h-full w-full -scale-x-100 object-cover"
										autoplay
										playsinline
										muted
									></video>
								{:else}
									<Avatar name={contact.name} hue={contact.hue} size={64} />
								{/if}

								<!-- name + state chips -->
								<div class="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
									<span
										class="truncate rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium text-white"
										style="background:rgb(0 0 0 / 0.55)"
									>
										{participant.isSelf ? 'You' : contact.name}
									</span>
									{#if participant.muted}
										<span
											class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
											style="background:rgb(0 0 0 / 0.55);color:var(--danger)"
											title="{contact.name} is muted"
										>
											<Icon name="mic-off" size={11} />
										</span>
									{/if}
									{#if participant.cameraOff}
										<span
											class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
											style="background:rgb(0 0 0 / 0.55);color:var(--color-ink-300)"
											title="{contact.name} has their camera off"
										>
											<Icon name="video-off" size={11} />
										</span>
									{/if}
								</div>

								{#if participant.handRaised}
									<span
										class="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg text-sm"
										style="background:var(--warn);color:#000"
										title="{contact.name} raised their hand"
									>
										✋
									</span>
								{/if}

								{#if participant.isSelf && room.myReaction}
									<span class="absolute left-1/2 top-3 -translate-x-1/2 text-3xl">
										{room.myReaction.emoji}
									</span>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			</div>

			<!-- ---------------- side panel ---------------- -->
			{#if panel}
				<aside
					class="mf-card flex w-full max-w-sm shrink-0 flex-col overflow-hidden max-lg:absolute max-lg:inset-x-3 max-lg:bottom-20 max-lg:top-14 max-lg:z-20 lg:w-80"
					aria-label="{panel} panel"
				>
					<div class="flex shrink-0 border-b" style="border-color:var(--border)" role="tablist">
						{#each PANELS as tab}
							<button
								type="button"
								role="tab"
								aria-selected={panel === tab.id}
								class="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors"
								style={panel === tab.id
									? 'color:var(--accent);border-bottom:2px solid var(--accent)'
									: 'color:var(--text-subtle)'}
								onclick={() => (panel = tab.id)}
							>
								<Icon name={tab.icon} size={15} />
								<span class="hidden sm:inline">{tab.label}</span>
							</button>
						{/each}
						<button
							type="button"
							class="px-2.5"
							style="color:var(--text-subtle)"
							onclick={() => (panel = null)}
							aria-label="Close panel"
						>
							<Icon name="close" size={16} />
						</button>
					</div>

					<div class="flex min-h-0 flex-1 flex-col p-3">
						{#if panel === 'chat'}
							<div class="mf-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto">
								{#if chat.length === 0}
									<EmptyState
										compact
										icon="chat"
										title="No messages yet"
										description="Say hello, or drop a link for the group."
									/>
								{:else}
									{#each chat as message (message.id)}
										{@const author = app.contact(message.authorId)}
										<div class="flex items-start gap-2">
											<Avatar name={author?.name ?? '?'} hue={author?.hue ?? 0} size={26} />
											<div class="min-w-0 flex-1">
												<p class="flex items-baseline gap-1.5">
													<span class="text-xs font-semibold">
														{message.authorId === app.meId ? 'You' : (author?.name ?? 'Unknown')}
													</span>
													<span class="text-[0.625rem]" style="color:var(--text-subtle)">
														{formatTime(message.sentAt, app.timezone)}
													</span>
												</p>
												<p class="text-sm break-words" style="color:var(--text-muted)">
													{message.text}
												</p>
											</div>
										</div>
									{/each}
								{/if}
							</div>
							<form class="mt-2.5 flex gap-1.5" onsubmit={sendChat}>
								<label class="mf-sr-only" for="mf-chat-input">Message</label>
								<input
									id="mf-chat-input"
									class="mf-field"
									style="min-height:2.25rem"
									placeholder="Send a message"
									bind:value={chatDraft}
								/>
								<button
									type="submit"
									class="mf-btn mf-btn-primary mf-btn-sm px-2.5"
									disabled={!chatDraft.trim()}
									aria-label="Send message"
								>
									<Icon name="chevron-right" size={16} />
								</button>
							</form>
						{:else if panel === 'participants'}
							<ul class="mf-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto">
								{#each room.participants as participant (participant.contactId)}
									{@const contact = app.contact(participant.contactId)}
									{#if contact}
										<li class="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
											<Avatar
												name={contact.name}
												hue={contact.hue}
												size={30}
												ring={participant.speaking}
											/>
											<div class="min-w-0 flex-1">
												<p class="truncate text-sm font-medium">
													{participant.isSelf ? 'You' : contact.name}
													{#if meeting.participants.find((p) => p.contactId === contact.id)?.role === 'host'}
														<span class="mf-badge mf-badge-accent ml-1">Host</span>
													{/if}
												</p>
												<p class="truncate text-[0.6875rem]" style="color:var(--text-subtle)">
													{participant.speaking ? 'Speaking' : contact.title}
												</p>
											</div>
											<div class="flex shrink-0 items-center gap-1" style="color:var(--text-subtle)">
												{#if participant.handRaised}<span title="Hand raised">✋</span>{/if}
												<Icon name={participant.muted ? 'mic-off' : 'mic'} size={14} />
												<Icon name={participant.cameraOff ? 'video-off' : 'video'} size={14} />
											</div>
										</li>
									{/if}
								{/each}
							</ul>
						{:else if panel === 'agenda'}
							<div class="mf-scroll min-h-0 flex-1 overflow-y-auto">
								{#if agenda.length === 0}
									<EmptyState
										compact
										icon="list"
										title="No agenda"
										description="This meeting was scheduled without one."
									/>
								{:else}
									<ol class="space-y-1.5">
										{#each agenda as topic, i (topic.id)}
											{@const isActive = i === activeTopic}
											<li
												class="rounded-lg border p-2.5 transition-colors"
												style={isActive
													? 'border-color:var(--accent);background:var(--accent-soft)'
													: 'border-color:var(--border)'}
											>
												<div class="flex items-start gap-2">
													<button
														type="button"
														class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border"
														style="border-color:var(--border-strong);{topic.covered
															? 'background:var(--ok);border-color:var(--ok);color:#fff'
															: ''}"
														onclick={() => app.toggleTopicCovered(meeting.id, topic.id)}
														aria-label="Mark &quot;{topic.title}&quot; as {topic.covered
															? 'not covered'
															: 'covered'}"
														aria-pressed={topic.covered}
													>
														{#if topic.covered}<Icon name="check" size={10} />{/if}
													</button>
													<div class="min-w-0 flex-1">
														<p
															class="text-sm font-medium"
															style={topic.covered ? 'text-decoration:line-through;opacity:0.6' : ''}
														>
															{topic.title}
														</p>
														<p class="mt-0.5 text-[0.6875rem]" style="color:var(--text-subtle)">
															{topic.minutes} min
															{#if topic.owner}· {app.contactName(topic.owner)}{/if}
														</p>
													</div>
													{#if isActive && topicRemaining !== null}
														<span
															class="shrink-0 font-mono text-xs font-semibold tabular-nums"
															style="color:{topicRemaining === 0 ? 'var(--danger)' : 'var(--accent)'}"
															title="Time left in this topic"
														>
															{countdownLabel(topicRemaining)}
														</span>
													{/if}
												</div>
											</li>
										{/each}
									</ol>
								{/if}

								<!-- decisions log -->
								<div class="mt-4 border-t pt-3" style="border-color:var(--border)">
									<h3 class="mb-2 text-xs font-semibold uppercase" style="color:var(--text-subtle)">
										Decisions ({decisions.length})
									</h3>
									{#if decisions.length > 0}
										<ul class="mb-2 space-y-1.5">
											{#each decisions as decision (decision.id)}
												<li class="flex items-start gap-2 text-xs">
													<span class="mt-0.5 shrink-0" style="color:var(--ok)">
														<Icon name="check-circle" size={13} />
													</span>
													<span class="flex-1">{decision.text}</span>
												</li>
											{/each}
										</ul>
									{/if}
									<form class="flex gap-1.5" onsubmit={addDecision}>
										<label class="mf-sr-only" for="mf-decision-input">New decision</label>
										<input
											id="mf-decision-input"
											class="mf-field"
											style="min-height:2.25rem"
											placeholder="Log a decision"
											bind:value={decisionDraft}
										/>
										<button
											type="submit"
											class="mf-btn mf-btn-secondary mf-btn-sm px-2.5"
											disabled={!decisionDraft.trim()}
											aria-label="Log decision"
										>
											<Icon name="plus" size={15} />
										</button>
									</form>
								</div>
							</div>
						{:else if panel === 'notes'}
							<NotesEditor
								bind:this={notesEditor}
								meetingId={meeting.id}
								compact
								onCreateAction={createActionFromLine}
							/>
							{#if actionItems.length > 0}
								<div class="mt-2 border-t pt-2" style="border-color:var(--border)">
									<p class="text-[0.6875rem]" style="color:var(--text-subtle)">
										{actionItems.length} action
										{actionItems.length === 1 ? 'item' : 'items'} from this meeting
									</p>
								</div>
							{/if}
						{/if}
					</div>
				</aside>
			{/if}
		</div>

		<!-- ---------------- control bar ---------------- -->
		<footer class="flex shrink-0 flex-wrap items-center justify-center gap-1.5 px-3 pb-3 pt-1">
			<button
				type="button"
				class="mf-btn {room.micOn ? 'mf-btn-secondary' : 'mf-btn-danger'} px-3"
				onclick={() => room.toggleMic()}
				aria-pressed={room.micOn}
				aria-label={room.micOn ? 'Mute microphone (M)' : 'Unmute microphone (M)'}
				title="Microphone (M)"
			>
				<Icon name={room.micOn ? 'mic' : 'mic-off'} size={18} />
			</button>
			<button
				type="button"
				class="mf-btn {room.cameraOn ? 'mf-btn-secondary' : 'mf-btn-danger'} px-3"
				onclick={() => room.toggleCamera()}
				aria-pressed={room.cameraOn}
				aria-label={room.cameraOn ? 'Turn camera off (V)' : 'Turn camera on (V)'}
				title="Camera (V)"
			>
				<Icon name={room.cameraOn ? 'video' : 'video-off'} size={18} />
			</button>
			<button
				type="button"
				class="mf-btn {room.screenSharing ? 'mf-btn-primary' : 'mf-btn-secondary'} px-3"
				onclick={async () => {
					const error = await room.toggleScreenShare();
					if (error) app.showToast(error, 'error');
				}}
				aria-pressed={room.screenSharing}
				aria-label="Share your screen"
				title="Share screen"
			>
				<Icon name="screen" size={18} />
			</button>
			<button
				type="button"
				class="mf-btn {room.handRaised ? 'mf-btn-primary' : 'mf-btn-secondary'} px-3"
				onclick={() => room.toggleHand()}
				aria-pressed={room.handRaised}
				aria-label={room.handRaised ? 'Lower your hand (R)' : 'Raise your hand (R)'}
				title="Raise hand (R)"
			>
				<Icon name="hand" size={18} />
			</button>

			<!-- reactions -->
			<div class="flex items-center gap-0.5 rounded-lg px-1" style="background:var(--surface-raised)">
				{#each REACTIONS as emoji}
					<button
						type="button"
						class="rounded px-1.5 py-1.5 text-base transition-transform hover:scale-125"
						onclick={() => room.react(emoji)}
						aria-label="React with {emoji}"
					>
						{emoji}
					</button>
				{/each}
			</div>

			<button
				type="button"
				class="mf-btn {room.recording ? 'mf-btn-danger' : 'mf-btn-secondary'} px-3"
				onclick={() => room.toggleRecording()}
				aria-pressed={room.recording}
				aria-label={room.recording ? 'Stop recording indicator' : 'Start recording indicator'}
				title="Recording indicator (visual only)"
			>
				<Icon name="record" size={18} />
			</button>

			{#each PANELS as tab}
				<button
					type="button"
					class="mf-btn {panel === tab.id ? 'mf-btn-primary' : 'mf-btn-secondary'} px-3"
					onclick={() => (panel = panel === tab.id ? null : tab.id)}
					aria-pressed={panel === tab.id}
					aria-label="{tab.label} panel"
					title={tab.label}
				>
					<Icon name={tab.icon} size={18} />
				</button>
			{/each}

			<div class="mx-1 h-8 w-px" style="background:var(--color-ink-700)"></div>

			<button type="button" class="mf-btn mf-btn-secondary" onclick={leaveWithoutEnding}>
				<Icon name="logout" size={17} />
				<span class="hidden sm:inline">Leave</span>
			</button>
			<button type="button" class="mf-btn mf-btn-danger" onclick={endMeeting}>
				<Icon name="phone" size={17} />
				<span class="hidden sm:inline">End meeting</span>
			</button>
		</footer>
	</div>
{/if}

<ActionItemDialog
	open={actionDialogOpen}
	meetingId={meetingId}
	sourceLine={actionSourceLine}
	onClose={() => {
		actionDialogOpen = false;
		actionSourceLine = '';
	}}
/>
