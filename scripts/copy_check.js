#!/usr/bin/env node
// copy_check.js - the copy guard. Scans the shipped page for the words and marks the spec bans
// and runs validate.js's square and SAN rules over every COPY template in contract.js.
//
//   node scripts/copy_check.js [--dir app]          exit 0 when clean, 1 with every hit as file:line
//
// Scanned: <dir>/index.html, <dir>/styles.css, <dir>/js/*.js except validate.js (its ban list is
// built from char codes), <dir>/data/*.json. scripts/ and app/dev/ are not scanned.
//
// Rules:
//  words    blunder, mistake, inaccuracy, submit, analyze, accuracy, user (whole words, any case);
//           the CSS property user-select is a property name, not copy, and is exempt
//  marks    '??' (in JS only inside string literals: the nullish operator is code, not copy)
//  red      the word red, #f00 / #ff0000, any hex or rgb() colour whose red channel is more than
//           twice the larger of green and blue
//  markup   a class, id or selector naming an eval bar, move list, rating or clock
//  emoji    emoji code points; chess glyphs U+2654-U+265F (pieces are SVG, never text)
//  copy     every COPY template passes validate.templateRules (no square, no notation outside a
//           placeholder) and every question starts with 'Hold on.' and has at most 16 words
//
// JS files are scanned by their string literals (words, red, markup, emoji, '??') and comments
// (words, red, markup, emoji); code identifiers are not copy.

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const DIR = path.resolve(arg('--dir', path.join(__dirname, '..', 'app')));

const WORD_RE = /\b(blunder|mistake|inaccuracy|submit|analyze|accuracy|user)\b/gi;
const RED_WORD_RE = /\bred\b/gi;
const HEX_RE = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
const RGB_RE = /\brgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/gi;
const MARKUP_HTML_RE = /\b(?:class|id)\s*=\s*["'][^"']*?(eval|movelist|move-list|rating|clock)/gi;
const MARKUP_CSS_RE = /[.#][\w-]*?(eval|movelist|move-list|rating|clock)\b/gi;
const MARKUP_TEXT_RE = /(?:^|[\s.#"'`\-_])(eval-?bar|move-?list|rating|clock)\b/gi;
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;
const GLYPH_RE = /[♔-♟]/g;
const QQ = String.fromCharCode(63, 63);

const hits = [];
function hit(file, text, index, rule, what) {
  const line = text.slice(0, index).split('\n').length;
  const from = text.lastIndexOf('\n', index) + 1;
  let to = text.indexOf('\n', index);
  if (to < 0) to = text.length;
  const excerpt = text.slice(from, to).trim().slice(0, 100);
  hits.push(`${path.relative(process.cwd(), file)}:${line}: ${rule}: ${what} | ${excerpt}`);
}

// ---------------------------------------------------------------------------------------------
// Chunks: a chunk is a piece of a file with its offset, so hits report the real line.
// ---------------------------------------------------------------------------------------------
function wholeFile(text) {
  return [{ text, offset: 0, kind: 'text' }];
}

// Pull string literals (kind 'string') and comments (kind 'comment') out of JavaScript source.
// Regex literals are skipped so a quote inside one does not open a string.
function jsChunks(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  let prev = '';          // the last significant (non-space) character before the current token
  const push = (kind, start, end) => { if (end > start) out.push({ text: src.slice(start, end), offset: start, kind }); };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let e = src.indexOf('\n', i);
      if (e < 0) e = n;
      push('comment', i + 2, e);
      i = e;
      continue;
    }
    if (c === '/' && d === '*') {
      let e = src.indexOf('*/', i + 2);
      if (e < 0) e = n;
      push('comment', i + 2, e);
      i = e + 2;
      prev = '';
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j += 1; j += 1; }
      push('string', i + 1, j);
      i = j + 1;
      prev = c;
      continue;
    }
    if (c === '`') {
      // a template literal: ${...} may hold nested quotes and templates
      let j = i + 1;
      let start = j;
      let depth = 0;
      while (j < n) {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (depth === 0 && ch === '`') break;
        if (depth === 0 && ch === '$' && src[j + 1] === '{') { push('string', start, j); depth = 1; j += 2; continue; }
        if (depth > 0) {
          if (ch === '{') depth += 1;
          else if (ch === '}') { depth -= 1; if (depth === 0) start = j + 1; }
          else if (ch === '"' || ch === "'" || ch === '`') {
            // a nested string inside the expression
            const q = ch;
            let k = j + 1;
            while (k < n && src[k] !== q) { if (src[k] === '\\') k += 1; k += 1; }
            push('string', j + 1, k);
            j = k;
          }
        }
        j += 1;
      }
      if (depth === 0) push('string', start, j);
      i = j + 1;
      prev = '`';
      continue;
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev) || prev === 'return')) {
      // a regex literal
      let j = i + 1;
      let cls = false;
      while (j < n && src[j] !== '\n') {
        const ch = src[j];
        if (ch === '\\') { j += 2; continue; }
        if (ch === '[') cls = true;
        else if (ch === ']') cls = false;
        else if (ch === '/' && !cls) break;
        j += 1;
      }
      i = j + 1;
      prev = '/';
      continue;
    }
    if (!/\s/.test(c)) {
      if (/[A-Za-z_$]/.test(c)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j += 1;
        const ident = src.slice(i, j);
        prev = ident === 'return' || ident === 'typeof' || ident === 'case' ? 'return' : 'a';
        i = j;
        continue;
      }
      prev = c;
    }
    i += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rules on a chunk
// ---------------------------------------------------------------------------------------------
function scanWords(file, full, chunk) {
  WORD_RE.lastIndex = 0;
  let m;
  while ((m = WORD_RE.exec(chunk.text))) {
    if (/^user-select/i.test(chunk.text.slice(m.index))) continue; // the CSS property
    hit(file, full, chunk.offset + m.index, 'banned word', m[0]);
  }
}
function scanQQ(file, full, chunk) {
  let i = chunk.text.indexOf(QQ);
  while (i >= 0) { hit(file, full, chunk.offset + i, 'banned mark', QQ); i = chunk.text.indexOf(QQ, i + 2); }
}
function scanRed(file, full, chunk) {
  let m;
  RED_WORD_RE.lastIndex = 0;
  while ((m = RED_WORD_RE.exec(chunk.text))) hit(file, full, chunk.offset + m.index, 'red', m[0]);
  HEX_RE.lastIndex = 0;
  while ((m = HEX_RE.exec(chunk.text))) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (r > 0 && r > 2 * Math.max(g, b)) hit(file, full, chunk.offset + m.index, 'red colour', m[0]);
  }
  RGB_RE.lastIndex = 0;
  while ((m = RGB_RE.exec(chunk.text))) {
    const r = Number(m[1]), g = Number(m[2]), b = Number(m[3]);
    if (r > 0 && r > 2 * Math.max(g, b)) hit(file, full, chunk.offset + m.index, 'red colour', m[0]);
  }
}
function scanMarkup(file, full, chunk, re) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(chunk.text))) hit(file, full, chunk.offset + m.index, 'forbidden markup', m[1] || m[0]);
}
function scanGlyphs(file, full, chunk) {
  let m;
  EMOJI_RE.lastIndex = 0;
  while ((m = EMOJI_RE.exec(chunk.text))) hit(file, full, chunk.offset + m.index, 'emoji', `U+${m[0].codePointAt(0).toString(16).toUpperCase()}`);
  GLYPH_RE.lastIndex = 0;
  while ((m = GLYPH_RE.exec(chunk.text))) hit(file, full, chunk.offset + m.index, 'chess glyph', `U+${m[0].codePointAt(0).toString(16).toUpperCase()}`);
}

function scanFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file).toLowerCase();
  if (ext === '.js' || ext === '.mjs') {
    for (const chunk of jsChunks(text)) {
      scanWords(file, text, chunk);
      scanRed(file, text, chunk);
      scanMarkup(file, text, chunk, MARKUP_TEXT_RE);
      scanGlyphs(file, text, chunk);
      if (chunk.kind === 'string') scanQQ(file, text, chunk);
    }
    return;
  }
  for (const chunk of wholeFile(text)) {
    scanWords(file, text, chunk);
    scanQQ(file, text, chunk);
    scanRed(file, text, chunk);
    scanGlyphs(file, text, chunk);
    if (ext === '.html') { scanMarkup(file, text, chunk, MARKUP_HTML_RE); scanMarkup(file, text, chunk, MARKUP_TEXT_RE); }
    else if (ext === '.css') scanMarkup(file, text, chunk, MARKUP_CSS_RE);
    else scanMarkup(file, text, chunk, MARKUP_TEXT_RE);
  }
}

// ---------------------------------------------------------------------------------------------
// COPY templates through validate.templateRules
// ---------------------------------------------------------------------------------------------
function walkStrings(value, keyPath, visit) {
  if (typeof value === 'string') { visit(keyPath, value); return; }
  if (Array.isArray(value)) { value.forEach((v, i) => walkStrings(v, `${keyPath}[${i}]`, visit)); return; }
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walkStrings(v, keyPath ? `${keyPath}.${k}` : k, visit);
}

async function checkTemplates() {
  const contractPath = path.join(DIR, 'js', 'contract.js');
  const validatePath = path.join(DIR, 'js', 'validate.js');
  const contract = await import(pathToFileURL(contractPath).href);
  const validate = await import(pathToFileURL(validatePath).href);
  const rel = path.relative(process.cwd(), contractPath);
  let count = 0;
  walkStrings(contract.COPY, 'COPY', (key, text) => {
    count += 1;
    const r = validate.templateRules(text);
    if (!r.ok) hits.push(`${rel}: template ${key}: ${r.reason} | ${text}`);
    if (/^COPY\.QUESTION\./.test(key)) {
      if (!text.startsWith('Hold on.')) hits.push(`${rel}: template ${key}: does not start with 'Hold on.' | ${text}`);
      const words = text.trim().split(/\s+/).length;
      if (words > 16) hits.push(`${rel}: template ${key}: ${words} words, more than 16 | ${text}`);
    }
    if (/\?\?/.test(text)) hits.push(`${rel}: template ${key}: banned mark | ${text}`);
  });
  return count;
}

async function main() {
  const files = [path.join(DIR, 'index.html'), path.join(DIR, 'styles.css')];
  const jsDir = path.join(DIR, 'js');
  for (const f of fs.readdirSync(jsDir).sort()) if (/\.m?js$/.test(f) && f !== 'validate.js') files.push(path.join(jsDir, f));
  const dataDir = path.join(DIR, 'data');
  if (fs.existsSync(dataDir)) for (const f of fs.readdirSync(dataDir).sort()) if (/\.json$/.test(f)) files.push(path.join(dataDir, f));
  for (const f of files) {
    if (!fs.existsSync(f)) { hits.push(`${path.relative(process.cwd(), f)}: missing`); continue; }
    scanFile(f);
  }
  let templates = 0;
  try { templates = await checkTemplates(); } catch (e) { hits.push(`contract.js / validate.js could not be loaded: ${e && e.message}`); }
  if (hits.length) {
    for (const h of hits) console.log(h);
    console.log(`copy_check: ${hits.length} hit${hits.length === 1 ? '' : 's'} in ${files.length} files`);
    process.exit(1);
  }
  console.log(`copy_check: ok (${files.length} files, ${templates} templates)`);
}
main().catch((e) => { console.error('copy_check failed:', e && e.stack || e); process.exit(2); });
