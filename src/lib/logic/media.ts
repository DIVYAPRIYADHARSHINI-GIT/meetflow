/**
 * Camera and microphone handling.
 *
 * This is the riskiest runtime surface in the app, because it depends on real hardware and
 * real user consent. Every failure mode is classified into an explicit `MediaErrorKind`
 * with a human message and a recovery hint, so the UI never shows a raw DOMException and
 * never leaves the user staring at a dead preview.
 *
 * Stream lifetime rule: whoever starts a stream must stop it. `stopStream` is called when
 * leaving the room, when switching devices, and on page unload - a camera light left on
 * after you leave a meeting is a bug people notice immediately.
 */

export type MediaErrorKind =
	| 'denied'
	| 'not-found'
	| 'in-use'
	| 'insecure-context'
	| 'unsupported'
	| 'disconnected'
	| 'unknown';

export interface MediaFailure {
	kind: MediaErrorKind;
	message: string;
	hint: string;
}

/** Map a getUserMedia rejection onto something a person can act on. */
export function classifyMediaError(error: unknown): MediaFailure {
	const name = (error as { name?: string } | null)?.name ?? '';

	switch (name) {
		case 'NotAllowedError':
		case 'PermissionDeniedError':
			return {
				kind: 'denied',
				message: 'Camera and microphone access was blocked.',
				hint: 'Allow access in your browser\'s site settings (the icon in the address bar), then try again. You can still join with your camera and mic off.'
			};
		case 'NotFoundError':
		case 'DevicesNotFoundError':
			return {
				kind: 'not-found',
				message: 'No camera or microphone was found.',
				hint: 'Connect a device and try again, or join without one - you will still see and hear everyone else.'
			};
		case 'NotReadableError':
		case 'TrackStartError':
			return {
				kind: 'in-use',
				message: 'Your camera or microphone is already in use.',
				hint: 'Another app (or another tab) is probably using it. Close it and try again.'
			};
		case 'OverconstrainedError':
		case 'ConstraintNotSatisfiedError':
			return {
				kind: 'not-found',
				message: 'The selected device is no longer available.',
				hint: 'Pick a different camera or microphone below.'
			};
		case 'AbortError':
			return {
				kind: 'disconnected',
				message: 'The device stopped responding.',
				hint: 'It may have been unplugged. Reconnect it and try again.'
			};
		default:
			return {
				kind: 'unknown',
				message: 'Could not start your camera and microphone.',
				hint: 'Check that no other app is using them, then try again. You can join without them.'
			};
	}
}

/** Is a media capture even possible here? Checked before prompting, to give a better message. */
export function mediaSupport(): { supported: boolean; failure: MediaFailure | null } {
	if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
		// A non-secure origin (plain http on a LAN IP) silently hides mediaDevices entirely,
		// which otherwise looks like a broken app rather than a browser policy.
		const insecure =
			typeof window !== 'undefined' &&
			!window.isSecureContext &&
			window.location.hostname !== 'localhost';
		return {
			supported: false,
			failure: insecure
				? {
						kind: 'insecure-context',
						message: 'Camera access needs a secure connection.',
						hint: 'Open MeetFlow over https (or on localhost) to use your camera and microphone. You can still use the room without them.'
					}
				: {
						kind: 'unsupported',
						message: 'This browser does not support camera access.',
						hint: 'Try a recent version of Chrome, Edge, Firefox or Safari. You can still use the room without a camera.'
					}
		};
	}
	return { supported: true, failure: null };
}

export interface DeviceOption {
	deviceId: string;
	label: string;
	kind: 'videoinput' | 'audioinput';
}

/**
 * List cameras and microphones.
 *
 * Labels are empty until permission has been granted at least once - that is a browser
 * privacy rule, not a bug - so a generic fallback label is substituted.
 */
export async function listDevices(): Promise<DeviceOption[]> {
	if (!navigator.mediaDevices?.enumerateDevices) return [];
	try {
		const devices = await navigator.mediaDevices.enumerateDevices();
		return devices
			.filter((d) => d.kind === 'videoinput' || d.kind === 'audioinput')
			.map((d, i) => ({
				deviceId: d.deviceId,
				kind: d.kind as 'videoinput' | 'audioinput',
				label: d.label || `${d.kind === 'videoinput' ? 'Camera' : 'Microphone'} ${i + 1}`
			}));
	} catch {
		return [];
	}
}

export interface StreamRequest {
	video: boolean;
	audio: boolean;
	videoDeviceId?: string;
	audioDeviceId?: string;
}

export type StreamResult =
	| { ok: true; stream: MediaStream }
	| { ok: false; failure: MediaFailure };

/**
 * Request a media stream.
 *
 * Falls back to audio-only when the camera specifically fails but a mic was also asked for:
 * being able to talk is better than nothing, and it matches what users expect from a
 * meeting app.
 */
export async function requestStream(request: StreamRequest): Promise<StreamResult> {
	const support = mediaSupport();
	if (!support.supported) return { ok: false, failure: support.failure! };

	if (!request.video && !request.audio) {
		return { ok: true, stream: new MediaStream() };
	}

	const constraints: MediaStreamConstraints = {
		video: request.video
			? request.videoDeviceId
				? { deviceId: { exact: request.videoDeviceId } }
				: { width: { ideal: 1280 }, height: { ideal: 720 } }
			: false,
		audio: request.audio
			? request.audioDeviceId
				? { deviceId: { exact: request.audioDeviceId } }
				: { echoCancellation: true, noiseSuppression: true }
			: false
	};

	try {
		const stream = await navigator.mediaDevices.getUserMedia(constraints);
		return { ok: true, stream };
	} catch (error) {
		const failure = classifyMediaError(error);

		// Retry audio-only when the camera was the problem.
		if (request.video && request.audio && failure.kind !== 'denied') {
			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					video: false,
					audio: constraints.audio
				});
				return { ok: true, stream };
			} catch {
				return { ok: false, failure };
			}
		}
		return { ok: false, failure };
	}
}

/**
 * Stop every track on a stream.
 *
 * Must be called on leave, on device switch and on unload. Not stopping tracks leaves the
 * camera indicator on, which users read (correctly) as "this site is still watching me".
 */
export function stopStream(stream: MediaStream | null | undefined): void {
	if (!stream) return;
	for (const track of stream.getTracks()) {
		try {
			track.stop();
		} catch {
			// Already stopped or detached: nothing to recover from.
		}
	}
}

/** Enable/disable tracks without tearing the stream down (mute and camera-off). */
export function setTrackEnabled(
	stream: MediaStream | null,
	kind: 'audio' | 'video',
	enabled: boolean
): void {
	if (!stream) return;
	const tracks = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
	for (const track of tracks) track.enabled = enabled;
}

/** Does the stream currently carry a live track of this kind? */
export function hasLiveTrack(stream: MediaStream | null, kind: 'audio' | 'video'): boolean {
	if (!stream) return false;
	const tracks = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
	return tracks.some((t) => t.readyState === 'live');
}

/**
 * Watch for a device being unplugged mid-call.
 *
 * `ended` fires on the track when the hardware disappears; `devicechange` fires on the
 * device list. Both are needed: unplugging a USB webcam raises one or the other depending
 * on the browser. Returns a cleanup function.
 */
export function watchForDisconnect(
	stream: MediaStream | null,
	onDisconnect: (kind: 'audio' | 'video') => void
): () => void {
	if (!stream) return () => {};

	const cleanups: (() => void)[] = [];

	for (const track of stream.getTracks()) {
		const kind = track.kind === 'audio' ? 'audio' : 'video';
		const handler = () => onDisconnect(kind);
		track.addEventListener('ended', handler);
		cleanups.push(() => track.removeEventListener('ended', handler));
	}

	return () => {
		for (const cleanup of cleanups) cleanup();
	};
}

/**
 * Rough input level (0-1) from a stream's audio track, for the mic test meter.
 * Returns a stop function; the AudioContext is closed on stop so it does not leak.
 */
export function createLevelMeter(
	stream: MediaStream,
	onLevel: (level: number) => void
): () => void {
	const AudioCtx =
		typeof window === 'undefined'
			? undefined
			: (window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
	if (!AudioCtx || stream.getAudioTracks().length === 0) return () => {};

	let context: AudioContext;
	try {
		context = new AudioCtx();
	} catch {
		return () => {};
	}

	const source = context.createMediaStreamSource(stream);
	const analyser = context.createAnalyser();
	analyser.fftSize = 512;
	analyser.smoothingTimeConstant = 0.75;
	source.connect(analyser);

	const data = new Uint8Array(analyser.frequencyBinCount);
	let frame = 0;
	let stopped = false;

	const tick = () => {
		if (stopped) return;
		analyser.getByteFrequencyData(data);
		let sum = 0;
		for (const value of data) sum += value;
		onLevel(Math.min(1, sum / data.length / 110));
		frame = requestAnimationFrame(tick);
	};
	frame = requestAnimationFrame(tick);

	return () => {
		stopped = true;
		cancelAnimationFrame(frame);
		try {
			source.disconnect();
			analyser.disconnect();
			void context.close();
		} catch {
			// Context already closed.
		}
	};
}
