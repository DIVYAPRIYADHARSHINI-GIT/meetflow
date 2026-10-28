/**
 * Media-handling tests.
 *
 * getUserMedia cannot run in Node, so these cover the parts that decide what the USER sees:
 * error classification, support detection, track lifecycle and disconnect watching. The
 * real permission-granted and permission-denied paths are exercised against headless Chrome
 * in `probes/e2e.probe.ts`, which can fake a webcam and deny permissions for real.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	classifyMediaError,
	hasLiveTrack,
	listDevices,
	mediaSupport,
	requestStream,
	setTrackEnabled,
	stopStream,
	watchForDisconnect
} from './media';

/** Minimal MediaStreamTrack stand-in. */
function makeTrack(kind: 'audio' | 'video', readyState: 'live' | 'ended' = 'live') {
	const listeners = new Map<string, Set<(e: unknown) => void>>();
	return {
		kind,
		readyState,
		enabled: true,
		stopped: false,
		stop() {
			this.stopped = true;
			this.readyState = 'ended';
		},
		addEventListener(type: string, fn: (e: unknown) => void) {
			if (!listeners.has(type)) listeners.set(type, new Set());
			listeners.get(type)!.add(fn);
		},
		removeEventListener(type: string, fn: (e: unknown) => void) {
			listeners.get(type)?.delete(fn);
		},
		dispatch(type: string) {
			for (const fn of listeners.get(type) ?? []) fn({});
		},
		listenerCount(type: string) {
			return listeners.get(type)?.size ?? 0;
		}
	};
}

function makeStream(tracks: ReturnType<typeof makeTrack>[]) {
	return {
		getTracks: () => tracks,
		getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
		getVideoTracks: () => tracks.filter((t) => t.kind === 'video')
	} as unknown as MediaStream;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('classifyMediaError', () => {
	const cases: [string, string][] = [
		['NotAllowedError', 'denied'],
		['PermissionDeniedError', 'denied'],
		['NotFoundError', 'not-found'],
		['DevicesNotFoundError', 'not-found'],
		['NotReadableError', 'in-use'],
		['TrackStartError', 'in-use'],
		['OverconstrainedError', 'not-found'],
		['AbortError', 'disconnected']
	];

	for (const [name, kind] of cases) {
		it(`maps ${name} to "${kind}"`, () => {
			expect(classifyMediaError({ name }).kind).toBe(kind);
		});
	}

	it('falls back to unknown for anything unexpected', () => {
		expect(classifyMediaError(new Error('boom')).kind).toBe('unknown');
		expect(classifyMediaError(null).kind).toBe('unknown');
		expect(classifyMediaError(undefined).kind).toBe('unknown');
	});

	it('always provides a message AND an actionable hint', () => {
		for (const [name] of cases) {
			const failure = classifyMediaError({ name });
			expect(failure.message.length).toBeGreaterThan(10);
			expect(failure.hint.length).toBeGreaterThan(10);
			// No raw DOMException names must leak into user-facing copy.
			expect(failure.message).not.toContain('Error');
		}
	});

	it('tells a denied user they can still join', () => {
		expect(classifyMediaError({ name: 'NotAllowedError' }).hint).toMatch(/still join/i);
	});
});

describe('mediaSupport', () => {
	it('detects a missing mediaDevices API', () => {
		vi.stubGlobal('navigator', {});
		vi.stubGlobal('window', { isSecureContext: true, location: { hostname: 'example.com' } });
		const result = mediaSupport();
		expect(result.supported).toBe(false);
		expect(result.failure?.kind).toBe('unsupported');
	});

	it('explains an insecure origin specifically', () => {
		vi.stubGlobal('navigator', {});
		vi.stubGlobal('window', { isSecureContext: false, location: { hostname: '192.168.1.5' } });
		const result = mediaSupport();
		expect(result.failure?.kind).toBe('insecure-context');
		expect(result.failure?.hint).toMatch(/https/i);
	});

	it('does not flag localhost as insecure', () => {
		vi.stubGlobal('navigator', {});
		vi.stubGlobal('window', { isSecureContext: false, location: { hostname: 'localhost' } });
		expect(mediaSupport().failure?.kind).toBe('unsupported');
	});

	it('reports supported when getUserMedia exists', () => {
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => {} } });
		expect(mediaSupport().supported).toBe(true);
	});
});

describe('requestStream', () => {
	it('returns an empty stream when nothing was asked for', async () => {
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });
		vi.stubGlobal('MediaStream', class { getTracks() { return []; } });
		const result = await requestStream({ video: false, audio: false });
		expect(result.ok).toBe(true);
		expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
	});

	it('passes an exact deviceId when one is chosen', async () => {
		const getUserMedia = vi.fn().mockResolvedValue(makeStream([makeTrack('video')]));
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
		vi.stubGlobal('window', { isSecureContext: true, location: { hostname: 'x.test' } });

		await requestStream({ video: true, audio: false, videoDeviceId: 'cam-2' });
		expect(getUserMedia).toHaveBeenCalledWith(
			expect.objectContaining({ video: { deviceId: { exact: 'cam-2' } }, audio: false })
		);
	});

	it('falls back to audio-only when the camera fails but the mic could work', async () => {
		const getUserMedia = vi
			.fn()
			.mockRejectedValueOnce({ name: 'NotFoundError' })
			.mockResolvedValueOnce(makeStream([makeTrack('audio')]));
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
		vi.stubGlobal('window', { isSecureContext: true, location: { hostname: 'x.test' } });

		const result = await requestStream({ video: true, audio: true });
		expect(result.ok).toBe(true);
		expect(getUserMedia).toHaveBeenCalledTimes(2);
		// The retry must not ask for video again.
		expect(getUserMedia.mock.calls[1][0]).toMatchObject({ video: false });
	});

	it('does NOT retry when permission was denied outright', async () => {
		// A denial covers the whole prompt, so retrying just produces a second rejection.
		const getUserMedia = vi.fn().mockRejectedValue({ name: 'NotAllowedError' });
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
		vi.stubGlobal('window', { isSecureContext: true, location: { hostname: 'x.test' } });

		const result = await requestStream({ video: true, audio: true });
		expect(result.ok).toBe(false);
		expect(getUserMedia).toHaveBeenCalledTimes(1);
		if (!result.ok) expect(result.failure.kind).toBe('denied');
	});

	it('reports failure when the audio-only retry also fails', async () => {
		const getUserMedia = vi.fn().mockRejectedValue({ name: 'NotReadableError' });
		vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
		vi.stubGlobal('window', { isSecureContext: true, location: { hostname: 'x.test' } });

		const result = await requestStream({ video: true, audio: true });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.failure.kind).toBe('in-use');
	});
});

describe('listDevices', () => {
	it('returns an empty list when enumeration is unavailable', async () => {
		vi.stubGlobal('navigator', { mediaDevices: {} });
		expect(await listDevices()).toEqual([]);
	});

	it('substitutes a label when the browser withholds it', async () => {
		vi.stubGlobal('navigator', {
			mediaDevices: {
				enumerateDevices: async () => [
					{ deviceId: 'a', kind: 'videoinput', label: '' },
					{ deviceId: 'b', kind: 'audioinput', label: 'Blue Yeti' },
					{ deviceId: 'c', kind: 'audiooutput', label: 'Speakers' }
				]
			}
		});
		const devices = await listDevices();
		// audiooutput is filtered out; MeetFlow only picks inputs.
		expect(devices).toHaveLength(2);
		expect(devices[0].label).toMatch(/^Camera/);
		expect(devices[1].label).toBe('Blue Yeti');
	});

	it('survives enumerateDevices throwing', async () => {
		vi.stubGlobal('navigator', {
			mediaDevices: {
				enumerateDevices: async () => {
					throw new Error('nope');
				}
			}
		});
		expect(await listDevices()).toEqual([]);
	});
});

describe('stopStream', () => {
	it('stops every track', () => {
		const tracks = [makeTrack('audio'), makeTrack('video')];
		stopStream(makeStream(tracks));
		expect(tracks.every((t) => t.stopped)).toBe(true);
	});

	it('is safe with null and with a track that throws', () => {
		expect(() => stopStream(null)).not.toThrow();
		expect(() => stopStream(undefined)).not.toThrow();

		const bad = {
			getTracks: () => [
				{
					stop() {
						throw new Error('already gone');
					}
				}
			]
		} as unknown as MediaStream;
		expect(() => stopStream(bad)).not.toThrow();
	});
});

describe('setTrackEnabled', () => {
	it('toggles only the requested kind', () => {
		const audio = makeTrack('audio');
		const video = makeTrack('video');
		const stream = makeStream([audio, video]);

		setTrackEnabled(stream, 'audio', false);
		expect(audio.enabled).toBe(false);
		expect(video.enabled).toBe(true);

		setTrackEnabled(stream, 'video', false);
		expect(video.enabled).toBe(false);
	});

	it('is safe with a null stream', () => {
		expect(() => setTrackEnabled(null, 'audio', false)).not.toThrow();
	});
});

describe('hasLiveTrack', () => {
	it('is true only for a live track of that kind', () => {
		const stream = makeStream([makeTrack('audio', 'live'), makeTrack('video', 'ended')]);
		expect(hasLiveTrack(stream, 'audio')).toBe(true);
		expect(hasLiveTrack(stream, 'video')).toBe(false);
		expect(hasLiveTrack(null, 'audio')).toBe(false);
	});
});

describe('watchForDisconnect', () => {
	it('fires when a track ends, naming the kind', () => {
		const video = makeTrack('video');
		const onDisconnect = vi.fn();
		watchForDisconnect(makeStream([video]), onDisconnect);

		video.dispatch('ended');
		expect(onDisconnect).toHaveBeenCalledWith('video');
	});

	it('removes its listeners on cleanup so the room can be re-entered', () => {
		const audio = makeTrack('audio');
		const cleanup = watchForDisconnect(makeStream([audio]), vi.fn());
		expect(audio.listenerCount('ended')).toBe(1);
		cleanup();
		expect(audio.listenerCount('ended')).toBe(0);
	});

	it('returns a no-op cleanup for a null stream', () => {
		expect(() => watchForDisconnect(null, vi.fn())()).not.toThrow();
	});
});
