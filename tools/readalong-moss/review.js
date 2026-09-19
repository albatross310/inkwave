'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const colours = ['#254e3e', '#784627', '#594c83', '#355a78', '#7c3f59', '#5d602a'];
  const served = /^https?:$/.test(location.protocol);
  let manifest = null, source = 'files', files = [], generation = 0, objectUrls = [];
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); }
  function text(value, label, limit = 20000) {
    if (typeof value !== 'string' || value.length > limit) throw new Error(`${label} must be text shorter than ${limit.toLocaleString()} characters.`);
    return value;
  }
  function audioPath(value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || value.length > 240 || !/^[a-zA-Z0-9][a-zA-Z0-9_./ -]*\.(wav|mp3|ogg|flac|m4a)$/i.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('Audio paths must name files inside this audition folder. External URLs and parent paths are not supported.');
    }
    return value;
  }
  function validate(value) {
    if (!value || value.version !== 1 || !Array.isArray(value.cast) || !Array.isArray(value.scenes)) throw new Error('Choose a version 1 audition manifest with cast and scenes.');
    if (!value.cast.length || value.cast.length > 12 || value.scenes.length > 40) throw new Error('An audition supports 1–12 voices and up to 40 scenes.');
    const ids = new Set();
    const cast = value.cast.map(entry => {
      if (!entry || typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(entry.id) || ids.has(entry.id)) throw new Error('Every cast member needs a unique speaker ID.');
      ids.add(entry.id);
      return { id: entry.id, name: text(entry.name, 'Voice name', 160), role: text(entry.role || '', 'Voice role', 160), voice_prompt: text(entry.voice_prompt || '', 'Voice prompt'), reference_text: text(entry.reference_text || '', 'Reference text'), audio: audioPath(entry.audio), persona: entry.persona && typeof entry.persona === 'object' ? entry.persona : null };
    });
    const sceneIds = new Set(); let turns = 0;
    const scenes = value.scenes.map(entry => {
      if (!entry || typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(entry.id) || sceneIds.has(entry.id) || !Array.isArray(entry.turns)) throw new Error('Every scene needs a unique ID and a list of speaker turns.');
      sceneIds.add(entry.id); turns += entry.turns.length;
      if (turns > 5000) throw new Error('Choose an audition with no more than 5,000 speaker turns.');
      return { id: entry.id, title: text(entry.title, 'Scene title', 240), turns: entry.turns.map(turn => {
        if (!turn || !ids.has(turn.speaker)) throw new Error('Every scene turn must refer to a speaker in the cast.');
        return { speaker: turn.speaker, text: text(turn.text, 'Scene text') };
      }), audio: audioPath(entry.audio), render_seconds: Number.isFinite(entry.render_seconds) && entry.render_seconds >= 0 ? entry.render_seconds : null,
        audio_seconds: Number.isFinite(entry.audio_seconds) && entry.audio_seconds >= 0 ? entry.audio_seconds : null, context: entry.context && typeof entry.context === 'object' ? entry.context : null, continuation_of: typeof entry.continuation_of === 'string' ? entry.continuation_of.slice(0, 80) : '' };
    });
    return { version: 1, cast, scenes, title: typeof value.title === 'string' ? value.title.slice(0, 240) : '', source: typeof value.source === 'string' ? value.source.slice(0, 2000) : '', metrics: value.metrics || {}, direction: typeof value.direction === 'string' ? value.direction.slice(0, 20000) : '' };
  }
  function reviewContext(label, values) {
    const details = node('details', undefined, 'performance-notes'); details.append(node('summary', label));
    const list = node('dl');
    for (const [key, value] of Object.entries(values).slice(0, 20)) {
      const label = key.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase());
      list.append(node('dt', label), node('dd', (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 10000)));
    }
    details.append(list); return details;
  }
  function clearPlayers() {
    for (const player of document.querySelectorAll('audio')) { player.pause(); player.removeAttribute('src'); player.load(); }
    objectUrls.forEach(url => URL.revokeObjectURL(url)); objectUrls = [];
  }
  function audioFile(path) {
    let matched = files.filter(file => file.relative === path);
    if (matched.length === 1) return matched[0].file;
    matched = files.filter(file => file.file.name === path.split('/').pop());
    return matched.length === 1 ? matched[0].file : null;
  }
  function duration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return 'Unknown';
    const rounded = Math.round(seconds);
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
  }
  function recording(path, label, entry) {
    const box = node('div', undefined, 'recording');
    const message = node('p', 'Not yet generated', 'recording-state missing');
    box.append(message);
    if (!path) return box;
    let url;
    if (source === 'server') url = new URL(path, new URL('.', location.href)).href;
    else {
      const file = audioFile(path);
      if (!file) { message.textContent = `Not yet generated · ${path}`; return box; }
      url = URL.createObjectURL(file); objectUrls.push(url);
    }
    message.textContent = 'Checking recording…'; message.className = 'recording-state';
    const audio = node('audio'); audio.controls = true; audio.preload = 'metadata'; audio.hidden = true;
    audio.setAttribute('aria-label', label);
    audio.addEventListener('loadedmetadata', () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) { message.textContent = 'Recording has no readable duration'; return; }
      audio.hidden = false; message.className = 'recording-state ready';
      message.textContent = `Recording available · ${duration(audio.duration)}`;
      if (entry && !box.querySelector('.scene-timing')) {
        const parts = [`Audio: ${duration(audio.duration)}`];
        if (entry.render_seconds !== null) parts.push(`Generation: ${duration(entry.render_seconds)} · ${(entry.render_seconds / audio.duration).toFixed(2)}× audio duration`);
        box.append(node('p', parts.join('  /  '), 'scene-timing'));
      }
    });
    audio.addEventListener('error', () => { audio.hidden = true; message.className = 'recording-state missing'; message.textContent = `Not yet generated or unreadable · ${path}`; });
    audio.addEventListener('play', () => { for (const other of document.querySelectorAll('audio')) if (other !== audio) other.pause(); });
    audio.src = url; box.append(audio);
    return box;
  }
  function render() {
    clearPlayers(); $('cast').replaceChildren(); $('scenes').replaceChildren();
    $('empty').hidden = true; $('audition').hidden = false;
    $('page-title').textContent = manifest.title || 'Cast & scene review';
    $('source-info').textContent = manifest.source ? `Source: ${manifest.source}` : ''; $('source-info').hidden = !manifest.source;
    $('direction').textContent = manifest.direction; $('direction').hidden = !manifest.direction;
    const cast = new Map();
    manifest.cast.forEach((voice, index) => {
      const colour = colours[index % colours.length]; cast.set(voice.id, { ...voice, colour });
      const card = node('article', undefined, 'cast-card'); card.style.setProperty('--speaker', colour);
      card.append(node('div', voice.id, 'speaker-id'), node('h3', voice.name), node('p', voice.role, 'role'));
      card.append(recording(voice.audio, `${voice.name} reference audition`));
      card.append(node('p', voice.reference_text || 'No reference transcript supplied.', 'reference-text'));
      const details = node('details'); details.append(node('summary', 'Voice design prompt'), node('p', voice.voice_prompt || 'No voice prompt supplied.'));
      card.append(details);
      if (voice.persona) card.append(reviewContext('Character notes for review', voice.persona));
      $('cast').append(card);
    });
    manifest.scenes.forEach((scene, index) => {
      const card = node('article', undefined, 'scene-card'); card.id = `scene-${scene.id}`;
      const heading = node('div', undefined, 'scene-top');
      heading.append(node('div', `${String(index + 1).padStart(2, '0')} · Single scene track`, 'scene-kind'), node('h3', scene.title));
      if (scene.continuation_of) heading.append(node('p', `Continuation of ${manifest.scenes.find(previous => previous.id === scene.continuation_of)?.title || scene.continuation_of}`, 'small'));
      if (scene.context) heading.append(reviewContext('Scene context for review', scene.context));
      const player = recording(scene.audio, `${scene.title} full scene`, scene); player.classList.add('scene-player'); heading.append(player);
      const transcript = node('ol', undefined, 'transcript'); transcript.setAttribute('aria-label', `${scene.title} source dialogue`);
      for (const turn of scene.turns) {
        const voice = cast.get(turn.speaker), row = node('li', undefined, 'turn'); row.style.setProperty('--speaker', voice.colour);
        row.append(node('span', `${voice.name} · ${voice.role || voice.id}`, 'turn-speaker'), node('p', turn.text)); transcript.append(row);
      }
      card.append(heading, transcript); $('scenes').append(card);
    });
    if (!manifest.scenes.length) $('scenes').append(node('p', 'No scene inputs have been supplied yet.', 'small'));
    const metrics = JSON.stringify(manifest.metrics, null, 2);
    $('metrics').textContent = metrics.length > 12000 ? `${metrics.slice(0, 12000)}\n…` : metrics;
    $('run-details').hidden = !Object.keys(manifest.metrics).length;
  }
  async function loadServer() {
    if (!served) return;
    const serial = ++generation; status('Checking for a served audition…');
    try {
      const response = await fetch('./manifest.json', { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (response.status === 404) { if (serial === generation) status('Manifest not yet available. Open an audition folder, or reload after generation.'); return; }
      if (!response.ok) throw new Error(`The manifest could not be read (HTTP ${response.status}).`);
      const raw = await response.text(); if (raw.length > 1000000) throw new Error('The audition manifest must be smaller than 1 MB.');
      const next = validate(JSON.parse(raw)); if (serial !== generation) return;
      manifest = next; source = 'server'; files = []; render(); status(`Loaded ${next.cast.length} reference voices and ${next.scenes.length} scene inputs. Checking available recordings.`);
    } catch (error) { if (serial === generation) status(`Could not load this audition: ${error.message}. You can choose its files directly.`, true); }
  }
  async function loadFiles(selected) {
    if (!selected.length) return;
    const serial = ++generation;
    try {
      const json = selected.filter(file => /\.json$/i.test(file.name));
      const candidates = json.filter(file => file.name === 'manifest.json');
      const input = candidates.length === 1 ? candidates[0] : json.length === 1 ? json[0] : null;
      if (json.length && !input) throw new Error('Choose one audition manifest, along with its audio files.');
      if (!input && !manifest) throw new Error('Include manifest.json when opening an audition for the first time.');
      let next = manifest;
      if (input) { if (input.size > 1000000) throw new Error('The audition manifest must be smaller than 1 MB.'); next = validate(JSON.parse(await input.text())); }
      if (serial !== generation) return;
      const prefix = input?.webkitRelativePath ? input.webkitRelativePath.slice(0, -input.name.length) : '';
      const additions = selected.filter(file => /\.(wav|mp3|ogg|flac|m4a)$/i.test(file.name)).map(file => {
        const relative = file.webkitRelativePath || file.name;
        return { file, relative: prefix && relative.startsWith(prefix) ? relative.slice(prefix.length) : relative };
      });
      manifest = next; source = 'files'; files = input ? additions : [...files.filter(old => !additions.some(file => file.relative === old.relative)), ...additions];
      render(); status(`Opened local files: ${manifest.cast.length} reference voices, ${manifest.scenes.length} scene inputs. Audio stays in this browser.`);
    } catch (error) { if (serial === generation) status(`Could not open these files: ${error.message}`, true); }
  }
  $('open-folder').addEventListener('click', () => $('folder').click());
  $('open-files').addEventListener('click', () => $('files').click());
  for (const id of ['folder', 'files']) $(id).addEventListener('change', event => { const selected = [...event.target.files]; event.target.value = ''; void loadFiles(selected); });
  $('reload').hidden = !served; $('reload').addEventListener('click', () => void loadServer());
  $('save-notes').addEventListener('click', () => {
    const output = { version: 1, reviewed_at: new Date().toISOString(), cast: manifest.cast.map(({ id, name }) => ({ id, name })), scenes: manifest.scenes.map(({ id, title }) => ({ id, title })), notes: $('review-notes').value };
    const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }));
    const link = node('a'); link.href = url; link.download = 'audition-review-notes.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  window.addEventListener('pagehide', clearPlayers);
  if (served) void loadServer(); else status('Choose an audition folder or a manifest and audio files. Nothing is uploaded.');
})();
