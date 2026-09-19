import { VERSION, DIRECTOR_BRIEF, cleanText, words, makeChapters, chunksForProfile, digest, cacheKey, alignWords, wordAtTime, voiceScore, validateProfile, formatTime, LOCAL_MODEL, isLocalProfile, defaultProfile } from './core.mjs';
import * as db from './storage.mjs';
import { exportBook, importBook } from './archive.mjs';
const $ = id => document.getElementById(id);
const audio = $('audio');
const state = {
  book: null, chapters: [], chunks: [], chunkKeys: [], cached: new Set(), chapter: 0,
  profile: defaultProfile(location.hostname), profiles: {}, voiceSerial: 0,
  credential: '', credentialKind: 'key', voices: [], asset: null, playingChunk: -1,
  url: '', loadSerial: 0, rendering: false, preparing: false, opening: false, stop: false, ready: false, rescue: null,
  follow: true, focus: false, activeWord: null, activeParagraph: null, marks: [],
  search: [], searchIndex: -1, wordsByStart: new Map(), timeToRestore: 0, sleepAt: 0,
};
let toastTimer, raf = 0, lastSaved = 0, saveChain = Promise.resolve(), librarySerial = 0;
function notify(text, sticky = false) {
  clearTimeout(toastTimer); $('toast').textContent = text; $('toast').hidden = false;
  if (!sticky) toastTimer = setTimeout(() => { $('toast').hidden = true; }, 9000);
}
function error(e) { notify(e?.message || String(e), true); }
function action(id, fn) { $(id).addEventListener('click', () => { Promise.resolve().then(fn).catch(error); }); }
function element(tag, text, className) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (className) e.className = className; return e; }
function download(blob, name) { const u = URL.createObjectURL(blob), a = element('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 30_000); }
function currentPosition() { return { chapter: state.chapter, chunk: state.playingChunk, time: Number.isFinite(audio.currentTime) ? audio.currentTime : 0, marks: state.marks }; }
function positionId() { return `place:${state.book?.id}:${state.profile.voiceId}:${state.profile.model}:${state.profile.delivery}`; }
function queueSave(store, value) { saveChain = saveChain.then(() => db.put(store, value)).catch(e => { error(e); }); return saveChain; }
function savePosition() { if (state.book && state.ready) return queueSave('prefs', { id: positionId(), ...currentPosition() }); }
function savePreferences() {
  queueSave('prefs', { id: 'preferences', profile: state.profile, profiles: state.profiles, font: Number($('font-size').value), theme: document.documentElement.dataset.theme || 'day', speed: audio.playbackRate });
}
function ensureBook() { if (!state.book) throw new Error('Open a book first.'); }
function notRendering() { if (state.opening) throw new Error('Please wait for the book to finish loading.'); if (state.rendering || state.preparing) throw new Error('Pause rendering and let the current passage finish before changing books or voices.'); }
function showLibrary(open) { document.body.classList.toggle('library-open', open); $('library-toggle').setAttribute('aria-expanded', String(open)); }
function voiceCaption() {
  $('voice-caption').textContent = state.profile.voiceId ? `${state.profile.voiceName || state.profile.voiceId} · ${isLocalProfile(state.profile) ? 'Local Kokoro · free · passage highlighting' : state.profile.model === 'eleven_v3' ? 'Eleven v3' : 'Multilingual v2'} · ${state.profile.delivery} · AI narration` : 'Choose an ElevenLabs voice · AI narration';
}
async function refreshKeys() {
  state.chunkKeys = state.profile.voiceId ? await Promise.all(state.chunks.map(chunk => cacheKey(chunk, state.profile))) : [];
  state.cached = new Set(await db.keys('audio'));
  updateProgress();
}
function updateProgress() {
  const busy = state.rendering || state.preparing;
  const count = state.chunkKeys.filter(key => state.cached.has(key)).length;
  $('render-progress').max = Math.max(1, state.chunks.length); $('render-progress').value = count;
  $('render-status').textContent = state.book ? `${count} / ${state.chunks.length} passages saved${isLocalProfile(state.profile) ? ' · local Kokoro' : ''}${state.rendering ? ' · rendering' : ''}` : 'Import text to begin.';
  const remaining = state.chunks.filter((_, i) => !state.cached.has(state.chunkKeys[i]));
  $('render-summary').textContent = state.book ? `${remaining.length} uncached passages · ${remaining.reduce((n, c) => n + c.text.length, 0).toLocaleString()} text characters. Completed passages are reused with the same voice and settings.` : 'Open a book first.';
  $('stop-render').hidden = !state.rendering;
  $('save-recovery').hidden = !state.rescue;
  for (const id of ['engine', 'local-voices', 'connect', 'disconnect', 'credential', 'credential-kind', 'model', 'delivery', 'voice-id', 'voice-select', 'clear-edition']) $(id).disabled = busy;
  $('render-open').hidden = busy;
  for (const id of ['render-sample', 'render-chapter', 'render-book', 'save-profile']) $(id).disabled = busy;
  updateEngineFields();
  renderChapterNav();
}
function renderChapterNav() {
  $('chapters').replaceChildren();
  for (const chapter of state.chapters) {
    const button = element('button', chapter.title);
    button.setAttribute('aria-current', String(chapter.index === state.chapter));
    const chunks = state.chunks.filter(c => c.chapter === chapter.index), saved = chunks.filter(c => state.cached.has(state.chunkKeys[c.index])).length;
    button.append(element('span', `${saved}/${chunks.length}`));
    button.addEventListener('click', () => navigateChapter(chapter.index));
    $('chapters').append(button);
  }
}
async function refreshLibrary() {
  const serial = ++librarySerial;
  const books = await db.all('books');
  if (serial !== librarySerial) return;
  $('books').replaceChildren();
  for (const book of books.sort((a, b) => b.createdAt - a.createdAt)) {
    const b = element('button', book.title); b.setAttribute('aria-current', String(book.id === state.book?.id));
    b.addEventListener('click', () => openBook(book).catch(error)); $('books').append(b);
  }
}
async function importText(title, input) {
  notRendering(); state.opening = true;
  try { return await importTextInner(title, input); } finally { state.opening = false; }
}
async function importTextInner(title, input, importNote = '') {
  const text = cleanText(input), id = await digest(text);
  const book = await db.addBookIfAbsent({ id, text, title: String(title || 'Untitled reading').replace(/\.(txt|md|markdown|epub|pdf)$/i, '').slice(0, 180), importNote, createdAt: Date.now() });
  await openBookInner(book); notify(importNote || 'Added to your local shelf. No text has been sent for narration.', !!importNote);
}
async function openFile(file) {
  notRendering(); state.opening = true;
  try { return await openFileInner(file); } finally { state.opening = false; }
}
async function openFileInner(file) {
  if (/\.iwlisten$/i.test(file.name)) {
    const imported = await importBook(file); await savePosition(); state.profile = imported.profile; savePreferences();
    await openBookInner(imported.book, false); populateVoiceFields(); notify(`Imported ${imported.assetCount} saved passages. No new generation needed.`); return;
  }
  const signature = new TextDecoder('latin1').decode(await file.slice(0, 1024).arrayBuffer());
  const pdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf' || signature.includes('%PDF-');
  const epub = /\.epub$/i.test(file.name) || file.type === 'application/epub+zip';
  if (pdf || epub) {
    notify(`Opening ${pdf ? 'PDF' : 'EPUB'} on this device…`, true);
    const extract = pdf ? (await import('./import-pdf.mjs')).extractPdf : (await import('./import-epub.mjs')).extractEpub;
    const result = await extract(file, { onProgress: message => notify(message, true) });
    await importTextInner(result.title || file.name, result.text, (result.warnings || []).join(' '));
    return;
  }
  if (file.size > 8_000_000) throw new Error('Choose a UTF-8 text file smaller than 8 MB, or an .iwlisten backup.');
  const bytes = await file.arrayBuffer();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('This file is not UTF-8 text. Export it as plain UTF-8 text before opening.'); }
  if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(text)) throw new Error('This is an HTML page, not a text manuscript. Open the original .txt book rather than the old reader HTML.');
  await importTextInner(file.name, text);
}
function unloadAudio() {
  state.loadSerial++; audio.pause(); audio.removeAttribute('src'); audio.load();
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = ''; state.asset = null; clearHighlight();
}
async function openBook(book, saveCurrent = true) {
  notRendering(); state.opening = true;
  try { return await openBookInner(book, saveCurrent); } finally { state.opening = false; }
}
async function openBookInner(book, saveCurrent = true) {
  if (saveCurrent) await savePosition(); state.ready = false; unloadAudio();
  state.book = book; state.chapters = makeChapters(book.text); state.chunks = chunksForProfile(book.text, state.profile, state.chapters);
  const saved = await db.get('prefs', positionId());
  state.chapter = Number.isInteger(saved?.chapter) ? Math.min(Math.max(saved.chapter, 0), state.chapters.length - 1) : 0;
  state.playingChunk = Number.isInteger(saved?.chunk) && state.chunks[saved.chunk] ? saved.chunk : state.chunks.find(c => c.chapter === state.chapter)?.index ?? 0;
  state.timeToRestore = Math.max(0, Number(saved?.time) || 0);
  state.marks = Array.isArray(saved?.marks) ? saved.marks.filter(m => Number.isInteger(m.chunk) && state.chunks[m.chunk] && Number.isFinite(m.time)).slice(0, 500) : [];
  $('empty').hidden = true; $('book-view').hidden = false; $('book-title').textContent = book.title;
  $('import-note').textContent = book.importNote || ''; $('import-note').hidden = !book.importNote;
  await refreshKeys(); state.ready = true; voiceCaption(); renderText(); await refreshLibrary();
  queueSave('prefs', { id: 'last-book', bookId: book.id });
  showLibrary(false);
  if (state.cached.has(state.chunkKeys[state.playingChunk])) await loadChunk(state.playingChunk, false, state.timeToRestore, false);
  else { $('passage-label').textContent = 'Render a passage to listen'; $('elapsed').textContent = '0:00'; $('duration').textContent = '0:00'; }
}
function renderText() {
  const chapter = state.chapters[state.chapter]; if (!chapter) return;
  clearHighlight(); state.wordsByStart.clear(); $('text').replaceChildren();
  $('chapter-number').textContent = `SECTION ${state.chapter + 1} OF ${state.chapters.length}`;
  $('chapter-title').textContent = chapter.title;
  const text = state.book.text.slice(chapter.start, chapter.end);
  $('chapter-meta').textContent = `${words(text).length.toLocaleString()} words · click a recorded word to seek`;
  const firstLine = text.split('\n', 1)[0];
  let bodyOffset = 0;
  if (firstLine.replace(/^#+\s*/, '') === chapter.title) {
    $('chapter-title').replaceChildren(); let last = 0;
    for (const word of words(firstLine)) {
      $('chapter-title').append(document.createTextNode(firstLine.slice(last, word.start)));
      const span = element('span', word.text, 'word'); span.dataset.start = String(chapter.start + word.start); span.dataset.end = String(chapter.start + word.end);
      state.wordsByStart.set(chapter.start + word.start, span); $('chapter-title').append(span); last = word.end;
    }
    bodyOffset = firstLine.length;
  }
  // The heading is rendered above, with its original timing offsets, not duplicated.
  for (const match of text.slice(bodyOffset).matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/gu)) {
    const p = element('p'), offset = chapter.start + bodyOffset + match.index, content = match[0]; let last = 0;
    for (const word of words(content)) {
      p.append(document.createTextNode(content.slice(last, word.start)));
      const span = element('span', word.text, 'word'); span.dataset.start = String(offset + word.start); span.dataset.end = String(offset + word.end);
      state.wordsByStart.set(offset + word.start, span); p.append(span); last = word.end;
    }
    p.append(document.createTextNode(content.slice(last))); $('text').append(p);
  }
  $('text').classList.toggle('focus-on', state.focus);
  $('prev-chapter').disabled = state.chapter === 0; $('next-chapter').disabled = state.chapter === state.chapters.length - 1;
  renderChapterNav(); $('main').scrollTop = 0; highlightCurrent();
}
function navigateChapter(index) {
  if (state.opening || !state.chapters[index]) return;
  audio.pause(); state.chapter = index; state.follow = false; $('follow').setAttribute('aria-pressed', 'false');
  state.playingChunk = state.chunks.find(c => c.chapter === index)?.index ?? 0; unloadAudio(); state.timeToRestore = 0;
  renderText(); showLibrary(false); savePosition();
  $('passage-label').textContent = 'Press play for this chapter'; $('seek').value = '0'; $('elapsed').textContent = '0:00'; $('duration').textContent = '0:00';
}
function clearHighlight() {
  state.activeWord?.classList.remove('active'); state.activeParagraph?.classList.remove('speaking');
  state.activeWord = null; state.activeParagraph = null;
  $('text').querySelectorAll('.passage').forEach(e => e.classList.remove('passage')); $('text').classList.remove('has-active');
}
function followElement(el) {
  if (!state.follow || !el) return;
  const main = $('main'), r = el.getBoundingClientRect(), box = main.getBoundingClientRect();
  if (r.top < box.top + 75 || r.bottom > box.bottom - 80) main.scrollTo({ top: main.scrollTop + r.top - box.top - Math.min(main.clientHeight * 0.35, 220), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}
function highlightCurrent() {
  if (!state.asset || !state.chunks[state.playingChunk]) return;
  const chunk = state.chunks[state.playingChunk];
  if (chunk.chapter !== state.chapter) return;
  if (state.asset.mode !== 'word') {
    if (audio.paused) return;
    for (const [start, el] of state.wordsByStart) if (start >= chunk.start && start < chunk.end) el.parentElement.classList.add('passage');
    $('text').classList.add('has-active'); return;
  }
  const word = wordAtTime(state.asset.words, audio.currentTime), target = word ? state.wordsByStart.get(chunk.start + word.start) : null;
  if (target === state.activeWord) return;
  state.activeWord?.classList.remove('active'); state.activeParagraph?.classList.remove('speaking');
  state.activeWord = target || null; state.activeParagraph = target?.parentElement || null;
  if (target) { target.classList.add('active'); state.activeParagraph.classList.add('speaking'); $('text').classList.add('has-active'); followElement(target); }
  else $('text').classList.remove('has-active');
}
function tick() {
  highlightCurrent();
  if (state.sleepAt && Date.now() >= state.sleepAt) { audio.pause(); state.sleepAt = 0; $('sleep').value = '0'; notify('Sleep timer finished. Your place is saved.'); }
  if (!audio.paused) raf = requestAnimationFrame(tick);
}
async function loadChunk(index, play = true, time = 0, changeChapter = true) {
  ensureBook(); const chunk = state.chunks[index]; if (!chunk) return false;
  const serial = ++state.loadSerial;
  const key = state.chunkKeys[index];
  const asset = state.rescue?.id === key ? state.rescue : key ? await db.get('audio', key) : null;
  if (serial !== state.loadSerial) return false;
  if (!asset) { audio.pause(); notify('This passage has not been recorded with the selected voice. Render it in Voice & render before playing.'); return false; }
  audio.pause(); if (state.url) URL.revokeObjectURL(state.url);
  clearHighlight(); state.asset = asset; state.playingChunk = index; state.timeToRestore = time;
  if (changeChapter && state.chapter !== chunk.chapter) { state.chapter = chunk.chapter; renderText(); }
  state.url = URL.createObjectURL(asset.blob); audio.src = state.url;
  $('passage-label').textContent = `Passage ${index + 1} / ${state.chunks.length}`;
  if (asset.mode !== 'word') notify(asset.reason || 'Passage highlighting: no trustworthy word timings were returned.');
  await new Promise((resolve, reject) => {
    const finish = () => { cleanup(); if (serial !== state.loadSerial) { resolve(); return; } audio.currentTime = Math.min(time, Math.max(0, audio.duration - 0.02)); resolve(); };
    const fail = () => { cleanup(); reject(new Error('This saved recording could not be decoded by your browser. Export it before making a new take.')); };
    const timer = setTimeout(fail, 15000);
    function cleanup() { clearTimeout(timer); audio.removeEventListener('loadedmetadata', finish); audio.removeEventListener('error', fail); }
    audio.addEventListener('loadedmetadata', finish, { once: true }); audio.addEventListener('error', fail, { once: true }); audio.load();
  });
  if (serial !== state.loadSerial) return false;
  $('seek').max = String(audio.duration || 1); updateTime();
  if (play) { state.follow = true; $('follow').setAttribute('aria-pressed', 'true'); await audio.play(); }
  return true;
}
async function togglePlay() {
  if (state.opening) return;
  ensureBook();
  if (!audio.paused) { audio.pause(); return; }
  if (!state.asset || state.chunks[state.playingChunk]?.chapter !== state.chapter) {
    const target = state.chunks.find(c => c.chapter === state.chapter)?.index ?? 0;
    await loadChunk(target, true); return;
  }
  if (audio.ended) audio.currentTime = 0;
  await audio.play();
}
async function seekBy(delta) {
  if (state.opening) return;
  if (!state.asset) return;
  const next = audio.currentTime + delta;
  if (next < 0 && state.playingChunk > 0 && state.cached.has(state.chunkKeys[state.playingChunk - 1])) {
    const wasPlaying = !audio.paused;
    if (!await loadChunk(state.playingChunk - 1, false)) return;
    audio.currentTime = Math.max(0, audio.duration + next); if (wasPlaying) await audio.play();
  } else if (next > audio.duration && state.cached.has(state.chunkKeys[state.playingChunk + 1])) {
    await loadChunk(state.playingChunk + 1, !audio.paused, next - audio.duration);
  } else { audio.currentTime = Math.max(0, Math.min(audio.duration || 0, next)); }
  highlightCurrent(); updateTime(); savePosition();
}
function updateTime() { $('elapsed').textContent = formatTime(audio.currentTime); $('duration').textContent = formatTime(audio.duration); $('seek').value = String(audio.currentTime || 0); }
async function api(body, local = isLocalProfile(body.model ? body : state.profile)) {
  if (local && !isLocalProfile(defaultProfile(location.hostname))) throw new Error('Local narration runs on this Mac. Open the local Inkwave app to generate recordings; saved audio plays here.');
  if (!local && !state.credential) throw new Error('Enter your ElevenLabs API key in Voice & render.');
  const headers = { 'Content-Type': 'application/json' };
  if (!local) headers[state.credentialKind === 'key' ? 'x-elevenlabs-key' : 'x-readalong-access'] = state.credential;
  let response;
  try { response = await fetch(local ? '/api/readalong-local' : '/api/readalong', { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store', credentials: local ? 'omit' : 'same-origin', signal: AbortSignal.timeout(local ? 600_000 : 200_000) }); }
  catch { throw new Error(local ? 'The local narration service lost its connection or timed out. Completed recordings remain saved. No automatic retry was made.' : 'The request lost its connection or timed out. It may have been charged. Rendering stopped; no automatic retry was made.'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('The narration endpoint returned unreadable data. Check the deployment; no automatic retry was made.'); }
  if (!response.ok) throw new Error(result.error || `Narration failed (${response.status}).`);
  return result;
}
function updateEngineFields() {
  const local = $('engine').value === 'local';
  $('local-info').hidden = !local; $('local-voices').hidden = !local;
  for (const id of ['connection-fields', 'consent-row', 'voice-brief', 'billing-note']) $(id).hidden = local;
  $('voice-select-label').textContent = local ? 'Local voices · British and American English' : 'Available voices · Australian female labels ranked first';
  $('voice-id').placeholder = local ? 'For example, kokoro_bf_emma' : 'A voice available to your ElevenLabs account';
  for (const option of $('model').querySelectorAll('option')) option.hidden = option.disabled = (option.value === LOCAL_MODEL) !== local;
  $('model').disabled = state.preparing || state.rendering || local;
  $('delivery').disabled = state.preparing || state.rendering || local;
}
function populateVoiceFields(profile = state.profile) {
  $('engine').value = isLocalProfile(profile) ? 'local' : 'eleven';
  $('voice-id').value = profile.voiceId; $('model').value = profile.model; $('delivery').value = profile.delivery;
  $('voice-select').value = profile.voiceId; updateEngineFields();
}
function changeEngine() {
  notRendering(); state.voiceSerial++; state.voices = [];
  const engine = $('engine').value;
  const profile = state.profiles[engine] || (engine === 'local' ? defaultProfile('localhost') : defaultProfile(''));
  populateVoiceFields(profile);
  $('voice-select').replaceChildren(element('option', 'Load voices, or use the voice ID below'));
  $('voice-description').textContent = ''; $('voice-message').textContent = 'Press “Use this voice” to select this engine and voice.';
}
async function loadVoices() {
  notRendering(); const local = $('engine').value === 'local', serial = ++state.voiceSerial;
  if (!local) { state.credential = $('credential').value.trim(); state.credentialKind = $('credential-kind').value; }
  $('connect').disabled = true; $('local-voices').disabled = true; $('voice-message').textContent = local ? 'Loading voices installed on this Mac…' : 'Loading voices from your account…';
  try {
    let cursor = '', more = true, pages = 0; const voices = [];
    while (more && pages++ < 20) {
      const data = await api({ action: 'voices', cursor }, local); if (serial !== state.voiceSerial) return; if (data.has_more && !data.next_page_token) throw new Error('The provider returned an incomplete voice list without a continuation token. Please retry loading voices.'); voices.push(...data.voices); cursor = data.next_page_token; more = data.has_more && !!cursor;
    }
    state.voices = [...new Map(voices.map(v => [v.voice_id, v])).values()].sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
    const select = $('voice-select'); select.replaceChildren(element('option', 'Select and audition a voice')); select.options[0].value = '';
    for (const v of state.voices) {
      const labels = [v.labels?.accent, v.labels?.gender].filter(Boolean).join(' · ');
      const option = element('option', `${v.name}${labels ? ` — ${labels}` : ''}`); option.value = v.voice_id; select.append(option);
    }
    select.value = $('voice-id').value;
    const au = state.voices.some(v => /australi|en-au/i.test(v.labels?.accent || '') && /^female$/i.test(v.labels?.gender || ''));
    $('voice-message').textContent = local ? `${state.voices.length} local voices available. Kokoro has British and American English voices; these are not Australian accents. Rendering stays on this Mac and uses no speech credits.` : `${state.voices.length} voices loaded${more ? ' (first 20 pages only)' : ''}. ${au ? 'Australian female-labelled voices are ranked first.' : 'No Australian female-labelled voice was found. Add one to your ElevenLabs library or enter its voice ID.'} Labels are not a guarantee; audition before rendering.`;
  } finally { $('connect').disabled = state.preparing || state.rendering; $('local-voices').disabled = state.preparing || state.rendering; }
}
async function applyProfile() {
  notRendering(); state.opening = true;
  try { return await applyProfileInner(); } finally { state.opening = false; }
}
async function applyProfileInner() {
  const voiceId = $('voice-id').value.trim(), voice = state.voices.find(v => v.voice_id === voiceId);
  const remembered = state.profiles[$('engine').value], localDefault = defaultProfile('localhost');
  const voiceName = voice?.name || (voiceId === state.profile.voiceId ? state.profile.voiceName : remembered?.voiceId === voiceId ? remembered.voiceName : voiceId === localDefault.voiceId ? localDefault.voiceName : voiceId);
  const profile = validateProfile({ voiceId, voiceName, model: $('model').value, delivery: $('delivery').value });
  await savePosition();
  if (state.profile.voiceId) state.profiles[isLocalProfile(state.profile) ? 'local' : 'eleven'] = state.profile;
  state.profile = profile; state.profiles[isLocalProfile(profile) ? 'local' : 'eleven'] = profile; savePreferences(); voiceCaption();
  if (state.book) await openBookInner(state.book, false);
  $('voice-message').textContent = 'Voice selected. Older recordings remain cached; these settings select a separate recording set.';
}
function showVoice() { populateVoiceFields(); updateProgress(); $('voice-dialog').showModal(); }
async function renderSelection(scope) {
  ensureBook(); notRendering(); validateProfile(state.profile);
  // Reserve the edition before hashing or reading storage can yield to another action.
  state.preparing = true; state.stop = false; updateProgress();
  try { return await renderSelectionInner(scope); } finally { state.preparing = false; updateProgress(); }
}
async function renderSelectionInner(scope) {
  const local = isLocalProfile(state.profile);
  if (state.rescue) { await db.put('audio', state.rescue); state.cached.add(state.rescue.id); state.rescue = null; updateProgress(); }
  const pendingProfile = { voiceId: $('voice-id').value.trim(), model: $('model').value, delivery: $('delivery').value };
  if (($('engine').value === 'local') !== local || pendingProfile.voiceId !== state.profile.voiceId || pendingProfile.model !== state.profile.model || pendingProfile.delivery !== state.profile.delivery) throw new Error('Press “Use this voice” before rendering with the changed settings.');
  if (!local) {
    state.credential = $('credential').value.trim() || state.credential; state.credentialKind = $('credential-kind').value;
    if (!state.credential) throw new Error('Enter your connection credential first.');
    if (!$('consent').checked) throw new Error('Please acknowledge the text-sharing and credit use before rendering.');
  }
  if (!navigator.locks?.request) throw new Error('This browser cannot safely coordinate rendering between tabs. Use a current Safari, Chrome or Edge browser. Reading saved recordings is still available.');
  await refreshKeys();
  if (state.stop) return;
  let selected = state.chunks.filter(c => scope === 'book' || c.chapter === state.chapter);
  if (scope === 'sample') selected = selected.slice(0, 1);
  const missing = selected.filter(c => !state.cached.has(state.chunkKeys[c.index]));
  if (!missing.length) { notify(local ? 'These passages are already saved; no new generation needed.' : 'These passages are already saved; no credits used.'); if (scope === 'sample') { $('voice-dialog').close(); await loadChunk(selected[0].index, true); } return; }
  if (!local && !window.confirm(`Render ${missing.length} passage${missing.length === 1 ? '' : 's'} (${missing.reduce((n, c) => n + c.text.length, 0).toLocaleString()} text characters) with ${state.profile.voiceName || state.profile.voiceId}?\n\nThis sends the selected passages to ElevenLabs and uses your account’s credits. Keep the reader open. Provider billing and pronunciation can vary. No automatic retries.`)) return;
  await navigator.locks.request('inkwave-readalong-render-v1', { ifAvailable: true }, async lock => {
    if (state.stop) return;
    if (!lock) throw new Error('Another Inkwave reader tab is rendering. Let it finish or pause it first.');
    state.rendering = true; updateProgress(); $('voice-dialog').close();
    try {
      try { await navigator.storage?.persist?.(); } catch { notify('The browser could not reserve persistent storage. Export a backup after rendering.'); }
      for (const chunk of missing) {
        if (state.stop) break;
        const id = state.chunkKeys[chunk.index];
        if (await db.get('audio', id)) { state.cached.add(id); updateProgress(); continue; }
        if (state.stop) break;
        $('render-status').textContent = `${local ? 'Generating locally' : 'Rendering'} passage ${chunk.index + 1} / ${state.chunks.length}…`;
        const data = await api({ action: 'render', text: chunk.text, ...state.profile });
        const bytes = Uint8Array.from(atob(data.audio_base64), c => c.charCodeAt(0));
        const aligned = local ? { words: [], mode: 'passage', reason: data.alignmentReason || 'Local Kokoro narration uses passage highlighting; verified word timings are unavailable.' } : alignWords(chunk.text, data.alignment);
        const mime = data.mime || (local ? 'audio/wav' : 'audio/mpeg');
        if (!['audio/mpeg', 'audio/wav', 'audio/x-wav'].includes(mime)) throw new Error('The narration service returned an unsupported audio format.');
        const asset = { id, blob: new Blob([bytes], { type: mime }), ...aligned, requestId: data.requestId, createdAt: Date.now() };
        state.rescue = asset; // Retain paid audio in memory if a quota/write failure occurs.
        await db.put('audio', asset); state.rescue = null;
        state.cached.add(id); updateProgress();
      }
      notify(state.stop ? 'Rendering paused. Completed passages are saved.' : 'Selected passages are saved. Ready to listen.');
    } finally { state.rendering = false; updateProgress(); }
    if (!state.stop && scope === 'sample' && state.cached.has(state.chunkKeys[selected[0].index])) await loadChunk(selected[0].index, true);
  });
}
function setFollow(on) { state.follow = on; $('follow').setAttribute('aria-pressed', String(on)); if (on && state.asset) { const c = state.chunks[state.playingChunk]; if (c.chapter !== state.chapter) { state.chapter = c.chapter; renderText(); } followElement(state.activeWord); } }
function pauseForClose() { state.stop = true; state.loadSerial++; audio.pause(); savePosition(); }
function closeReader() { pauseForClose(); if (window.parent !== window) window.parent.postMessage({ type: 'inkwave-readalong:close' }, location.origin); else notify('Your place is saved. You can close this tab.'); }
function renderMarks() {
  $('marks').replaceChildren();
  if (!state.marks.length) $('marks').append(element('p', 'No saved places in this voice edition yet.'));
  for (let i = 0; i < state.marks.length; i++) {
    const m = state.marks[i], row = element('div', null, 'mark-row');
    const go = element('button', `${state.chapters[state.chunks[m.chunk].chapter].title} · ${formatTime(m.time)} — ${m.label}`);
    go.addEventListener('click', () => { $('marks-dialog').close(); loadChunk(m.chunk, true, m.time).catch(error); });
    const del = element('button', '×'); del.setAttribute('aria-label', 'Remove this bookmark'); del.addEventListener('click', () => { state.marks.splice(i, 1); savePosition(); renderMarks(); }); row.append(go, del); $('marks').append(row);
  }
}
function updateSearch() {
  ensureBook(); const query = $('search').value.trim().toLocaleLowerCase(); state.search = []; state.searchIndex = -1;
  if (query.length >= 2) {
    const text = state.book.text.toLocaleLowerCase(); let from = 0;
    while (state.search.length < 2000) { const at = text.indexOf(query, from); if (at < 0) break; state.search.push({ start: at, end: at + query.length }); from = at + query.length; }
  }
  $('search-count').textContent = state.search.length ? `${state.search.length}${state.search.length === 2000 ? '+' : ''} found` : query ? 'No matches' : '';
}
function nextSearch() {
  if (!state.search.length) return;
  state.searchIndex = (state.searchIndex + 1) % state.search.length; const match = state.search[state.searchIndex];
  const chapter = state.chapters.find(c => c.start <= match.start && c.end > match.start);
  setFollow(false);
  if (chapter && chapter.index !== state.chapter) { state.chapter = chapter.index; renderText(); }
  $('main').querySelectorAll('.found').forEach(el => el.classList.remove('found'));
  let first;
  for (const [start, el] of state.wordsByStart) if (start < match.end && Number(el.dataset.end) > match.start) { el.classList.add('found'); first ||= el; }
  first?.scrollIntoView({ block: 'center', behavior: 'instant' }); $('search-count').textContent = `${state.searchIndex + 1} / ${state.search.length}`;
}
for (const button of document.querySelectorAll('.dialog-head button')) button.addEventListener('click', () => button.closest('dialog').close());
// Wire controls. Imported text is inserted with textContent only, never interpreted as HTML.
action('import', () => $('file').click()); action('empty-import', () => $('file').click());
$('file').addEventListener('change', e => { const file = e.target.files[0]; e.target.value = ''; if (file) openFile(file).catch(error); });
action('paste-open', () => $('paste-dialog').showModal());
action('paste-add', async () => { await importText($('paste-title-input').value, $('paste-text').value); $('paste-dialog').close(); $('paste-text').value = ''; });
action('sample-text', () => importText('An ordinary exception', '1. The exception\n\nThe committee had finally agreed that the door was open. It remained locked, but this was now an implementation matter.\n\nMara waited with her bag between her feet. On the other side of the glass, the cleaner put down his bucket and considered the notice.\n\n“Does it apply to me?” he asked.\n\n“Not yet.”\n\nHe nodded, relieved to have been spared access to the room he was supposed to clean. Mara took out her notebook. There was something here worth getting right, and she was beginning to suspect it was not the wording.\n\n2. A practical distinction\n\nRain moved across the windows. It did not ask which side was public.\n\nThe cleaner fetched a chair. He did not offer it ceremoniously. He set it beside her, where a chair would be useful.'));
action('library-toggle', () => showLibrary(!document.body.classList.contains('library-open')));
action('voice-open', showVoice); action('render-open', showVoice); action('connect', loadVoices); action('save-profile', applyProfile);
action('local-voices', loadVoices);
$('engine').addEventListener('change', () => { try { changeEngine(); } catch (e) { error(e); } });
action('disconnect', () => { state.credential = ''; $('credential').value = ''; $('voice-message').textContent = 'Disconnected. Saved recordings still play.'; });
$('voice-select').addEventListener('change', () => { const v = state.voices.find(v => v.voice_id === $('voice-select').value); if (v) { $('voice-id').value = v.voice_id; $('voice-description').textContent = v.description; } });
$('brief').textContent = DIRECTOR_BRIEF;
action('copy-brief', async () => { await navigator.clipboard.writeText(DIRECTOR_BRIEF); $('voice-message').textContent = 'Voice-design brief copied.'; });
for (const scope of ['sample', 'chapter', 'book']) action(`render-${scope}`, () => renderSelection(scope));
action('save-recovery', async () => { if (!state.rescue) return; await db.put('audio', state.rescue); state.cached.add(state.rescue.id); state.rescue = null; updateProgress(); notify('Recovered recording saved without another speech request.'); });
action('clear-edition', async () => {
  ensureBook(); notRendering(); validateProfile(state.profile);
  const ids = state.chunkKeys.filter(key => state.cached.has(key));
  if (!ids.length) throw new Error('This voice edition has no saved audio to remove.');
  if (!confirm(`Remove ${ids.length} cached passages for this book and voice? Identical passages can be shared with other books, which will also lose those recordings. Export a backup first. Book text and all Inkwave editor documents are untouched.`)) return;
  if (!navigator.locks?.request) throw new Error('Use a browser with Web Locks to safely remove cached recordings.');
  await navigator.locks.request('inkwave-readalong-render-v1', { ifAvailable: true }, async lock => { if (!lock) throw new Error('Another reader tab is rendering. Pause it first.'); unloadAudio(); for (const id of ids) await db.remove('audio', id); });
  await refreshKeys(); notify('Selected narration cache removed. Book text and editor documents were kept.');
});
action('stop-render', () => { state.stop = true; $('render-status').textContent = 'Pausing after the current passage is saved…'; });
action('play', togglePlay); action('back', () => seekBy(-10)); action('forward', () => seekBy(10));
action('follow', () => setFollow(!state.follow));
action('focus', () => { state.focus = !state.focus; $('focus').setAttribute('aria-pressed', String(state.focus)); $('text').classList.toggle('focus-on', state.focus); });
action('appearance', () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'night' ? 'day' : 'night'; savePreferences(); });
$('font-size').addEventListener('input', () => { document.documentElement.style.setProperty('--font', `${$('font-size').value}px`); savePreferences(); });
$('speed').addEventListener('change', () => { audio.playbackRate = Number($('speed').value); savePreferences(); });
$('sleep').addEventListener('change', () => { state.sleepAt = Number($('sleep').value) ? Date.now() + Number($('sleep').value) * 60_000 : 0; });
$('seek').addEventListener('input', () => { if (state.asset) { audio.currentTime = Number($('seek').value); highlightCurrent(); updateTime(); savePosition(); } });
action('prev-chapter', () => navigateChapter(state.chapter - 1)); action('next-chapter', () => navigateChapter(state.chapter + 1));
action('close-reader', closeReader);
action('bookmark', () => { ensureBook(); const chunk = state.chunks[state.playingChunk]; if (!chunk || !state.asset) throw new Error('Play a saved passage before bookmarking.'); state.marks.push({ chunk: chunk.index, time: audio.currentTime, label: chunk.text.slice(0, 70) }); state.marks = state.marks.slice(-500); savePosition(); notify('Place saved.'); });
action('marks-open', () => { ensureBook(); renderMarks(); $('marks-dialog').showModal(); });
action('export', async () => {
  ensureBook(); notRendering(); validateProfile(state.profile); notify('Preparing your listening-book backup…', true);
  const blob = await exportBook(state.book, state.profile, state.chunks, currentPosition(), state.rescue);
  download(blob, `${state.book.title.replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 100) || 'Inkwave'}.iwlisten`);
  notify('Backup prepared. It contains this text and the selected voice’s saved recordings, including any unsaved recovery passage.');
});
action('delete-book', async () => { ensureBook(); notRendering(); if (!confirm('Remove this book’s text from this browser’s listening shelf? Your editor documents are untouched. Cached audio is retained; export a backup first.')) return; state.ready = false; unloadAudio(); await db.remove('books', state.book.id); state.book = null; state.chunks = []; state.chapters = []; state.chunkKeys = []; $('book-view').hidden = true; $('empty').hidden = false; $('book-title').textContent = 'Nothing open yet'; await refreshLibrary(); updateProgress(); });
$('search').addEventListener('input', () => { try { updateSearch(); } catch (e) { error(e); } });
$('search').addEventListener('keydown', e => { if (e.key === 'Enter') nextSearch(); }); action('search-next', nextSearch);
async function seekToWord(offset) {
  const chunk = state.chunks.find(c => offset >= c.start && offset < c.end);
  if (!chunk) return;
  const serial = state.loadSerial;
  const asset = await db.get('audio', state.chunkKeys[chunk.index] || '');
  // Closing or changing books while this read waits cancels the original click.
  if (serial !== state.loadSerial) return;
  if (!asset) throw new Error('That word has not been recorded. Render the chapter first.');
  const timing = asset.words.find(w => w.start === offset - chunk.start);
  if (!await loadChunk(chunk.index, true, timing?.from ?? 0)) return;
  if (!timing) notify('Word alignment is unavailable for this passage; starting at its beginning.');
}
$('main').addEventListener('click', e => {
  if (state.opening) return;
  const target = e.target.closest('.word'); if (!target || window.getSelection()?.toString()) return;
  seekToWord(Number(target.dataset.start)).catch(error);
});
for (const event of ['wheel', 'touchmove', 'pointerdown']) $('main').addEventListener(event, e => { if (event !== 'pointerdown' || e.target === $('main')) setFollow(false); }, { passive: true });
audio.addEventListener('play', () => { $('play').textContent = 'Ⅱ'; $('play').setAttribute('aria-label', 'Pause recording'); cancelAnimationFrame(raf); tick(); if (navigator.mediaSession) { navigator.mediaSession.playbackState = 'playing'; navigator.mediaSession.metadata = new MediaMetadata({ title: state.book?.title || 'Inkwave Read along', artist: state.profile.voiceName || 'AI narration', album: state.chapters[state.chapter]?.title || '' }); } });
audio.addEventListener('pause', () => { $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play recording'); cancelAnimationFrame(raf); savePosition(); if (navigator.mediaSession) navigator.mediaSession.playbackState = 'paused'; });
audio.addEventListener('timeupdate', () => { updateTime(); if (Date.now() - lastSaved > 4000) { lastSaved = Date.now(); savePosition(); } if (state.sleepAt && Date.now() >= state.sleepAt) { state.sleepAt = 0; $('sleep').value = '0'; audio.pause(); } });
audio.addEventListener('ended', () => { const next = state.playingChunk + 1; if (state.sleepAt && Date.now() >= state.sleepAt) return; if (state.chunks[next] && state.cached.has(state.chunkKeys[next])) loadChunk(next, true).catch(error); else notify(state.chunks[next] ? 'The next passage is not saved yet. Render more when ready.' : 'You’ve reached the end.'); });
window.addEventListener('pagehide', () => { pauseForClose(); state.credential = ''; $('credential').value = ''; });
document.addEventListener('visibilitychange', () => { if (document.hidden) savePosition(); });
window.addEventListener('message', e => { if (e.origin === location.origin && e.source === window.parent && e.data?.type === 'inkwave-readalong:pause') pauseForClose(); });
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { e.preventDefault(); closeReader(); return; }
  if (e.target.closest('input,textarea,select,button') || document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay().catch(error); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); seekBy(-10).catch(error); }
  if (e.key === 'ArrowRight') { e.preventDefault(); seekBy(10).catch(error); }
});
window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
window.addEventListener('drop', e => { e.preventDefault(); document.body.classList.remove('dragging'); const file = e.dataTransfer.files[0]; if (file) openFile(file).catch(error); });
if (navigator.mediaSession) {
  for (const [name, fn] of [['play', () => togglePlay()], ['pause', () => audio.pause()], ['seekbackward', () => seekBy(-10)], ['seekforward', () => seekBy(10)]]) {
    try { navigator.mediaSession.setActionHandler(name, () => Promise.resolve(fn()).catch(error)); } catch { /* Optional platform action. */ }
  }
}
async function init() {
  const prefs = await db.get('prefs', 'preferences');
  // An embedded reader starts with the writer's theme until they choose its own.
  let inheritedTheme;
  try { if (window.parent !== window) inheritedTheme = window.parent.document.documentElement.dataset.theme; } catch { /* A standalone/cross-origin host has no shared theme. */ }
  if ((prefs?.theme ?? inheritedTheme) === 'night') document.documentElement.dataset.theme = 'night';
  if (prefs) {
    if (prefs.profile?.voiceId) state.profile = validateProfile(prefs.profile);
    for (const engine of ['local', 'eleven']) {
      const saved = prefs.profiles?.[engine];
      if (saved?.voiceId) { const profile = validateProfile(saved); if (isLocalProfile(profile) === (engine === 'local')) state.profiles[engine] = profile; }
    }
    const font = Number(prefs.font); if (Number.isFinite(font) && font >= 14 && font <= 28) { $('font-size').value = String(font); document.documentElement.style.setProperty('--font', `${font}px`); }
    if (prefs.theme === 'night') document.documentElement.dataset.theme = 'night';
    const speed = Number(prefs.speed); if (speed >= .75 && speed <= 2) { audio.playbackRate = speed; $('speed').value = String(speed); }
  }
  if (state.profile.voiceId) state.profiles[isLocalProfile(state.profile) ? 'local' : 'eleven'] = state.profile;
  populateVoiceFields(); voiceCaption(); await refreshLibrary();
  const last = await db.get('prefs', 'last-book');
  if (last?.bookId) { const book = await db.get('books', last.bookId); if (book) await openBook(book); }
}
init().catch(error);
