#!/usr/bin/env node
// test_path.mjs — the pathway's model in node (no browser, no engine): app/js/path.js over
// synthetic logs built with game(), every fixture of product/PATHWAY.md 'The next rule' and the
// looks, the nodeOf table of ARCHITECTURE.md 8.9 over data/positions.json and data/tutorial.json,
// the trim-invariance and merge-silence fixtures, the v1 twin, idempotence, the COPY.PATH checks
// and the synthetic-player print.
//
//   node /home/user/hello-world/scripts/test_path.mjs      (exit 0 on success, 1 on the first failure)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = process.env.HOLDON_APP || path.join(ROOT, 'app'); // override for dev runs against a copy

const { Chess } = await import(path.join(APP, 'vendor', 'chess.js'));
const C = await import(path.join(APP, 'js', 'contract.js'));
const P = await import(path.join(APP, 'js', 'path.js'));

let validate = null;
try {
  validate = await import(path.join(APP, 'js', 'validate.js'));
} catch (e) {
  if (e && e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
}

const positions = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'positions.json'), 'utf8'));
const tutorial = JSON.parse(fs.readFileSync(path.join(APP, 'data', 'tutorial.json'), 'utf8'));
const { PATH, COPY } = C;

let checks = 0;
function ok(cond, msg) {
  checks += 1;
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}
function eq(a, b, msg) {
  ok(isDeepStrictEqual(a, b), `${msg}\n  got:      ${JSON.stringify(a)}\n  expected: ${JSON.stringify(b)}`);
}
function section(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`FAIL in ${name}: ${e && e.stack ? e.stack : e}`);
    process.exit(1);
  }
  console.log(`${name}: ok`);
}

// ---------------------------------------------------------------------------------------------
// The log builder
// ---------------------------------------------------------------------------------------------
const DAY = 24 * 60 * 60 * 1000;
const EPOCH = Date.parse('2026-03-02T10:00:00.000Z');
const D6 = 'r1bq1rk1/ppp1bppp/2np1n2/4p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7';
let seq = 0;

// The split of each look as a record carries it.
const KIND = {
  pawns: { category: 'hanging_after_move', sub: null, variant: 'takes_back', pawnAmongTakers: true },
  takers: { category: 'hanging_after_move', sub: null, variant: null, pawnAmongTakers: false },
  takes_back: { category: 'hanging_after_move', sub: null, variant: 'takes_back', pawnAmongTakers: false },
  their_last_move: { category: 'ignored_attack', sub: 'already', variant: null, pawnAmongTakers: false },
  free: { category: 'free_piece_ignored', sub: null, variant: null, pawnAmongTakers: false },
  guards: { category: 'ignored_attack', sub: 'lost_guard', variant: null, pawnAmongTakers: false },
  mates: { category: 'allowed_mate', sub: null, variant: null, pawnAmongTakers: false },
};
const RIGHT = [{ square: 'd6', grade: 'right', ask: null }];
// rec('pawns') -> a played-anyway pawns hold (weight 2); options override any field
function rec(look, o = {}) {
  return { ...KIND[look], netLoss: 2, ply: 15, outcome: 'anyway', taps: [], ...o };
}

// game({ result, observed, date, holds, escapes, gifts, captures, again }) -> GameSummary v2.
// Ids are unique; dates are one day apart from a fixed epoch, in call order.
function game(o = {}) {
  seq += 1;
  const id = 'g' + String(seq).padStart(4, '0');
  const date = o.date || new Date(EPOCH + seq * DAY).toISOString();
  const observed = o.observed ?? 22;
  const holds = (o.holds || []).map((h) => ({
    fen: D6, san: 'Nxe5', piece: 'n', to: 'e5', best: 'd6',
    answer: { squares: ['d6'], best: 'd6', partial: ['c6'] }, refutation: ['d6e5'], refutationFrom: 'post',
    why: h.outcome === 'landed' ? 'hand' : null, said: null, answered: false, coachShown: false,
    ...h, gameId: id,
  }));
  const escapes = o.escapes || 0;
  const rewards = [];
  for (let i = 0; i < escapes; i += 1) rewards.push({ kind: 'escaped', ply: 9 + 2 * i, piece: 'b', said: i === 0 });
  return {
    v: 2, id, date, result: o.result || 'giveup', givenAway: 0, holds, freeTaken: 0,
    playedAnyway: holds.filter((h) => h.outcome === 'anyway').length, plies: observed * 2,
    backs: holds.filter((h) => h.outcome === 'back').length,
    observed, captures: o.captures === undefined ? 0 : o.captures, rewards,
    gifts: o.gifts || { offered: 0, taken: 0 }, again: !!o.again, hand: C.handAll('full'), review: false,
  };
}
const clean = (o = {}) => game(o);
const digestOf = (games) => games.map(P.digestOf);
// the newest date of a log plus an hour: a 'now' that is never idle
function nowOf(games) {
  return Math.max(...games.map((g) => Date.parse(g.date)), EPOCH) + 60 * 60 * 1000;
}
function st(games, now = nowOf(games)) {
  return P.compute(digestOf(games), now);
}
function look(state, id) {
  return state.looks.find((l) => l.id === id);
}
// stages after each prefix of the log
function history(games) {
  return games.map((g, i) => st(games.slice(0, i + 1)).stages);
}
const ALL_ASKING = Object.fromEntries(PATH.MATERIAL_LOOKS.map((id) => [id, 'asking']));

// ---------------------------------------------------------------------------------------------
// The next rule: the empty log, counted games, the climb
// ---------------------------------------------------------------------------------------------
section('empty log', () => {
  const s = P.compute([], EPOCH);
  eq(s.stages, ALL_ASKING, 'empty log: every look asking');
  ok(s.current === 'pawns', 'empty log: current pawns');
  eq(s.tied, ['pawns', 'free'], 'empty log: pawns and free tie on nothing');
  ok(s.review === false && s.countedGames === 0 && s.newest === null && s.newestReal === null, 'empty log: no review, no lines');
  const p = P.plan(s);
  eq(p.hand, C.handAll('full'), 'empty log: hand all full');
  ok(p.giftRate === 0.12 && p.giftRate === PATH.GIFT_RATE.on, 'empty log: giftRate 0.12');
  ok(p.line === null, 'empty log: no opening line (the first game keeps today\'s line)');
  ok(p.announce === null && p.transitions.length === 0, 'empty log: nothing announced');
  ok(p.drill === null, 'empty log: no drill');
  ok(p.question.pawns === COPY.PATH.QUESTION.pawns, 'empty log: the pawns remembering question is the template');
  ok(p.askFirst === PATH.ASK_FIRST.pawns && p.focus === 'pawns', 'empty log: askFirst and focus from the rules');
  ok(p.closeLine === COPY.PATH.CLOSE.NONE_FIRST, 'empty log: close line NONE_FIRST');
  ok(p.where === COPY.PATH.WHERE.FIRST, 'empty log: where FIRST');
  ok(Object.isFrozen(s) && Object.isFrozen(s.looks) && Object.isFrozen(s.looks[0]) && Object.isFrozen(s.stages), 'state is frozen');
  ok(Object.isFrozen(p) && Object.isFrozen(p.hand) && Object.isFrozen(p.hand.hanging_after_move) && Object.isFrozen(p.question), 'plan is frozen');
  const w = P.words(s, { now: EPOCH });
  ok(Object.isFrozen(w) && Object.isFrozen(w.rows) && Object.isFrozen(w.facts), 'words are frozen');
  eq(w.rows.map((r) => r.id), ['pawns', 'mates'], 'empty log: the face shows the current look and the mates');
  ok(w.collapsed === 'Five more, not come up yet.', `empty log: collapsed line: ${w.collapsed}`);
  ok(w.rows[0].caption === COPY.PATH.CAPTION.CURRENT && w.rows[0].ink === 'ink' && w.rows[0].state === 'current', 'empty log: current caption and ink');
  ok(w.rows[1].caption === COPY.PATH.CAPTION.MATES && w.rows[1].ink === 'coach' && w.rows[1].state === 'always', 'empty log: mates row');
});

section('counted games', () => {
  const line = (o) => P.digestOf(game(o));
  ok(P.counted(line({ observed: 20 })), 'observed 20 counts');
  ok(!P.counted(line({ observed: 19 })), 'a give-up at observed 19 does not count');
  ok(P.counted(line({ result: 'resign', observed: 9 })), 'a resign at observed 9 counts');
  ok(P.counted(line({ result: 'mate-win', observed: 8 })), 'a mate-win at observed 8 counts');
  ok(P.counted(line({ result: 'mate-loss', observed: 8 })), 'a mate-loss at observed 8 counts');
  ok(!P.counted(line({ result: 'mate-loss', observed: 7 })), 'a mate-loss at observed 7 does not count');
  ok(!P.counted(line({ result: 'draw', observed: 19 })), 'a draw is not decisive');
  ok(!P.counted(line({ observed: 30, again: true })), 'an again game never counts');
  ok(!P.counted(null) && !P.counted({}), 'counted is total');

  // three games at observed 12 change nothing
  const short = [clean({ observed: 12 }), clean({ observed: 12 }), clean({ observed: 12 })];
  const s = st(short);
  eq(s.stages, ALL_ASKING, 'three games at observed 12: every look asking');
  ok(s.countedGames === 0 && s.looks.every((l) => l.run === 0 && !l.everFired), 'three short games: no run, nothing fired');
  ok(P.plan(s).announce.kind === 'NOT_COUNTED', 'a short newest game announces NOT_COUNTED');
  // a resign at observed 9 counts; a give-up at observed 19 does not
  ok(st([clean({ result: 'resign', observed: 9 }), clean({ result: 'resign', observed: 9 })]).stages.pawns === 'quiet', 'two resigns at observed 9 reach quiet');
  ok(st([clean({ observed: 19 }), clean({ observed: 19 })]).stages.pawns === 'asking', 'two give-ups at observed 19 stay asking');
});

section('pawns: quiet, off, never off without a record', () => {
  // two clean counted games
  const two = [clean(), clean()];
  const s2 = st(two);
  ok(s2.stages.pawns === 'quiet', 'two clean counted games: pawns quiet');
  const p2 = P.plan(s2);
  ok(p2.hand.hanging_after_move.pawn === 'bare', 'two clean counted games: the pawns hand bare');
  ok(p2.hand.allowed_mate === 'full' && p2.hand.missed_mate === 'full' && p2.hand.allowed_stalemate === 'full', 'mates keep the full hand');

  // a pawns record then five clean counted games
  const log = [game({ holds: [rec('pawns')] }), clean({ observed: 22 }), clean({ observed: 26 }), clean({ observed: 30 }), clean({ observed: 24 }), clean({ observed: 28 })];
  const h = history(log);
  eq(h.map((x) => x.pawns), ['asking', 'asking', 'quiet', 'quiet', 'quiet', 'off'], 'record + five clean: quiet at the third, off at the sixth');
  const s6 = st(log);
  const p6 = P.plan(s6);
  ok(p6.hand.hanging_after_move.pawn === 'off', 'off: the pawns hand off');
  ok(p6.hand.allowed_mate === 'full' && p6.hand.ignored_attack.already === 'full', 'off pawns: allowed_mate and ignored_attack.already stay full');
  ok(p6.hand.hanging_after_move.piece === 'bare' && p6.hand.hanging_after_move.takes_back === 'full', 'takers capped quiet (never fired), takes_back asking (no captures)');
  ok(p6.announce && p6.announce.kind === 'OFF' && p6.announce.look === 'pawns', 'the first off game announces OFF for the pawns');
  ok(p6.line.startsWith(COPY.PATH.TRANSITION.OFF.pawns) && p6.line.includes('They are yours'), `off line: ${p6.line}`);
  ok(P.plan(s6, null, null, ['off:pawns']).announce === null, 'OFF is said once per look (said off:pawns)');
  ok(look(s6, 'pawns').since === log[5].date, 'since is the date of the game that changed the stage');
  ok(s6.looks.find((l) => l.id === 'pawns').state === 'off', 'the face reads off');

  // the same with the clean games at observed 12: asking
  const short = [game({ holds: [rec('pawns')] }), ...[1, 2, 3, 4, 5].map(() => clean({ observed: 12 }))];
  ok(st(short).stages.pawns === 'asking', 'record + five clean at observed 12: asking');

  // five clean counted games with no pawns record ever: quiet, never off, no OFF transition
  const never = [clean(), clean(), clean(), clean(), clean()];
  const hn = history(never);
  ok(hn.every((x, i) => (i === 0 ? x.pawns === 'asking' : x.pawns === 'quiet')), `never fired: ${hn.map((x) => x.pawns)}`);
  let shown = null;
  for (let i = 1; i <= never.length; i += 1) {
    const s = st(never.slice(0, i));
    const p = P.plan(s, null, shown);
    ok(!p.transitions.some((t) => t.look === 'pawns' && t.kind === 'OFF'), `never fired: no OFF transition at game ${i}`);
    shown = s.stages;
  }
  const longer = [...never, clean(), clean(), clean(), clean()];
  ok(st(longer).stages.pawns === 'quiet', 'never fired: still quiet after nine clean games');
});

section('takers climbs game-major with pawns', () => {
  const log = [game({ holds: [rec('pawns'), rec('takers')] }), clean(), clean(), clean(), clean(), clean(), clean()];
  const h = history(log);
  eq(h.map((x) => x.pawns), ['asking', 'asking', 'quiet', 'quiet', 'quiet', 'off', 'off'], 'pawns over games one to seven');
  eq(h.map((x) => x.takers), ['asking', 'asking', 'quiet', 'quiet', 'quiet', 'off', 'off'], 'takers quiet in the game pawns goes quiet, off in the game pawns goes off');
  const s7 = st(log);
  ok(look(s7, 'takers').everFired, 'takers fired');
  // a pawns weight-2 record as game eight drops pawns and leaves takers and the history alone
  const g8 = game({ holds: [rec('pawns', { outcome: 'anyway' })] });
  const s8 = st([...log, g8]);
  ok(s8.stages.pawns === 'quiet' && look(s8, 'pawns').woken, 'game eight: pawns dropped from off (one record: quiet, woken)');
  ok(s8.stages.takers === 'off', 'game eight: takers untouched');
  eq(history([...log, g8]).slice(0, 7), h, 'game eight leaves the earlier stages untouched');
  const g8b = game({ holds: [rec('pawns'), rec('pawns', { ply: 31 })] });
  const s8b = st([...log, g8b]);
  ok(s8b.stages.pawns === 'asking' && s8b.stages.takers === 'off', 'two pawns records in game eight: pawns asking, takers off');
  // a gated look keeps counting its run
  const gated = [game({ holds: [rec('pawns')] }), clean()];
  ok(look(st(gated), 'takers').run === 2 && st(gated).stages.takers === 'asking', 'takers counts its run while pawns is asking');
});

section('decay: slip, wake, weights', () => {
  const offLog = [game({ holds: [rec('pawns')] }), clean(), clean(), clean(), clean(), clean()];
  const sOff = st(offLog);
  ok(sOff.stages.pawns === 'off', 'the off log');
  // a landed pawns record in a twelve-ply give-up after off
  const slipGame = game({ observed: 6, holds: [rec('pawns', { outcome: 'landed', why: 'hand' })] });
  const slip = [...offLog, slipGame];
  const s = st(slip);
  ok(s.stages.pawns === 'quiet' && look(s, 'pawns').woken, 'a landed record in a short give-up: quiet, woken');
  ok(look(s, 'pawns').state === 'back', 'the face reads back');
  const p = P.plan(s);
  eq(p.transitions.filter((t) => t.look === 'pawns'), [{ look: 'pawns', kind: 'SLIP' }], 'SLIP transition against before');
  eq(P.plan(s, null, sOff.stages).transitions.filter((t) => t.look === 'pawns'), [{ look: 'pawns', kind: 'SLIP' }], 'SLIP transition against shown');
  ok(p.announce.kind === 'SLIP' && p.line.includes('said nothing'), `slip line: ${p.line}`);
  ok(p.hand.hanging_after_move.pawn === 'bare', 'after a slip: the bare hand');
  // a woken look needs two clean counted games
  const one = st([...slip, clean()]);
  ok(one.stages.pawns === 'quiet' && look(one, 'pawns').woken, 'woken: after one clean counted game still quiet and woken');
  const two = st([...slip, clean(), clean()]);
  ok(two.stages.pawns === 'off' && !look(two, 'pawns').woken, 'woken: after two clean counted games (window clean) off');
  // two landed records in one game: asking, WAKE
  const wakeGame = game({ holds: [rec('pawns', { outcome: 'landed' }), rec('pawns', { outcome: 'landed', ply: 33 })] });
  const sw = st([...offLog, wakeGame]);
  ok(sw.stages.pawns === 'asking', 'two landed records in one game: asking');
  const pw = P.plan(sw);
  ok(pw.announce.kind === 'WAKE' && pw.announce.look === 'pawns' && pw.line.includes('once more'), `wake line: ${pw.line}`);
  ok(pw.hand.hanging_after_move.pawn === 'full', 'after the wake: the full hand');
  // at quiet: weight 2 -> asking, one weight-1 keeps quiet with run 0
  const quietLog = [game({ holds: [rec('pawns')] }), clean(), clean()];
  ok(st(quietLog).stages.pawns === 'quiet', 'the quiet log');
  const w2 = st([...quietLog, game({ holds: [rec('pawns', { outcome: 'anyway' })] })]);
  ok(w2.stages.pawns === 'asking', 'a weight-2 record at quiet: asking');
  ok(P.plan(w2).announce.kind === 'WAKE', 'quiet to asking is a WAKE');
  const w1 = st([...quietLog, game({ holds: [rec('pawns', { outcome: 'back', taps: RIGHT })] })]);
  ok(w1.stages.pawns === 'quiet' && look(w1, 'pawns').run === 0, 'a weight-1 record at quiet keeps quiet, run 0');
  const two1 = st([...quietLog, game({ holds: [rec('pawns', { outcome: 'back', taps: RIGHT }), rec('pawns', { outcome: 'back', taps: RIGHT, ply: 30 })] })]);
  ok(two1.stages.pawns === 'asking', 'two weight-1 records in one game at quiet: asking');
  // decay runs over uncounted games too, and never over again games
  const againSlip = st([...offLog, game({ again: true, holds: [rec('pawns', { outcome: 'landed' })] })]);
  ok(againSlip.stages.pawns === 'off', 'a record in an again game never decays');
});

section('weight', () => {
  ok(P.weight({ outcome: 'back', taps: [{ square: 'f3', grade: 'right', ask: 'safe_square' }] }) === 1, 'a right first tap on a K2 ask is weight 1');
  ok(P.weight({ outcome: 'back', taps: [{ square: 'c6', grade: 'partial', ask: null }] }) === 1, 'a partial first tap is weight 1');
  ok(P.weight({ outcome: 'back', taps: [{ square: 'a1', grade: 'wrong', ask: null }, { square: 'd6', grade: 'right', ask: null }] }) === 2, 'a back after a wrong first tap is weight 2');
  ok(P.weight({ outcome: 'back', taps: [{ square: 'd6', grade: 'named', ask: null }] }) === 2, 'a named first tap is weight 2');
  ok(P.weight({ outcome: 'back', taps: [] }) === 2, 'a back with no tap is weight 2');
  for (const outcome of ['anyway', 'ended', 'landed']) ok(P.weight({ outcome, taps: RIGHT }) === 2, `${outcome} is weight 2`);
  ok(P.weight(null) === 2, 'weight is total');
  const d = P.digestOf(game({ holds: [rec('pawns', { outcome: 'back', taps: RIGHT }), rec('pawns', { netLoss: 3 }), rec('free', { netLoss: null })] }));
  eq({ n: d.looks.pawns.n, w: d.looks.pawns.w, netLoss: d.looks.pawns.netLoss }, { n: 2, w: 3, netLoss: 5 }, 'the digest sums records, weights and netLoss');
  eq({ n: d.looks.free.n, netLoss: d.looks.free.netLoss }, { n: 1, netLoss: 0 }, 'a null netLoss counts zero');
  ok(!('takers' in d.looks), 'only looks with records are present');
});

section('floors', () => {
  // takes_back: captures over the trailing window
  const tb = (caps) => [game({ captures: 1, holds: [rec('takes_back')] }), ...caps.map((c) => clean({ captures: c }))];
  ok(st(tb([1, 1, 1, 1, 1])).stages.takes_back === 'off', 'takes_back captures [1,1,1,1,1]: off');
  eq(history(tb([1, 1, 1, 1, 1])).map((x) => x.takes_back), ['asking', 'asking', 'quiet', 'quiet', 'quiet', 'off'], 'takes_back: quiet at the third, off at the sixth');
  ok(st(tb([0, 0, 0, 0, 0])).stages.takes_back === 'asking', 'takes_back captures [0,0,0,0,0]: asking');
  ok(st(tb([2, 2, 1, 1, 1])).stages.takes_back === 'off', 'takes_back captures [2,2,1,1,1]: off');
  const v1caps = [game({ captures: null, holds: [rec('takes_back')] }), ...[1, 2, 3, 4, 5].map(() => clean({ captures: null }))];
  ok(st(v1caps).stages.takes_back === 'asking', 'captures null (v1) never satisfies the floor');
  // their_last_move: escapes, or everFired
  const tl = [game({ holds: [rec('their_last_move')] }), ...[1, 1, 0, 1, 1].map((e) => clean({ escapes: e }))];
  ok(st(tl).stages.their_last_move === 'off', 'their_last_move escapes [1,1,0,1,1] with an earlier record: off');
  const tl0 = [0, 0, 0, 0, 0].map((e) => clean({ escapes: e }));
  ok(st(tl0).stages.their_last_move === 'asking', 'their_last_move escapes [0,0,0,0,0], no record: asking');
  const tlPos = [1, 1, 1, 1, 1].map((e) => clean({ escapes: e }));
  eq(history(tlPos).map((x) => x.their_last_move), ['asking', 'quiet', 'quiet', 'quiet', 'off'], 'escapes are positive evidence: off with no record ever');
  // free: gifts offered and taken
  const g = (o, t) => ({ offered: o, taken: t });
  const fr = (gifts) => [game({ gifts: g(1, 1), holds: [rec('free')] }), ...gifts.map((x) => clean({ gifts: g(x, x) }))];
  ok(st(fr([1, 1, 1, 1, 1])).stages.free === 'off', 'free gifts [1,1,1,1,1] taken the same: off');
  ok(st([game({ holds: [rec('free')] }), ...[0, 0, 0, 0, 0].map(() => clean())]).stages.free === 'asking', 'free gifts [0,0,0,0,0]: asking');
  ok(st([game({ holds: [rec('free')] }), ...[1, 2, 3, 4, 5].map(() => clean({ gifts: g(2, 0) }))]).stages.free === 'asking', 'free: gifts walked past keep the floor shut');
  ok(st([game({ holds: [rec('free')] }), ...[1, 2, 3, 4, 5].map(() => clean({ gifts: g(1, 0) }))]).stages.free === 'asking', 'free: taken >= offered - 1 over the window');
  const freeOff = fr([1, 1, 1, 1, 1]);
  ok(P.plan(st(freeOff)).giftRate === 0.08, 'free off: giftRate 0.08');
  const walked = st([...freeOff, game({ observed: 22, holds: [rec('free', { outcome: 'landed', why: 'hand' })] })]);
  ok(walked.stages.free === 'quiet' && look(walked, 'free').woken, 'one walked-past gift at off: one free record, quiet woken, not asking');
  ok(P.plan(walked).giftRate === 0.12, 'a woken free returns the notch to 0.12');
  // guards: history, and the prerequisite
  const gd = [1, 2, 3, 4, 5, 6].map(() => clean({ escapes: 1 }));
  const hg = history(gd);
  ok(hg.slice(0, 4).every((x) => x.guards === 'asking') && hg[4].guards === 'quiet' && hg[5].guards === 'quiet', `guards never fired: ${hg.map((x) => x.guards)}`);
  ok(st(gd).stages.guards === 'quiet', 'guards: six clean counted games with no record ever: quiet, not off');
  let shownG = null;
  gd.forEach((_, i) => {
    const s = st(gd.slice(0, i + 1));
    ok(!P.plan(s, null, shownG).transitions.some((t) => t.look === 'guards' && t.kind === 'OFF'), `guards: no OFF transition at game ${i + 1}`);
    shownG = s.stages;
  });
  ok(look(st(gd.slice(0, 2)), 'guards').state === 'not_yet' && look(st(gd.slice(0, 3)), 'guards').state !== 'not_yet', 'guards leaves not_yet at three counted games');
  const gd7 = [game({ escapes: 1, holds: [rec('guards')] }), ...[1, 2, 3, 4, 5, 6].map(() => clean({ escapes: 1 }))];
  ok(st(gd7).stages.guards === 'off', 'guards: seven counted games with one record first: off');
  const gdNoPre = [game({ holds: [rec('guards')] }), ...[1, 2, 3, 4, 5, 6].map(() => clean())];
  ok(st(gdNoPre).stages.guards === 'asking' && st(gdNoPre).stages.their_last_move === 'asking', 'guards waits on their_last_move');
});

section('mates', () => {
  const scholars = [game({ result: 'mate-loss', observed: 3, holds: [rec('mates', { outcome: 'ended' })] })];
  const s = st(scholars);
  const m = look(s, 'mates');
  ok(m.word === 'back' && m.state === 'always' && m.stage === 'asking', 'a Scholar\'s loss (observed 3) sets the word back');
  ok(s.current !== 'mates', 'mates never current');
  const quietM = st([game({ holds: [rec('mates')] }), clean(), clean(), clean(), clean(), clean()]);
  ok(look(quietM, 'mates').word === 'quiet', 'mates: five clean counted games after a record: quiet');
  ok(P.words(quietM).rows.find((r) => r.id === 'mates').caption === COPY.PATH.CAPTION.MATES_QUIET, 'mates quiet caption');
  ok(look(st([1, 2, 3, 4, 5].map(() => clean({ result: 'mate-win' }))), 'mates').word === 'asking', 'mate-wins are evidence of nothing');
  ok(look(st([game({ holds: [rec('mates')] }), clean(), clean(), clean(), clean()]), 'mates').word === 'asking', 'mates: four clean games are not five');
  ok(look(st([game({ holds: [rec('mates')] }), clean(), clean(), clean(), clean(), clean(), game({ again: true })]), 'mates').word === 'quiet', 'an again game does not read back');
  const p = P.plan(s);
  ok(p.hand.allowed_mate === 'full' && p.hand.missed_mate === 'full' && p.hand.allowed_stalemate === 'full', 'mates hand full');
  for (const v of [{ category: 'allowed_mate' }, { category: 'missed_mate' }, { category: 'allowed_stalemate' }]) {
    ok(C.handLevel(C.handAll('off'), v) === 'full', `handLevel never fades ${v.category}`);
  }
});

section('current and the tie-break', () => {
  const cur = (holds) => st([game({ holds })]);
  ok(cur([rec('pawns'), rec('free'), rec('free', { ply: 30 })]).current === 'free', 'free with more records in the window is current');
  ok(cur([rec('pawns', { netLoss: 2 }), rec('free', { netLoss: 3 })]).current === 'free', 'equal records: the larger netLoss3');
  const tie = cur([rec('pawns', { netLoss: 3 }), rec('free', { netLoss: 3 })]);
  ok(tie.current === 'pawns', 'a full tie goes to pawns');
  eq(tie.tied, ['pawns', 'free'], 'tied lists both');
  ok(P.plan(tie).focus === 'pawns', 'focus falls to the first tied look');
  const pawnsMore = cur([rec('pawns'), rec('pawns', { ply: 30 }), rec('free')]);
  ok(pawnsMore.current === 'pawns' && pawnsMore.tied.length === 0, 'pawns with more records: current, no tie');
  // the first look at asking, past the pawns
  const s = st([game({ holds: [rec('pawns')] }), clean(), clean(), clean(), clean(), clean()]);
  ok(s.current === 'takes_back', `pawns off, takers capped quiet: current takes_back (${s.current})`);
  // every look off: current null
  const all = [game({ captures: 1, escapes: 1, gifts: { offered: 1, taken: 1 }, holds: PATH.MATERIAL_LOOKS.map((id) => rec(id)) }),
    ...[1, 2, 3, 4, 5].map(() => clean({ captures: 1, escapes: 1, gifts: { offered: 1, taken: 1 } }))];
  const sa = st(all);
  eq(sa.stages, Object.fromEntries(PATH.MATERIAL_LOOKS.map((id) => [id, 'off'])), 'every material look off');
  ok(sa.current === null, 'every look off: current null');
  const pa = P.plan(sa);
  ok(pa.line.endsWith(COPY.PATH.NOTHING_LEFT), `nothing left line: ${pa.line}`);
  ok(pa.where === COPY.PATH.WHERE.ALL_OFF && pa.closeLine === COPY.PATH.CLOSE.NOTHING_LEFT, 'nothing left: where and close');
  ok(pa.giftRate === 0.08 && Object.keys(pa.question).length === 0 && pa.askFirst === null, 'nothing left: notch, no question, no ask');
  // the hand comes off one announced look at a time: unsaid, only the announced look is off (P2)
  eq(pa.announce, { kind: 'OFF', look: 'pawns' }, 'every look off, nothing said: pawns announced first');
  eq(pa.hand, { ...C.handAll('bare'), hanging_after_move: { pawn: 'off', piece: 'bare', takes_back: 'bare' } }, 'every look off, nothing said: the unsaid looks hold bare');
  const allSaid = PATH.MATERIAL_LOOKS.map((id) => `off:${id}`);
  const pz = P.plan(sa, null, null, allSaid);
  eq(pz.hand, C.handAll('off'), 'every look off and said: the hand off, mates full');
  ok(pz.line === COPY.PATH.NOTHING_LEFT && pz.announce === null, `every look off and said: the line is nothing left alone (${pz.line})`);
  const pr = P.plan(st(all, nowOf(all) + 15 * DAY));
  eq(pr.hand, C.handAll('bare'), 'every look off under review: the bare hand');
  // capped quiet looks only: current null
  const capped = st([clean(), clean(), clean(), clean(), clean(), clean()].map((g) => ({ ...g, captures: 1 })));
  ok(PATH.MATERIAL_LOOKS.every((id) => capped.stages[id] !== 'off'), 'nothing fired: nothing off');
});

section('review: fourteen days', () => {
  const offLog = [game({ holds: [rec('pawns')] }), clean(), clean(), clean(), clean(), clean()];
  const newest = Date.parse(offLog[offLog.length - 1].date);
  const s = st(offLog, newest + 15 * DAY);
  ok(s.review === true, 'a fifteen-day gap: review');
  const p = P.plan(s);
  ok(p.hand.hanging_after_move.pawn === 'bare', 'review: an off look reads bare');
  ok(p.announce.kind === 'REVIEW' && p.line.startsWith(COPY.PATH.TRANSITION.REVIEW) && p.line.includes('a while'), `review line: ${p.line}`);
  ok(st(offLog, newest + 13 * DAY).review === false, 'thirteen days: no review');
  const again = game({ again: true, date: new Date(newest + 14 * DAY).toISOString() });
  const s2 = P.compute(digestOf([...offLog, again]), newest + 15 * DAY);
  ok(s2.review === false, 'an again game dated yesterday: no review');
  ok(P.plan(s2).hand.hanging_after_move.pawn === 'off', 'no review: off stays off');
  ok(s2.newest.id === again.id && s2.newestReal.id === offLog[5].id, 'newest of any kind vs newest real');
});

// ---------------------------------------------------------------------------------------------
// Determinism, trim invariance, merge silence
// ---------------------------------------------------------------------------------------------
section('determinism and totality', () => {
  const log = [game({ holds: [rec('pawns'), rec('free')] }), clean({ escapes: 1 }), game({ observed: 6, holds: [rec('takers', { outcome: 'landed' })] }), clean(), clean({ captures: 2 })];
  const d = digestOf(log);
  const now = nowOf(log);
  eq(P.compute(d, now), P.compute(d, now), 'the same digest twice is deep-equal');
  eq(P.compute([...d].reverse(), now), P.compute(d, now), 'line order does not matter');
  eq(P.compute(JSON.parse(JSON.stringify(d)), now), P.compute(d, now), 'a JSON round trip of the digest changes nothing');
  eq(P.plan(P.compute(d, now)), P.plan(P.compute(d, now)), 'the same state plans the same');
  const junk = [null, 1, 'x', [], {}, { id: 'a', date: 'not a date', looks: {} }, { id: 'b', date: new Date(EPOCH).toISOString(), looks: null }, { date: new Date(EPOCH).toISOString(), looks: {} }];
  eq(P.compute(junk, EPOCH).stages, ALL_ASKING, 'malformed lines are skipped');
  eq(P.compute([...junk, ...d], now).stages, P.compute(d, now).stages, 'malformed lines beside good ones are skipped');
  eq(P.compute(null, EPOCH).stages, ALL_ASKING, 'compute(null)');
  ok(P.plan(null).current === 'pawns' && P.words(null).rows.length === 2, 'plan and words are total');
  ok(P.nodeOf(null) === null && P.nodeOf({}) === null && P.nodeOf({ category: 'nothing' }) === null, 'nodeOf is total');
  ok(P.nodeOf({ category: 'ignored_attack', sub: null }) === null, 'an ignored_attack with no sub is no look');
  ok(P.norm(null).v === 2 && Array.isArray(P.norm(undefined).holds), 'norm is total');
  ok(isDeepStrictEqual(P.digestOf(null).looks, {}), 'digestOf is total');
  ok(P.stillOf(null, 'pawns') === null && P.stillOf([{}], 'pawns') === null, 'stillOf is total');
  ok(P.countWord(NaN) === 'zero' && P.countWord(undefined) === 'zero' && P.countWord(0) === 'zero', 'countWord: non-finite is zero');
  ok(P.countWord(1) === 'one' && P.countWord(12) === 'twelve' && P.countWord(13) === COPY.PATH.MANY && P.countWord(400) === 'many', 'countWord words and many');
});

section('trim invariance', () => {
  const log = [];
  for (let i = 0; i < 13; i += 1) {
    const holds = i === 0 ? [rec('pawns'), rec('takes_back')] : i === 4 ? [rec('free')] : i === 9 ? [rec('takers', { outcome: 'back', taps: RIGHT })] : [];
    log.push(game({ captures: 1, escapes: i % 2, gifts: { offered: 1, taken: 1 }, holds }));
  }
  // the digest was appended game by game; the summaries are trimmed to twelve
  const digest = digestOf(log);
  const trimmed = log.slice(1);
  ok(trimmed.length === C.KEEP.GAMES, 'twelve summaries kept');
  const now = nowOf(log);
  const s = P.compute(digest, now);
  const sTrim = P.compute(digest, now);
  eq(sTrim.stages, s.stages, 'the 13-game log and its trimmed twin give identical stages');
  eq(P.plan(sTrim, null, null, [], trimmed).hand, P.plan(s, null, null, [], log).hand, 'and the same hand');
  eq(P.plan(sTrim, null, null, [], trimmed).line, P.plan(s, null, null, [], log).line, 'and the same opening line');
  const rebuilt = P.compute(digestOf(trimmed), now);
  ok(true, `(a digest rebuilt from the twelve summaries would read pawns ${rebuilt.stages.pawns} against ${s.stages.pawns}: the kept digest is what counts)`);
});

section('merge silence', () => {
  const log = [game({ holds: [rec('pawns')] }), clean(), clean(), game({ observed: 9, result: 'resign', holds: [rec('free')] }), clean(), clean(), clean(), clean()];
  const a = P.compute(digestOf(log), nowOf(log));
  // another device's older game merged in: game.js resets shown to the merged stages silently
  const older = game({ date: new Date(EPOCH - 3 * DAY).toISOString(), holds: [rec('their_last_move')] });
  const merged = [older, ...log];
  const b = P.compute(digestOf(merged), nowOf(merged));
  eq(P.plan(b, null, b.stages).transitions, [], 'transitions over a merged log are empty when shown is the merged stages');
  // the off looks this device has already announced are in said (said is union-merged)
  // (the inserted older game turns their_last_move off here: no device has said that one, so it
  // is announced, as below; ARCHITECTURE.md 8.11)
  const saidOff = PATH.MATERIAL_LOOKS.filter((id) => b.stages[id] === 'off').map((id) => `off:${id}`);
  const ab = P.plan(b, null, b.stages, saidOff);
  ok(ab.announce === null || ab.announce.kind === 'NOT_COUNTED', `a merge announces no stage change (${JSON.stringify(ab.announce)})`);
  // an off look neither device has announced is still said once, before the hand comes off (P2)
  const unsaid = P.plan(b, null, b.stages, []);
  ok(b.stages.pawns === 'off' && unsaid.announce && unsaid.announce.kind === 'OFF' && unsaid.announce.look === 'pawns' && unsaid.hand.hanging_after_move.pawn === 'off', `an unsaid off look is announced after a merge too (${JSON.stringify(unsaid.announce)})`);
  eq(P.plan(a, null, a.stages).transitions, [], 'shown equal to the stages: no transitions');
  // a shown that is empty falls back to before
  eq(P.plan(a, null, {}).transitions, P.plan(a, null, null).transitions, 'an empty shown reads as absent');
});

// ---------------------------------------------------------------------------------------------
// nodeOf over the recorded data, norm and the v1 twin
// ---------------------------------------------------------------------------------------------
const TABLE = {
  italian_d6: { 'Nxe5': 'pawns', 'Bxf7+': 'takes_back' },
  queen_hang: { 'Qxe5+': 'takes_back', 'Qxf7+': 'takes_back' },
  tutorial: { 'Bxf7+': 'takes_back', 'Nxe5': 'takes_back', 'Be6': 'pawns' },
  ruy_a6: { 'O-O': 'their_last_move', 'Ng5': 'their_last_move' },
  nc4_rook: { 'Nc4': 'guards', 'Nb3': 'guards' },
  italian_bg5: { 'Nh4': 'guards' },
  italian_nxe4: { 'Nc3': 'free' },
  placement_oo: { 'Nbd2': 'free' },
  italian_ng4: { 'O-O': 'free' },
  f3_e5: { 'g4': 'mates' },
  two_mates: { 'Qc7': 'mates' },
  scholars_white: { 'Qh3': 'mates' },
  kq_stalemate: { 'Qf7': 'mates' },
};
const TUTORIAL_TABLE = { 'Nd4': 'pawns', 'Ba6': 'pawns', 'Be6': 'pawns', 'Bxf7+': 'takes_back', 'Nxe5': 'takes_back' };
function recordFrom(fen, san, row) {
  const mv = new Chess(fen).move(san);
  return { fen, san, category: row.category, sub: row.sub ?? null, best: row.answer ? row.answer.best : null, to: mv.to, piece: mv.piece, outcome: 'anyway', taps: [], netLoss: 2, ply: 13 };
}

section('nodeOf table', () => {
  let held = 0;
  for (const pos of positions) {
    for (const [san, row] of Object.entries(pos.moves)) {
      if (row.expect !== 'held') {
        if (!row.category) ok(P.nodeOf({ fen: pos.fen, san, category: null }) === null, `${pos.id} ${san}: no look`);
        continue;
      }
      held += 1;
      const want = TABLE[pos.id] && TABLE[pos.id][san];
      ok(want, `${pos.id} ${san} is in the table`);
      const r = recordFrom(pos.fen, san, row);
      const n = P.norm({ v: 2, holds: [r] }).holds[0];
      ok(typeof n.pawnAmongTakers === 'boolean', `${pos.id} ${san}: pawnAmongTakers derived`);
      ok(P.nodeOf(n) === want, `${pos.id} ${san}: ${P.nodeOf(n)} (want ${want})`);
      ok(P.nodeOf(r) === want, `${pos.id} ${san}: nodeOf normalises a record without the split`);
    }
  }
  ok(held === Object.values(TABLE).reduce((t, m) => t + Object.keys(m).length, 0), `every table row is a recorded hold (${held})`);
  let tut = 0;
  for (const [san, row] of Object.entries(tutorial.moves)) {
    if (!row.held) continue;
    tut += 1;
    const want = TUTORIAL_TABLE[san];
    const r = recordFrom(tutorial.fen, san, row);
    // (a v2-shaped game: a v1 game's record at the tutorial position is the tutorial dare and is
    // dropped by norm, below)
    const n = P.norm({ v: 2, holds: [r] }).holds[0];
    ok(P.nodeOf(n) === want, `tutorial ${san}: ${P.nodeOf(n)} (want ${want})`);
    ok(n.pawnAmongTakers === row.pawnAmongTakers, `tutorial ${san}: the derived split matches the recorded one`);
    ok(n.variant === row.variant, `tutorial ${san}: the derived variant matches the recorded one`);
    ok(P.nodeOf({ ...r, pawnAmongTakers: row.pawnAmongTakers, variant: row.variant }) === want, `tutorial ${san}: from the recorded split`);
  }
  ok(tut === Object.keys(TUTORIAL_TABLE).length, 'every tutorial hold is in the table');
  // the split is first: a capture with a pawn among the takers is pawns
  ok(P.nodeOf({ category: 'hanging_after_move', variant: 'takes_back', pawnAmongTakers: true }) === 'pawns', 'pawnAmongTakers first');
  ok(P.nodeOf({ category: 'hanging_after_move', variant: null, pawnAmongTakers: false }) === 'takers', 'takers');
  ok(P.nodeOf({ category: 'ignored_attack', sub: 'lost_guard', pawnAmongTakers: false }) === 'guards', 'lost_guard is guards (synthetic only)');
  ok(P.nodeOf({ category: 'missed_mate', pawnAmongTakers: false }) === 'mates' && P.nodeOf({ category: 'allowed_stalemate', pawnAmongTakers: false }) === 'mates', 'the mate categories');
  // nodeOf and contract.handLevel name the same slot
  const hand = C.handAll('full');
  for (const id of PATH.MATERIAL_LOOKS) {
    const h = JSON.parse(JSON.stringify(hand));
    const v = KIND[id];
    if (id === 'pawns') h.hanging_after_move.pawn = 'off';
    if (id === 'takers') h.hanging_after_move.piece = 'off';
    if (id === 'takes_back') h.hanging_after_move.takes_back = 'off';
    if (id === 'their_last_move') h.ignored_attack.already = 'off';
    if (id === 'free') h.free_piece_ignored = 'off';
    if (id === 'guards') { h.ignored_attack.lost_guard = 'off'; h.ignored_attack.opened_line = 'off'; }
    ok(C.handLevel(h, v) === 'off', `the ${id} slot`);
    for (const other of PATH.MATERIAL_LOOKS) if (other !== id) ok(C.handLevel(h, KIND[other]) === 'full', `the ${id} slot leaves ${other}`);
  }
});

// The MVP's v1 summaries: no v, no observed, holds without the split.
function v1Game(i, holds) {
  const id = 'v1g' + i;
  return {
    id, date: new Date(EPOCH - (10 - i) * DAY).toISOString(), result: 'giveup', givenAway: holds.length, holds: holds.map((h) => ({ ...h, gameId: id })),
    freeTaken: 0, playedAnyway: holds.filter((h) => h.outcome === 'anyway').length, plies: 44, backs: holds.filter((h) => h.outcome === 'back').length,
  };
}
const V1_NXE5 = { fen: D6, san: 'Nxe5', category: 'hanging_after_move', sub: null, taps: [{ square: 'd6', grade: 'right' }], outcome: 'back', coachShown: false, netLoss: 2, piece: 'n', to: 'e5', best: 'd6', ply: 13 };
const V1_BXF7 = { fen: D6, san: 'Bxf7+', category: 'hanging_after_move', sub: null, taps: [{ square: 'g8', grade: 'partial' }, { square: 'f8', grade: 'right' }], outcome: 'anyway', coachShown: false, netLoss: 2, piece: 'b', to: 'f7', best: 'f8', ply: 13 };

section('norm and the v1 twin', () => {
  const v1 = [v1Game(1, [V1_NXE5, V1_BXF7]), v1Game(2, []), v1Game(3, []), v1Game(4, [V1_NXE5]), v1Game(5, [])];
  const before = JSON.stringify(v1);
  const n = v1.map(P.norm);
  ok(JSON.stringify(v1) === before, 'norm never mutates');
  const h = n[0].holds;
  ok(P.nodeOf(h[0]) === 'pawns' && h[0].pawnAmongTakers === true && h[0].variant === 'takes_back', 'v1 Nxe5 (best d6): pawns');
  ok(P.nodeOf(h[1]) === 'takes_back' && h[1].pawnAmongTakers === false && h[1].variant === 'takes_back', 'v1 Bxf7+ (best f8): takes_back');
  ok(n[0].v === 2 && n[0].observed === 22 && n[0].captures === null && n[0].again === false && n[0].review === false, 'v1 summary fill');
  eq(n[0].rewards, [], 'v1: rewards []');
  eq(n[0].gifts, { offered: 0, taken: 0 }, 'v1: gifts zero');
  eq(n[0].hand, C.handAll('full'), 'v1: hand all full');
  ok(h.every((r) => r.taps.every((t) => t.ask === null) && r.said === null && r.answer === null && r.why === null && Array.isArray(r.refutation) && r.refutation.length === 0), 'v1 holds: ask, said, answer, why, refutation filled');
  ok(P.norm({ plies: 43 }).observed === 22, 'observed = ceil(plies / 2)');
  eq(n.map(P.norm), n, 'norm is idempotent');
  eq(n.map(P.digestOf), n.map(P.norm).map(P.digestOf), 'digestOf is idempotent on a normalised summary');
  eq(v1.map(P.digestOf), n.map(P.digestOf), 'digestOf of a v1 summary equals digestOf of its twin');
  const now = EPOCH;
  eq(P.compute(v1.map(P.digestOf), now).stages, P.compute(n.map(P.digestOf), now).stages, 'a v1 games array and its normalised twin give the same stages');
  eq(P.compute(v1.map(P.digestOf), now), P.compute(n.map(P.digestOf), now), 'and the same state');
  ok(P.compute(v1.map(P.digestOf), now).stages.pawns === 'quiet', 'the v1 log reads pawns quiet (a weight-1 take-back in game four keeps quiet)');
  // a v2 summary is left as it is
  const v2 = game({ holds: [rec('pawns', { outcome: 'back', taps: RIGHT })], escapes: 1, gifts: { offered: 2, taken: 1 }, captures: 3 });
  eq(P.norm(v2), P.norm(P.norm(v2)), 'norm on v2 is idempotent');
  ok(P.norm(v2).captures === 3 && P.norm(v2).observed === 22 && P.norm(v2).holds[0].pawnAmongTakers === true, 'norm keeps the v2 fields');
  const dl = P.digestOf(v2);
  eq(Object.keys(dl).sort(), ['again', 'captures', 'date', 'escapes', 'gifts', 'id', 'looks', 'observed', 'result'], 'the digest line fields');
  ok(dl.escapes === 1 && dl.gifts.offered === 2 && dl.gifts.taken === 1 && dl.captures === 3, 'the digest line counters');
  ok(JSON.stringify(dl).length < 260, `a digest line is small (${JSON.stringify(dl).length} bytes)`);
  // P4: the MVP stored the tutorial dare whenever he took it back and played on; a v1 record at
  // the tutorial position is never a record of a look, so takes_back cannot go off on it
  const TUT = { fen: C.TUTORIAL_FEN, san: 'Bxf7+', category: 'hanging_after_move', sub: null, taps: [{ square: 'e8', grade: 'right' }], outcome: 'back', coachShown: false, netLoss: 2, piece: 'b', to: 'f7', best: 'e8', ply: 1 };
  const tutLog = [v1Game(1, [TUT]), v1Game(2, []), v1Game(3, []), v1Game(4, []), v1Game(5, [])];
  eq(P.norm(tutLog[0]).holds, [], 'v1: the tutorial dare is dropped by norm');
  eq(P.digestOf(tutLog[0]).looks, {}, 'v1: the tutorial dare is in no digest line');
  const tutV2 = [];
  for (let k = 0; k < 7; k += 1) tutV2.push(game({ captures: 2, gifts: { offered: 1, taken: 1 } }));
  const tutState = P.compute([...tutLog, ...tutV2].map(P.digestOf), nowOf(tutV2));
  ok(tutState.stages.takes_back !== 'off' && P.plan(tutState).hand.hanging_after_move.takes_back !== 'off', `v1 tutorial dare: takes_back never goes off on it (${tutState.stages.takes_back})`);
  ok(look(tutState, 'takes_back').everFired === false, 'v1 tutorial dare: takes_back never fired');
  // a v2 record at the tutorial position (a loaded position, an engine hold) is a record
  ok(P.norm({ v: 2, holds: [TUT] }).holds.length === 1, 'v2: a record at the tutorial position is kept');
  ok(P.norm({ v: 2, holds: [{ ...TUT, tutorial: true }] }).holds.length === 0, 'a record flagged tutorial is dropped');
  // a v1 hold is never a drill (no answer)
  const s = P.compute(n.map(P.digestOf), now);
  ok(P.plan(s, null, null, [], n).drill === null, 'a v1 hold is never offered as a drill');
});

// ---------------------------------------------------------------------------------------------
// The plan: the opening line, the countdown, the question, the close, the drill
// ---------------------------------------------------------------------------------------------
section('the opening line', () => {
  const g1 = game({ observed: 22, holds: [rec('pawns', { outcome: 'anyway' }), rec('pawns', { outcome: 'back', taps: RIGHT, ply: 25 })] });
  const s = st([g1]);
  const p = P.plan(s, null, null, [], [g1]);
  ok(s.current === 'pawns' && p.line.includes('pawns') && !/\d/.test(p.line), `the pawns line: ${p.line}`);
  ok(p.line === `${COPY.PATH.OPEN.pawns} ${fillN(COPY.PATH.COUNTDOWN.QUIET_MANY, 'Two')}`, `the pawns line with the countdown: ${p.line}`);
  const k3 = { gameId: g1.id, nodeId: 'pawns', promptVersion: 'v3', where: 'You keep landing where a pawn waits.', next: 'Find the pawn first.', again: null, question: 'Hold on. The pawn again. Which one reaches that square? Tap it.', askFirst: 'safe_square', focus: 'free' };
  const pk = P.plan(s, k3, null, [], [g1]);
  ok(pk.line === 'Find the pawn first.', `K3's next line replaces the template: ${pk.line}`);
  ok(pk.question.pawns === k3.question && pk.askFirst === 'safe_square' && pk.focus === 'free' && pk.k3 && pk.k3.gameId === g1.id, 'K3 question, ask and focus');
  ok(P.words(s, { k3, games: [g1] }).where === k3.where, 'K3 where on the view');
  const pf = P.plan(s, { ...k3, nodeId: 'free' }, null, [], [g1]);
  ok(pf.line === p.line && pf.question.pawns === COPY.PATH.QUESTION.pawns && pf.k3 === null && pf.askFirst === PATH.ASK_FIRST.pawns, 'K3 for another look: the templates');
  ok(P.plan(s, { ...k3, gameId: 'older' }).line === p.line, 'K3 for another game: the templates');
  ok(P.words(s, { k3: { ...k3, nodeId: 'free' } }).where === P.plan(s).where, 'K3 where for another look: the template');
  // a give-up at observed 6
  const g2 = game({ observed: 6 });
  const s2 = st([g1, g2]);
  const p2 = P.plan(s2);
  ok(p2.announce.kind === 'NOT_COUNTED' && p2.line.includes('do not count'), `not counted: ${p2.line}`);
  ok(!P.plan(s2, null, null, [`nc:${g2.id}`]).line.includes('do not count'), 'NOT_COUNTED once per game');
  // mate-loss with nothing to announce
  const ml = game({ result: 'mate-loss', observed: 22, holds: [rec('mates', { outcome: 'ended' })] });
  const pm = P.plan(st([ml]));
  // the mate-loss line replaces OPEN (PATHWAY 'The next rule', ARCHITECTURE.md 8.4)
  ok(pm.announce === null && pm.line === COPY.PATH.MATE_LOSS, `mate-loss line alone: ${pm.line}`);
  // P9: a four-move Scholar's loss (observed 3) is never 'early' from his chair: the mate line, not NOT_COUNTED
  const ms = game({ result: 'mate-loss', observed: 3, holds: [rec('mates', { outcome: 'ended' })] });
  const pms = P.plan(st([ms]));
  ok(pms.line === COPY.PATH.MATE_LOSS && pms.announce === null && !pms.line.includes('do not count'), `a short mate-loss says the mate line: ${pms.line}`);
  // a transition still outranks the mate line
  const msq = [game({ holds: [rec('pawns')] }), clean(), game({ result: 'mate-loss', observed: 22, holds: [rec('mates', { outcome: 'ended' })] })];
  const pmq = P.plan(st(msq));
  ok(pmq.announce && pmq.announce.kind === 'QUIET' && !pmq.line.includes(COPY.PATH.MATE_LOSS), `a transition outranks the mate line: ${pmq.line}`);
  // QUIET announced; transitions against shown
  const q = [game({ holds: [rec('pawns')] }), clean(), clean()];
  const pq = P.plan(st(q));
  ok(pq.announce.kind === 'QUIET' && pq.announce.look === 'pawns' && pq.line.startsWith(COPY.PATH.TRANSITION.QUIET.pawns), `quiet line: ${pq.line}`);
  ok(P.plan(st(q), null, st(q).stages).announce === null, 'shown equal to the stages: nothing to announce');
  // priority: REVIEW, WAKE, SLIP, OFF, QUIET; current first within a kind
  const base = [game({ holds: [rec('pawns'), rec('takers')] }), clean(), clean(), clean(), clean(), clean()];
  const both = st([...base, game({ holds: [rec('takers', { outcome: 'landed' })] , observed: 22 }), game({ observed: 22, holds: [rec('pawns', { outcome: 'landed' }), rec('pawns', { outcome: 'landed', ply: 30 })] })]);
  const pb = P.plan(both, null, st(base).stages);
  ok(pb.transitions.some((t) => t.kind === 'SLIP') && pb.transitions.some((t) => t.kind === 'WAKE'), 'a SLIP and a WAKE');
  ok(pb.announce.kind === 'WAKE' && pb.announce.look === 'pawns', 'WAKE before SLIP');
  const pr = P.plan(P.compute(digestOf([...base]), nowOf(base) + 20 * DAY), null, null);
  ok(pr.announce.kind === 'REVIEW', 'REVIEW first');
  const offs = P.plan(st(base));
  ok(offs.announce.kind === 'OFF' && offs.announce.look === 'pawns', 'OFF in ladder order');
  ok(P.plan(st(base), null, null, ['off:pawns']).announce.look === 'takers', 'the next unsaid OFF');
  ok(P.plan(st(base), null, null, ['off:pawns', 'off:takers']).announce === null, 'every OFF said: nothing');
});

// review2 P2 and P5: an OFF is never lost to another sentence, and a slip the hand spoke for is not
// called silent
section('the OFF line is never lost; a shown slip is not silent', () => {
  // (a) he comes back fifteen days after the game that took the pawns off: REVIEW takes the slot
  const offLog = [game({ holds: [rec('pawns')] }), clean(), clean(), clean(), clean()];
  const shownBefore = st(offLog).stages;
  const off5 = [...offLog, clean()];
  const later = nowOf(off5) + 15 * DAY;
  const sRev = P.compute(digestOf(off5), later);
  const pRev = P.plan(sRev, null, shownBefore, []);
  ok(sRev.stages.pawns === 'off' && pRev.announce.kind === 'REVIEW' && pRev.hand.hanging_after_move.pawn === 'bare', 'a: review game, pawns bare');
  const reviewGame = clean({ date: new Date(later).toISOString() });
  const after = [...off5, reviewGame];
  const pNext = P.plan(st(after), null, pRev.shownAfter, []);
  ok(pNext.announce && pNext.announce.kind === 'OFF' && pNext.announce.look === 'pawns', `a: the OFF comes the game after the review (${JSON.stringify(pNext.announce)})`);
  ok(pNext.line.includes('They are yours') && pNext.hand.hanging_after_move.pawn === 'off', `a: said, then off: ${pNext.line}`);
  ok(P.plan(st(after), null, pNext.shownAfter, ['off:pawns']).hand.hanging_after_move.pawn === 'off' && P.plan(st(after), null, pNext.shownAfter, ['off:pawns']).announce === null, 'a: said once');
  // (b) one game: pawns slips and free completes its off window; SLIP takes the slot
  const fb = [game({ gifts: { offered: 1, taken: 1 }, holds: [rec('pawns')] }), game({ gifts: { offered: 1, taken: 1 }, holds: [rec('free')] }),
    ...[1, 2, 3, 4].map(() => clean({ gifts: { offered: 1, taken: 1 } }))];
  const sb = st(fb);
  ok(sb.stages.pawns === 'off' && sb.stages.free === 'quiet', `b: before (${JSON.stringify(sb.stages)})`);
  const shownB = sb.stages;
  const slipGame = game({ gifts: { offered: 1, taken: 1 }, holds: [rec('pawns', { outcome: 'landed', why: 'hand' })] });
  const fb2 = [...fb, slipGame];
  const s8 = st(fb2);
  const p8 = P.plan(s8, null, shownB, ['off:pawns']);
  ok(s8.stages.free === 'off' && s8.stages.pawns === 'quiet', `b: free off, pawns woken (${JSON.stringify(s8.stages)})`);
  ok(p8.announce.kind === 'SLIP' && p8.announce.look === 'pawns' && p8.line.includes('said nothing'), `b: the SLIP is said: ${p8.line}`);
  ok(p8.hand.free_piece_ignored === 'bare', `b: free is not off before its OFF line is said (${p8.hand.free_piece_ignored})`);
  const fb3 = [...fb2, clean({ gifts: { offered: 1, taken: 1 } })];
  const p9 = P.plan(st(fb3), null, p8.shownAfter, ['off:pawns']);
  ok(p9.announce && p9.announce.kind === 'OFF' && p9.announce.look === 'free' && p9.hand.free_piece_ignored === 'off', `b: the free OFF the next game (${JSON.stringify(p9.announce)})`);
  // P5: in the review game he is held bare and answers right: the look stays off, nothing is announced as a slip
  const answered = game({ date: new Date(later).toISOString(), holds: [rec('pawns', { outcome: 'back', taps: RIGHT })] });
  const sAns = st([...off5, answered]);
  ok(sAns.stages.pawns === 'off' && look(sAns, 'pawns').woken === false, `P5: a right answer in the review game keeps pawns off (${sAns.stages.pawns})`);
  const pAns = P.plan(sAns, null, pRev.shownAfter, ['off:pawns']);
  ok(!pAns.line.includes('said nothing') && pAns.announce === null, `P5: no slip line after a right answer: ${pAns.line}`);
  // played anyway under the review's bare hold: woken, and the slip line does not say 'I said nothing'
  const anywayG = game({ date: new Date(later).toISOString(), holds: [rec('pawns', { outcome: 'anyway' })] });
  const sAny = st([...off5, anywayG]);
  const pAny = P.plan(sAny, null, pRev.shownAfter, ['off:pawns']);
  ok(sAny.stages.pawns === 'quiet' && pAny.announce.kind === 'SLIP' && pAny.line.startsWith(COPY.PATH.TRANSITION.SLIP_HELD.pawns), `P5: a shown slip says SLIP_HELD: ${pAny.line}`);
  ok(!pAny.line.includes('said nothing'), 'P5: never "I said nothing" when the hand spoke');
  // the review game offers gifts at the held rate for an off free look
  const freeOff = [game({ gifts: { offered: 1, taken: 1 }, holds: [rec('free')] }), ...[1, 2, 3, 4, 5].map(() => clean({ gifts: { offered: 1, taken: 1 } }))];
  ok(st(freeOff).stages.free === 'off' && P.plan(st(freeOff)).giftRate === PATH.GIFT_RATE.off, 'free off: the off notch');
  ok(P.plan(P.compute(digestOf(freeOff), nowOf(freeOff) + 15 * DAY)).giftRate === PATH.GIFT_RATE.on, 'free off under review: the held notch');
});

// review2 P13: K3's one question is used for guards only for the sub-case it was written about
// every opening line the plan can compose stays within the 28-word cap: one announcement and
// OPEN, or OPEN and its countdown
section('composed opening lines', () => {
  const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;
  const T = COPY.PATH.TRANSITION;
  const announces = [T.REVIEW, COPY.PATH.NOT_COUNTED];
  for (const kind of ['QUIET', 'OFF', 'SLIP', 'SLIP_HELD', 'WAKE']) announces.push(...Object.values(T[kind]));
  const C2 = COPY.PATH.COUNTDOWN;
  const countdowns = [C2.QUIET_ONE, C.fill(C2.QUIET_MANY, { n: 'Twelve' }), C2.OFF_ONE, C.fill(C2.OFF_MANY, { n: 'Twelve' }), ...Object.values(C2.FLOOR)];
  let worst = 0;
  for (const open of [...Object.values(COPY.PATH.OPEN), COPY.PATH.NOTHING_LEFT, COPY.PATH.MATE_LOSS]) {
    for (const a of announces) worst = Math.max(worst, words(`${a} ${open}`));
    for (const c of countdowns) worst = Math.max(worst, words(`${open} ${c}`));
  }
  ok(worst <= 28, `the longest composed opening line is ${worst} words`);
  // and the plan composes them that way: an announcement drops the countdown
  const nc = P.plan(st([game({ holds: [rec('pawns')] }), game({ observed: 6 })]));
  ok(nc.announce.kind === 'NOT_COUNTED' && nc.line === `${COPY.PATH.NOT_COUNTED} ${COPY.PATH.OPEN.pawns}`, `NOT_COUNTED then OPEN alone: ${nc.line}`);
});

section('the guards question from K3', () => {
  const gl = [game({ captures: 1, escapes: 1, gifts: { offered: 1, taken: 1 }, holds: PATH.MATERIAL_LOOKS.filter((id) => id !== 'guards').map((id) => rec(id)) }),
    ...[1, 2, 3, 4, 5].map(() => clean({ captures: 1, escapes: 1, gifts: { offered: 1, taken: 1 } })),
    game({ captures: 1, escapes: 1, gifts: { offered: 1, taken: 1 }, holds: [rec('guards'), rec('guards', { ply: 30 })] })];
  const sg = st(gl);
  ok(sg.current === 'guards', 'guards current');
  const q = 'Hold on. The piece you are moving was guarding something. Tap it.';
  const k3 = { gameId: sg.newestReal.id, nodeId: 'guards', promptVersion: 'v3', where: null, next: null, again: null, question: q, askFirst: null, focus: null, slot: 'guards_lost_guard' };
  const p = P.plan(sg, k3);
  ok(p.question.guards_lost_guard === q && p.question.guards_opened_line === COPY.PATH.QUESTION.guards_opened_line, 'K3 question on its own sub-case only');
  const pNone = P.plan(sg, { ...k3, slot: undefined });
  ok(pNone.question.guards_lost_guard === COPY.PATH.QUESTION.guards_lost_guard && pNone.question.guards_opened_line === COPY.PATH.QUESTION.guards_opened_line, 'K3 without a sub-case: the templates for guards');
  const pawnsK3 = P.plan(st([game({ holds: [rec('pawns')] })]), { gameId: null, nodeId: 'pawns', question: 'Hold on. The pawn again. Which one reaches that square? Tap it.' });
  ok(pawnsK3.question.pawns === COPY.PATH.QUESTION.pawns, '(a k3 of another game is not used)');
});

function fillN(t, n) {
  return C.fill(t, { n });
}

section('the countdown is honest', () => {
  // at every step of a record-then-clean log the countdown names the games to the next stage
  const log = [game({ holds: [rec('pawns')] })];
  for (let k = 0; k < 6; k += 1) {
    const s = st(log);
    if (s.current !== 'pawns') break;
    const p = P.plan(s);
    const m = p.countdown && p.countdown.match(/^(One|Two|Three|Four|Five) more clean game/);
    ok(m, `a countdown at step ${k}: ${p.countdown}`);
    const n = ['One', 'Two', 'Three', 'Four', 'Five'].indexOf(m[1]) + 1;
    const stage = s.stages.pawns;
    const more = [...log];
    for (let i = 1; i < n; i += 1) more.push(clean());
    ok(st(more).stages.pawns === stage, `step ${k}: still ${stage} one game short`);
    more.push(clean());
    ok(st(more).stages.pawns !== stage, `step ${k}: the stage moves after ${n}`);
    log.push(clean());
  }
  ok(P.plan(st([clean()])).countdown === COPY.PATH.COUNTDOWN.QUIET_ONE, 'one clean game: one more');
  // a floor that does not hold: its sentence
  const tbLog = [game({ holds: [rec('pawns')] }), clean(), clean(), clean(), clean(), clean()];
  const ptb = P.plan(st(tbLog));
  ok(ptb.current === 'takes_back' && ptb.countdown === COPY.PATH.COUNTDOWN.FLOOR.takes_back, `the takes_back floor: ${ptb.countdown}`);
  // a look whose floor cannot hold yet: its floor sentence
  const capped = st([clean({ captures: 1 }), clean({ captures: 1 }), clean({ captures: 1 }), clean({ captures: 1 })]);
  ok(capped.current === 'their_last_move' && P.plan(capped).countdown === COPY.PATH.COUNTDOWN.FLOOR.their_last_move, `their_last_move with nothing to answer: ${P.plan(capped).countdown}`);
});

section('the question, the close line, where, the drill', () => {
  // build a log where guards is current: pawns..free off or capped, guards asking
  const gl = [game({ captures: 1, escapes: 1, gifts: { offered: 1, taken: 1 }, holds: PATH.MATERIAL_LOOKS.filter((id) => id !== 'guards').map((id) => rec(id)) }),
    ...[1, 2, 3, 4, 5].map(() => clean({ captures: 1, escapes: 1, gifts: { offered: 1, taken: 1 } })),
    game({ captures: 1, escapes: 1, gifts: { offered: 1, taken: 1 }, holds: [rec('guards'), rec('guards', { sub: 'opened_line', ply: 30 })] })];
  const sg = st(gl);
  ok(sg.current === 'guards', `guards current (${sg.current})`);
  const pg = P.plan(sg);
  eq(Object.keys(pg.question).sort(), ['guards_lost_guard', 'guards_opened_line'], 'guards has two question slots');
  ok(pg.question.guards_opened_line === COPY.PATH.QUESTION.guards_opened_line, 'the opened_line question');
  // close lines
  const one = game({ holds: [rec('pawns', { outcome: 'back', taps: RIGHT })] });
  ok(P.plan(st([one]), null, null, [], [one]).closeLine === C.fill(COPY.PATH.CLOSE.ONE, { look: 'the pawns' }), 'close ONE');
  const allG = game({ holds: [rec('pawns'), rec('pawns', { ply: 30 })] });
  ok(P.plan(st([allG]), null, null, [], [allG]).closeLine === 'Two holds today, all on the pawns. That is what we are on.', 'close ALL');
  const someG = game({ holds: [rec('pawns'), rec('pawns', { ply: 30 }), rec('their_last_move')] });
  ok(P.plan(st([someG]), null, null, [], [someG]).closeLine === 'Three holds today, two on the pawns. That is what we are on.', 'close SOME');
  const otherG = game({ holds: [rec('mates')] });
  const otherG2 = game({ holds: [rec('mates'), rec('mates', { category: 'missed_mate', ply: 30 })] });
  ok(P.plan(st([otherG2]), null, null, [], [otherG2]).closeLine === 'Two holds today, none on the pawns. That is still what we are on.', 'close OTHER');
  ok(P.plan(st([otherG]), null, null, [], [otherG]).closeLine === 'One hold today, none on the pawns. That is still what we are on.', 'close OTHER with one hold (OTHER_ONE)');
  const none1 = game();
  ok(P.plan(st([none1]), null, null, [], [none1]).closeLine === COPY.PATH.CLOSE.NONE_FIRST, 'close NONE_FIRST on the only game');
  const none2 = game();
  const sNone = st([none1, none2]);
  ok(P.plan(sNone, null, null, [], [none1, none2]).closeLine === C.fill(COPY.PATH.CLOSE.NONE, { look: COPY.PATH.LOOK_WORDS[sNone.current] }), 'close NONE');
  const landedG = game({ holds: [rec('pawns', { outcome: 'landed', why: 'pair' })] });
  const pl = P.plan(st([landedG]), null, null, [], [landedG]);
  ok(pl.closeLine === COPY.PATH.CLOSE.LANDED_LET.pawns, `close LANDED_LET (pair): ${pl.closeLine}`);
  ok(P.plan(st([landedG])).closeLine === pl.closeLine, 'close LANDED_LET from the digest alone');
  // P8/P20: a piece the off hand let land names its own look, whatever is current
  const offBase = [game({ holds: [rec('pawns')] }), clean(), clean(), clean(), clean(), clean()];
  const slipG = game({ holds: [rec('pawns', { outcome: 'landed', why: 'hand' })] });
  const slipLog = [...offBase, slipG];
  const pSlip = P.plan(st(slipLog), null, st(offBase).stages, ['off:pawns'], slipLog);
  ok(pSlip.closeLine === COPY.PATH.CLOSE.LANDED.pawns, `close LANDED (hand) names the pawns: ${pSlip.closeLine}`);
  ok(P.plan(st(slipLog), null, st(offBase).stages, ['off:pawns']).closeLine === COPY.PATH.CLOSE.LANDED.pawns, 'close LANDED (hand) from the digest alone');
  // the wording is the look's own for free, their_last_move and guards (P8)
  for (const id of ['free', 'their_last_move', 'guards']) {
    const lg = game({ holds: [rec('pawns'), rec(id, { outcome: 'landed', why: 'quiet', ply: 30 })], observed: 13, result: 'mate-loss' });
    const ls = st([lg]);
    const line = P.closeLineFor({ ...ls, current: id }, { holds: lg.holds });
    ok(line === COPY.PATH.CLOSE.LANDED_LET[id], `close LANDED_LET for ${id}: ${line}`);
    ok(!/where (what|their)/.test(line), `no ungrammatical look words for ${id}`);
  }
  for (const id of PATH.MATERIAL_LOOKS) {
    ok(typeof COPY.PATH.CLOSE.LANDED[id] === 'string' && typeof COPY.PATH.CLOSE.LANDED_LET[id] === 'string' && typeof COPY.PATH.TRANSITION.SLIP_HELD[id] === 'string', `${id}: its own landed and slip lines`);
  }
  // P6: the card's line reads the holds the card lists (the tutorial's among them)
  const tutHold = { fen: C.TUTORIAL_FEN, san: 'Bxf7+', category: 'hanging_after_move', sub: null, variant: 'takes_back', pawnAmongTakers: false, outcome: 'back', taps: [{ square: 'e8', grade: 'right', ask: null }], tutorial: true, netLoss: 2, ply: 1 };
  const firstG = game({ holds: [] });
  const sFirst = st([firstG]);
  ok(P.plan(sFirst, null, null, [], [firstG]).closeLine === COPY.PATH.CLOSE.NONE_FIRST, 'the stored first game holds no record');
  const cardLine = P.closeLineFor(sFirst, { holds: [tutHold, { ...tutHold, ply: 3 }], stored: true });
  ok(cardLine === 'Two holds today, none on the pawns. That is still what we are on.', `the first card counts the tutorial holds it lists: ${cardLine}`);
  // P7: a game given up before any move was not stored: nothing of the previous game is 'today'
  const pawnsG = game({ holds: [rec('pawns')] });
  const unstored = P.closeLineFor(st([pawnsG]), { holds: [], stored: false });
  ok(unstored === C.fill(COPY.PATH.CLOSE.NONE, { look: 'the pawns' }), `an unstored game: close NONE (${unstored})`);
  ok(P.closeLineFor(P.compute([]), { holds: [], stored: false }) === COPY.PATH.CLOSE.NONE_FIRST, 'an unstored first game: NONE_FIRST');
  ok(P.closeLineFor(st([pawnsG]), { again: true }) === COPY.PATH.CLOSE.AGAIN, 'the card of an again game: AGAIN');
  const againG = game({ again: true, holds: [rec('pawns', { outcome: 'again' })] });
  const pa = P.plan(st([one, againG]), null, null, [], [one, againG]);
  ok(pa.closeLine === COPY.PATH.CLOSE.AGAIN && pa.drill === null, 'an again game: close AGAIN, no drill');
  // where
  ok(P.plan(st([one, none2])).where === COPY.PATH.WHERE.NONE_OFF, 'where NONE_OFF');
  const offLog = [game({ holds: [rec('pawns')] }), clean(), clean(), clean(), clean(), clean()];
  // the rows still held, mates among them
  ok(P.plan(st(offLog)).where === 'One of these is yours. I still hold six.', `where ONE_OFF: ${P.plan(st(offLog)).where}`);
  ok(P.plan(st(gl)).where === 'Five of these are yours. I still hold two.', `where SOME_OFF: ${P.plan(st(gl)).where}`);
  // FIRST is the first real game, not the first counted one
  const shortLog = [clean({ observed: 6 }), clean({ observed: 6 }), clean({ observed: 6 })];
  ok(P.plan(st(shortLog)).where !== COPY.PATH.WHERE.FIRST, 'three short games: not the first-game where line');
  ok(P.plan(st([clean({ observed: 6 })])).where === COPY.PATH.WHERE.FIRST, 'one short game: the first-game where line');
  // the drill
  const anyG = game({ holds: [rec('pawns', { outcome: 'back', taps: RIGHT, ply: 9 }), rec('pawns', { outcome: 'anyway', ply: 21 }), rec('takers', { outcome: 'anyway', ply: 31 })] });
  const pd = P.plan(st([anyG]), null, null, [], [anyG]);
  ok(pd.drill && pd.drill.record.ply === 21 && pd.drill.gameId === anyG.id && P.nodeOf(pd.drill.record) === 'pawns', 'the drill: the newest anyway record of current');
  ok(P.plan(st([anyG])).drill === null, 'no summaries: no drill');
  const backOnly = game({ holds: [rec('pawns', { outcome: 'back', taps: RIGHT })] });
  ok(P.plan(st([backOnly]), null, null, [], [backOnly]).drill === null, 'a game with only a take-back: no drill');
  // P15: the gate writes refutation [] for missed_mate and allowed_stalemate; both are drills
  const mateG = game({ holds: [rec('mates', { category: 'missed_mate', outcome: 'anyway', refutation: [] })] });
  ok(P.plan(st([mateG]), null, null, [], [mateG]).drill.record.category === 'missed_mate', 'a missed mate played anyway is a drill (no refutation)');
  const staleG = game({ holds: [rec('mates', { category: 'allowed_stalemate', outcome: 'anyway', refutation: [], fen: '7k/8/8/8/8/8/8/K4Q2 w - - 0 1', san: 'Qf7', to: 'f7', piece: 'q', best: 'h8', answer: { squares: ['h8'], best: 'h8', partial: [] } })] });
  ok(P.plan(st([staleG]), null, null, [], [staleG]).drill.record.category === 'allowed_stalemate', 'a stalemate played anyway is a drill (no refutation)');
  const amG = game({ holds: [rec('mates', { category: 'allowed_mate', outcome: 'anyway', refutation: [] })] });
  ok(P.plan(st([amG]), null, null, [], [amG]).drill === null, 'an allowed mate without its mating reply is no drill');
  // his worst moment: the larger loss before the later move
  const worstG = game({ holds: [rec('pawns', { outcome: 'anyway', netLoss: 3, ply: 11 }), rec('pawns', { outcome: 'anyway', netLoss: 2, ply: 31 })] });
  ok(P.plan(st([worstG]), null, null, [], [worstG]).drill.record.ply === 11, 'the drill is the larger loss');
  const noRef = game({ holds: [rec('pawns', { refutation: [] })] });
  ok(P.plan(st([noRef]), null, null, [], [noRef]).drill === null, 'a record without a refutation is no drill');
  ok(P.plan(st([anyG]), null, null, [], [game({ date: new Date(EPOCH).toISOString() })]).drill === null, 'only the newest real game\'s own summary gives a drill');
});

// ---------------------------------------------------------------------------------------------
// words: the face and the K3 facts, never a square, a move or a digit
// ---------------------------------------------------------------------------------------------
const SQUARE_RE = /\b[a-h][1-8]\b/;
const SAN_RE = /\b[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|\b[a-h]x[a-h][1-8]|\bO-O/;
function wordsClean(w, where) {
  const { said, ...facts } = w.facts;
  const text = JSON.stringify({ rows: w.rows, collapsed: w.collapsed, where: w.where, facts });
  ok(!/\d/.test(text), `${where}: no digit in ${text}`);
  ok(!SQUARE_RE.test(text.replace(/"[a-z_]+":/g, '')), `${where}: no square`);
  ok(!SAN_RE.test(text), `${where}: no move`);
}

section('words', () => {
  const g1 = game({ observed: 22, holds: [rec('pawns', { outcome: 'anyway', ply: 13 }), rec('pawns', { outcome: 'back', taps: RIGHT, ply: 25, said: 'im taking on e5 with Nxe5' })] });
  const s1 = st([g1]);
  const w1 = P.words(s1, { games: [g1], offeredAsks: ['what_takes_it', 'safe_square'], now: nowOf([g1]) });
  wordsClean(w1, 'first game');
  ok(w1.rows[0].id === 'pawns' && w1.rows[0].caption === 'This is where we are. Twice this game.', `first close card caption: ${w1.rows[0].caption}`);
  ok(w1.rows[0].sentence === COPY.PATH.SENTENCES.pawns, 'the sentence');
  ok(w1.collapsed === 'Five more, not come up yet.', 'collapsed after one game');
  eq(w1.facts.said, [{ look: 'pawns', text: 'im taking on e5 with Nxe5' }], 'the said text passes through as given');
  eq(w1.facts.game.holds.map((h) => [h.look, h.taker, h.outcome, h.firstTap, h.when]), [['pawns', 'pawn', 'anyway', 'none', 'early'], ['pawns', 'pawn', 'back', 'right', 'late']], 'this game\'s holds in words');
  ok(w1.facts.game.observed === 'twenty-two' || w1.facts.game.observed === C.COPY.PATH.MANY, `observed in words: ${w1.facts.game.observed}`);
  ok(w1.facts.current === 'pawns' && w1.facts.lastThree.startsWith('two holds') && w1.facts.lastThree.endsWith('one taken back'), `lastThree: ${w1.facts.lastThree}`);
  eq(w1.facts.asks, ['what_takes_it', 'safe_square'], 'asks passed through');
  eq(w1.facts.allowed.pawns, ['pawn'], 'allowed piece words from PATH.QUESTION_PIECES');
  eq(w1.facts.looks.map((l) => l.id), PATH.LOOKS, 'the seven looks with meanings');
  ok(w1.facts.looks.every((l) => l.meaning === COPY.PATH.MEANING[l.id]), 'meanings from COPY.PATH.MEANING');
  const drill = P.plan(s1, null, null, [], [g1]).drill;
  const wd = P.words(s1, { games: [g1], drill });
  ok(wd.facts.again.startsWith('your knight') && !/\d/.test(wd.facts.again), `the drill in piece words: ${wd.facts.again}`);
  ok(P.words(s1, { games: [g1] }).facts.again === 'none', 'no drill: none');
  ok(P.words(s1, { saidTexts: [{ look: 'pawns', text: 'x' }] }).facts.said.length === 1, 'saidTexts passed in are used');
  // the recent caption, ink, the off captions
  const three = [game({ holds: [rec('pawns')] }), game({ holds: [rec('pawns')] }), game({ holds: [rec('pawns')] })];
  ok(P.words(st(three)).rows[0].caption === 'This is where we are. Three times in the last three games.', `recent caption: ${P.words(st(three)).rows[0].caption}`);
  const offLog = [game({ holds: [rec('pawns')] }), clean(), clean(), clean(), clean(), clean()];
  const offAt = Date.parse(offLog[5].date);
  const so = st(offLog, offAt + 60 * 1000);
  const wo = P.words(so, { games: offLog, now: offAt + 60 * 1000 });
  wordsClean(wo, 'off log');
  const pawnsRow = wo.rows.find((r) => r.id === 'pawns');
  ok(pawnsRow.state === 'off' && pawnsRow.ink === 'ink' && pawnsRow.caption === 'Yours.', `off the same day: ${pawnsRow.caption}`);
  ok(/^Yours since (Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\.$/.test(P.words(so, { now: offAt + 3 * DAY }).rows.find((r) => r.id === 'pawns').caption), 'off within the week: Yours since a weekday');
  ok(P.words(so, { now: offAt + 10 * DAY }).rows.find((r) => r.id === 'pawns').caption === COPY.PATH.CAPTION.OFF_WHILE, 'off after a week: Yours for a while');
  ok(wo.rows.find((r) => r.id === 'takers').caption === COPY.PATH.CAPTION.QUIET && wo.rows.find((r) => r.id === 'takers').ink === 'coach', 'a quiet row');
  ok(wo.rows.find((r) => r.id === 'takes_back').state === 'current', 'takes_back current');
  eq(wo.facts.yours, ['pawns'], 'yours');
  const slip = st([...offLog, game({ observed: 6, holds: [rec('pawns', { outcome: 'landed' })] })]);
  const ws = P.words(slip, { transitions: P.plan(slip).transitions });
  ok(ws.rows.find((r) => r.id === 'pawns').caption === COPY.PATH.CAPTION.BACK, 'a woken row: Again, for now');
  eq(ws.facts.changed, [{ id: 'pawns', kind: 'SLIP' }], 'changed this game');
  // never a digit, a square or a move over many logs
  for (let i = 0; i < 40; i += 1) {
    const log = synthLog(lcg(1000 + i), 6 + (i % 7));
    const s = st(log);
    const p = P.plan(s, null, null, [], log);
    const w = P.words(s, { games: log, drill: p.drill, transitions: p.transitions, offeredAsks: C.ASK_KINDS });
    wordsClean(w, `synthetic log ${i}`);
    ok(w.rows.length <= 7 && w.rows.every((r) => r.state !== 'not_yet'), 'at most seven rows, no not_yet');
    ok(w.rows.filter((r) => r.state === 'current').length <= 1, 'at most one current row');
    ok(!p.line || (!/\d/.test(p.line) && !SQUARE_RE.test(p.line)), `the line has no digit: ${p.line}`);
    ok(!/\d/.test(p.closeLine) && !/\d/.test(p.where), 'close and where have no digit');
  }
});

section('stillOf', () => {
  const g1 = game({ holds: [rec('pawns', { ply: 13 }), rec('pawns', { ply: 21, san: 'Bxf7+', to: 'f7', piece: 'b', pawnAmongTakers: true })] });
  const g2 = game({ holds: [rec('free', { fen: positions.find((p) => p.id === 'italian_nxe4').fen, san: 'Nc3', to: 'c3' })] });
  const again = game({ again: true, holds: [rec('pawns', { outcome: 'again', ply: 40 })] });
  const still = P.stillOf([again, g2, g1], 'pawns');
  ok(still && still.record.ply === 21 && still.record.san === 'Bxf7+', 'the newest record of the look, across the newest non-again games');
  ok(still.chess.get('f7') && still.chess.get('f7').type === 'b' && still.chess.get('f7').color === 'w', 'the scratch position after the move');
  ok(Object.isFrozen(still) && Object.isFrozen(still.record), 'the still is frozen');
  const sf = P.stillOf([g1, g2], 'free');
  ok(sf && sf.record.san === 'Nc3' && sf.chess.get('c3').type === 'n', 'the free still');
  ok(P.stillOf([g1, g2], 'guards') === null, 'no record: null');
  ok(P.stillOf([game({ holds: [rec('pawns', { san: 'Qh5' })] })], 'pawns') === null, 'an illegal san: null');
  ok(P.stillOf([game({ holds: [rec('pawns', { outcome: 'again' })] })], 'pawns') === null, 'an again outcome is not a record');
});

// ---------------------------------------------------------------------------------------------
// COPY.PATH
// ---------------------------------------------------------------------------------------------
const chars = (...codes) => String.fromCharCode(...codes);
// the copy guard's words plus the pathway's own (char codes, so this file never spells them)
const EXTRA_BANNED = [
  chars(108, 101, 118, 101, 108), chars(109, 97, 115, 116, 101, 114, 101, 100), chars(112, 114, 111, 103, 114, 101, 115, 115),
  chars(120, 112), chars(99, 117, 114, 114, 105, 99, 117, 108, 117, 109), chars(108, 101, 115, 115, 111, 110),
  chars(98, 108, 117, 110, 100, 101, 114), chars(109, 105, 115, 116, 97, 107, 101), chars(105, 110, 97, 99, 99, 117, 114, 97, 99, 121),
  chars(115, 117, 98, 109, 105, 116), chars(97, 110, 97, 108, 121, 122, 101), chars(97, 99, 99, 117, 114, 97, 99, 121),
];
const EXTRA_RE = new RegExp('\\b(?:' + EXTRA_BANNED.join('|') + ')s?\\b', 'i');
function strings(obj, prefix, out = []) {
  if (typeof obj === 'string') out.push([prefix, obj]);
  else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) strings(v, `${prefix}.${k}`, out);
  return out;
}
function wc(text) {
  return validate && validate.wordCount ? validate.wordCount(text) : String(text).trim().split(/\s+/).filter(Boolean).length;
}

section('COPY.PATH', () => {
  const all = [...strings(COPY.PATH, 'COPY.PATH'), ['COPY.QUESTION.bare', COPY.QUESTION.bare]];
  ok(all.length > 80, `COPY.PATH strings (${all.length})`);
  for (const [where, text] of all) {
    ok(text.length > 0 && wc(text) <= 28, `${where}: ${wc(text)} words`);
    ok(!/\d/.test(text), `${where}: a digit`);
    ok(!EXTRA_RE.test(text), `${where}: a banned word`);
    ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text), `${where}: emoji`);
    ok(text[0] === text[0].toUpperCase() || /^\{/.test(text) || where.includes('LOOK_WORDS') || where.includes('MEANING') || where.endsWith('.MANY'), `${where}: sentence case`);
    if (validate) {
      const r = validate.templateRules(text);
      ok(r.ok, `${where}: templateRules: ${r.reason}`);
      const banned = validate.BANNED.some((b) => text.toLowerCase().includes(b.toLowerCase()));
      ok(!banned, `${where}: validate.BANNED`);
    }
  }
  for (const [id, s] of Object.entries(COPY.PATH.SENTENCES)) ok(s.length < 34, `sentence ${id} is ${s.length} characters`);
  eq(Object.keys(COPY.PATH.SENTENCES), PATH.LOOKS, 'one sentence per look in ladder order');
  for (const id of PATH.MATERIAL_LOOKS) {
    ok(COPY.PATH.OPEN[id] && COPY.PATH.TRANSITION.QUIET[id] && COPY.PATH.TRANSITION.OFF[id] && COPY.PATH.TRANSITION.SLIP[id] && COPY.PATH.TRANSITION.WAKE[id], `${id}: every line exists`);
  }
  for (const [slot, q] of Object.entries(COPY.PATH.QUESTION)) {
    ok(q.startsWith(C.CLAUDE.K3.QUESTION_START) && q.endsWith(C.CLAUDE.K3.QUESTION_END), `${slot}: the question shape`);
    ok(wc(q) <= C.CLAUDE.K3.QUESTION_MAX_WORDS, `${slot}: ${wc(q)} words`);
    const pieces = q.toLowerCase().match(/\b(pawn|knight|bishop|rook|queen|king)s?\b/g) || [];
    const look = slot.startsWith('guards') ? 'guards' : slot;
    ok(pieces.every((p) => PATH.QUESTION_PIECES[look].includes(p.replace(/s$/, ''))), `${slot}: piece words allowed`);
  }
  if (validate && typeof validate.validateK3 === 'function') {
    for (const [slot, q] of Object.entries(COPY.PATH.QUESTION)) {
      const nodeId = slot.startsWith('guards') ? 'guards' : slot;
      const ctx = { nodeId, allowedPieces: PATH.QUESTION_PIECES[nodeId] || [], offeredAsks: [], tied: [], allowedSquares: [], piecesOn: {}, allowedMoves: [] };
      const r = validate.validateK3({ where: null, next: null, again: '', question: q, ask_first: null, focus: null }, ctx);
      ok(r && !r.rejected.includes('question') && r.value.question === q, `${slot}: validateK3 accepts the question (${r && r.reasons && r.reasons.question})`);
    }
  } else {
    console.log('  (validateK3 not present yet: the K3 shape check of COPY.PATH.QUESTION is skipped)');
  }
});

// ---------------------------------------------------------------------------------------------
// The synthetic player: a seeded Poisson player at 0.5 holds per game over the material looks
// ---------------------------------------------------------------------------------------------
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function poisson(rand, mean) {
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  for (;;) {
    p *= rand();
    if (p <= L) return k;
    k += 1;
  }
}
// the player of the print: holds only (no gifts, escapes or captures), so a look can read off
// only on its own silence; extras = true adds gifts, escapes and captures for the words sweep
function synthLog(rand, n, observed = 24, extras = true) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const holds = [];
    const k = poisson(rand, 0.5);
    for (let j = 0; j < k; j += 1) {
      const id = PATH.MATERIAL_LOOKS[Math.floor(rand() * PATH.MATERIAL_LOOKS.length)];
      const back = rand() < 0.5;
      holds.push(rec(id, { outcome: back ? 'back' : 'anyway', taps: back ? RIGHT : [], ply: 8 + Math.floor(rand() * 40), sub: id === 'guards' && rand() < 0.5 ? 'opened_line' : KIND[id].sub }));
    }
    if (!extras) {
      out.push(game({ observed, holds }));
      continue;
    }
    const offered = poisson(rand, 1.6);
    out.push(game({ observed, holds, captures: poisson(rand, 2), escapes: poisson(rand, 0.6), gifts: { offered, taken: Math.max(0, offered - (rand() < 0.3 ? 1 : 0)) } }));
  }
  return out;
}

section('synthetic player', () => {
  const rand = lcg(20261013);
  const LOGS = 200;
  let offLogs = 0;
  let neverFiredOff = 0;
  const perLook = Object.fromEntries(PATH.MATERIAL_LOOKS.map((id) => [id, 0]));
  for (let i = 0; i < LOGS; i += 1) {
    const log = synthLog(rand, 12, 24, false);
    let anyOff = false;
    const offSeen = new Set();
    for (let k = 1; k <= log.length; k += 1) {
      const s = st(log.slice(0, k));
      const p = P.plan(s);
      ok(p.hand.allowed_mate === 'full' && p.hand.missed_mate === 'full' && p.hand.allowed_stalemate === 'full', 'mates never below full');
      ok(s.current !== 'mates', 'mates never current');
      for (const l of s.looks) {
        if (l.stage === 'off' && !l.everFired && !(s.positive[l.id])) neverFiredOff += 1;
      }
      for (const id of PATH.MATERIAL_LOOKS) if (s.stages[id] === 'off') { anyOff = true; offSeen.add(id); }
    }
    if (anyOff) offLogs += 1;
    for (const id of offSeen) perLook[id] += 1;
  }
  ok(neverFiredOff === 0, 'a look with no record and no positive evidence is never off');
  console.log(`  synthetic: ${offLogs} of ${LOGS} logs read off at some point (${(offLogs / LOGS).toFixed(2)})`);
  console.log(`  synthetic, per look: ${PATH.MATERIAL_LOOKS.map((id) => `${id} ${perLook[id]}`).join(', ')}`);
});

console.log(`all ${checks} checks passed`);
