/** Conservative journal notation for a derived speech layer, never the manuscript.
 * Half-open UTF-16 mappings partition the entire input/output. `offset` shifts
 * source ranges only. Callers exclude LaTeX/math-parser spans before using this
 * helper. No OCR, reading-order repair, inferred footnote removal or AI rewriting.
 */
export const JOURNAL_SPEECH_VERSION = 'iw-journal-speech-1';
const GREEK = Object.fromEntries([...'αβγδεζηθικλμνξοπρστυφχψω'].map((c, i) => [c,
  ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega'][i]]));
Object.assign(GREEK, { 'ς': 'sigma', 'ϑ': 'theta', 'ϕ': 'phi', 'ϵ': 'epsilon', 'µ': 'mu' });
const SCRIPT = Object.fromEntries([...'₀₁₂₃₄₅₆₇₈₉⁰¹²³⁴⁵⁶⁷⁸⁹'].map((c, i) => [c, String(i % 10)]));
Object.assign(SCRIPT, { '₊': 'plus', '⁺': 'plus', '₋': 'minus', '⁻': 'minus', '₌': 'equals', '⁼': 'equals', 'ₙ': 'n', 'ₓ': 'x', 'ⁿ': 'n', 'ⁱ': 'i' });
const scriptWords = value => [...value].map(c => SCRIPT[c] ?? c).join(' ').replace(/(?<=\d) (?=\d)/g, '');
const signed = value => value.replace(/^[−-]/u, 'minus ').replace(/^\+/u, 'plus ');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const UNITS = {
  kg: ['kilogram', 'kilograms'], g: ['gram', 'grams'], mg: ['milligram', 'milligrams'],
  'µg': ['microgram', 'micrograms'], 'μg': ['microgram', 'micrograms'], ng: ['nanogram', 'nanograms'],
  L: ['litre', 'litres'], mL: ['millilitre', 'millilitres'], 'µL': ['microlitre', 'microlitres'], 'μL': ['microlitre', 'microlitres'],
  m: ['metre', 'metres'], cm: ['centimetre', 'centimetres'], mm: ['millimetre', 'millimetres'],
  km: ['kilometre', 'kilometres'], nm: ['nanometre', 'nanometres'], 'µm': ['micrometre', 'micrometres'], 'μm': ['micrometre', 'micrometres'],
  s: ['second', 'seconds'], ms: ['millisecond', 'milliseconds'], min: ['minute', 'minutes'], h: ['hour', 'hours'],
  mol: ['mole', 'moles'], mmol: ['millimole', 'millimoles'],
  Hz: ['hertz', 'hertz'], kHz: ['kilohertz', 'kilohertz'], MHz: ['megahertz', 'megahertz'],
  Pa: ['pascal', 'pascals'], kPa: ['kilopascal', 'kilopascals'], MPa: ['megapascal', 'megapascals'],
  J: ['joule', 'joules'], kJ: ['kilojoule', 'kilojoules'], W: ['watt', 'watts'], kW: ['kilowatt', 'kilowatts'],
  V: ['volt', 'volts'], mV: ['millivolt', 'millivolts'], 'Ω': ['ohm', 'ohms'],
  K: ['kelvin', 'kelvin'], '°C': ['degree Celsius', 'degrees Celsius'], '°F': ['degree Fahrenheit', 'degrees Fahrenheit'],
};
const UNIT = Object.keys(UNITS).sort((a, b) => b.length - a.length).map(escape).join('|');
const NUMBER = '[−+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const EXPONENT = '(?:\\^[−+-]?\\d{1,3}|[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]{1,4})';
const unitName = (unit, power, singular) => {
  const word = UNITS[unit][singular ? 0 : 1];
  if (!power) return word;
  const exponent = power.startsWith('^') ? signed(power.slice(1)) : scriptWords(power);
  if (exponent === '2') return 'square ' + word;
  if (exponent === '3') return 'cubic ' + word;
  return word + ' to the power of ' + exponent;
};

export function speakJournal(text, { offset = 0, citations = 'read' } = {}) {
  if (typeof text !== 'string') throw new TypeError('Journal speech input must be text.');
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(offset + text.length)) throw new RangeError('Invalid source offset.');
  if (!['read', 'skip'].includes(citations)) throw new TypeError('Citations must be read or skip.');
  const edits = [], warningSet = new Set();
  const wordChar = char => !!char && /[\p{L}\p{N}_]/u.test(char);
  function add(pattern, transform, priority = 0) {
    for (const match of text.matchAll(pattern)) {
      const replacement = transform(match);
      if (replacement !== null && replacement !== match[0]) edits.push({ start: match.index, end: match.index + match[0].length, replacement, priority });
    }
  }
  const bounded = m => !wordChar(text[m.index - 1]) && !wordChar(text[m.index + m[0].length]);
  add(new RegExp(`\\b([pP])\\s*(<=|>=|<|>|≤|≥|=)\\s*(${NUMBER})`, 'gu'), m => {
    if (!bounded(m)) return null;
    const op = { '<': 'less than', '>': 'greater than', '<=': 'less than or equal to', '≤': 'less than or equal to', '>=': 'greater than or equal to', '≥': 'greater than or equal to', '=': 'equals' };
    return `${m[1]} ${op[m[2]]} ${signed(m[3])}`;
  }, 30);
  add(/\b(\d{1,3}(?:\.\d+)?)\s*%\s*CI\b/gu, m => `${m[1]} percent confidence interval`, 30);
  add(/\b(?:Eq\.|Eqs\.|Fig\.|Figs\.|Sec\.|Secs\.)\s*(?=\(?\d)/gu, m => ({ 'Eq.': 'equation ', 'Eqs.': 'equations ', 'Fig.': 'figure ', 'Figs.': 'figures ', 'Sec.': 'section ', 'Secs.': 'sections ' })[m[0].trim()], 20);
  add(/§\s*(?=\d)/gu, () => 'section ', 20);
  add(/\+\s*\/\s*-|±/gu, m => {
    // A literal symbol is readable; don't infer what uncertainty measure it denotes.
    const left = m.index && !/\s/u.test(text[m.index - 1]) ? ' ' : '';
    const right = text[m.index + m[0].length] && !/\s/u.test(text[m.index + m[0].length]) ? ' ' : '';
    return left + 'plus or minus' + right;
  }, 10);
  add(new RegExp(`(${NUMBER})[ \\t]*(${UNIT})(${EXPONENT})?(?:[ \\t]*[/][ \\t]*(${UNIT})(${EXPONENT})?)?`, 'gu'), m => {
    if (!bounded(m)) return null;
    return `${signed(m[1])} ${unitName(m[2], m[3], Number(m[1]) === 1)}${m[4] ? ' per ' + unitName(m[4], m[5], true) : ''}`;
  }, 25);
  add(new RegExp(`(${NUMBER})\\s*[×·]\\s*10(${EXPONENT})`, 'gu'), m => bounded(m) ? `${signed(m[1])} times ten to the power of ${m[2].startsWith('^') ? signed(m[2].slice(1)) : scriptWords(m[2])}` : null, 20);
  add(new RegExp(`10(${EXPONENT})`, 'gu'), m => bounded(m) ? `ten to the power of ${m[1].startsWith('^') ? signed(m[1].slice(1)) : scriptWords(m[1])}` : null, 15);
  add(new RegExp(`(${NUMBER})[eE]([−+-]?\\d{1,3})`, 'gu'), m => bounded(m) ? `${signed(m[1])} times ten to the power of ${signed(m[2])}` : null, 15);
  add(new RegExp(`(${NUMBER})\\s*%`, 'gu'), m => bounded(m) ? `${signed(m[1])} percent` : null, 5);
  add(/[Α-Ωα-ωϑϕϵµ]/gu, m => {
    const name = GREEK[m[0].toLowerCase()];
    if (!name || wordChar(text[m.index - 1]) || /[\p{L}]/u.test(text[m.index + 1] || '')) return null;
    return name;
  });
  add(/[₀₁₂₃₄₅₆₇₈₉₊₋₌ₙₓ]+/gu, m => ` subscript ${scriptWords(m[0])}${wordChar(text[m.index + m[0].length]) ? ' ' : ''}`);
  add(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼ⁿⁱ]+/gu, m => ` superscript ${scriptWords(m[0])}${wordChar(text[m.index + m[0].length]) ? ' ' : ''}`);
  add(/\[\s*\d{1,4}(?:\s*[,;–—-]\s*\d{1,4})*\s*\]/gu, m => {
    const before = text.slice(Math.max(0, m.index - 100), m.index);
    const lineBefore = before.slice(before.lastIndexOf('\n') + 1);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
    const mathContext = /(?:matrix|vector|array|coordinates?|interval|set|CI)\b[^.!?\n]*$/iu.test(before) || /[=<>×+*/]\s*$/u.test(before) || /^\s*(?:[=+*/]|\[)/u.test(after);
    const proseContext = /[\p{L}][\p{L}\p{N} ,;:)'"’”\-]*\s+$/u.test(lineBefore);
    if (mathContext || !proseContext) {
      warningSet.add('Ambiguous bracketed numbers were retained; they may be a citation, list or mathematical notation.');
      return null;
    }
    if (citations === 'skip') return '';
    const numbers = m[0].slice(1, -1).trim().replace(/\s*[–—-]\s*/gu, ' to ').replace(/\s*[,;]\s*/gu, ' and ');
    const explicit = /(?:references?|refs?\.?|citations?)\s*$/iu.test(before);
    return (explicit ? '' : /[,;–—-]/u.test(m[0]) ? 'references ' : 'reference ') + numbers;
  }, 20);
  edits.sort((a, b) => a.start - b.start || b.priority - a.priority || b.end - a.end);
  const mappings = [], parts = [];
  let source = 0, speech = 0;
  const append = (start, end, value) => {
    parts.push(value);
    mappings.push({ sourceStart: offset + start, sourceEnd: offset + end, speechStart: speech, speechEnd: speech + value.length });
    speech += value.length;
  };
  for (const edit of edits) {
    if (edit.start < source) continue;
    if (edit.start > source) append(source, edit.start, text.slice(source, edit.start));
    append(edit.start, edit.end, edit.replacement);
    source = edit.end;
  }
  if (source < text.length) append(source, text.length, text.slice(source));
  return { text: parts.join(''), mappings, warnings: [...warningSet], version: JOURNAL_SPEECH_VERSION };
}

/** Navigation targets describe source lines; detection never removes those lines. */
export function detectJournalTargets(text) {
  if (typeof text !== 'string') throw new TypeError('Journal navigation input must be text.');
  const targets = [];
  let references = false;
  for (const match of text.matchAll(/[^\r\n]+/gu)) {
    const line = match[0].trim();
    if (!line) continue;
    const start = match.index + match[0].indexOf(line), end = start + line.length;
    let kind = null;
    const heading = /^(?:#{1,6}\s+\S|(?:\d{1,2}(?:\.\d{1,2}){0,4}\.?\s+)[A-Z])/u.test(line) || /^(?:abstract|introduction|background|methods|materials and methods|results|discussion|conclusions?|acknowledg(?:e)?ments|references|bibliography|funding|conflicts? of interest|data availability|supplementary material|appendix(?: [A-Z])?)[.:]?$/iu.test(line);
    if (/^(?:Figure|Fig\.)\s*\d+[A-Za-z]?(?:[. :—–]|$)/iu.test(line)) kind = 'figure';
    else if (/^Table\s*\d+[A-Za-z]?(?:[. :—–]|$)/iu.test(line)) kind = 'table';
    else if (/^(?:Footnote\s+\d+[:.)]?\s+|\[\^\w+\]:\s*|[†‡]\s+\S)/iu.test(line)) kind = 'footnote';
    else if (references && /^(?:\[\d{1,4}\]|\d{1,4}[.)])\s+\S/u.test(line)) kind = 'reference';
    else if (/^(?:Eq\.|Equation)\s*\(?\d+\)?\s*[:.=]/iu.test(line) || /^(?:[A-Za-zΑ-ω][A-Za-zΑ-ω\d_₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]*\s*[=≈≡]\s*[^\n]{1,140})\s+\(\d+[a-z]?\)$/u.test(line)) kind = 'equation';
    else if (heading && line.length <= 160) kind = 'heading';
    if (kind === 'heading') references = /^(?:#{1,6}\s*)?(?:\d+(?:\.\d+)*\.?\s+)?(?:references|bibliography)[.:]?$/iu.test(line);
    if (kind) targets.push({ kind, start, end, label: line.replace(/^#{1,6}\s*/u, '') });
  }
  return targets;
}
