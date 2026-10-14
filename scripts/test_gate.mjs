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
      // the refutation is playable after his move (free_piece_ignored: the capture he walked past,
      // playable instead of his move, from the position before it)
      const probe = new Chess(p.fen);
      if (v.refutationFrom !== 'pre') probe.move(san);
      ok(v.refutationFrom === (v.category === 'free_piece_ignored' ? 'pre' : 'post'), `${where}: refutationFrom ${v.refutationFrom}`);
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
  // Show me plays the look he missed (dxe4), not their even trade on c3, and floats no loss
  assert.deepEqual(v.refutation, ['d3e4'], 'Nc3: the ghost line is the capture he walked past');
  ok(v.refutationFrom === 'pre', 'Nc3: the ghost line plays from the position before his move');
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
// 2b. Shapes from the review findings (F9, F10, F11, F16, F17, F19, F20)
// ------------------------------------------------------------------------------------------
{
  // F10: after Ng5 in the Ruy two pieces hang: the bishop (already attacked) stays best, the knight
  // he moved is right too, and each gets its own if_right; the O-O acceptance keeps its one answer
  const { v, fa, move } = run('ruy_a6', 'Ng5');
  assert.deepEqual(v.answer, { squares: ['b5', 'g5'], best: 'b5', partial: ['a6'] }, 'Ng5 answer');
  ok(G.grade(v.answer, 'g5') === 'right' && G.grade(v.answer, 'b5') === 'right' && G.grade(v.answer, 'a6') === 'partial', 'Ng5 grading');
  const copy = G.holdCopy(v, fa, move);
  ok(copy.if_right('g5') === 'Yes, the knight. The queen takes it next move.', `Ng5 if_right(g5): ${copy.if_right('g5')}`);
  ok(copy.if_right('b5') === 'Yes, the bishop. The pawn takes it next move.', `Ng5 if_right(b5): ${copy.if_right('b5')}`);
  ok(copy.named === 'Your bishop on b5.' && v.refutation[0] === 'a6b5', 'Ng5: the named square and the ghost stay on the bishop');
  assert.deepEqual(run('ruy_a6', 'O-O').v.answer, { squares: ['b5'], best: 'b5', partial: ['a6'] }, 'O-O answer unchanged by the widening');
}
{
  // F9: a pinned knight that moves, or a knight stepping off the d-file, opens a line onto the queen:
  // sub opened_line with its own copy; the defenders of d1 are unchanged, so no guard was lost
  for (const [id, san, attacker] of [['nc4_rook', 'Nc4', 'rook'], ['nc4_rook', 'Nb3', 'rook'], ['italian_bg5', 'Nh4', 'bishop']]) {
    const { v, fa, fb, move } = run(id, san);
    ok(v.held && v.category === 'ignored_attack' && v.sub === C.SUBCASES.OPENED_LINE, `${id} ${san}: ${v.reason}`);
    ok(fb.bySquare.d1.attackers.length === 0 && fa.bySquare.d1.attackers.length === 1, `${id} ${san}: d1 was not attacked before, is after`);
    ok(fb.bySquare.d1.defenders.length === fa.bySquare.d1.defenders.length, `${id} ${san}: the defenders of d1 are unchanged`);
    const copy = G.holdCopy(v, fa, move);
    ok(copy.question === 'Hold on. Your move opens a line to something of yours. Tap it.', `${id} ${san} question: ${copy.question}`);
    ok(copy.if_right('d1') === `Yes, the queen. The piece you moved was standing in the ${attacker}'s way.`, `${id} ${san} if_right: ${copy.if_right('d1')}`);
    ok(copy.if_wrong === 'Not that one. Look along the line your piece just left.', `${id} ${san} if_wrong: ${copy.if_wrong}`);
    ok(copy.named === 'Your queen on d1.', `${id} ${san} named: ${copy.named}`);
  }
  // a genuine lost guard keeps its wording: the d3 bishop was attacked by the knight and guarded by
  // the queen; Qh5 walks the guard away (synthetic post: Nxd3+ wins the bishop)
  const fen = '4k3/8/8/4n3/8/3B4/8/3QK3 w - - 0 1';
  const s = setup(fen, 'Qh5');
  ok(s.fb.bySquare.d3.attackers.length === 1 && s.fb.bySquare.d3.defenders.length === 1 && s.fa.bySquare.d3.defenders.length === 0, 'Qh5: the bishop loses its one guard');
  const pre = { fen, evalBefore: 0, best: { uci: 'd1d2', san: 'Qd2', from: 'd1', to: 'd2', piece: 'q', captured: null, isMate: false }, mateIn: null, line2: null, depth: 14, stopped: false };
  const post = { fen: s.after.fen(), evalAfter: -300, replyMateIn: null, depth: 12, lines: [{ reply: { uci: 'e5d3', san: 'Nxd3+', from: 'e5', to: 'd3', piece: 'n', captured: 'b', isMate: false, isCapture: true, isCheck: true }, score: -300, pv: ['e5d3', 'e1d2'] }] };
  const v = G.verdict(pre, post, s.fb, s.fa, { move: s.move, anyways: 0, playedPairs: [] });
  ok(v.held && v.category === 'ignored_attack' && v.sub === C.SUBCASES.LOST_GUARD, `Qh5: ${v.reason}`);
  const copy = G.holdCopy(v, s.fa, s.move);
  ok(copy.question === 'Hold on. Something of yours just lost its guard. Tap it.' && copy.if_right('d3') === 'Yes, the bishop. Your move took its guard away.', `Qh5 copy: ${copy.question} / ${copy.if_right('d3')}`);
}
{
  // F11: Two Knights 6.Bxd5: the loss is Qxd5 (an even trade on the moved piece, no category); line
  // 2's Qxg5 scores under the threshold on its own, so it does not explain the loss and nothing holds
  const { v, row, p } = run('two_knights_bxd5', 'Bxd5');
  ok(row.post.lines[1] && row.post.lines[1].reply.to === 'g5' && p.pre.evalBefore - row.post.lines[1].score < C.GATE.HOLD_CP, 'Bxd5: line 2 takes on g5 for under 200 cp');
  ok(!v.held && v.category === null && v.cpLoss >= C.GATE.HOLD_CP, `Bxd5: ${v.reason}`);
}
{
  // F16: two equal takers (the d7 and f7 pawns) are both right; partial is only for a dearer taker
  const { v, fa, move } = run('tutorial', 'Be6');
  ok(v.answer.squares.length === 2 && v.answer.squares.includes('d7') && v.answer.squares.includes('f7') && v.answer.partial.length === 0, `Be6 answer ${JSON.stringify(v.answer)}`);
  ok(G.grade(v.answer, 'd7') === 'right' && G.grade(v.answer, 'f7') === 'right', 'Be6: either pawn is right');
  const other = v.answer.squares.find((sq) => sq !== v.answer.best);
  ok(G.holdCopy(v, fa, move).if_right(other).startsWith('Yes, the pawn.'), 'Be6: the other pawn gets the right line');
  const nxe5 = run('italian_d6', 'Nxe5').v;
  assert.deepEqual(nxe5.answer.partial, ['c6'], 'Nxe5: the knight (dearer than the pawn) stays partial');
}
{
  // F17: with rooks on a8 and b8 both Ra1 and Rb1 mate after Qc7: both squares are right
  const { v } = run('two_mates', 'Qc7');
  ok(v.held && v.category === 'allowed_mate', `Qc7: ${v.reason}`);
  assert.deepEqual([...v.answer.squares].sort(), ['a1', 'b1'], 'Qc7 answer squares');
  ok(['a1', 'b1'].includes(v.answer.best) && G.grade(v.answer, 'a1') === 'right' && G.grade(v.answer, 'b1') === 'right', 'Qc7: either mating square is right');
}
{
  // F19: the only legal move is never held (there is nothing to take it back to)
  const { v, fb } = run('only_move', 'Kb1');
  ok(fb.legal.length === 1 && !v.held && v.category === null && /only legal/.test(v.reason), `Kb1: ${v.reason}`);
}
{
  // F20: a mate-scored pre-search against a plain cp post is no loss while the win stands
  const { v, p, move, fb, fa } = run('kq_stalemate', 'Kb2');
  ok(v.cpLoss === 0 && !v.held && v.reward === null, `Kb2: cpLoss ${v.cpLoss} (${v.reason})`);
  const gone = G.verdict(p.pre, { ...p.moves.Kb2.post, evalAfter: 50 }, fb, fa, { move, anyways: 0, playedPairs: [] });
  ok(gone.cpLoss === p.pre.evalBefore - 50, `Kb2 with the win gone keeps the raw loss: ${gone.cpLoss}`);
}
console.log('findings: ok');

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
  // F5: an even trade is not a free piece: his capture is counted net of what their last capture
  // took on that square (lastMove); load(fen) has no last move, so the FEN-derivable rule stands
  const qt = setup('6k1/1p4p1/4p2p/4q3/p1pP4/7P/PP3PP1/6K1 w - - 0 29', 'dxe5');
  const preQ = { evalBefore: 0, best: { uci: 'd4e5', san: 'dxe5', from: 'd4', to: 'e5', piece: 'p', captured: 'q' } };
  ok(qt.fb.bySquare.e5.hanging, 'the e5 queen hangs by the facts');
  assert.deepEqual(G.reward(preQ, qt.fb, qt.fa, qt.move, null), { kind: 'free_taken', piece: 'q', square: 'e5' }, 'no last move: the queen reads free');
  ok(G.reward(preQ, qt.fb, qt.fa, qt.move, { from: 'd5', to: 'e5', piece: 'q', captured: 'q' }) === null, 'after ...Qxe5, dxe5 is an even trade: no reward');
  const nb = setup('r1bqk2r/1pppbpp1/p1n4p/4p3/2B1P3/2NPnN1P/PPP2PP1/R2Q1RK1 w kq - 0 9', 'fxe3');
  const preN = { evalBefore: 0, best: { uci: 'f2e3', san: 'fxe3', from: 'f2', to: 'e3', piece: 'p', captured: 'n' } };
  ok(nb.fb.bySquare.e3.hanging, 'the e3 knight hangs by the facts');
  const rn = G.reward(preN, nb.fb, nb.fa, nb.move, { from: 'g4', to: 'e3', piece: 'n', captured: 'b' });
  ok(!(rn && rn.kind === 'free_taken'), `fxe3 after ...Nxe3 took a bishop: even, not a free piece (${rn && rn.kind})`);
  assert.deepEqual(G.reward(preN, nb.fb, nb.fa, nb.move, null), { kind: 'free_taken', piece: 'n', square: 'e3' }, 'the same recapture with no last move reads free (load(fen))');
  r = run('italian_nxe4', 'dxe4');
  assert.deepEqual(G.reward(r.p.pre, r.fb, r.fa, r.move, { from: 'f6', to: 'e4', piece: 'n', captured: 'p' }), { kind: 'free_taken', piece: 'n', square: 'e4' }, 'dxe4 after ...Nxe4 took a pawn: a knight for a pawn is still free');
  const vv = G.verdict(r.p.pre, r.row.post, r.fb, r.fa, { move: r.move, anyways: 0, playedPairs: [], lastMove: { from: 'f6', to: 'e4', piece: 'n', captured: 'p' } });
  ok(vv.reward && vv.reward.kind === 'free_taken', 'verdict() passes lastMove through to the reward');
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

// ==========================================================================================
// Iteration two (the pathway). Everything above is the MVP's test and must stay exactly as it
// is: the same count, the same outcome, with gameState.hand absent on every call.
// ==========================================================================================
const BASELINE = 2195;
if (checks !== BASELINE) throw new Error(`the MVP's checks changed: ${checks} ran before the pathway sections, expected ${BASELINE}`);
console.log(`baseline: ${checks} checks unchanged`);

// ------------------------------------------------------------------------------------------
// 12. The hand: suppressed 'hand' after the pair and quiet rules, facts intact
// ------------------------------------------------------------------------------------------
{
  // the pawn slot off, everything else full
  const pawnsOff = C.handAll('full');
  pawnsOff.hanging_after_move.pawn = 'off';
  const live = run('italian_d6', 'Nxe5').v;
  const { v } = run('italian_d6', 'Nxe5', { hand: pawnsOff });
  ok(C.handLevel(pawnsOff, v) === 'off', 'Nxe5 reads the pawn slot');
  ok(!v.held && v.suppressed === 'hand', `hand: Nxe5 is suppressed 'hand' (${v.reason})`);
  ok(v.category === 'hanging_after_move' && v.sub === null && v.variant === 'takes_back' && v.pawnAmongTakers === true, 'hand: category, sub, variant, pawnAmongTakers intact');
  ok(v.netLoss === 2 && v.cpLoss === live.cpLoss, 'hand: netLoss and cpLoss intact');
  assert.deepEqual(v.answer, live.answer, 'hand: the answer set intact');
  assert.deepEqual(v.refutation, live.refutation, 'hand: the refutation intact');
  assert.deepEqual(v.takers, live.takers, 'hand: the takers intact');
  assert.deepEqual(v.gained, live.gained, 'hand: gained intact');
  ok(v.target === live.target && v.targetPiece === live.targetPiece && v.refutationFrom === live.refutationFrom && v.reward === null, 'hand: target and refutationFrom intact');
  ok(v.reason === `${live.reason} (suppressed: hand)`, `hand: the reason says so: ${v.reason}`);
  assert.deepEqual({ ...v, held: true, suppressed: null, reason: live.reason }, live, 'hand: nothing else differs from the live verdict');
  // the same hand leaves Bxf7+ (takes_back, no pawn among the takers) held
  const b = run('italian_d6', 'Bxf7+', { hand: pawnsOff }).v;
  ok(b.held && b.suppressed === null && b.category === 'hanging_after_move' && b.pawnAmongTakers === false, `hand: Bxf7+ is held under the pawns-off hand (${b.reason})`);
  // takes_back off holds Nxe5 (pawns first) and lets Bxf7+ land
  const tbOff = C.handAll('full');
  tbOff.hanging_after_move.takes_back = 'off';
  ok(run('italian_d6', 'Nxe5', { hand: tbOff }).v.held, 'hand: takes_back off keeps Nxe5 (a pawn among the takers reads the pawn slot)');
  ok(run('italian_d6', 'Bxf7+', { hand: tbOff }).v.suppressed === 'hand', 'hand: takes_back off lands Bxf7+');
  // 'bare' and 'full' never suppress; a hand with no slot for the category reads full
  ok(run('italian_d6', 'Nxe5', { hand: C.handAll('bare') }).v.held, 'hand: bare still holds');
  ok(run('italian_d6', 'Nxe5', { hand: C.handAll('full') }).v.held, 'hand: full still holds');
  ok(run('italian_d6', 'Nxe5', { hand: {} }).v.held, 'hand: an empty hand holds');
  ok(run('italian_d6', 'Nxe5', { hand: null }).v.held, 'hand: a null hand holds');
  // hand all off: ALWAYS_HOLD and a five-point loss still hold
  const off = C.handAll('off');
  let r = run('f3_e5', 'g4', { hand: off }).v;
  ok(r.held && r.suppressed === null && r.category === 'allowed_mate', `hand off: g4 after 1.f3 e5 still holds (${r.reason})`);
  r = run('queen_hang', 'Qxe5+', { hand: off }).v;
  ok(r.held && r.suppressed === null && r.netLoss === 8 && r.netLoss >= C.GATE.BIG_LOSS, `hand off: Qxe5+ (net ${r.netLoss}) still holds`);
  r = run('kq_stalemate', 'Qf7', { hand: off }).v;
  ok(r.held && r.suppressed === null && r.category === 'allowed_stalemate', 'hand off: Qf7 still holds');
  r = run('scholars_white', 'Qh3', { hand: off }).v;
  ok(r.held && r.suppressed === null && r.category === 'missed_mate', 'hand off: a missed mate still holds');
  r = run('two_mates', 'Qc7', { hand: off }).v;
  ok(r.held && r.category === 'allowed_mate', 'hand off: Qc7 still holds');
  // ... and every material look lands
  r = run('ruy_a6', 'O-O', { hand: off }).v;
  ok(!r.held && r.suppressed === 'hand' && r.category === 'ignored_attack' && r.sub === 'already' && r.netLoss === 3, 'hand off: the Ruy O-O lands');
  r = run('italian_nxe4', 'Nc3', { hand: off }).v;
  ok(!r.held && r.suppressed === 'hand' && r.category === 'free_piece_ignored' && r.refutationFrom === 'pre', 'hand off: Nc3 lands with its pre refutation');
  r = run('nc4_rook', 'Nc4', { hand: off }).v;
  ok(!r.held && r.suppressed === 'hand' && r.sub === C.SUBCASES.OPENED_LINE, 'hand off: Nc4 (opened_line) lands');
  // the sub slots are read one by one
  const guardsOff = C.handAll('full');
  guardsOff.ignored_attack.opened_line = 'off';
  ok(run('nc4_rook', 'Nc4', { hand: guardsOff }).v.suppressed === 'hand' && run('ruy_a6', 'O-O', { hand: guardsOff }).v.held, 'hand: opened_line off lands Nc4 and keeps the Ruy O-O');
  const freeOff = C.handAll('full');
  freeOff.free_piece_ignored = 'off';
  ok(run('italian_nxe4', 'Nc3', { hand: freeOff }).v.suppressed === 'hand' && run('italian_d6', 'Nxe5', { hand: freeOff }).v.held, 'hand: free off lands Nc3 only');
  // order: pair, then quiet, then hand
  ok(run('italian_d6', 'Nxe5', { hand: off, playedPairs: ['ne5'] }).v.suppressed === 'pair', 'hand: the pair rule is named first');
  ok(run('italian_d6', 'Nxe5', { hand: off, anyways: 2 }).v.suppressed === 'quiet', 'hand: the quiet rule is named before the hand');
  ok(run('italian_d6', 'Nxe5', { hand: off, anyways: 1 }).v.suppressed === 'hand', 'hand: one play-anyway leaves the hand to decide');
  // a clean move under any hand is still clean, with its reward
  const h3 = run('italian_d6', 'h3', { hand: off }).v;
  ok(!h3.held && h3.category === null && h3.suppressed === null, 'hand off: a clean move stays clean');
  const dx = run('italian_nxe4', 'dxe4', { hand: off }).v;
  ok(dx.reward && dx.reward.kind === 'free_taken', 'hand off: the reward on a clean move stands');
  // the cold engine and the only legal move are unchanged by the hand
  const s = setup(find('italian_d6').fen, 'Nxe5');
  ok(G.verdict(null, null, s.fb, s.fa, { move: s.move, hand: off }).category === null, 'hand off: cold engine stays clean');
  ok(/only legal/.test(run('only_move', 'Kb1', { hand: off }).v.reason), 'hand off: the only legal move stays clean');
  // handLevel's own table over the recorded verdicts
  for (const p of positions) {
    for (const [san, row] of Object.entries(p.moves)) {
      if (row.expect !== 'held') continue;
      const v2 = run(p.id, san).v;
      ok(C.handLevel(C.handAll('off'), v2) === (C.ALWAYS_HOLD.includes(v2.category) ? 'full' : 'off'), `${p.id} ${san}: handLevel off`);
      ok(C.handLevel(C.handAll('bare'), v2) === (C.ALWAYS_HOLD.includes(v2.category) ? 'full' : 'bare'), `${p.id} ${san}: handLevel bare`);
      ok(C.handLevel(null, v2) === 'full' && C.handLevel(undefined, v2) === 'full', `${p.id} ${san}: handLevel without a hand`);
      const landed = run(p.id, san, { hand: C.handAll('off') }).v;
      const exempt = C.ALWAYS_HOLD.includes(v2.category) || (typeof v2.netLoss === 'number' && v2.netLoss >= C.GATE.BIG_LOSS);
      ok(landed.held === exempt && landed.suppressed === (exempt ? null : 'hand'), `${p.id} ${san}: hand off -> ${exempt ? 'held' : 'landed'} (${landed.reason})`);
      assert.deepEqual({ ...landed, held: true, suppressed: null, reason: v2.reason }, v2, `${p.id} ${san}: the landed verdict carries the hold's facts`);
    }
  }
}
console.log('hand: ok');

// ------------------------------------------------------------------------------------------
// 13. rewards(): both kinds; escaped needs the opponent's last move as the attacker
// ------------------------------------------------------------------------------------------
{
  // the Ruy after 3...a6: the a6 pawn (their last move) is on the bishop; Ba4 escapes it
  const ruy = find('ruy_a6');
  const beforeA6 = new Chess('r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3');
  const a6 = beforeA6.move('a6');
  ok(a6 && beforeA6.fen() === ruy.fen, 'the Ruy position is the one after ...a6');
  let r = run('ruy_a6', 'Ba4');
  let rw = G.rewards(r.p.pre, r.fb, r.fa, r.move, a6);
  assert.deepEqual(rw, { free: null, escaped: { kind: 'escaped', piece: 'b', attacker: 'p' } }, 'Ba4 after ...a6: escaped only');
  assert.deepEqual(G.rewards(r.p.pre, r.fb, r.fa, r.move, null), { free: null, escaped: null }, 'Ba4 with no last move: escaped is null');
  assert.deepEqual(G.rewards(r.p.pre, r.fb, r.fa, r.move), { free: null, escaped: null }, 'Ba4 with the argument left out: escaped is null');
  const elsewhere = { color: 'b', from: 'g8', to: 'f6', piece: 'n', san: 'Nf6' };
  assert.deepEqual(G.rewards(r.p.pre, r.fb, r.fa, r.move, elsewhere), { free: null, escaped: null }, 'Ba4 after a last move that did not attack the bishop: no escape');
  ok(r.fb.bySquare.b5.attackers.some((a) => a.square === a6.to), 'the a6 pawn is among the b5 attackers (what the rule reads)');
  // reward() is unchanged: it never asks for the last move
  assert.deepEqual(G.reward(r.p.pre, r.fb, r.fa, r.move), { kind: 'escaped', piece: 'b', attacker: 'p' }, 'reward() still returns escaped without a last move');
  // the Italian after 4.d3 Nxe4: dxe4 takes the free knight; nothing of White's hung before
  const ita = find('italian_nxe4');
  const beforeNxe4 = new Chess('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R b KQkq - 0 4');
  const nxe4 = beforeNxe4.move('Nxe4');
  ok(nxe4 && nxe4.captured === 'p' && beforeNxe4.fen() === ita.fen, 'the Italian position is the one after ...Nxe4');
  r = run('italian_nxe4', 'dxe4');
  rw = G.rewards(r.p.pre, r.fb, r.fa, r.move, nxe4);
  assert.deepEqual(rw, { free: { kind: 'free_taken', piece: 'n', square: 'e4' }, escaped: null }, 'dxe4 after ...Nxe4: free only (a knight for a pawn)');
  ok(r.fb.hanging.w.filter((p) => p.type !== 'p' && p.value >= 2).length === 0, 'dxe4: nothing of White\'s worth two hung before, so escaped cannot fire');
  assert.deepEqual(G.rewards(r.p.pre, r.fb, r.fa, r.move, null), { free: { kind: 'free_taken', piece: 'n', square: 'e4' }, escaped: null }, 'dxe4 with no last move: free stands');
  assert.deepEqual(G.rewards(r.p.pre, r.fb, r.fa, r.move, nxe4).free, G.reward(r.p.pre, r.fb, r.fa, r.move, nxe4), 'free is exactly reward()\'s first rule');
  // free's even-trade rule is the same as reward()'s
  const qt = setup('6k1/1p4p1/4p2p/4q3/p1pP4/7P/PP3PP1/6K1 w - - 0 29', 'dxe5');
  const preQ = { evalBefore: 0, best: { uci: 'd4e5', san: 'dxe5', from: 'd4', to: 'e5', piece: 'p', captured: 'q' } };
  ok(G.rewards(preQ, qt.fb, qt.fa, qt.move, { from: 'd5', to: 'e5', piece: 'q', captured: 'q' }).free === null, 'rewards: an even trade is not free');
  ok(G.rewards(preQ, qt.fb, qt.fa, qt.move, null).free.kind === 'free_taken', 'rewards: with no last move the FEN rule stands');
  // both on one move: the b5 bishop hangs to the pawn that just came to a6, and the free c6
  // knight is what the bishop takes; after Bxc6 nothing of White's hangs
  const beforeBoth = new Chess('6k1/p7/2n5/1B6/8/8/8/6K1 b - - 0 1');
  const a6b = beforeBoth.move('a6');
  ok(a6b && a6b.to === 'a6', 'the constructed last move is ...a6');
  const both = setup(beforeBoth.fen(), 'Bxc6');
  ok(both.fb.bySquare.b5.hanging && both.fb.bySquare.b5.attackers.some((a) => a.square === 'a6'), 'constructed: the bishop hangs to the a6 pawn');
  ok(both.fb.bySquare.c6.hanging && both.fb.bySquare.c6.color === 'b' && both.fb.bySquare.c6.value === 3, 'constructed: the knight is free');
  ok(both.fa.hanging.w.length === 0, 'constructed: after Bxc6 nothing of White\'s hangs');
  const preBoth = { fen: beforeBoth.fen(), evalBefore: 300, best: { uci: 'b5c6', san: 'Bxc6', from: 'b5', to: 'c6', piece: 'b', captured: 'n', isMate: false }, mateIn: null, line2: null, depth: 14, stopped: false };
  rw = G.rewards(preBoth, both.fb, both.fa, both.move, a6b);
  assert.deepEqual(rw, { free: { kind: 'free_taken', piece: 'n', square: 'c6' }, escaped: { kind: 'escaped', piece: 'b', attacker: 'p' } }, 'constructed: both rewards on one move');
  assert.deepEqual(G.reward(preBoth, both.fb, both.fa, both.move, a6b), rw.free, 'reward() keeps returning the first match (free)');
  assert.deepEqual(G.rewards(preBoth, both.fb, both.fa, both.move, null), { free: rw.free, escaped: null }, 'constructed: without the last move only free');
  assert.deepEqual(G.rewards(preBoth, both.fb, both.fa, both.move, { from: 'h8', to: 'g8', piece: 'k' }), { free: rw.free, escaped: null }, 'constructed: a king step as the last move does not count as the attack');
  // a discovered attack is not their last move's attack: the bishop on b5 is hit by a rook on b8
  // once the b6 knight steps aside (their last move went to d5, not onto the bishop)
  const disc = new Chess('1r4k1/8/1n6/1B6/8/8/8/6K1 b - - 0 1');
  const nd5 = disc.move('Nd5');
  const esc = setup(disc.fen(), 'Ba4');
  ok(esc.fb.bySquare.b5.hanging && !esc.fb.bySquare.b5.attackers.some((a) => a.square === nd5.to), 'discovered: the bishop hangs to the rook, not to the piece that moved');
  const preDisc = { fen: disc.fen(), evalBefore: 0, best: { uci: 'b5a4', san: 'Ba4', from: 'b5', to: 'a4', piece: 'b', captured: null, isMate: false }, mateIn: null, line2: null, depth: 14, stopped: false };
  ok(G.rewards(preDisc, esc.fb, esc.fa, esc.move, nd5).escaped === null, 'discovered: no escape reward');
  ok(G.reward(preDisc, esc.fb, esc.fa, esc.move, nd5) && G.reward(preDisc, esc.fb, esc.fa, esc.move, nd5).kind === 'escaped', 'discovered: reward() (the MVP rule) still calls it escaped');
  // the guards
  assert.deepEqual(G.rewards(null, r.fb, r.fa, r.move, nxe4), { free: null, escaped: null }, 'rewards: no pre-search, no free (and nothing hung)');
  assert.deepEqual(G.rewards(r.p.pre, null, r.fa, r.move, nxe4), { free: null, escaped: null }, 'rewards: no facts, nothing');
  assert.deepEqual(G.rewards(r.p.pre, r.fb, r.fa, null, nxe4), { free: null, escaped: null }, 'rewards: no move, nothing');
  // the recorded clean moves agree with reward() on free, and escaped only with the attack as the last move
  for (const p of positions) {
    for (const [san, row] of Object.entries(p.moves)) {
      if (row.expect !== 'committed') continue;
      const s2 = setup(p.fen, san);
      const r1 = G.reward(p.pre, s2.fb, s2.fa, s2.move);
      const r2 = G.rewards(p.pre, s2.fb, s2.fa, s2.move, null);
      ok(JSON.stringify(r2.free) === JSON.stringify(r1 && r1.kind === 'free_taken' ? r1 : null), `${p.id} ${san}: rewards().free agrees with reward()`);
      ok(r2.escaped === null, `${p.id} ${san}: escaped is null without a last move`);
    }
  }
}
console.log('rewards both: ok');

// ------------------------------------------------------------------------------------------
// 14. recordVerdict(): a stored record as the hold it was
// ------------------------------------------------------------------------------------------
{
  // a v2 HoldRecord from a live verdict, as game.js stores it
  const recordOf = (id, san, over = {}) => {
    const { v, move, p } = run(id, san);
    return {
      record: {
        fen: p.fen, san, category: v.category, sub: v.sub, variant: v.variant, pawnAmongTakers: v.pawnAmongTakers,
        taps: [], outcome: 'anyway', why: null, answered: true, coachShown: false, said: null,
        netLoss: v.netLoss, piece: move.piece, to: move.to, best: v.answer.best,
        answer: { squares: [...v.answer.squares], best: v.answer.best, partial: [...v.answer.partial] },
        refutation: [...v.refutation], refutationFrom: v.refutationFrom, ply: 12, gameId: 'g1', ...G.recordFlags(v), ...over,
      },
      live: v,
    };
  };
  const same = (id, san) => {
    const { record, live } = recordOf(id, san);
    const before = new Chess(record.fen);
    const applied = new Chess(record.fen).move(record.san);
    const rv = G.recordVerdict(record, applied, before);
    const where = `recordVerdict ${id} ${san}`;
    ok(rv && rv.held === true && rv.suppressed === null, `${where}: held`);
    ok(rv.category === live.category && rv.sub === live.sub && rv.variant === live.variant && rv.pawnAmongTakers === live.pawnAmongTakers, `${where}: category, sub, variant, pawnAmongTakers`);
    assert.deepEqual(rv.answer, live.answer, `${where}: the answer set`);
    assert.deepEqual(rv.refutation, live.refutation, `${where}: the refutation`);
    ok(rv.refutationFrom === live.refutationFrom, `${where}: refutationFrom`);
    ok(rv.netLoss === live.netLoss && rv.cpLoss === null, `${where}: netLoss copied, cpLoss null`);
    ok(rv.target === live.target && rv.targetPiece === live.targetPiece && rv.targetColor === live.targetColor, `${where}: target ${rv.target} ${rv.targetPiece} ${rv.targetColor} vs ${live.target} ${live.targetPiece} ${live.targetColor}`);
    assert.deepEqual(rv.takers, live.takers, `${where}: the takers`);
    assert.deepEqual(rv.gained, live.gained, `${where}: gained`);
    ok(rv.reward === null && /^again: /.test(rv.reason), `${where}: reason ${rv.reason}`);
    ok(G.grade(rv.answer, live.answer.best) === 'right', `${where}: the best square grades right`);
    // the hold copy and the asks come out the same as the live hold's
    const s = setup(record.fen, san);
    const a = G.holdCopy(live, s.fa, s.move);
    const b = G.holdCopy(rv, s.fa, s.move);
    const psq = live.answer.partial.length ? live.answer.partial[0] : live.answer.best;
    ok(a.question === b.question && a.if_right(live.answer.best) === b.if_right(live.answer.best) && a.if_partial(psq) === b.if_partial(psq) && a.if_wrong === b.if_wrong && a.named === b.named, `${where}: the hold copy is the same`);
    ok(a.anyway(false) === b.anyway(false) && a.anyway(true) === b.anyway(true) && a.fallback === b.fallback && a.caption === b.caption, `${where}: the anyway, fallback and caption lines are the same`);
    assert.deepEqual(G.asksFor(rv, s.fb, s.fa, s.move, s.before), G.asksFor(live, s.fb, s.fa, s.move, s.before), `${where}: the asks are the same`);
    return { record, rv, live };
  };
  const nxe5 = same('italian_d6', 'Nxe5');
  assert.deepEqual(nxe5.rv.answer, { squares: ['d6', 'c6'], best: 'd6', partial: ['c6'] }, 'recordVerdict Nxe5 answer');
  assert.deepEqual(nxe5.rv.refutation, ['d6e5'], 'recordVerdict Nxe5 refutation');
  ok(nxe5.rv.variant === 'takes_back' && nxe5.rv.pawnAmongTakers === true && nxe5.rv.netLoss === 2, 'recordVerdict Nxe5 facts');
  assert.deepEqual(nxe5.rv.gained, ['p'], 'recordVerdict Nxe5 gained');
  const bxf7 = same('italian_d6', 'Bxf7+');
  assert.deepEqual(bxf7.rv.answer, { squares: ['f8', 'g8'], best: 'f8', partial: ['g8'] }, 'recordVerdict Bxf7+ answer');
  ok(bxf7.rv.refutation[0] === 'f8f7' && bxf7.rv.takers.find((t) => t.square === 'g8').type === 'k', 'recordVerdict Bxf7+ refutation and the king taker');
  // every other recorded hold rebuilds too (ignored_attack both subs, free, both mates, the stalemate)
  for (const p of positions) {
    for (const [san, row] of Object.entries(p.moves)) {
      if (row.expect !== 'held' || (p.id === 'italian_d6' && (san === 'Nxe5' || san === 'Bxf7+'))) continue;
      same(p.id, san);
    }
  }
  // the tutorial's own rows, stored as the tutorial stores them, rebuild as the tutorial verdict
  for (const san of ['Nxe5', 'Bxf7+', 'Nd4', 'Ba6', 'Be6']) {
    const s = setup(tutorial.fen, san);
    const tv = G.tutorialVerdict(tutorial.moves[san], s.move, s.before);
    const rec = { fen: tutorial.fen, san, category: tv.category, sub: tv.sub, variant: tv.variant, pawnAmongTakers: tv.pawnAmongTakers, netLoss: tv.netLoss, piece: s.move.piece, to: s.move.to, best: tv.answer.best, answer: tv.answer, refutation: tv.refutation, refutationFrom: 'post', outcome: 'anyway', ply: 7, gameId: 't' };
    const rv = G.recordVerdict(rec, s.move, s.before);
    assert.deepEqual(rv.answer, tv.answer, `tutorial ${san} record answer`);
    assert.deepEqual(rv.refutation, tv.refutation, `tutorial ${san} record refutation`);
    assert.deepEqual(rv.takers.map((t) => t.square).sort(), tv.takers.map((t) => t.square).sort(), `tutorial ${san} record takers`);
    ok(rv.targetPiece === tv.targetPiece && rv.target === tv.target, `tutorial ${san} record target`);
  }
  // without the move or the position the record's own fen and san stand in
  {
    const { record, live } = recordOf('ruy_a6', 'O-O');
    const rv = G.recordVerdict(record);
    ok(rv && rv.category === 'ignored_attack' && rv.sub === 'already' && rv.target === 'b5' && rv.targetPiece === 'b', 'recordVerdict with the record alone');
    assert.deepEqual(rv.answer, live.answer, 'recordVerdict with the record alone: the answer');
    assert.deepEqual(rv.takers, live.takers, 'recordVerdict with the record alone: the takers');
  }
  // a record without an answer set (a normalised v1 record) is never a drill
  {
    const { record } = recordOf('italian_d6', 'Nxe5');
    ok(G.recordVerdict({ ...record, answer: null }) === null, 'recordVerdict: answer null -> null');
    const v1 = { ...record };
    delete v1.answer; delete v1.refutation; delete v1.refutationFrom; delete v1.variant; delete v1.pawnAmongTakers;
    ok(G.recordVerdict(v1) === null, 'recordVerdict: a v1 record -> null');
    ok(G.recordVerdict(null) === null && G.recordVerdict({}) === null && G.recordVerdict({ category: 'hanging_after_move' }) === null, 'recordVerdict: junk -> null');
    ok(G.recordVerdict({ ...record, san: 'Nxe4' }) === null, 'recordVerdict: an illegal san -> null');
    ok(G.recordVerdict({ ...record, category: 'something_else' }) === null, 'recordVerdict: an unknown category -> null');
    // a copy: the record's own arrays are not shared with the verdict
    const rv = G.recordVerdict(record);
    rv.answer.squares.push('a1'); rv.refutation.push('a1a2');
    ok(record.answer.squares.length === 2 && record.refutation.length === 1, 'recordVerdict copies the record\'s arrays');
  }
}
console.log('recordVerdict: ok');

// ------------------------------------------------------------------------------------------
// 15. Shown outcomes: remembered() ignores a landed record; closeCaption's landed and again
// ------------------------------------------------------------------------------------------
{
  const d6 = find('italian_d6').fen;
  const rec = (over) => ({ fen: d6, san: 'Nxe5', category: 'hanging_after_move', sub: null, variant: 'takes_back', pawnAmongTakers: true, taps: [], outcome: 'back', why: null, coachShown: false, netLoss: 2, piece: 'n', to: 'e5', best: 'd6', ply: 12, gameId: 'x', ...over });
  const landed = rec({ outcome: 'landed', why: 'hand' });
  ok(G.remembered({ holds: [landed] }) === C.COPY.REMEMBERED.NONE, 'remembered: a landed record is not a hold he saw');
  ok(G.remembered({ holds: [rec(), landed] }) === 'One hold last game, a pawn you did not see. Watch the pawns.', 'remembered: one shown beside one landed');
  ok(G.remembered({ holds: [rec(), rec({ outcome: 'anyway' }), landed, rec({ outcome: 'ended' })] }) === 'Three holds last game, all a pawn you did not see. Watch the pawns.', 'remembered: back, anyway and ended count');
  ok(G.remembered({ holds: [rec({ outcome: 'again' })] }) === 'One hold last game, a pawn you did not see. Watch the pawns.', 'remembered: the drill\'s take-back counts on its own game');
  ok(G.remembered({ holds: [rec({ outcome: 'nonsense' }), landed] }) === C.COPY.REMEMBERED.NONE, 'remembered: unknown outcomes are not counted');
  for (const o of C.PATH.SHOWN_OUTCOMES) ok(G.remembered({ holds: [rec({ outcome: o })] }) !== C.COPY.REMEMBERED.NONE, `remembered: '${o}' is a shown outcome`);
  ok(G.closeCaption(landed) === 'Knight to e5, a pawn was waiting: it landed.', `caption landed: ${G.closeCaption(landed)}`);
  ok(G.closeCaption(rec({ outcome: 'landed', why: 'quiet', best: 'c6' })) === 'Knight to e5, a knight was waiting: it landed.', 'caption landed (quiet)');
  ok(G.closeCaption(rec({ outcome: 'again' })) === 'Knight to e5, a pawn was waiting: answered.', `caption again: ${G.closeCaption(rec({ outcome: 'again' }))}`);
  ok(G.closeCaption(rec()) === 'Knight to e5, a pawn was waiting: taken back.', 'caption back unchanged');
  const freeLanded = { fen: find('italian_nxe4').fen, san: 'Nc3', category: 'free_piece_ignored', sub: null, outcome: 'landed', why: 'hand', piece: 'n', to: 'c3', best: 'e4', netLoss: 3 };
  ok(G.closeCaption(freeLanded) === 'A free knight was there: it stayed.', `caption free landed: ${G.closeCaption(freeLanded)}`);
  ok(G.closeCaption({ ...freeLanded, fen: find('placement_oo').fen, san: 'Nbd2', to: 'd2', best: 'g4' }) === 'A free bishop was there: it stayed.', 'caption free landed names the free piece');
  ok(G.closeCaption({ ...freeLanded, outcome: 'anyway' }) === 'Knight to c3, a free knight was there: played anyway.', 'caption free played anyway is unchanged');
  ok(G.closeCaption({ fen: find('ruy_a6').fen, san: 'O-O', category: 'ignored_attack', sub: 'already', outcome: 'landed', why: 'hand', piece: 'k', to: 'g1', best: 'b5' }) === 'King to g1, your bishop was under attack: it landed.', 'caption ignored_attack landed');
  templateOk(G.closeCaption(landed), 'landed caption', 20);
  templateOk(G.closeCaption(freeLanded), 'free landed caption', 20);
  ok(C.COPY.CLOSE.OUTCOME.landed === C.COPY.CLOSE.LANDED, 'the landed outcome word is the one COPY key');
}
console.log('shown outcomes: ok');

// ------------------------------------------------------------------------------------------
// 16. review2: the ignored_attack sub-cases against the board, and a guarded 'free' piece
//     (P10 their last move and the pin release, P11 a blocked guard, P12 won, not free)
// ------------------------------------------------------------------------------------------
{
  // a synthetic pre/post: his move, the reply that takes (and an optional recapture), the scores
  const synth = (fen, san, replyUci, { bestUci, evalBefore = 0, evalAfter = -400, back = null, lastMove = null } = {}) => {
    const s = setup(fen, san);
    const sc = new Chess(s.after.fen());
    const rm = sc.move({ from: replyUci.slice(0, 2), to: replyUci.slice(2, 4) });
    ok(rm, `synth: illegal reply ${replyUci}`);
    const reply = { uci: replyUci, san: rm.san, from: rm.from, to: rm.to, piece: rm.piece, captured: rm.captured || null, isCapture: !!rm.captured, isCheck: sc.isCheck(), isMate: sc.isCheckmate() };
    const post = { fen: s.after.fen(), evalAfter, lines: [{ reply, score: evalAfter, pv: back ? [replyUci, back] : [replyUci] }], replyMateIn: null, depth: 12 };
    const bc = new Chess(fen);
    const bm = bc.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4) });
    const pre = { fen, evalBefore, best: { uci: bestUci, san: bm.san, from: bm.from, to: bm.to, piece: bm.piece, captured: bm.captured || null, isMate: false }, mateIn: null, line2: null, depth: 12, stopped: false };
    const v = G.verdict(pre, post, s.fb, s.fa, { move: s.move, anyways: 0, playedPairs: [], lastMove });
    return { ...s, v, copy: G.holdCopy(v, s.fa, s.move) };
  };
  // P10a: the bishop on b5 has stood attacked by the a6 pawn since 3...a6; their last move (Nf6) hit e4
  const ruy = new Chess();
  for (const m of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'd3', 'Nf6']) ruy.move(m);
  const nf6 = { from: 'g8', to: 'f6', piece: 'n', color: 'b', captured: null };
  const persist = synth(ruy.fen(), 'h3', 'a6b5', { bestUci: 'b5a4', lastMove: nf6 });
  ok(persist.v.held && persist.v.category === 'ignored_attack' && persist.v.sub === 'already', `P10a: held as already (${persist.v.reason})`);
  ok(persist.v.byLastMove === false, 'P10a: the attack did not come with their last move');
  ok(persist.copy.question === C.COPY.QUESTION.ignored_attack_already, `P10a: the template question (${persist.copy.question})`);
  ok(persist.copy.if_wrong === C.COPY.IF_WRONG.ignored_attack_already_old && !/last move/.test(persist.copy.if_wrong), `P10a: the wrong-tap hint does not send him to their last move (${persist.copy.if_wrong})`);
  // the same bishop, attacked by the move they just made (a6 as their last move): byLastMove true
  const ruy5 = new Chess();
  for (const m of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) ruy5.move(m);
  const fresh = synth(ruy5.fen(), 'd3', 'a6b5', { bestUci: 'b5a4', lastMove: { from: 'a7', to: 'a6', piece: 'p', color: 'b', captured: null } });
  ok(fresh.v.sub === 'already' && fresh.v.byLastMove === true && fresh.copy.if_wrong === C.COPY.IF_WRONG.ignored_attack, `P10: a fresh attack keeps the last-move hint (${fresh.v.byLastMove})`);
  // no last move known (a loaded position): unknown, the MVP's copy
  const loaded = synth(ruy5.fen(), 'd3', 'a6b5', { bestUci: 'b5a4' });
  ok(loaded.v.sub === 'already' && loaded.v.byLastMove === null, 'P10: a loaded position: byLastMove unknown');
  // P10b: Bb5 pins the c6 knight to the king; Bc4 releases the pin and Nxe5 follows. Nothing could take e5 before: opened_line (guards)
  const pin = synth('r3k3/pp3ppp/2n5/1B2B3/8/8/PP3PPP/6K1 w - - 0 1', 'Bc4', 'c6e5', { bestUci: 'e5c7' });
  ok(pin.v.held && pin.v.category === 'ignored_attack' && pin.v.sub === 'opened_line', `P10b: a pin release is opened_line (${pin.v.sub}: ${pin.v.reason})`);
  ok(!/already under attack/.test(pin.copy.question), `P10b: not 'already under attack' (${pin.copy.question})`);
  // P11: Bd3 blocks the queen's guard of d4 (the moved bishop guarded nothing)
  const block = synth('6k1/ppp1qppp/1b6/8/3N4/8/PPP2PPP/3Q1BK1 w - - 0 1', 'Bd3', 'b6d4', { bestUci: 'd4f5' });
  ok(block.v.held && block.v.sub === 'lost_guard' && block.v.guardMoved === false, `P11: a blocked guard is lost_guard with guardMoved false (${block.v.sub} ${block.v.guardMoved})`);
  ok(block.copy.if_wrong === C.COPY.IF_WRONG.ignored_attack_lost_guard && !/last move/.test(block.copy.if_wrong), `P11: the lost_guard hint (${block.copy.if_wrong})`);
  // the moved piece was the guard: guardMoved true
  const moved = synth('6k1/ppp2ppp/1b6/8/3N4/4B3/PPP2PPP/6K1 w - - 0 1', 'Bg5', 'b6d4', { bestUci: 'd4f5' });
  ok(moved.v.held && moved.v.sub === 'lost_guard' && moved.v.guardMoved === true, `P11: the guard moved (${moved.v.sub} ${moved.v.guardMoved}: ${moved.v.reason})`);
  // P12: placement_oo, the g4 bishop is guarded by Nf6; hxg4 wins it for a pawn: won, not free
  const oo = run('placement_oo', 'Nbd2');
  ok(oo.v.category === 'free_piece_ignored' && oo.v.defended === true, 'P12: the g4 bishop is guarded');
  const ooCopy = G.holdCopy(oo.v, oo.fa, oo.move);
  ok(ooCopy.question === C.COPY.QUESTION.free_piece_ignored_cheap && !/free/.test(ooCopy.question), `P12: the question says won (${ooCopy.question})`);
  ok(ooCopy.if_wrong === C.COPY.IF_WRONG.free_piece_ignored_cheap && !/nothing is guarding/.test(ooCopy.if_wrong), `P12: the hint does not say unguarded (${ooCopy.if_wrong})`);
  ok(ooCopy.if_right(oo.v.answer.best) === 'Yes, the bishop. It is worth more than what takes it.', `P12: the right tap (${ooCopy.if_right(oo.v.answer.best)})`);
  ok(!/free/.test(ooCopy.anyway(false)) && !/free/.test(ooCopy.fallback) && !/free/.test(ooCopy.caption), 'P12: no "free" in the anyway, fallback or caption');
  for (const t of [ooCopy.question, ooCopy.if_wrong, ooCopy.if_right(oo.v.answer.best), ooCopy.anyway(false), ooCopy.fallback]) templateOk(t, 'P12 copy');
  const nxe4 = run('italian_nxe4', 'Nc3');
  ok(nxe4.v.defended === false && G.holdCopy(nxe4.v, nxe4.fa, nxe4.move).question === C.COPY.QUESTION.free_piece_ignored, 'P12: an unguarded piece keeps the free copy');
  const cheapLanded = { fen: find('placement_oo').fen, san: 'Nbd2', category: 'free_piece_ignored', sub: null, outcome: 'landed', why: 'hand', piece: 'n', to: 'd2', best: 'g4', netLoss: 2, defended: true };
  ok(G.closeCaption(cheapLanded) === 'Their bishop could be won: it stayed.', `P12: the landed caption (${G.closeCaption(cheapLanded)})`);
  ok(G.closeCaption({ ...cheapLanded, outcome: 'anyway' }) === 'Knight to d2, their bishop could be won: played anyway.', `P12: the played-anyway caption (${G.closeCaption({ ...cheapLanded, outcome: 'anyway' })})`);
  // recordFlags keeps exactly the booleans
  eq_(G.recordFlags(persist.v), { byLastMove: false }, 'recordFlags already');
  eq_(G.recordFlags(block.v), { guardMoved: false }, 'recordFlags lost_guard');
  eq_(G.recordFlags(oo.v), { defended: true }, 'recordFlags free');
  eq_(G.recordFlags(loaded.v), {}, 'recordFlags: an unknown byLastMove is not kept');
}
function eq_(a, b, msg) { checks += 1; assert.deepEqual(a, b, msg); }
console.log('ignored_attack sub-cases and a guarded free piece: ok');

console.log(`all ${checks} checks passed (${BASELINE} of the MVP unchanged, ${checks - BASELINE} for the pathway)`);
