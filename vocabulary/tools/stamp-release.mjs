// Copy vocabulary data files to content-hashed filenames and point
// index.html and the published manifest at those names.
// Source files (manifest.js, sentence-index.js, tango2000/p6.js, …) stay
// so the next edit still has a stable path. Run from the vocabulary folder:
//   node tools/stamp-release.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const vocabDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(vocabDir, 'data');
const HASH_LEN = 10;

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, HASH_LEN);
}

function logicalBase(fileName) {
  return fileName.replace(new RegExp('\\.[0-9a-f]{' + HASH_LEN + '}(?=\\.js$)'), '').replace(/\.js$/, '');
}

function hashedRel(rel, content) {
  const base = logicalBase(path.basename(rel));
  return path.posix.join(path.posix.dirname(rel), base + '.' + hashText(content) + '.js');
}

function loadManifestFiles() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(dataDir, 'manifest.js'), 'utf8'), sandbox, { filename: 'manifest.js' });
  const files = [];
  for (const book of sandbox.window.VOCAB_MANIFEST.books || []) {
    for (const unit of book.units || []) {
      for (const chunk of unit.chunks || []) {
        if (chunk.file && !files.includes(chunk.file)) files.push(chunk.file);
      }
    }
  }
  return files;
}

function writeHashed(rel, content, keep) {
  const destRel = hashedRel(rel, content);
  const dest = path.join(vocabDir, destRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content);
  keep.add(path.resolve(dest));
  return destRel;
}

export function stampRelease() {
  const chunkFiles = loadManifestFiles();
  const keep = new Set();
  let manifestText = fs.readFileSync(path.join(dataDir, 'manifest.js'), 'utf8');
  const replacements = chunkFiles
    .map((rel) => ({ rel, content: fs.readFileSync(path.join(vocabDir, rel)) }))
    .sort((a, b) => b.rel.length - a.rel.length);
  for (const item of replacements) {
    const destRel = writeHashed(item.rel, item.content, keep);
    manifestText = manifestText.split(item.rel).join(destRel);
  }
  const indexText = fs.readFileSync(path.join(dataDir, 'sentence-index.js'), 'utf8');
  const release = hashText(manifestText + '\n' + indexText);
  const manifestRel = 'data/manifest.' + release + '.js';
  const indexRel = 'data/sentence-index.' + release + '.js';
  fs.writeFileSync(path.join(vocabDir, manifestRel), manifestText);
  fs.writeFileSync(path.join(vocabDir, indexRel), indexText);
  keep.add(path.resolve(vocabDir, manifestRel));
  keep.add(path.resolve(vocabDir, indexRel));

  const indexHtmlPath = path.join(vocabDir, 'index.html');
  let html = fs.readFileSync(indexHtmlPath, 'utf8');
  if (!html.includes('var VOCAB_VERSION = ')) throw new Error('index.html is missing VOCAB_VERSION');
  if (!html.includes('data/manifest.' + "' + VOCAB_VERSION + '" + '.js')) {
    throw new Error('index.html manifest script is not using VOCAB_VERSION in the filename');
  }
  html = html.replace(/var VOCAB_VERSION = '[^']*';/, "var VOCAB_VERSION = '" + release + "';");
  fs.writeFileSync(indexHtmlPath, html);

  const hashedName = new RegExp('\\.[0-9a-f]{' + HASH_LEN + '}\\.js$');
  function sweep(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) sweep(full);
      else if (hashedName.test(entry.name) && !keep.has(path.resolve(full))) fs.unlinkSync(full);
    }
  }
  sweep(dataDir);
  console.log('stamped ' + manifestRel + ' and ' + chunkFiles.length + ' chunk files');
  return release;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) stampRelease();
