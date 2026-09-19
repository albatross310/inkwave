import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../../public/readalong/core.mjs';
const source = (await readFile(new URL('../../public/readalong/app.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace(/^init\(\)\.catch\(error\);$/m, '');
const profile = { voiceId: 'testvoice1234', voiceName: 'Fixture', model: 'eleven_v3', delivery: 'steady' };
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function reader(overrides = {}) {
  const nodes = new Map();
  function node() {
    return { value: '', checked: true, dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, append() {}, replaceChildren() {},
      querySelectorAll() { return []; }, pause() {}, load() {}, close() {}, currentTime: 0, paused: true, playbackRate: 1 };
  }
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); }, createElement: node,
    createTextNode: value => value, querySelectorAll: () => [], addEventListener() {}, documentElement: node(), body: node() };
  const window = { addEventListener() {}, confirm: overrides.confirm || (() => false), parent: { document: { documentElement: { dataset: { theme: 'night' } } } } };
  const db = { get: async () => undefined, keys: async () => [], all: async () => [], put: async () => {}, ...overrides.db };
  const context = vm.createContext({ ...core, document, window, db, importBook: overrides.importBook,
    navigator: { locks: overrides.locks || { request() { throw new Error('No rendering should start in this test'); } } },
    URL, Blob, TextDecoder, AbortSignal, atob, fetch: overrides.fetch, setTimeout: (...args) => { const timer = setTimeout(...args); timer.unref(); return timer; }, clearTimeout, cancelAnimationFrame() {}, location: { origin: 'https://iwzero.me', hostname: overrides.hostname || 'iwzero.me' } });
  vm.runInContext(source + '\nglobalThis.testReader = { state, importText, openFile, applyProfile, renderSelection, loadChunk, seekBy, pauseForClose, seekToWord, populateVoiceFields, api, init };', context);
  const app = context.testReader;
  app.state.profile = { ...(overrides.profile || profile) };
  app.state.book = { id: 'fixture', text: 'A sentence.', title: 'Fixture' };
  app.state.chapters = core.makeChapters(app.state.book.text);
  app.state.chunks = core.chunksForProfile(app.state.book.text, app.state.profile, app.state.chapters);
  app.populateVoiceFields(); document.getElementById('credential').value = 'mock-key';
  return { app, document, db };
}
test('render preparation reserves the edition before asynchronous cache reads', async () => {
  const keys = deferred(), started = deferred();
  const { app } = reader({ db: { keys: () => { started.resolve(); return keys.promise; } } });
  const rendering = app.renderSelection('book'); await started.promise;
  assert.equal(app.state.preparing, true);
  await assert.rejects(app.importText('Other book', 'Different sentence.'), /Pause rendering/);
  await assert.rejects(app.applyProfile(), /Pause rendering/);
  await assert.rejects(app.renderSelection('book'), /Pause rendering/);
  keys.resolve([]); await rendering;
  assert.equal(app.state.preparing, false);
  assert.equal(app.state.book.id, 'fixture');
});
test('archive import blocks paid preparation until validation and storage finish', async () => {
  const pending = deferred();
  const { app } = reader({ importBook: () => pending.promise });
  const opening = app.openFile({ name: 'fixture.iwlisten' });
  assert.equal(app.state.opening, true);
  await assert.rejects(app.renderSelection('book'), /finish loading/);
  await assert.rejects(app.applyProfile(), /finish loading/);
  pending.reject(new Error('Synthetic archive failure'));
  await assert.rejects(opening, /Synthetic archive failure/);
  assert.equal(app.state.opening, false);
  assert.equal(app.state.profile.voiceId, profile.voiceId);
});
test('profile change reserves state while the previous listening place is saved', async () => {
  const pending = deferred(), started = deferred();
  const { app } = reader({ db: { put: () => { started.resolve(); return pending.promise; } } });
  app.state.ready = true;
  const changing = app.applyProfile(); await started.promise;
  assert.equal(app.state.opening, true);
  await assert.rejects(app.renderSelection('book'), /finish loading/);
  // Stop before rendering text; the assertion concerns the save boundary, not DOM layout.
  app.state.book = null;
  pending.resolve(); await changing;
  assert.equal(app.state.opening, false);
});
test('embedded theme inherits the host only when no reader preference exists', async () => {
  for (const preference of [undefined, 'day', 'night']) {
    const { app, document } = reader({ db: { get: async (_, id) => id === 'preferences' && preference ? { theme: preference } : undefined } });
    app.state.book = null;
    await app.init();
    assert.equal(document.documentElement.dataset.theme || 'day', preference ?? 'night');
  }
});
test('closing during preparation cancels before the billing confirmation', async () => {
  const pending = deferred(), started = deferred(); let confirmations = 0;
  const { app } = reader({ confirm: () => { confirmations++; return true; }, db: { keys: () => { started.resolve(); return pending.promise; } } });
  const rendering = app.renderSelection('sample'); await started.promise;
  app.pauseForClose(); pending.resolve([]); await rendering;
  assert.equal(confirmations, 0);
  assert.equal(app.state.preparing, false);
});
test('a pending Web Lock callback cannot restart a reader closed after confirmation', async () => {
  const pending = deferred(), started = deferred();
  const { app } = reader({ confirm: () => true, locks: { async request(_, __, run) { started.resolve(); await pending.promise; return run({ name: 'mock-lock' }); } } });
  const rendering = app.renderSelection('sample'); await started.promise;
  app.pauseForClose(); pending.resolve(); await rendering;
  assert.equal(app.state.stop, true);
  assert.equal(app.state.rendering, false);
  assert.equal(app.state.preparing, false);
});
test('pausing during the last cache read prevents the next paid request', async () => {
  const pending = deferred(), started = deferred();
  const { app } = reader({ confirm: () => true,
    locks: { request: (_, __, run) => run({ name: 'mock-lock' }) },
    db: { get: () => { started.resolve(); return pending.promise; } },
  });
  const rendering = app.renderSelection('book'); await started.promise;
  app.pauseForClose(); pending.resolve(undefined); await rendering;
  assert.equal(app.state.stop, true);
  assert.equal(app.state.rendering, false);
  // No fetch is installed in this VM: reaching a paid request makes the test fail.
});
test('closing also cancels pending playback of an already cached recording', async () => {
  const pending = deferred(), started = deferred();
  const { app } = reader({ db: { get: () => { started.resolve(); return pending.promise; } } });
  app.state.chunkKeys = ['fixture-audio'];
  const playback = app.loadChunk(0, true); await started.promise;
  app.pauseForClose();
  pending.resolve({ id: 'fixture-audio', blob: new Blob(['cached audio']), mode: 'passage', words: [] });
  assert.equal(await playback, false);
  assert.equal(app.state.asset, null);
});
test('closing during a backward passage seek cannot resume playback', async () => {
  const pending = deferred(), started = deferred();
  const { app, document } = reader({ db: { get: () => { started.resolve(); return pending.promise; } } });
  app.state.chunks.push({ ...app.state.chunks[0], index: 1 });
  app.state.chunkKeys = ['previous-audio', 'current-audio'];
  app.state.cached.add('previous-audio'); app.state.playingChunk = 1;
  app.state.asset = { id: 'current-audio' };
  const audio = document.getElementById('audio');
  audio.paused = false; audio.currentTime = 2; audio.duration = 18;
  let plays = 0;
  audio.play = async () => { plays++; };
  const seeking = app.seekBy(-10); await started.promise;
  app.pauseForClose();
  pending.resolve({ id: 'previous-audio', blob: new Blob(['cached audio']), mode: 'passage', words: [] });
  await seeking;
  assert.equal(plays, 0);
  assert.equal(audio.currentTime, 2);
});
test('closing during a clicked-word cache read prevents a new playback load', async () => {
  const pending = deferred(); let reads = 0;
  const { app } = reader({ db: { get: () => { reads++; return pending.promise; } } });
  const seeking = app.seekToWord(0);
  app.pauseForClose();
  pending.resolve({ words: [{ start: 0, from: 0 }] });
  await seeking;
  assert.equal(reads, 1, 'The cancelled click must not initiate loadChunk and read audio again.');
});
test('local rendering needs no credentials, consent or credit confirmation and never sends retained keys', async () => {
  const calls = [], saved = [];
  const { app, document } = reader({ hostname: 'localhost', profile: core.defaultProfile('localhost'),
    confirm: () => { throw new Error('Local narration must not ask for paid confirmation'); },
    locks: { request: (_, __, run) => run({ name: 'local-fixture' }) },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ audio_base64: 'V0FW', mime: 'audio/wav', alignment: { characters: [] }, alignmentReason: 'Local passage highlighting only.' }) }; },
    db: { put: async (store, value) => saved.push({ store, value }) },
  });
  document.getElementById('credential').value = ''; document.getElementById('consent').checked = false;
  app.state.credential = 'retained-paid-key';
  await app.renderSelection('book');
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/readalong-local');
  assert.deepEqual(Object.keys(calls[0].options.headers), ['Content-Type']);
  assert.equal(calls[0].options.credentials, 'omit');
  assert.equal(JSON.parse(calls[0].options.body).model, 'kokoro_v1_0');
  assert.equal(saved[0].value.blob.type, 'audio/wav');
  assert.equal(saved[0].value.mode, 'passage'); assert.equal(saved[0].value.words.length, 0);
  assert.equal(saved[0].value.reason, 'Local passage highlighting only.');
  assert.equal(app.state.credential, 'retained-paid-key');
});
test('local network failures mention no charge, and hosted pages never call the local endpoint', async () => {
  const local = core.defaultProfile('localhost');
  const { app } = reader({ hostname: 'localhost', profile: local, fetch: async () => { throw new Error('offline'); } });
  await assert.rejects(app.api({ action: 'render', ...local, text: 'Test.' }), error => /local narration/.test(error.message) && !/charged|credits/.test(error.message));
  const hosted = reader({ profile: local, fetch: async () => { throw new Error('Should not fetch'); } });
  await assert.rejects(hosted.app.api({ action: 'voices' }), /Open the local Inkwave/);
});
