/** A spoken ghost layer. All source coordinates are immutable UTF-16 ranges. */
export const SPEECH_PLAN_VERSION = 'iw-ghost-1';

const escaped = (text, index) => {
  let count = 0;
  while (index > 0 && text[--index] === '\\') count++;
  return count % 2 === 1;
};

export function mathSpans(text) {
  const spans = [];
  const openings = /\$\$|\$|\\\(|\\\[|\\begin\{(?:equation\*?|align\*?|gather\*?|displaymath)\}/g;
  let match;
  while ((match = openings.exec(text))) {
    const start = match.index, open = match[0];
    if (escaped(text, start)) continue;
    const close = open === '$$' ? '$$' : open === '$' ? '$' : open === '\\(' ? '\\)' : open === '\\[' ? '\\]' : open.replace('begin', 'end');
    let finish = text.indexOf(close, start + open.length);
    while (finish >= 0 && escaped(text, finish)) finish = text.indexOf(close, finish + close.length);
    if (finish < 0) {
      if (open !== '$') spans.push({ start, end: text.length, bodyStart: start + open.length, bodyEnd: text.length, malformed: true });
      continue;
    }
    const body = text.slice(start + open.length, finish);
    // Dollar amounts are not automatically mathematics. Delimited letter/number atoms are.
    if (open === '$' && (/\n\s*\n/.test(body) || /^\d[\s\S]*\b(?:and|to|for|per|each|or)\b/i.test(body))) continue;
    const end = finish + close.length;
    spans.push({ start, end, bodyStart: start + open.length, bodyEnd: finish, display: open !== '$' && open !== '\\(' });
    openings.lastIndex = end;
  }
  return spans;
}

export function sourceRangesForSpeech(mappings, start, end) {
  return uniqueRanges(mappings.filter(m => m.speechStart < end && m.speechEnd > start)
    .map(m => m.identity ? ({ start: m.sourceStart + Math.max(start, m.speechStart) - m.speechStart,
      end: m.sourceStart + Math.min(end, m.speechEnd) - m.speechStart }) : ({ start: m.sourceStart, end: m.sourceEnd })));
}

export function speechRangesForSource(mappings, start, end) {
  return uniqueRanges(mappings.filter(m => m.sourceStart < end && m.sourceEnd > start && m.speechEnd > m.speechStart)
    .map(m => m.identity ? ({ start: m.speechStart + Math.max(start, m.sourceStart) - m.sourceStart,
      end: m.speechStart + Math.min(end, m.sourceEnd) - m.sourceStart }) : ({ start: m.speechStart, end: m.speechEnd })));
}

function uniqueRanges(ranges) {
  const seen = new Set();
  return ranges.filter(r => {
    const key = `${r.start}:${r.end}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a, b) => a.start - b.start || a.end - b.end);
}

export function validateMappings(mappings, sourceLength, speechLength) {
  if (!Array.isArray(mappings) || mappings.length > 2_000_000) throw new Error('Invalid speech mappings.');
  for (const m of mappings) {
    if (![m.sourceStart, m.sourceEnd, m.speechStart, m.speechEnd].every(Number.isSafeInteger)
      || m.sourceStart < 0 || m.sourceEnd <= m.sourceStart || m.sourceEnd > sourceLength
      || m.speechStart < 0 || m.speechEnd < m.speechStart || m.speechEnd > speechLength) throw new Error('A speech mapping is outside its source.');
  }
  return mappings;
}

export async function compileSpeechPlan(source, { citations = 'read', mathStyle = 'brief' } = {}) {
  if (typeof source !== 'string' || source.length > 2_000_000) throw new Error('Invalid ghost-layer source.');
  if (!['read', 'skip'].includes(citations)) throw new Error('Invalid citation reading mode.');
  if (!['brief', 'precise'].includes(mathStyle)) throw new Error('Invalid mathematical reading style.');
  const [{ speakLatex, version: mathVersion }, { speakJournal, detectJournalTargets, version: journalVersion }] = await Promise.all([
    import('./math-speech.mjs'), import('./journal-speech.mjs'),
  ]);
  const spans = mathSpans(source), mappings = [], warnings = [], targets = [], breaks = [];
  let spokenText = '', cursor = 0;
  function append(result, fallbackStart, fallbackEnd) {
    const offset = spokenText.length;
    spokenText += result.text;
    for (const m of result.mappings) mappings.push({ ...m,
      identity: source.slice(m.sourceStart, m.sourceEnd) === result.text.slice(m.speechStart, m.speechEnd),
      speechStart: offset + m.speechStart, speechEnd: offset + m.speechEnd });
    for (const pause of result.breaks || []) breaks.push({ ...pause, speechOffset: offset + pause.speechOffset });
    for (const warning of result.warnings || []) warnings.push({ ...warning, sourceStart: warning.sourceStart ?? fallbackStart, sourceEnd: warning.sourceEnd ?? fallbackEnd });
  }
  const prose = (start, end) => {
    if (start >= end) return;
    append(speakJournal(source.slice(start, end), { offset: start, citations }), start, end);
  };
  for (const span of spans) {
    prose(cursor, span.start);
    const speechStart = spokenText.length;
    if (span.malformed) {
      append({ text: source.slice(span.start, span.end), mappings: [{ sourceStart: span.start, sourceEnd: span.end, speechStart: 0, speechEnd: span.end - span.start }], warnings: [{ message: 'Unclosed mathematical expression. Check the source before rendering.', blocking: true }] }, span.start, span.end);
    } else {
      const result = speakLatex(source.slice(span.bodyStart, span.bodyEnd), { offset: span.bodyStart, style: mathStyle });
      append({ ...result, warnings: result.warnings.map(w => ({ ...w, blocking: true })) }, span.start, span.end);
      // Delimiters carry structure but no additional spoken words.
      mappings.push({ sourceStart: span.start, sourceEnd: span.bodyStart, speechStart, speechEnd: speechStart });
      mappings.push({ sourceStart: span.bodyEnd, sourceEnd: span.end, speechStart: spokenText.length, speechEnd: spokenText.length });
    }
    targets.push({ kind: 'equation', start: span.start, end: span.end, label: `Equation ${targets.length + 1}` });
    cursor = span.end;
  }
  prose(cursor, source.length);
  for (const target of detectJournalTargets(source)) if (!spans.some(s => target.start >= s.start && target.start < s.end)) targets.push(target);
  targets.sort((a, b) => a.start - b.start);
  validateMappings(mappings, source.length, spokenText.length);
  return { version: [SPEECH_PLAN_VERSION, mathVersion || 'math-1', journalVersion || 'journal-1'].join(':'),
    source, spokenText, mappings, warnings, targets, breaks, options: { citations, mathStyle } };
}

/** Split the spoken edition, retaining exact source and many-to-many links. */
export async function academicChunks(source, chapters, max, options = {}) {
  const { splitChunks } = await import('./core.mjs');
  const chunks = [];
  for (const chapter of chapters) {
    const plan = await compileSpeechPlan(source.slice(chapter.start, chapter.end), options);
    const speechChunks = splitChunks(plan.spokenText, [{ start: 0, end: plan.spokenText.length, index: 0 }], max);
    for (const spoken of speechChunks) {
      const selected = plan.mappings.filter(m => m.speechStart < spoken.end && m.speechEnd > spoken.start);
      if (!selected.length) continue;
      // Keep identity portions exact when a long prose mapping crosses a chunk boundary.
      const sliced = selected.map(m => {
        const first = Math.max(m.speechStart, spoken.start), last = Math.min(m.speechEnd, spoken.end);
        const identity = plan.source.slice(m.sourceStart, m.sourceEnd) === plan.spokenText.slice(m.speechStart, m.speechEnd);
        return { sourceStart: identity ? m.sourceStart + first - m.speechStart : m.sourceStart,
          sourceEnd: identity ? m.sourceStart + last - m.speechStart : m.sourceEnd,
          speechStart: first - spoken.start, speechEnd: last - spoken.start, identity };
      });
      const sourceStart = Math.min(...sliced.map(m => m.sourceStart)), sourceEnd = Math.max(...sliced.map(m => m.sourceEnd));
      chunks.push({ index: chunks.length, chapter: chapter.index, start: chapter.start + sourceStart, end: chapter.start + sourceEnd,
        text: plan.source.slice(sourceStart, sourceEnd), speechText: spoken.text, speechVersion: plan.version,
        breaks: plan.breaks.filter(p => p.speechOffset > spoken.start && p.speechOffset < spoken.end)
          .map(p => ({ ...p, speechOffset: p.speechOffset - spoken.start })),
        mappings: sliced.map(m => ({ ...m, sourceStart: m.sourceStart - sourceStart, sourceEnd: m.sourceEnd - sourceStart })),
        warnings: plan.warnings.filter(w => w.sourceStart < sourceEnd && w.sourceEnd > sourceStart)
          .map(w => ({ ...w, sourceStart: chapter.start + w.sourceStart, sourceEnd: chapter.start + w.sourceEnd })) });
    }
  }
  return chunks;
}
