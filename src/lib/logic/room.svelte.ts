/**
 * Meeting-room session state: local media, simulated participants, timers and reactions.
 *
 * Kept out of the component so the room's behaviour is testable and so the component stays
 * about layout. Simulated participants are what make the demo look alive: real named people
 * who mute, unmute, raise hands and talk on a seeded schedule, with one marked as the active
 * speaker at a time.
 */

import type { Meeting, RoomParticipantState } from '../types';
import {
	createLevelMeter,
	requestStream,
	setTrackEnabled,
	stopStream,
	watchForDisconnect,
	type MediaFailure
} from './media';

/** Deterministic PRNG so the simulated room behaves identically in tests and demos. */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export const REACTIONS = ['👍', '👏', '🎉', '❤️', '😂', '🤔'] as const;

export class RoomSession {
	/** 'prejoin' until the user commits, then 'joined', then 'left'. */
	phase = $state<'prejoin' | 'joined' | 'left'>('prejoin');

	stream = $state<MediaStream | null>(null);
	failure = $state<MediaFailure | null>(null);
	requesting = $state(false);

	micOn = $state(true);
	cameraOn = $state(true);
	screenSharing = $state(false);
	handRaised = $state(false);
	recording = $state(false);

	/** Mic input level 0-1, for the pre-join meter. */
	level = $state(0);

	videoDeviceId = $state<string>('');
	audioDeviceId = $state<string>('');

	/** Instant the user actually joined, used for the meeting timer and real duration. */
	joinedAt = $state<string | null>(null);
	elapsedSeconds = $state(0);

	participants = $state<RoomParticipantState[]>([]);
	myReaction = $state<{ emoji: string; at: number } | null>(null);

	private tickTimer: ReturnType<typeof setInterval> | null = null;
	private simTimer: ReturnType<typeof setInterval> | null = null;
	private stopMeter: (() => void) | null = null;
	private stopDisconnectWatch: (() => void) | null = null;
	private rand = mulberry32(20260302);

	/** Seed the simulated roster from the meeting's real participant list. */
	seedParticipants(meeting: Meeting, meId: string): void {
		this.participants = meeting.participants.map((p, i) => ({
			contactId: p.contactId,
			// Everyone but you starts with camera on and unmuted, except a couple for realism.
			muted: p.contactId === meId ? !this.micOn : i % 3 === 2,
			cameraOff: p.contactId === meId ? !this.cameraOn : i % 4 === 3,
			handRaised: false,
			speaking: false,
			isSelf: p.contactId === meId
		}));
		if (!this.participants.some((p) => p.isSelf)) {
			this.participants = [
				{ contactId: meId, muted: !this.micOn, cameraOff: !this.cameraOn, handRaised: false, speaking: false, isSelf: true },
				...this.participants
			];
		}
	}

	/** Ask for camera/mic. Safe to call repeatedly (e.g. after switching device). */
	async acquire(options: { video?: boolean; audio?: boolean } = {}): Promise<void> {
		const wantVideo = options.video ?? this.cameraOn;
		const wantAudio = options.audio ?? this.micOn;

		this.requesting = true;
		this.releaseMedia();

		const result = await requestStream({
			video: wantVideo,
			audio: wantAudio,
			videoDeviceId: this.videoDeviceId || undefined,
			audioDeviceId: this.audioDeviceId || undefined
		});
		this.requesting = false;

		if (!result.ok) {
			this.failure = result.failure;
			this.stream = null;
			/*
			 * Reflect reality in the controls. ANY failure means there is no stream, so the mic
			 * and camera cannot honestly show as "on" - previously this only reset for 'denied'
			 * and 'not-found', which left the buttons reading "Mic on / Camera on" after an
			 * 'unknown' or 'in-use' failure while the preview showed "Camera is off". Caught by
			 * the live-site denied-permission probe.
			 */
			this.cameraOn = false;
			this.micOn = false;
			this.syncSelf();
			return;
		}

		this.failure = null;
		this.stream = result.stream;

		// The browser may grant audio but not video (our audio-only fallback), so derive the
		// control state from what we ACTUALLY got rather than what we asked for.
		this.cameraOn = wantVideo && result.stream.getVideoTracks().length > 0;
		this.micOn = wantAudio && result.stream.getAudioTracks().length > 0;

		this.stopMeter = createLevelMeter(result.stream, (value) => (this.level = value));
		this.stopDisconnectWatch = watchForDisconnect(result.stream, (kind) => {
			// A device vanishing mid-call must not look like the app broke.
			if (kind === 'video') this.cameraOn = false;
			else this.micOn = false;
			this.failure = {
				kind: 'disconnected',
				message: `Your ${kind === 'video' ? 'camera' : 'microphone'} was disconnected.`,
				hint: 'Reconnect it and use the control below to turn it back on.'
			};
			this.syncSelf();
		});

		this.syncSelf();
	}

	/** Tear down media without ending the session (used before re-acquiring). */
	private releaseMedia(): void {
		this.stopMeter?.();
		this.stopMeter = null;
		this.stopDisconnectWatch?.();
		this.stopDisconnectWatch = null;
		stopStream(this.stream);
		this.stream = null;
		this.level = 0;
	}

	join(): void {
		this.phase = 'joined';
		this.joinedAt = new Date().toISOString();
		this.elapsedSeconds = 0;

		this.tickTimer = setInterval(() => {
			this.elapsedSeconds += 1;
		}, 1000);

		// Simulated room activity: someone starts or stops speaking every few seconds.
		this.simTimer = setInterval(() => this.simulateTick(), 2600);
	}

	/** Toggle the mic, keeping the track state and the roster in sync. */
	toggleMic(): void {
		this.micOn = !this.micOn;
		setTrackEnabled(this.stream, 'audio', this.micOn);
		this.syncSelf();
	}

	/**
	 * Toggle the camera.
	 *
	 * If no video track exists yet (joined with camera off, or it was denied), this
	 * re-requests the stream rather than toggling a track that is not there.
	 */
	async toggleCamera(): Promise<void> {
		const next = !this.cameraOn;
		if (next && this.stream?.getVideoTracks().length === 0) {
			this.cameraOn = true;
			await this.acquire({ video: true, audio: this.micOn });
			return;
		}
		this.cameraOn = next;
		setTrackEnabled(this.stream, 'video', next);
		this.syncSelf();
	}

	toggleHand(): void {
		this.handRaised = !this.handRaised;
		this.syncSelf();
	}

	toggleRecording(): void {
		this.recording = !this.recording;
	}

	/**
	 * Screen share, using the real getDisplayMedia API.
	 * Stopping from the browser's own "stop sharing" bar is handled via the track's end event.
	 */
	async toggleScreenShare(): Promise<string | null> {
		if (this.screenSharing) {
			this.screenSharing = false;
			return null;
		}
		if (!navigator.mediaDevices?.getDisplayMedia) {
			return 'Screen sharing is not supported in this browser.';
		}
		try {
			const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
			this.screenSharing = true;
			// Respect the browser's own stop control.
			for (const track of display.getTracks()) {
				track.addEventListener('ended', () => {
					this.screenSharing = false;
					stopStream(display);
				});
			}
			return null;
		} catch (error) {
			// Cancelling the picker is a normal user action, not an error worth shouting about.
			const name = (error as { name?: string })?.name;
			return name === 'NotAllowedError' ? null : 'Could not start screen sharing.';
		}
	}

	react(emoji: string): void {
		this.myReaction = { emoji, at: Date.now() };
		setTimeout(() => {
			if (this.myReaction?.at && Date.now() - this.myReaction.at >= 2800) this.myReaction = null;
		}, 3000);
	}

	/** Mirror my control state onto my tile in the roster. */
	private syncSelf(): void {
		this.participants = this.participants.map((p) =>
			p.isSelf
				? { ...p, muted: !this.micOn, cameraOff: !this.cameraOn, handRaised: this.handRaised }
				: p
		);
	}

	/** One step of simulated room activity. */
	private simulateTick(): void {
		const others = this.participants.filter((p) => !p.isSelf && !p.muted);
		if (others.length === 0) return;

		const speakerIndex = Math.floor(this.rand() * others.length);
		const speakerId = others[speakerIndex].contactId;

		this.participants = this.participants.map((p) => ({
			...p,
			// Exactly one active speaker, which is what drives the speaker highlight.
			speaking: p.contactId === speakerId,
			// Occasionally someone raises or lowers a hand.
			handRaised: p.isSelf ? p.handRaised : this.rand() > 0.94 ? !p.handRaised : p.handRaised
		}));
	}

	/** End the session and release every resource. Idempotent. */
	leave(): void {
		if (this.tickTimer) clearInterval(this.tickTimer);
		if (this.simTimer) clearInterval(this.simTimer);
		this.tickTimer = null;
		this.simTimer = null;
		this.releaseMedia();
		this.screenSharing = false;
		this.phase = 'left';
	}

	get elapsedMinutes(): number {
		return Math.floor(this.elapsedSeconds / 60);
	}

	get timerLabel(): string {
		const total = this.elapsedSeconds;
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const s = total % 60;
		const pad = (n: number) => String(n).padStart(2, '0');
		return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
	}

	/** Contact ids currently in the room, for recording attendance on leave. */
	get attendeeIds(): string[] {
		return this.participants.map((p) => p.contactId);
	}
}
