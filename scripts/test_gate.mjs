#!/usr/bin/env node
// test_gate.mjs — replays app/data/positions.json through facts.js and gate.js in node (no
// browser, no engine): every recorded move gets its verdict and reward asserted against the
// spec's expectations; the held positions render their template copy (<= 16 words each, and
// validate.templateRules when validate.js exists); the quiet and pair rules, grading, the asks,
// tutorial.json and the between-game lines are checked too.
//
//   node /home/user/hello-world/scripts/test_gate.mjs      (exit 0 on success, 1 on the first failure)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = process.env.HOLDON_APP || path.join(ROOT, 'app'); // override for dev runs against a copy

const { Chess } = await import(path.join(APP, 'vendor', 'chess.js'));
const F = await import(path.join(APP, 'js', 'facts.js'));
const G = await import(path.join(APP, 'js', 'gate.js'));
const C = await import(path.join(APP, 'js', 'contract.js'));

let validate = null;
try {
  validate = await import(path.join(APP, 'js', 'validate.js'));
} catch (e) {
  if (e && e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
}

const positions = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'positions.json'), 'utf8'));
const tutorial = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'tutorial.json'), 'utf8'));

let checks = 0;
function ok(cond, msg) {
  checks += 1;
  if (!cond) throw new Error(msg);
}
function words(text) {
  return validate && validate.wordCount ? validate.wordCount(text) : String(text).trim().split(/\s+/).filter(Boolean).length;
}
function templateOk(text, where, max = C.CLAUDE.TEMPLATE_MAX_WORDS) {
  ok(typeof text === 'string' && text.length > 0, `${where}: empty`);
  ok(words(text) <= max, `${where}: ${words(text)} words > ${max}: ${text}`);
  ok(!/\{\w+\}/.test(text), `${where}: unfilled placeholder in: ${text}`);
  if (validate && validate.templateRules) {
    // templateRules is written for the COPY templates, where a square appears only through a
    // placeholder; the squares in a rendered line were filled by the gate from chess.js, so
    // they are masked back to a placeholder and the SAN and digit rules run on the rest.
    const masked = text.replace(/\b[a-h][1-8]\b/g, '{square}');
    const r = validate.templateRules(masked);
    ok(r && r.ok, `${where}: templateRules rejected "${masked}": ${r && r.reason}`);
  }
}

// Build the pair of fact sheets for a move from a FEN.
function setup(fen, san) {
  const before = new Chess(fen);
  const after = new Chess(fen);
  const move = after.move(san);
  ok(move, `illegal ${san} in ${fen}`);
  return { before, after, move, fb: F.buildFacts(before), fa: F.buildFacts(after) };
}
function find(id) {
  const p = positions.find((x) => x.id === id);
  ok(p, `positions.json lacks ${id}`);
  return p;
}
function run(id, san, gameState = {}) {
  const p = find(id);
  const row = p.moves[san];
  ok(row, `${id} lacks ${san}`);
  const s = setup(p.fen, san);
  const v = G.verdict(p.pre, row.post, s.fb, s.fa, { move: s.move, anyways: 0, playedPairs: [], ...gameState });
  return { ...s, v, row, p };
}

// ------------------------------------------------------------------------------------------
// 1. Every recorded move: expect, category, sub, variant, answer, netLoss, reward
// ------------------------------------------------------------------------------------------
console.log(`positions.json: ${positions.length} positions, ${positions.reduce((n, p) => n + Object.keys(p.moves).length, 0)} moves`);
for (const p of positions) {
  ok(p.verified && p.verified.depth && p.verified.date && p.verified.command, `${p.id}: verification comment missing`);
  ok(p.pre && typeof p.pre.evalBefore === 'number' && p.pre.best && p.pre.best.san, `${p.id}: pre shape`);
  for (const [san, row] of Object.entries(p.moves)) {
    const where = `${p.id} ${san}`;
    const { v, fa, move, fb } = run(p.id, san);
    ok(row.post && typeof row.post.evalAfter === 'number' && Array.isArray(row.post.lines), `${where}: post shape`);
    if (row.expect === 'held') {
      ok(v.held === true, `${where}: expected held, got ${v.reason}`);
      ok(v.category === row.category, `${where}: category ${v.category} != ${row.category}`);
      if ('sub' in row) ok(v.sub === row.sub, `${where}: sub ${v.sub} != ${row.sub}`);
      if ('variant' in row) ok(v.variant === row.variant, `${where}: variant ${v.variant} != ${row.variant}`);
      if (row.answer) assert.deepEqual(v.answer, row.answer, `${where}: answer`);
      if ('netLoss' in row) ok(v.netLoss === row.netLoss, `${where}: netLoss ${v.netLoss} != ${row.netLoss}`);
      ok(v.cpLoss === p.pre.evalBefore - row.post.evalAfter, `${where}: cpLoss`);
      ok(v.target && v.targetPiece && v.targetColor, `${where}: target fields`);
      ok(v.reward === null, `${where}: a held move carries no reward`);
      for (const uci of v.refutation) ok(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci), `${where}: refutation ply ${uci}`);
      // the refutation is playable after his move
      const probe = new Chess(p.fen);
      probe.move(san);
      for (const uci of v.refutation) ok(probe.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }), `${where}: refutation ${uci} not playable`);
      // material categories: the recorded margin over the threshold
      if (['ignored_attack', 'hanging_after_move', 'free_piece_ignored'].includes(v.category)) {
        ok(v.cpLoss >= C.GATE.HOLD_CP + 70, `${where}: cpLoss ${v.cpLoss} has less than 70 cp margin over ${C.GATE.HOLD_CP}`);
      }
      // the answer set is on the board and never the moved piece's origin
      for (const sq of v.answer.squares) ok(C.SQUARES.includes(sq), `${where}: answer square ${sq}`);
      ok(!v.answer.squares.includes(move.from), `${where}: his origin square cannot be the answer`);
    } else if (row.expect === 'committed') {
      ok(v.held === false, `${where}: expected clean, got ${v.category}: ${v.reason}`);
      ok(v.category === null, `${where}: a committed test move should match no category (${v.category}, ${v.reason})`);
      ok(v.suppressed === null, `${where}: suppressed on a clean move`);
      const r = v.cpLoss !== null && v.cpLoss < C.GATE.HOLD_CP ? G.reward(p.pre, fb, fa, move) : null;
      ok((r ? r.kind : null) === (row.reward || null), `${where}: reward ${r && r.kind} != ${row.reward}`);
      ok((v.reward ? v.reward.kind : null) === (row.reward || null), `${where}: verdict.reward ${v.reward && v.reward.kind} != ${row.reward}`);
    } else if (row.expect === 'over') {
      ok(v.held === false && fa.isGameOver, `${where}: expected game over without a hold`);
    } else {
      throw new Error(`${where}: unknown expect ${row.expect}`);
    }
  }
}
console.log('verdicts: ok');

// ------------------------------------------------------------------------------------------
// 2. Specific shapes the spec names
// ------------------------------------------------------------------------------------------
{
  const { v, after } = run('italian_d6', 'Nxe5');
  ok(v.pawnAmongTakers === true, 'Nxe5: a pawn is among the takers');
  assert.deepEqual(v.gained, ['p'], 'Nxe5: he gets a pawn');
  assert.deepEqual(v.refutation, ['d6e5'], 'Nxe5: the refutation is dxe5');
  assert.deepEqual(v.takers.map((t) => t.square).sort(), ['c6', 'd6'], 'Nxe5 takers');
  assert.deepEqual(F.legalTakers(after, 'e5').map((t) => t.square).sort(), ['c6', 'd6'], 'legalTakers e5');
}
{
  const { v } = run('italian_d6', 'Bxf7+');
  ok(v.pawnAmongTakers === false, 'Bxf7+: no pawn among the takers');
  ok(v.takers.find((t) => t.square === 'g8').type === 'k', 'Bxf7+: the g8 taker is the king');
}
{
  const { v } = run('ruy_a6', 'O-O');
  ok(v.target === 'b5' && v.targetPiece === 'b' && v.targetColor === 'w', 'Ruy O-O target');
  ok(v.netLoss === 3, 'Ruy O-O netLoss 3');
  assert.deepEqual(v.refutation, ['a6b5'], 'Ruy O-O refutation');
  ok(v.takers.length === 1 && v.takers[0].type === 'p', 'Ruy O-O takers');
}
{
  const { v, fb } = run('italian_nxe4', 'Nc3');
  ok(fb.hanging.b.some((p) => p.square === 'e4'), 'Nxe4 position: e4 knight is free before');
  ok(v.netLoss === 3, 'Nc3 netLoss 3 (undefended knight)');
}
{
  const { v, fa } = run('placement_oo', 'Nbd2');
  ok(v.netLoss === 2, 'Nbd2 netLoss 2 (bishop defended by the knight, cheapest attacker a pawn)');
  ok(fa.bySquare.f3.hanging === false, 'Nbd2: the f3 knight is defended, not hanging');
}
{
  const { v } = run('f3_e5', 'g4');
  ok(v.netLoss === null && v.targetPiece === 'q' && v.targetColor === 'b', 'g4: their queen mates');
  assert.deepEqual(v.refutation, ['d8h4'], 'g4 refutation');
}
{
  const { v } = run('scholars_white', 'Qh3');
  ok(v.targetPiece === 'q' && v.targetColor === 'w' && v.target === 'f7', 'Qh3: his queen to f7');
}
{
  const { v, fa, fb } = run('kq_stalemate', 'Qf7');
  ok(fa.isStalemate && fb.material.diff === 9, 'Qf7 stalemates while 9 up');
  ok(v.target === 'h8' && v.targetPiece === 'k', 'Qf7 target is their king');
}
console.log('shapes: ok');

// ------------------------------------------------------------------------------------------
// 3. The quiet rule and the pair rule
// ------------------------------------------------------------------------------------------
{
  const quiet = { anyways: 2 };
  let r = run('f3_e5', 'g4', quiet);
  ok(r.v.held && r.v.category === 'allowed_mate' && r.v.suppressed === null, 'quiet: g4 after 1.f3 e5 still holds');
  r = run('scholars_white', 'Qh3', quiet);
  ok(r.v.held && r.v.suppressed === null, 'quiet: a missed mate still holds');
  r = run('kq_stalemate', 'Qf7', quiet);
  ok(r.v.held && r.v.suppressed === null, 'quiet: a stalemate still holds');
  r = run('italian_d6', 'Nxe5', quiet);
  ok(!r.v.held && r.v.suppressed === 'quiet' && r.v.category === 'hanging_after_move' && r.v.netLoss === 2, 'quiet: Nxe5 is suppressed with its category kept');
  r = run('ruy_a6', 'O-O', quiet);
  ok(!r.v.held && r.v.suppressed === 'quiet', 'quiet: the Ruy O-O (net 3) is suppressed');
  r = run('queen_hang', 'Qxe5+', quiet);
  ok(r.v.held && r.v.suppressed === null && r.v.netLoss >= C.GATE.BIG_LOSS, 'quiet: a queen-hanging move (net 8) still holds');
  r = run('italian_d6', 'Nxe5', { anyways: 1 });
  ok(r.v.held, 'one play-anyway does not quiet the gate');
  // the pair rule
  r = run('italian_d6', 'Nxe5', { playedPairs: ['ne5'] });
  ok(!r.v.held && r.v.suppressed === 'pair' && r.v.category === 'hanging_after_move', 'pair: ne5 played anyway is not held again');
  r = run('italian_d6', 'Nxe5', { playedPairs: ['be5', 'nd4'] });
  ok(r.v.held, 'pair: other pairs do not suppress');
  r = run('f3_e5', 'g4', { playedPairs: ['pg4'], anyways: 0 });
  ok(!r.v.held && r.v.suppressed === 'pair', 'pair: applies to mates too');
  // cold engine
  const s = setup(find('italian_d6').fen, 'Nxe5');
  const cold = G.verdict(null, null, s.fb, s.fa, { move: s.move, anyways: 0, playedPairs: [] });
  ok(!cold.held && cold.category === null && cold.cpLoss === null && cold.reward === null, 'cold engine: clean, no reward');
}
console.log('quiet and pair rules: ok');

// ------------------------------------------------------------------------------------------
// 4. Grading
// ------------------------------------------------------------------------------------------
{
  const { v } = run('italian_d6', 'Nxe5');
  ok(G.grade(v.answer, 'd6') === 'right', 'Nxe5 d6 right');
  ok(G.grade(v.answer, 'c6') === 'partial', 'Nxe5 c6 partial');
  ok(G.grade(v.answer, 'a1') === 'wrong', 'Nxe5 a1 wrong');
  ok(G.grade(v.answer, 'e5') === 'wrong', 'Nxe5 e5 wrong');
  const b = run('italian_d6', 'Bxf7+').v;
  ok(G.grade(b.answer, 'f8') === 'right' && G.grade(b.answer, 'g8') === 'partial', 'Bxf7+ f8 right, g8 partial');
  const o = run('ruy_a6', 'O-O').v;
  ok(G.grade(o.answer, 'a6') === 'partial' && G.grade(o.answer, 'b5') === 'right' && G.grade(o.answer, 'g1') === 'wrong', 'Ruy O-O grading');
  ok(G.grade(run('f3_e5', 'g4').v.answer, 'h4') === 'right', 'g4 h4 right');
  ok(G.grade(run('scholars_white', 'Qh3').v.answer, 'f7') === 'right', 'Qh3 f7 right');
  ok(G.grade(run('kq_stalemate', 'Qf7').v.answer, 'h8') === 'right', 'Qf7 h8 right');
  ok(G.grade({ squares: ['a1', 'b2'], best: null, partial: [] }, 'b2') === 'right', 'best null: any square in squares is right');
  ok(G.grade({ squares: ['a1', 'b2'], best: 'a1', partial: [] }, 'b2') === 'right', 'several mates: every destination is right');
}
console.log('grading: ok');

// ------------------------------------------------------------------------------------------
// 5. Template copy for every held position: <= 16 words, validate.templateRules, no answer square
// ------------------------------------------------------------------------------------------
let rendered = 0;
for (const p of positions) {
  for (const [san, row] of Object.entries(p.moves)) {
    if (row.expect !== 'held') continue;
    const where = `${p.id} ${san}`;
    const { v, fa, move } = run(p.id, san);
    const copy = G.holdCopy(v, fa, move);
    const best = v.answer.best;
    const partialSq = v.answer.partial.length ? v.answer.partial[0] : best;
    const lines = {
      question: copy.question,
      if_right: copy.if_right(best),
      if_partial: copy.if_partial(partialSq),
      if_wrong: copy.if_wrong,
    };
    for (const [k, text] of Object.entries(lines)) templateOk(text, `${where} ${k}`);
    ok(lines.question.startsWith('Hold on.'), `${where}: question starts with Hold on.`);
    for (const sq of v.answer.squares) ok(!lines.question.includes(sq), `${where}: question names answer square ${sq}`);
    for (const sq of v.answer.squares) ok(!lines.if_wrong.includes(sq), `${where}: if_wrong names answer square ${sq}`);
    ok(lines.if_right.startsWith('Yes'), `${where}: if_right starts with Yes`);
    ok(lines.if_wrong.startsWith('Not that one.'), `${where}: if_wrong starts with Not that one.`);
    templateOk(copy.named, `${where} named`);
    ok(copy.named.includes(best), `${where}: named line names the best square`);
    // the play-anyway sentence is two contract sentences; the spec caps it like a K1 line (20)
    templateOk(copy.anyway(true), `${where} anyway(true)`, C.CLAUDE.K1_MAX_WORDS);
    templateOk(copy.anyway(false), `${where} anyway(false)`, C.CLAUDE.K1_MAX_WORDS);
    ok(copy.anyway(true).startsWith('There it goes.') && copy.anyway(true).includes('that counts'), `${where}: anyway(true)`);
    ok(copy.anyway(false).includes('Next time'), `${where}: anyway(false)`);
    templateOk(copy.fallback, `${where} fallback`, C.CLAUDE.K2_MAX_WORDS);
    ok(/Still want to\?$/.test(copy.fallback), `${where}: fallback ends with the question: ${copy.fallback}`);
    ok(typeof copy.caption === 'string' && copy.caption.length > 0 && !/\{\w+\}/.test(copy.caption), `${where}: caption`);
    // asks
    const asks = G.asksFor(v, run(p.id, san).fb, fa, move, new Chess(p.fen));
    ok(asks.length >= 1, `${where}: at least the category's own look`);
    for (const a of asks) {
      ok(C.ASK_KINDS.includes(a.kind), `${where}: ask kind ${a.kind}`);
      ok(words(a.question) <= C.CLAUDE.ASK_QUESTION_MAX_WORDS, `${where}: ask question too long: ${a.question}`);
      ok(!/\{\w+\}/.test(a.question), `${where}: ask question placeholder: ${a.question}`);
      ok(a.squares.length > 0 && a.squares.every((sq) => C.SQUARES.includes(sq)), `${where}: ask squares`);
    }
    ok(new Set(asks.map((a) => a.kind)).size === asks.length, `${where}: asks are unique`);
    rendered += 1;
  }
}
ok(rendered >= 9, `rendered copy for ${rendered} held positions; expected at least nine`);
console.log(`copy: ok (${rendered} held positions rendered${validate ? ', validate.templateRules applied' : ', validate.js absent: word cap only'})`);

// ------------------------------------------------------------------------------------------
// 6. The copy the spec quotes
// ------------------------------------------------------------------------------------------
{
  const { v, fa, move, fb, before } = run('italian_d6', 'Nxe5');
  const copy = G.holdCopy(v, fa, move);
  ok(copy.question === 'Hold on. Before you take there: what takes back? Tap it.', `Nxe5 question: ${copy.question}`);
  ok(copy.if_right('d6') === 'Yes, the pawn. A knight for a pawn.', `Nxe5 if_right: ${copy.if_right('d6')}`);
  ok(copy.if_partial('c6') === 'The knight on c6 could too. Is there something cheaper? Tap it.', `Nxe5 if_partial: ${copy.if_partial('c6')}`);
  ok(copy.if_wrong === 'Not that one. Look at the pawns next to it.', `Nxe5 if_wrong: ${copy.if_wrong}`);
  ok(copy.named === 'The pawn on d6.', `Nxe5 named: ${copy.named}`);
  ok(copy.anyway(true) === 'There it goes. A knight for a pawn. You saw it coming; that counts.', `Nxe5 anyway(true): ${copy.anyway(true)}`);
  ok(copy.anyway(false) === 'There it goes. A knight for a pawn. Next time, the pawns first.', `Nxe5 anyway(false): ${copy.anyway(false)}`);
  ok(copy.fallback === 'The pawn on d6 takes the knight. Still want to?', `Nxe5 fallback: ${copy.fallback}`);
  ok(copy.caption === 'Knight to e5, a pawn was waiting', `Nxe5 caption: ${copy.caption}`);
  const asks = G.asksFor(v, fb, fa, move, before);
  ok(asks[0].kind === 'what_takes_back', 'Nxe5: the own look is what_takes_back');
  assert.deepEqual(asks[0].squares, ['d6', 'c6'], 'Nxe5 own look squares');
  const safe = asks.find((a) => a.kind === 'safe_square');
  ok(safe && safe.question === 'Tap a square where the knight is safe.', 'Nxe5 safe_square question');
  ok(safe.squares.includes('f3') && !safe.squares.includes('g5') && !safe.squares.includes('d4'), `Nxe5 safe squares ${safe.squares}: f3 safe, g5 kicked by the h-pawn, d4 attacked`);
  ok(safe.best === null, 'safe_square: any safe square is right');
  ok(G.grade(safe, 'f3') === 'right' && G.grade(safe, 'g5') === 'wrong', 'safe_square grading');
  ok(!asks.some((a) => a.kind === 'what_is_free') && !asks.some((a) => a.kind === 'attacked_piece'), 'Nxe5: nothing free, nothing attacked');
}
{
  const { v, fa, move } = run('italian_d6', 'Bxf7+');
  const copy = G.holdCopy(v, fa, move);
  ok(copy.if_right('f8').startsWith('Yes, the rook.') && copy.if_right('f8').includes('bishop for a pawn'), `Bxf7+ if_right: ${copy.if_right('f8')}`);
  ok(copy.if_partial('g8') === 'The king on g8 could too. Which one would they really use? Tap it.', `Bxf7+ if_partial: ${copy.if_partial('g8')}`);
  ok(copy.if_wrong === 'Not that one. Look at what reaches that square.', `Bxf7+ if_wrong: ${copy.if_wrong}`);
  ok(copy.anyway(false).endsWith('Next time, their rook first.'), `Bxf7+ anyway(false): ${copy.anyway(false)}`);
}
{
  const { v, fa, move, fb, before } = run('tutorial', 'Bxf7+');
  const copy = G.holdCopy(v, fa, move);
  ok(copy.if_right('e8') === 'Yes, the king. A bishop for a pawn.', `tutorial Bxf7+ if_right: ${copy.if_right('e8')}`);
  ok(copy.named === 'The king on e8.', `tutorial Bxf7+ named: ${copy.named}`);
  const asks = G.asksFor(v, fb, fa, move, before);
  ok(asks[0].kind === 'what_takes_back' && asks.some((a) => a.kind === 'safe_square'), 'tutorial Bxf7+ asks');
}
{
  const { v, fa, move, fb, before } = run('ruy_a6', 'O-O');
  const copy = G.holdCopy(v, fa, move);
  ok(copy.question === 'Hold on. One of yours is already under attack. Tap it.', `Ruy question: ${copy.question}`);
  ok(copy.if_partial('a6') === 'That is the pawn. Now tap the piece it reaches.', `Ruy if_partial: ${copy.if_partial('a6')}`);
  ok(copy.if_right('b5') === 'Yes, the bishop. The pawn takes it next move.', `Ruy if_right: ${copy.if_right('b5')}`);
  ok(copy.named === 'Your bishop on b5.', `Ruy named: ${copy.named}`);
  ok(copy.anyway(false) === 'There it goes. The bishop is gone. Next time, the pawns first.', `Ruy anyway: ${copy.anyway(false)}`);
  ok(copy.fallback === 'The pawn takes your bishop next move. Still want to?', `Ruy fallback: ${copy.fallback}`);
  ok(copy.caption === 'King to g1, your bishop was under attack', `Ruy caption: ${copy.caption}`);
  const asks = G.asksFor(v, fb, fa, move, before);
  ok(asks[0].kind === 'attacked_piece' && asks[0].best === 'b5', 'Ruy own look');
  ok(!asks.some((a) => a.kind === 'safe_square'), 'Ruy O-O: the king gets no safe_square look');
}
{
  const { v, fa, move, fb, before } = run('italian_nxe4', 'Nc3');
  const copy = G.holdCopy(v, fa, move);
  ok(copy.question === 'Hold on. Something of theirs is free right now. Tap it.', `Nc3 question: ${copy.question}`);
  ok(copy.if_right('e4') === 'Yes, the knight. It was yours for the taking.', `Nc3 if_right: ${copy.if_right('e4')}`);
  ok(copy.named === 'The knight on e4.', `Nc3 named: ${copy.named}`);
  ok(copy.anyway(false) === 'There it goes. The free knight is not free any more. Next time, their knight first.', `Nc3 anyway: ${copy.anyway(false)}`);
  const asks = G.asksFor(v, fb, fa, move, before);
  ok(asks[0].kind === 'what_is_free' && asks.filter((a) => a.kind === 'what_is_free').length === 1, 'Nc3 own look once');
  ok(asks.some((a) => a.kind === 'safe_square'), 'Nc3: the knight has safe squares');
}
{
  const { v, fa, move } = run('f3_e5', 'g4');
  const copy = G.holdCopy(v, fa, move);
  ok(copy.question === 'Hold on. Their queen has a check next move. Where does it land? Tap it.', `g4 question: ${copy.question}`);
  ok(copy.named === 'Their queen lands on h4.', `g4 named: ${copy.named}`);
  ok(copy.anyway(false) === 'There it goes. Next time, the check first.', `g4 anyway: ${copy.anyway(false)}`);
  ok(copy.fallback === 'Their queen lands on h4 and it is mate. Still want to?', `g4 fallback: ${copy.fallback}`);
}
{
  const { v, fa, move } = run('scholars_white', 'Qh3');
  const copy = G.holdCopy(v, fa, move);
  ok(copy.question === 'Hold on. You have a checkmate on the board. Tap the square.', `Qh3 question: ${copy.question}`);
  ok(copy.if_right('f7') === 'Yes, there. Your queen lands and it is checkmate.', `Qh3 if_right: ${copy.if_right('f7')}`);
  ok(copy.named === 'Your queen to f7.', `Qh3 named: ${copy.named}`);
}
{
  const { v, fa, move } = run('kq_stalemate', 'Qf7');
  const copy = G.holdCopy(v, fa, move);
  ok(copy.question === 'Hold on. After this, can their king move at all? Tap their king.', `Qf7 question: ${copy.question}`);
  ok(copy.named === 'Their king on h8.', `Qf7 named: ${copy.named}`);
  ok(copy.if_wrong === 'Not that one. Tap their king.', `Qf7 if_wrong: ${copy.if_wrong}`);
}
console.log('quoted copy: ok');

// ------------------------------------------------------------------------------------------
// 7. Rewards
// ------------------------------------------------------------------------------------------
{
  let r = run('ruy_a6', 'Ba4');
  let rw = G.reward(r.p.pre, r.fb, r.fa, r.move);
  assert.deepEqual(rw, { kind: 'escaped', piece: 'b', attacker: 'p' }, 'Ba4: escaped the pawn');
  ok(C.fill(C.COPY.REWARD_ESCAPED, { attacker: 'pawn', piece: 'bishop' }) === 'You looked. The pawn was on your bishop.', 'escaped line');
  r = run('italian_nxe4', 'dxe4');
  rw = G.reward(r.p.pre, r.fb, r.fa, r.move);
  assert.deepEqual(rw, { kind: 'free_taken', piece: 'n', square: 'e4' }, 'dxe4: free knight');
  r = run('placement_oo', 'hxg4');
  assert.deepEqual(G.reward(r.p.pre, r.fb, r.fa, r.move), { kind: 'free_taken', piece: 'b', square: 'g4' }, 'hxg4: free bishop');
  r = run('italian_d6', 'h3');
  ok(G.reward(r.p.pre, r.fb, r.fa, r.move) === null, 'h3: no reward');
  // free_taken needs the pre-search to agree
  r = run('italian_nxe4', 'dxe4');
  ok(G.reward({ ...r.p.pre, best: { ...r.p.pre.best, from: 'f3', to: 'e5' } }, r.fb, r.fa, r.move) === null, 'free_taken needs pre.best to be that capture');
  ok(G.reward(null, r.fb, r.fa, r.move) === null, 'free_taken needs a pre-search');
  // free_taken wins over escaped: the Ruy with the knight free would say free first (synthetic)
  const both = setup('r1bqkbnr/1ppp1ppp/p7/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4', 'Bxd7+');
  const fake = { evalBefore: 0, best: { from: 'b5', to: 'd7', captured: 'p' } };
  ok(G.reward(fake, both.fb, both.fa, both.move) === null, 'a pawn capture is never a reward');
}
console.log('rewards: ok');

// ------------------------------------------------------------------------------------------
// 8. toPlayer
// ------------------------------------------------------------------------------------------
ok(G.toPlayer({ cp: 35 }, true) === 35 && G.toPlayer({ cp: 35 }, false) === -35, 'toPlayer cp');
ok(G.toPlayer({ mate: 1 }, true) === 9999 && G.toPlayer({ mate: 1 }, false) === -9999, 'toPlayer mate 1');
ok(G.toPlayer({ mate: -3 }, true) === -9997 && G.toPlayer({ mate: -3 }, false) === 9997, 'toPlayer mate -3');
ok(G.toPlayer({ mate: 0 }, false) === 10000, 'toPlayer mate 0 (the opponent is mated)');
console.log('toPlayer: ok');

// ------------------------------------------------------------------------------------------
// 9. tutorial.json and tutorialVerdict
// ------------------------------------------------------------------------------------------
{
  ok(tutorial.fen === C.TUTORIAL_FEN, 'tutorial.json fen is TUTORIAL_FEN');
  const legal = new Chess(tutorial.fen).moves();
  ok(legal.length === 33, `the tutorial position has ${legal.length} legal moves`);
  const sans = Object.keys(tutorial.moves);
  ok(sans.length === 33, `tutorial.json has ${sans.length} rows`);
  for (const san of legal) ok(tutorial.moves[san], `tutorial.json lacks ${san}`);
  const held = sans.filter((s) => tutorial.moves[s].held).sort();
  assert.deepEqual(held, ['Ba6', 'Be6', 'Bxf7+', 'Nd4', 'Nxe5'], 'the five held tutorial moves');
  const want = {
    'Bxf7+': { squares: ['e8'], best: 'e8', partial: [] },
    Nxe5: { squares: ['c6'], best: 'c6', partial: [] },
    Nd4: { squares: ['e5', 'c6'], best: 'e5', partial: ['c6'] },
    Ba6: { squares: ['b7'], best: 'b7', partial: [] },
    Be6: { squares: ['d7', 'f7'], best: 'd7', partial: ['f7'] },
  };
  const netLoss = { 'Bxf7+': 2, Nxe5: 2, Nd4: 3, Ba6: 3, Be6: 3 };
  for (const san of held) {
    const row = tutorial.moves[san];
    assert.deepEqual(row.answer, want[san], `tutorial ${san} answer`);
    ok(row.category === 'hanging_after_move', `tutorial ${san} category`);
    ok(row.netLoss === netLoss[san], `tutorial ${san} netLoss ${row.netLoss}`);
    ok(row.cpLoss >= C.GATE.HOLD_CP, `tutorial ${san} cpLoss`);
    ok(row.line.length >= 1 && row.line[0] === row.reply, `tutorial ${san} line starts with the reply`);
    ok((row.variant === 'takes_back') === san.includes('x'), `tutorial ${san} variant`);
    // the row as a verdict
    const s = setup(tutorial.fen, san);
    const v = G.tutorialVerdict(row, s.move, s.before);
    ok(v.held && v.category === 'hanging_after_move', `tutorialVerdict ${san} held`);
    assert.deepEqual(v.answer, want[san], `tutorialVerdict ${san} answer`);
    ok(v.refutation.length === row.line.length, `tutorialVerdict ${san} refutation ${v.refutation}`);
    assert.deepEqual(F.legalTakers(s.after, s.move.to).map((t) => t.square).sort(), [...row.answer.squares].sort(), `tutorial ${san} takers agree with chess.js`);
    ok(v.pawnAmongTakers === row.takers.some((t) => t.type === 'p'), `tutorialVerdict ${san} pawnAmongTakers`);
    const copy = G.holdCopy(v, s.fa, s.move);
    templateOk(copy.question, `tutorial ${san} question`);
    templateOk(copy.if_right(v.answer.best), `tutorial ${san} if_right`);
    templateOk(copy.if_partial(v.answer.partial.length ? v.answer.partial[0] : v.answer.best), `tutorial ${san} if_partial`);
    templateOk(copy.if_wrong, `tutorial ${san} if_wrong`);
    const asks = G.asksFor(v, s.fb, s.fa, s.move, s.before);
    ok(asks.length >= 1 && asks[0].kind.startsWith('what_takes'), `tutorial ${san} asks`);
  }
  // Nd4: the tap on c6 (a knight, dearer than the best pawn) is a partial with the cheaper hint
  {
    const s = setup(tutorial.fen, 'Nd4');
    const v = G.tutorialVerdict(tutorial.moves.Nd4, s.move, s.before);
    ok(G.grade(v.answer, 'e5') === 'right' && G.grade(v.answer, 'c6') === 'partial', 'Nd4 grading');
    const copy = G.holdCopy(v, s.fa, s.move);
    ok(copy.if_partial('c6').includes('cheaper'), `Nd4 if_partial: ${copy.if_partial('c6')}`);
    ok(copy.if_right('e5') === 'Yes, the pawn. A knight for nothing.', `Nd4 if_right: ${copy.if_right('e5')}`);
    const be6 = setup(tutorial.fen, 'Be6');
    const v2 = G.tutorialVerdict(tutorial.moves.Be6, be6.move, be6.before);
    ok(G.holdCopy(v2, be6.fa, be6.move).if_partial('f7').includes('really use'), 'Be6: two pawns, the partial asks which they would use');
  }
  for (const san of sans.filter((s) => !tutorial.moves[s].held)) {
    const row = tutorial.moves[san];
    ok(row.category === null && row.netLoss === null && row.answer.squares.length === 0, `tutorial ${san} clean row`);
    const s = setup(tutorial.fen, san);
    const v = G.tutorialVerdict(row, s.move, s.before);
    ok(!v.held && v.category === null && v.cpLoss === row.cpLoss, `tutorialVerdict ${san} clean`);
  }
  // the tutorial table agrees with the engine recording of the same position
  const rec = find('tutorial');
  for (const san of ['Bxf7+', 'Nxe5']) {
    const { v } = run('tutorial', san);
    assert.deepEqual(v.answer, want[san], `recorded tutorial ${san} answer`);
    ok(v.netLoss === tutorial.moves[san].netLoss, `recorded tutorial ${san} netLoss`);
  }
  ok(rec.moves.d3.expect === 'committed', 'tutorial d3 committed');
}
console.log('tutorial: ok');

// ------------------------------------------------------------------------------------------
// 10. Between games: remembered() and closeCaption()
// ------------------------------------------------------------------------------------------
{
  const d6 = find('italian_d6').fen;
  const rec = (over) => ({ fen: d6, san: 'Nxe5', category: 'hanging_after_move', sub: null, taps: [], outcome: 'back', coachShown: false, netLoss: 2, piece: 'n', to: 'e5', best: 'd6', ply: 12, gameId: 'x', ...over });
  ok(G.remembered(null) === null, 'remembered(null)');
  ok(G.remembered({ holds: [] }) === 'No holds last game. Your move.', 'remembered none');
  ok(G.remembered({ holds: [rec()] }) === 'One hold last game, a pawn you did not see. Watch the pawns.', 'remembered one pawn');
  ok(G.remembered({ holds: [rec({ best: 'c6' })] }) === 'One hold last game. Before the piece lands, look from their chair.', 'remembered one other');
  ok(G.remembered({ holds: [rec(), rec()] }) === 'Two holds last game, both a pawn you did not see. Watch the pawns.', 'remembered two pawns');
  ok(G.remembered({ holds: [rec(), rec(), rec()] }) === 'Three holds last game, all a pawn you did not see. Watch the pawns.', 'remembered three pawns');
  ok(G.remembered({ holds: [rec(), rec({ category: 'free_piece_ignored', best: 'e4' }), rec()] }) === 'Three holds last game. Before the piece lands, look from their chair.', 'remembered mixed');
  ok(G.remembered({ holds: [rec({ pawnAmongTakers: false })] }) === 'One hold last game. Before the piece lands, look from their chair.', 'remembered honours pawnAmongTakers when stored');
  ok(G.closeCaption(rec()) === 'Knight to e5, a pawn was waiting: taken back.', `caption: ${G.closeCaption(rec())}`);
  ok(G.closeCaption(rec({ outcome: 'anyway', best: 'c6' })) === 'Knight to e5, a knight was waiting: played anyway.', 'caption knight anyway');
  const ruy = find('ruy_a6').fen;
  ok(G.closeCaption({ fen: ruy, san: 'O-O', category: 'ignored_attack', sub: 'already', outcome: 'back', piece: 'k', to: 'g1', best: 'b5' }) === 'King to g1, your bishop was under attack: taken back.', 'caption ignored_attack');
  ok(G.closeCaption({ fen: find('italian_nxe4').fen, san: 'Nc3', category: 'free_piece_ignored', outcome: 'ended', piece: 'n', to: 'c3', best: 'e4' }) === 'Knight to c3, a free knight was there: the game ended.', 'caption free');
  ok(G.closeCaption({ fen: find('f3_e5').fen, san: 'g4', category: 'allowed_mate', outcome: 'anyway', piece: 'p', to: 'g4', best: 'h4' }) === 'Pawn to g4, their check next move was mate: played anyway.', 'caption mate');
  ok(G.closeCaption({ fen: find('scholars_white').fen, san: 'Qh3', category: 'missed_mate', outcome: 'back', piece: 'q', to: 'h3', best: 'f7' }) === 'Queen to h3, you had a checkmate: taken back.', 'caption missed mate');
  ok(G.closeCaption({ fen: find('kq_stalemate').fen, san: 'Qf7', category: 'allowed_stalemate', outcome: 'back', piece: 'q', to: 'f7', best: 'h8' }) === 'Queen to f7, their king had no move: taken back.', 'caption stalemate');
  templateOk(G.remembered({ holds: [rec()] }), 'remembered line', 20);
  templateOk(G.closeCaption(rec()), 'close caption', 20);
}
console.log('between games: ok');

// ------------------------------------------------------------------------------------------
// 11. facts.js details the gate leans on
// ------------------------------------------------------------------------------------------
{
  const c = new Chess(find('italian_d6').fen);
  ok(F.pawnCanKick(c, 'g5', 'b') && !F.pawnCanKick(c, 'f3', 'b'), 'pawnCanKick g5 / f3');
  const dp = new Chess('4k3/8/8/3n4/8/8/4P3/4K3 w - - 0 1');
  ok(F.pawnCanKick(dp, 'd5', 'w') && F.pawnCanKick(dp, 'd4', 'w') && !F.pawnCanKick(dp, 'd6', 'w'), 'pawnCanKick double push');
  const blocked = new Chess('4k3/8/8/3n4/4p3/8/4P3/4K3 w - - 0 1');
  ok(!F.pawnCanKick(blocked, 'd5', 'w'), 'pawnCanKick: a blocked double push does not kick');
  // a ray the piece itself blocks counts once it moves
  const ray = new Chess('4r2k/8/8/8/4R3/8/8/3K4 w - - 0 1');
  ok(!F.safeSquares(ray, 'e4').includes('e2'), 'safeSquares: moving along the ray stays attacked');
  ok(F.safeSquares(ray, 'e4').includes('a4'), 'safeSquares: off the file is safe');
  const e5 = F.pieceInfo(new Chess('r1bq1rk1/ppp1bppp/2np1n2/4N3/2B1P3/2NP4/PPP2PPP/R1BQ1RK1 b - - 0 7'), 'e5');
  ok(e5.hanging && e5.cheapestAttacker === 1 && e5.defenders.length === 0, 'pieceInfo e5');
  ok(F.pieceInfo(c, 'g1').hanging === false, 'kings never hang');
  ok(F.uciToMove(c, 'f3e5').san === 'Nxe5' && F.uciToMove(c, 'e1g1') === null, 'uciToMove');
  assert.deepEqual(F.materialAfter(c, ['Nxe5', 'd6e5']), { w: 36, b: 38 }, 'materialAfter');
  ok(F.mateInOneMoves(new Chess(find('scholars_white').fen)).map((m) => m.san).join() === 'Qxf7#', 'mateInOneMoves');
  const facts = F.buildFacts(c);
  ok(facts.pieces.length === 32 && facts.turn === 'w' && facts.legal.length > 0 && Array.isArray(facts.mateInOne), 'buildFacts shape');
  ok(F.buildFacts(c, { mateInOne: false }).mateInOne === null, 'buildFacts without mateInOne');
  ok(F.pieceWord('n') === 'knight' && F.colorWord('b') === 'black', 'words');
}
console.log('facts: ok');

console.log(`all ${checks} checks passed`);
