// Build vocabulary/data/sentence-index.js from the manifest and chunk files.
// Run from the vocabulary folder: node tools/build-index.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const vocabDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function extraPhrases(value) {
  if (!value) return [];
  return String(value).split(/[()]/).map((part) => part.trim()).filter(Boolean);
}

function inflections(word) {
  const w = String(word || '').toLowerCase();
  const out = [];
  function push(s) { if (s && !out.includes(s)) out.push(s); }
  push(w);
  if (!w || /[\s-]/.test(w)) return out;
  if (/(?:[sxz]|[cs]h)$/.test(w)) push(w + 'es');
  else if (/[^aeiou]y$/.test(w)) push(w.slice(0, -1) + 'ies');
  else push(w + 's');
  if (/[^aeiou]y$/.test(w)) {
    const yi = w.slice(0, -1) + 'i';
    push(yi + 'er');
    push(yi + 'est');
    push(yi + 'ed');
    push(yi + 'ly');
  }
  if (/[^e]e$/.test(w) && w.length > 2) {
    const stem = w.slice(0, -1);
    push(stem + 'ing');
    push(stem + 'er');
    push(stem + 'est');
    push(w + 'd');
    push(w + 'r');
  }
  if (/[aeiou][^aeiouwxy]$/.test(w) && w.length <= 5) {
    const dbl = w + w.slice(-1);
    push(dbl + 'er');
    push(dbl + 'est');
    push(dbl + 'ed');
    push(dbl + 'ing');
  }
  push(w + 'er');
  push(w + 'est');
  push(w + 'ed');
  push(w + 'ing');
  push(w + 'ly');
  if (/y$/.test(w)) push(w.slice(0, -1) + 'ily');
  return out;
}

function phraseList(entry) {
  const phrases = [];
  function add(p) {
    p = String(p || '').trim();
    if (p && !phrases.includes(p.toLowerCase())) phrases.push(p);
  }
  if (!entry) return phrases;
  add(entry.word);
  extraPhrases(entry.comparative).forEach(add);
  extraPhrases(entry.superlative).forEach(add);
  inflections(entry.word).forEach(add);
  if (entry.word && !entry.word.includes(' ') && !entry.word.includes('-')) {
    add('more ' + entry.word);
    add('most ' + entry.word);
  }
  phrases.sort((a, b) => b.length - a.length);
  return phrases;
}

function findRanges(text, phrases) {
  if (!phrases.length || !text) return [];
  const pattern = phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')).join('|');
  const re = new RegExp('\\b(?:' + pattern + ')\\b', 'gi');
  const ranges = [];
  let match;
  while ((match = re.exec(text))) {
    if (!match[0]) { re.lastIndex++; continue; }
    ranges.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  }
  return ranges;
}

function loadWindowScript(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
}

const sandbox = { window: {} };
sandbox.window.VOCAB_CHUNKS = {};
sandbox.window.VOCAB_REGISTER = function (id, words) { sandbox.window.VOCAB_CHUNKS[id] = words; };
loadWindowScript(path.join(vocabDir, 'data', 'manifest.js'), sandbox);
const manifest = sandbox.window.VOCAB_MANIFEST;
const chunkIds = [];
for (const book of manifest.books || []) {
  for (const unit of book.units || []) {
    for (const chunk of unit.chunks || []) {
      chunkIds.push(chunk.id);
      loadWindowScript(path.join(vocabDir, chunk.file), sandbox);
    }
  }
}

const entries = [];
for (const chunkId of chunkIds) {
  for (const word of sandbox.window.VOCAB_CHUNKS[chunkId] || []) {
    if (!word.id) throw new Error(chunkId + ' entry ' + word.word + ' is missing id');
    entries.push({ ...word, chunk: chunkId });
  }
}

const forms = {};
const occurrences = {};
const words = {};
for (const entry of entries) {
  words[entry.id] = { word: entry.word, meaning: entry.chinese_meaning || '', chunk: entry.chunk };
  const seen = [];
  const occ = [];
  for (const other of entries) {
    const ranges = findRanges(other.example_sentence || '', phraseList(entry));
    if (!ranges.length) continue;
    const surfaces = [];
    for (const range of ranges) {
      if (!surfaces.includes(range.text)) surfaces.push(range.text);
      if (!seen.includes(range.text)) seen.push(range.text);
    }
    if (other.id === entry.id) continue;
    occ.push({ sentenceOf: other.id, chunk: other.chunk, forms: surfaces });
  }
  forms[entry.id] = seen;
  if (occ.length) occurrences[entry.id] = occ;
}

const index = {
  version: 1,
  generated: new Date().toISOString(),
  chunks: chunkIds,
  words,
  forms,
  occurrences
};
const outFile = path.join(vocabDir, 'data', 'sentence-index.js');
fs.writeFileSync(outFile, 'window.VOCAB_SENTENCE_INDEX = ' + JSON.stringify(index, null, 2) + ';\n');
const shared = Object.values(occurrences).reduce((n, list) => n + list.length, 0);
console.log('wrote ' + path.relative(vocabDir, outFile) + ' (' + shared + ' shared sentences)');

const PREP_WORDS = { in: 1, on: 1, at: 1, with: 1, about: 1, for: 1, to: 1, by: 1, of: 1, from: 1, into: 1, over: 1, across: 1, after: 1, between: 1 };
const FILTER_KINDS = { prefix: 1, suffix: 1, root: 1, letter: 1, page: 1, comparison: 1, colloc: 1, note: 1 };

function prepOf(coloc) {
  if (!coloc || coloc.kind !== 'prep') return '';
  const src = Array.isArray(coloc.match) ? coloc.match[coloc.match.length - 1] : coloc.match;
  const bits = String(src || '').trim().split(/\s+/);
  const prep = (bits[bits.length - 1] || '').replace(/[^a-z]/gi, '').toLowerCase();
  return PREP_WORDS[prep] ? prep : '';
}

function findLiteral(text, needle, from) {
  const n = String(needle || '');
  if (!n) return null;
  const i = text.toLowerCase().indexOf(n.toLowerCase(), from || 0);
  if (i < 0) return null;
  return { start: i, end: i + n.length };
}

function matchSpans(text, coloc) {
  const parts = Array.isArray(coloc.match) ? coloc.match : [coloc.match];
  let from = 0;
  for (const part of parts) {
    const hit = findLiteral(text, part, from);
    if (!hit) return false;
    from = hit.end;
  }
  return true;
}

function wordBlankOk(entry) {
  const sentence = entry.example_sentence || '';
  if (findRanges(sentence, phraseList(entry)).length) return true;
  const lemma = String(entry.word || '').toLowerCase();
  const re = /[A-Za-z][A-Za-z'-]*/g;
  let best = 0;
  let m;
  while ((m = re.exec(sentence))) {
    const w = m[0].toLowerCase();
    let score = 0;
    const n = Math.min(w.length, lemma.length);
    for (let i = 0; i < n; i++) {
      if (w.charAt(i) !== lemma.charAt(i)) break;
      score++;
    }
    if (score > best) best = score;
  }
  return best >= 3;
}

const catalogWords = entries.map((entry) => {
  const tags = [];
  for (const tag of entry.tags || []) {
    if (tag.startsWith('book:') || tag.startsWith('unit:') || tag.startsWith('colloc:')) continue;
    const kind = String(tag).split(':')[0];
    if (FILTER_KINDS[kind] && !tags.includes(tag)) tags.push(tag);
  }
  const preps = [];
  for (const coloc of entry.collocations || []) {
    const prep = prepOf(coloc);
    if (prep && !preps.includes(prep)) preps.push(prep);
  }
  const pos = (String(entry.chinese_meaning || '').match(/[形名動副代]/) || [''])[0];
  const list = entry.collocations || [];
  const hasColoc = !!(list.length && matchSpans(entry.example_sentence || '', list[0]));
  let flags = 0;
  if (hasColoc) flags |= 1;
  if (entry.example_translation) flags |= 2;
  if (wordBlankOk(entry)) flags |= 4;
  return {
    id: entry.id,
    word: entry.word,
    chunk: entry.chunk,
    num: entry.num,
    page: entry.page,
    pos,
    tags,
    preps,
    flags
  };
});

const catalog = { version: 1, total: catalogWords.length, words: catalogWords };
const catalogFile = path.join(vocabDir, 'data', 'catalog.js');
fs.writeFileSync(catalogFile, 'window.VOCAB_CATALOG = ' + JSON.stringify(catalog) + ';\n');
console.log('wrote ' + path.relative(vocabDir, catalogFile) + ' (' + catalogWords.length + ' words)');

const { stampRelease } = await import('./stamp-release.mjs');
stampRelease();
