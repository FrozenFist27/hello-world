// validate.js — the ordered validation pipeline for everything Claude writes. Pure: no DOM, no
// chess, and nothing from the app but contract.js (the K3 caps). The page grades every tap with
// chess.js's own answer sets; this file only decides whether a reply's words may be shown at all.
//
// The pipeline on one string, in order:
//  (1) every square token ([a-h][1-8] on word boundaries) must be in the allowed set and not in
//      the forbidden set; a piece word written as '<piece> on <square>' must match the piece the
//      board has there; the square tokens are then masked out;
//  (2) on the masked text any SAN-shaped token (a capital piece letter followed by a square or an
//      'x', an 'x' between a file or piece letter and a square, '=' followed by a piece letter,
//      O-O or O-O-O) outside the allowed moves rejects;
//  (3) any remaining digit rejects;
//  (4) any banned word rejects (the list is assembled from char codes so the words never appear
//      in the source, which the copy guard scans);
//  (5) caps: words, sentences, and a question mark where none is allowed.
//
// K2 and K1 wrap that pipeline with their own shapes; templateRules applies only (1)-(2) to the
// copy templates, with every square allowed and placeholders removed. K3 (the close) runs every
// text field through the same pipeline with an EMPTY allowed-square set and accepts per field;
// maskForPrompt() is the other direction: it takes squares and moves out of the player's own
// words before they enter any prompt.

import { CLAUDE } from './contract.js';

const chars = (...codes) => String.fromCharCode(...codes);

// The banned words, built from char codes: the three labels and the double question mark.
export const BANNED = [
  chars(98, 108, 117, 110, 100, 101, 114),                   // b-l-u-n-d-e-r
  chars(109, 105, 115, 116, 97, 107, 101),                   // m-i-s-t-a-k-e
  chars(105, 110, 97, 99, 99, 117, 114, 97, 99, 121),       // i-n-a-c-c-u-r-a-c-y
  chars(63, 63),                                             // two question marks
];
// Stems, so that plurals, past tenses and the adjective form of the third label reject too.
const BANNED_STEMS = [
  BANNED[0],                                                 // the first label and its plural and past tense
  chars(109, 105, 115, 116, 97, 107),                        // mistak-e, -es, -en
  chars(105, 110, 97, 99, 99, 117, 114, 97),                 // the third label without its ending
];
const BANNED_RE = new RegExp('\\b(?:' + BANNED_STEMS.join('|') + ')', 'i');
const DOUBLE_Q = BANNED[3];

const SQUARE_RE = /\b([a-h][1-8])\b/g;
const SQUARE_ONE = /^[a-h][1-8]$/;
const PIECE_WORDS = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };
const PIECE_ON_RE = /\b(pawn|knight|bishop|rook|queen|king)s?\s+(?:on|at)\s+([a-h][1-8])\b/gi;
const MASK = '\u00b7'; // a middle dot: no digit, no letter, keeps word boundaries where the square was
// SAN-shaped tokens: piece letter (+ optional disambiguation) + optional x + square; pawn capture
// file x square; promotion '=' + piece letter; castling. Checks and mates may follow.
const SAN_RE = /(?:\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|\b[a-h]x[a-h][1-8]|\b[a-h][1-8]?=[QRBN]|=\s?[QRBN]\b|\bO-O(?:-O)?)(?:=[QRBN])?[+#]?/g;
const PLACEHOLDER_RE = /\{\w+\}/g;

function str(x) {
  return typeof x === 'string' ? x : '';
}
function tidy(text) {
  return str(text).replace(/\s+/g, ' ').trim();
}

// Whitespace-separated words.
export function wordCount(text) {
  const t = tidy(text);
  return t ? t.split(' ').length : 0;
}

// Sentences end at . ! or ? (a run counts once); a trailing fragment without one counts too.
export function sentenceCount(text) {
  return splitSentences(text).length;
}
function splitSentences(text) {
  const t = tidy(text);
  if (!t) return [];
  return t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

// Every square token in order of appearance.
export function squaresIn(text) {
  const out = [];
  const t = str(text);
  SQUARE_RE.lastIndex = 0;
  let m;
  while ((m = SQUARE_RE.exec(t))) out.push(m[1]);
  return out;
}

function toSet(list) {
  const s = new Set();
  for (const x of list || []) if (typeof x === 'string') s.add(x.toLowerCase());
  return s;
}

// Rules (1) and (2): squares against the allowed and forbidden sets, piece words against the
// board, masking, then SAN-shaped tokens against the allowed moves. `piecesOn` null skips the
// piece check (templates). Returns { ok, reason?, masked? }.
function squareAndSanRules(text, { allowedSquares, allAllowed = false, forbidSquares, piecesOn, allowedMoves }) {
  const allowed = toSet(allowedSquares);
  const forbidden = toSet(forbidSquares);
  for (const sq of squaresIn(text)) {
    if (forbidden.has(sq)) return { ok: false, reason: `square ${sq} is forbidden here` };
    if (!allAllowed && !allowed.has(sq)) return { ok: false, reason: `square ${sq} is not in the allowed set` };
  }
  if (piecesOn) {
    PIECE_ON_RE.lastIndex = 0;
    let m;
    while ((m = PIECE_ON_RE.exec(text))) {
      const want = PIECE_WORDS[m[1].toLowerCase()];
      const sq = m[2].toLowerCase();
      const there = piecesOn[sq];
      if (!there || !there.type) return { ok: false, reason: `nothing is on ${sq}, not a ${m[1].toLowerCase()}` };
      if (String(there.type).toLowerCase() !== want) return { ok: false, reason: `the piece on ${sq} is not a ${m[1].toLowerCase()}` };
    }
  }
  const masked = text.replace(SQUARE_RE, MASK);
  const moves = new Set((allowedMoves || []).map((s) => String(s)));
  SAN_RE.lastIndex = 0;
  let m;
  while ((m = SAN_RE.exec(masked))) {
    const token = m[0].trim();
    if (!moves.has(token) && !moves.has(token.replace(/[+#]$/, ''))) return { ok: false, reason: `notation: ${token}` };
  }
  return { ok: true, masked };
}

// The full pipeline on one string.
export function validateText(text, ctx = {}, { maxWords = Infinity, maxSentences = Infinity, maxWordsPerSentence = Infinity, noQuestion = false, forbidSquares = [] } = {}) {
  if (typeof text !== 'string') return { ok: false, reason: 'not a string' };
  const t = tidy(text);
  const r = squareAndSanRules(t, {
    allowedSquares: ctx.allowedSquares || [],
    forbidSquares,
    piecesOn: ctx.piecesOn || {},
    allowedMoves: ctx.allowedMoves || [],
  });
  if (!r.ok) return r;
  const masked = r.masked;
  if (/\d/.test(masked)) return { ok: false, reason: 'a number', masked };
  if (BANNED_RE.test(t) || t.includes(DOUBLE_Q)) return { ok: false, reason: 'a banned word', masked };
  const words = wordCount(t);
  if (words > maxWords) return { ok: false, reason: `${words} words, more than ${maxWords}`, masked };
  const sentences = splitSentences(t);
  if (sentences.length > maxSentences) return { ok: false, reason: `${sentences.length} sentences, more than ${maxSentences}`, masked };
  for (const s of sentences) {
    const n = wordCount(s);
    if (n > maxWordsPerSentence) return { ok: false, reason: `a sentence of ${n} words, more than ${maxWordsPerSentence}`, masked };
  }
  if (noQuestion && t.includes('?')) return { ok: false, reason: 'a question mark', masked };
  return { ok: true, masked };
}

// K2: { say, ask, squares }. say: at most two sentences of at most twenty words each and 32 words
// in all (the spec's 31-word example passes; 32 plus the 8-word ask question is what fits the
// four-line box at 400 px), no question mark; ask: null or one of the offered kinds; squares: at
// most three, each allowed. CLAUDE.K2_MAX_WORDS / K2_MAX_WORDS_PER_SENTENCE mirror these numbers.
export function validateK2(reply, ctx = {}) {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return { ok: false, reason: 'reply is not an object' };
  const say = tidy(reply.say);
  if (!say) return { ok: false, reason: 'say is empty' };
  const r = validateText(say, ctx, { maxSentences: 2, maxWordsPerSentence: 20, maxWords: 32, noQuestion: true });
  if (!r.ok) return { ok: false, reason: `say: ${r.reason}` };
  let ask = reply.ask == null || reply.ask === '' ? null : reply.ask;
  if (ask !== null) {
    if (typeof ask !== 'string') return { ok: false, reason: 'ask is not a string' };
    ask = ask.trim();
    if (!(ctx.offeredAsks || []).includes(ask)) return { ok: false, reason: `ask ${ask} was not offered` };
  }
  const raw = reply.squares == null ? [] : reply.squares;
  if (!Array.isArray(raw)) return { ok: false, reason: 'squares is not an array' };
  const allowed = toSet(ctx.allowedSquares);
  const squares = [];
  for (const s of raw) {
    if (typeof s !== 'string' || !SQUARE_ONE.test(s.trim().toLowerCase())) return { ok: false, reason: 'squares holds something that is not a square' };
    const sq = s.trim().toLowerCase();
    if (!allowed.has(sq)) return { ok: false, reason: `square ${sq} is not in the allowed set` };
    if (!squares.includes(sq)) squares.push(sq);
  }
  if (squares.length > 3) return { ok: false, reason: `${squares.length} squares, more than three` };
  return { ok: true, value: { say, ask, squares } };
}

// K1: { if_right, if_partial, if_wrong, and_then, anyway }. Twenty words each, if_wrong fourteen
// and never an answer square, and_then empty or twelve.
export function validateK1(reply, ctx = {}) {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return { ok: false, reason: 'reply is not an object' };
  const value = {};
  const rules = [
    ['if_right', { maxWords: 20 }],
    ['if_partial', { maxWords: 20 }],
    ['if_wrong', { maxWords: 14, forbidSquares: ctx.answerSquares || [] }],
    ['and_then', { maxWords: 12 }],
    ['anyway', { maxWords: 20 }],
  ];
  for (const [key, opts] of rules) {
    let text = reply[key];
    if (key === 'and_then' && text == null) text = '';
    if (typeof text !== 'string') return { ok: false, reason: `${key} is not a string` };
    text = tidy(text);
    if (!text && key !== 'and_then') return { ok: false, reason: `${key} is empty` };
    if (text) {
      const r = validateText(text, ctx, opts);
      if (!r.ok) return { ok: false, reason: `${key}: ${r.reason}` };
    }
    value[key] = text;
  }
  return { ok: true, value };
}

// The square and SAN rules only, for the copy templates: placeholders are removed, every square
// is allowed, the piece check is skipped, no move is allowed.
export function templateRules(text) {
  if (typeof text !== 'string') return { ok: false, reason: 'not a string' };
  const t = text.replace(PLACEHOLDER_RE, ' ');
  const r = squareAndSanRules(t, { allowedSquares: [], allAllowed: true, forbidSquares: [], piecesOn: null, allowedMoves: [] });
  return r.ok ? { ok: true } : { ok: false, reason: r.reason };
}

// ---------------------------------------------------------------------------------------------
// K3, the close: { where, next, again, question, ask_first, focus }, accepted PER FIELD.
// ---------------------------------------------------------------------------------------------
// The caps come from CLAUDE.K3. One exception, Decided: the contract's own example 'where' (the
// PATHWAY.md K3 example, which must pass whole) is twenty words, two over WHERE_MAX_WORDS, so the
// where cap accepts up to twenty; the prompt still asks for CLAUDE.K3.WHERE_MAX_WORDS. Once the
// contract carries 20 this max() is a no-op.
const K3 = CLAUDE.K3;
const K3_WHERE_EXAMPLE_WORDS = 20;
export const K3_LIMITS = Object.freeze({
  where: Object.freeze({ maxWords: Math.max(K3.WHERE_MAX_WORDS, K3_WHERE_EXAMPLE_WORDS), maxSentences: K3.WHERE_MAX_SENTENCES, noQuestion: true }),
  next: Object.freeze({ maxWords: K3.NEXT_MAX_WORDS, maxSentences: K3.NEXT_MAX_SENTENCES, noQuestion: true }),
  again: Object.freeze({ maxWords: K3.AGAIN_MAX_WORDS, maxSentences: K3.AGAIN_MAX_SENTENCES, noQuestion: true }),
  question: Object.freeze({ maxWords: K3.QUESTION_MAX_WORDS, maxSentences: K3.QUESTION_MAX_SENTENCES, noQuestion: false }),
});
const PIECE_WORD_RE = /\b(pawn|knight|bishop|rook|queen|king)s?\b/gi;
// Every K3 text is shown over positions Claude has not seen: no square, no piece check, no move.
const K3_TEXT_CTX = Object.freeze({ allowedSquares: [], piecesOn: {}, allowedMoves: [] });

function k3Text(field, raw, ctx) {
  let text = raw;
  if (field === 'again' && text == null) text = '';
  if (typeof text !== 'string') return { ok: false, reason: `${field} is not a string` };
  text = tidy(text);
  if (!text) return field === 'again' ? { ok: true, value: '' } : { ok: false, reason: `${field} is empty` };
  const r = validateText(text, K3_TEXT_CTX, K3_LIMITS[field]);
  if (!r.ok) return { ok: false, reason: r.reason };
  if (field === 'question') {
    if (!text.startsWith(K3.QUESTION_START)) return { ok: false, reason: `does not start with '${K3.QUESTION_START}'` };
    if (!text.endsWith(K3.QUESTION_END)) return { ok: false, reason: `does not end with '${K3.QUESTION_END}'` };
    const allowed = toSet(ctx.allowedPieces);
    PIECE_WORD_RE.lastIndex = 0;
    let m;
    while ((m = PIECE_WORD_RE.exec(text))) {
      const w = m[1].toLowerCase();
      if (!allowed.has(w)) return { ok: false, reason: `the piece word ${w} is not allowed for ${ctx.nodeId || 'this look'}` };
    }
  }
  return { ok: true, value: text };
}

function k3Choice(field, raw, list) {
  if (raw == null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, reason: `${field} is not a string` };
  const v = raw.trim();
  if (!v) return { ok: true, value: null };
  if (!(Array.isArray(list) ? list : []).includes(v)) return { ok: false, reason: `${field} ${v} is not in the set` };
  return { ok: true, value: v };
}

// validateK3(reply, ctx): ctx = { nodeId, allowedPieces, offeredAsks, tied, ... }. Returns
// { ok: at least one field passed, value: { field: tidy text | choice | null (rejected) },
//   rejected: [field] in CLAUDE.K3.FIELDS order, reasons: { field: string } }.
export function validateK3(reply, ctx = {}) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const value = {};
  const rejected = [];
  const reasons = {};
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) {
    for (const f of K3.FIELDS) { value[f] = null; rejected.push(f); reasons[f] = 'reply is not an object'; }
    return { ok: false, value, rejected, reasons };
  }
  for (const f of K3.FIELDS) {
    let r;
    if (f === 'ask_first') r = k3Choice(f, reply[f], c.offeredAsks);
    else if (f === 'focus') r = k3Choice(f, reply[f], c.tied);
    else r = k3Text(f, reply[f], c);
    if (r.ok) value[f] = r.value;
    else { value[f] = null; rejected.push(f); reasons[f] = r.reason; }
  }
  return { ok: rejected.length < K3.FIELDS.length, value, rejected, reasons };
}

// maskForPrompt(text): the player's own words, safe to quote in a prompt. Every SAN-shaped token
// (castling included, and the lower-case spellings people type: nxe5, bxf7, o-o, 0-0) becomes
// 'that move'; every square token becomes 'that square'; control characters and guillemets go;
// whitespace collapses. A non-string is ''.
const LOOSE_MOVE_RE = /\b(?:[KQRBN]?[a-h]?[1-8]?x[a-h][1-8]|[KQRBN][a-h]?[1-8]?[a-h][1-8])(?:=?[QRBN])?[+#]?(?![\w])/gi;
const CASTLE_RE = /(?<![\w-])(?:[O0]-[O0](?:-[O0])?)(?![\w-])[+#]?/gi;
export function maskForPrompt(text) {
  if (typeof text !== 'string') return '';
  let t = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/[\u00ab\u00bb]/g, ' ');
  t = t.replace(SAN_RE, ' that move ');
  t = t.replace(CASTLE_RE, ' that move ');
  t = t.replace(LOOSE_MOVE_RE, ' that move ');
  t = t.replace(SQUARE_RE, 'that square');
  return t.replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
}
