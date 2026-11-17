// A cached art pack must survive being opened twice. The embed keeps the assembled pack so a quality retry or a
// re-open never downloads the art twice; the engine used to TRANSFER packBlob.buffer to the worker, which detaches it,
// so the second open threw "Failed to execute 'postMessage' on 'Worker': ArrayBuffer at index 1 is already detached".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const url = pathToFileURL(resolve('static/replay/engine/tape-player.mjs')).href;

// a worker whose postMessage behaves like the browser's: transferred buffers are DETACHED on the sending side.
// It answers `open` with `opened`, and the first frame request with an error so load() stops right after the open.
class FakeWorker {
	static opens = [];
	constructor() { this.onmessage = null; }
	postMessage(msg, transfer = []) {
		const copy = structuredClone(msg, { transfer }); // throws DataCloneError on an already-detached buffer, like Chrome
		if (msg.type === 'open') {
			FakeWorker.opens.push({ packBytes: copy.packBlob.byteLength, tapeBytes: copy.tape.byteLength });
			queueMicrotask(() => this.onmessage?.({ data: { type: 'opened', ms: 1, info: { frames: 5, first_clock: 0, viewport: [0, 0, 1, 1], sceneRT: null, inputLayouts: null } } }));
		} else if (msg.type === 'frame') {
			queueMicrotask(() => this.onmessage?.({ data: { type: 'error', i: msg.i, message: 'stop here' } }));
		}
	}
	terminate() {}
}

test('opening the same cached pack twice never detaches it (the quality retry path)', async () => {
	globalThis.Worker = FakeWorker;
	globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array(1024).buffer });
	const { TapePlayer } = await import(url);
	const assembled = { packIndex: [{ name: 'a', off: 0, len: 4096 }], packBlob: new Uint8Array(4096).fill(7) };
	const errors = [];
	for (let attempt = 0; attempt < 2; attempt++) {
		const p = new TapePlayer({}, 'bgra8unorm', {});
		try { await p.load('/tape.json.gz', assembled, {}); } catch (e) { errors.push(String(e?.message ?? e)); }
	}
	assert.equal(FakeWorker.opens.length, 2, 'both opens reached the worker');
	assert.deepEqual(FakeWorker.opens.map((o) => o.packBytes), [4096, 4096], 'the worker got the whole pack both times');
	assert.equal(assembled.packBlob.byteLength, 4096, 'the cached pack was not detached');
	assert.ok(errors.every((m) => !/detached/i.test(m)), `unexpected: ${errors.join(' | ')}`);
});
