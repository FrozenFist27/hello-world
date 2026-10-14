// path.js — the pathway's model: seven looks on a ladder, the hand per look, the digest and the
// game-major fold over it (product/PATHWAY.md 'The model' and 'The next rule'; ARCHITECTURE.md
// section 8). Pure: imports contract.js and chess.js only (chess.js for the v1 split and the
// still's scratch position); no DOM, no engine, no storage; the same digest always gives a
// deep-equal state. Every function is total: a malformed line or record is skipped, never
// thrown on. Every line of copy comes from COPY.PATH through fill(); nothing is worded here.

import { PATH, COPY, PIECE_WORDS, NUMBER_WORDS, ALWAYS_HOLD, TUTORIAL_FEN, fill, handAll } from './contract.js';
import { Chess } from '../vendor/chess.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DECISIVE = ['mate-win', 'mate-loss', 'resign'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EARLY_PLY = 20;
const SLOTS = { guards: ['guards_lost_guard', 'guards_opened_line'] };

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
function isObj(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}
function num(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function str(x) {
  return typeof x === 'string' ? x : '';
}
function cap(text) {
  const t = str(text);
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}
function deepFreeze(x) {
  if (!x || typeof x !== 'object' || Object.isFrozen(x)) return x;
  Object.freeze(x);
  for (const k of Object.keys(x)) deepFreeze(x[k]);
  return x;
}
function ladderIndex(id) {
  const i = PATH.LOOKS.indexOf(id);
  return i < 0 ? PATH.LOOKS.length : i;
}
// 'Once' | 'Twice' | 'Three times' (never a digit)
function timesWords(n) {
  if (n === 1) return COPY.TIMES[1];
  if (n === 2) return COPY.TIMES[2];
  return `${countWord(n)} times`;
}
function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ---------------------------------------------------------------------------------------------
// countWord: 'zero' .. 'twelve', then COPY.PATH.MANY
// ---------------------------------------------------------------------------------------------
export function countWord(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return NUMBER_WORDS[0];
  const i = Math.floor(v);
  return i <= PATH.MAX_COUNT_WORD && i < NUMBER_WORDS.length ? NUMBER_WORDS[i] : COPY.PATH.MANY;
}

// ---------------------------------------------------------------------------------------------
// Records: the split, the weight, the v1 fill
// ---------------------------------------------------------------------------------------------
// A black pawn among the attackers of the landing square once the move is made (chess.js).
function pawnAttacks(fen, san, to) {
  try {
    const chess = new Chess(fen);
    const mv = chess.move(san);
    if (!mv) return false;
    const square = str(to) || mv.to;
    return chess.attackers(square, 'b').some((sq) => {
      const p = chess.get(sq);
      return !!p && p.type === 'p' && p.color === 'b';
    });
  } catch (e) {
    return false;
  }
}

// A HoldRecord v2 from any stored record (v1 or v2). Returns a new object; idempotent.
function normRecord(rec) {
  const r = isObj(rec) ? rec : {};
  const san = str(r.san);
  const taps = (Array.isArray(r.taps) ? r.taps : []).filter(isObj).map((t) => ({
    square: t.square, grade: t.grade, ask: t.ask === undefined ? null : t.ask,
  }));
  const out = {
    ...r,
    san,
    taps,
    variant: r.variant === 'takes_back' || r.variant === null ? r.variant : san.includes('x') ? 'takes_back' : null,
    pawnAmongTakers: typeof r.pawnAmongTakers === 'boolean' ? r.pawnAmongTakers : pawnAttacks(r.fen, san, r.to),
    why: r.why === undefined ? null : r.why,
    said: r.said === undefined ? null : r.said,
    answer: r.answer === undefined ? null : r.answer,
    refutation: Array.isArray(r.refutation) ? r.refutation : [],
  };
  if (typeof out.answered !== 'boolean') out.answered = taps.some((t) => t.grade === 'right' || t.grade === 'partial');
  if (typeof out.coachShown !== 'boolean') out.coachShown = !!r.coachShown;
  return out;
}

// The look a record belongs to; null for a record of no look. pawnAmongTakers is the first split.
export function nodeOf(record) {
  if (!isObj(record) || typeof record.category !== 'string') return null;
  const r = typeof record.pawnAmongTakers === 'boolean' ? record : normRecord(record);
  switch (r.category) {
    case 'hanging_after_move':
      if (r.pawnAmongTakers) return 'pawns';
      return r.variant === 'takes_back' ? 'takes_back' : 'takers';
    case 'ignored_attack':
      if (r.sub === 'already') return 'their_last_move';
      if (r.sub === 'lost_guard' || r.sub === 'opened_line') return 'guards';
      return null;
    case 'free_piece_ignored':
      return 'free';
    default:
      return ALWAYS_HOLD.includes(r.category) ? 'mates' : null;
  }
}

// 1 when he took it back after a right or partial first tap (on whatever look graded it); else 2.
export function weight(record) {
  if (!isObj(record) || record.outcome !== 'back') return 2;
  const t = Array.isArray(record.taps) ? record.taps[0] : null;
  return isObj(t) && (t.grade === 'right' || t.grade === 'partial') ? 1 : 2;
}

// A tutorial hold is never a record of a look. A v2 summary never holds one (storeGame keeps them
// out), but the MVP's storeGame wrote every hold of the game, the tutorial dare included, whenever
// he took it back and played on: a v1 record at the tutorial position is that dare (the tutorial
// is the only time the page holds a move there, and the position cannot recur once he has moved).
function tutorialRecord(rec, v1) {
  return rec.tutorial === true || (v1 && rec.fen === TUTORIAL_FEN);
}

// A GameSummary v2 from a v1 or v2 summary. Returns a new object; idempotent; never mutates.
export function norm(game) {
  const g = isObj(game) ? game : {};
  const plies = num(g.plies);
  const v1 = g.v !== 2;
  const holds = (Array.isArray(g.holds) ? g.holds : []).filter(isObj).filter((h) => !tutorialRecord(h, v1)).map(normRecord);
  const gifts = isObj(g.gifts) ? { offered: num(g.gifts.offered), taken: num(g.gifts.taken) } : { offered: 0, taken: 0 };
  return {
    ...g,
    v: 2,
    id: g.id == null ? '' : String(g.id),
    date: str(g.date),
    result: str(g.result),
    givenAway: num(g.givenAway),
    holds,
    freeTaken: num(g.freeTaken),
    playedAnyway: num(g.playedAnyway),
    plies,
    backs: num(g.backs),
    observed: Number.isFinite(Number(g.observed)) && g.observed !== null ? Number(g.observed) : Math.ceil(plies / 2),
    captures: g.captures === undefined || g.captures === null ? null : num(g.captures),
    rewards: (Array.isArray(g.rewards) ? g.rewards : []).filter(isObj),
    gifts,
    again: !!g.again,
    hand: isObj(g.hand) ? g.hand : handAll('full'),
    review: !!g.review,
  };
}

// ---------------------------------------------------------------------------------------------
// The digest line and what counts
// ---------------------------------------------------------------------------------------------
export function digestOf(summary) {
  const g = norm(summary);
  const looks = {};
  for (const h of g.holds) {
    if (!PATH.RECORD_OUTCOMES.includes(h.outcome)) continue;
    const look = nodeOf(h);
    if (!look) continue;
    const e = looks[look] || (looks[look] = { n: 0, w: 0, netLoss: 0, landed: 0 });
    e.n += 1;
    e.w += weight(h);
    e.netLoss += num(h.netLoss);
    if (h.outcome === 'landed') e.landed += 1;
  }
  return {
    id: g.id, date: g.date, result: g.result, observed: g.observed, again: g.again, captures: g.captures,
    escapes: g.rewards.filter((r) => r.kind === 'escaped').length,
    gifts: { offered: g.gifts.offered, taken: g.gifts.taken },
    looks,
  };
}

export function counted(line) {
  if (!isObj(line) || line.again) return false;
  const observed = num(line.observed);
  return observed >= PATH.OBSERVED_MIN || (DECISIVE.includes(line.result) && observed >= PATH.OBSERVED_DECISIVE_MIN);
}

// ---------------------------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------------------------
function validLine(l) {
  return isObj(l) && l.id != null && Number.isFinite(Date.parse(l.date)) && isObj(l.looks);
}
function sortLines(digest) {
  const lines = (Array.isArray(digest) ? digest : []).filter(validLine).slice();
  lines.sort((a, b) => (Date.parse(a.date) - Date.parse(b.date)) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  return lines;
}
function entry(line, id) {
  const e = line.looks[id];
  return isObj(e) ? e : null;
}
function recs(line, id) {
  const e = entry(line, id);
  return e ? Math.max(0, num(e.n)) : 0;
}
function sum(lines, pick) {
  return lines.reduce((t, l) => t + num(pick(l)), 0);
}
function floorHolds(id, countedLines, s) {
  const win = countedLines.slice(-PATH.FLOOR_WINDOW);
  switch (id) {
    case 'takes_back': return sum(win, (l) => l.captures) >= PATH.CAPTURES_MIN;
    case 'their_last_move': return sum(win, (l) => l.escapes) >= PATH.ESCAPES_MIN || s.everFired;
    case 'free': {
      const offered = sum(win, (l) => l.gifts && l.gifts.offered);
      const taken = sum(win, (l) => l.gifts && l.gifts.taken);
      return offered >= PATH.GIFTS_MIN && taken >= offered - 1;
    }
    case 'guards': return countedLines.length >= PATH.GUARDS_HISTORY;
    default: return true; // pawns and takers: the counted game is the whole floor
  }
}
function windowClean(id, countedLines) {
  return countedLines.length >= PATH.OFF_WINDOW && countedLines.slice(-PATH.OFF_WINDOW).every((l) => recs(l, id) === 0);
}
function prereqOk(id, st) {
  const p = PATH.PREREQUISITE[id];
  if (!p || !st[p]) return true;
  return st[p].stage === 'quiet' || st[p].stage === 'off';
}

// The game-major fold over sorted lines: per look { stage, run, woken, everFired, since }.
function fold(lines) {
  const st = {};
  for (const id of PATH.MATERIAL_LOOKS) st[id] = { stage: 'asking', run: 0, woken: false, everFired: false, since: null };
  const positive = { free: false, their_last_move: false };
  const countedLines = [];
  const realLines = [];
  let matesEver = false;
  let realGames = 0;
  for (const line of lines) {
    if (line.again) continue;
    realGames += 1;
    realLines.push(line);
    if (line.gifts && num(line.gifts.taken) > 0) positive.free = true;
    if (num(line.escapes) > 0) positive.their_last_move = true;
    if (recs(line, 'mates') > 0) matesEver = true;
    const isCounted = counted(line);
    if (isCounted) countedLines.push(line);
    for (const id of PATH.MATERIAL_LOOKS) {
      const s = st[id];
      const n = recs(line, id);
      if (n > 0) {
        const e = entry(line, id);
        const w = Math.max(n, num(e && e.w));
        const was = s.stage;
        if (s.stage === 'off') {
          // one record he took back after a right first tap keeps the look off: a weight-1
          // record exists at off only when the hold was shown (the fourteen-day review's bare
          // hold, or a loss of five or more), and he answered it, which is what quiet does with
          // one too (ARCHITECTURE.md 8.11)
          const answered = n === 1 && !!e && e.w != null && Number.isFinite(Number(e.w)) && Number(e.w) === 1;
          if (!answered) {
            s.stage = n >= 2 ? 'asking' : 'quiet';
            s.woken = true;
          }
        } else if (s.stage === 'quiet' && (n >= 2 || w >= 2)) {
          s.stage = 'asking';
        }
        s.run = 0;
        s.everFired = true;
        if (s.stage !== was) s.since = line.date;
      } else if (isCounted) {
        s.run += 1;
        if (s.stage === 'asking') {
          if (s.run >= PATH.CLEAN_TO_QUIET && floorHolds(id, countedLines, s) && prereqOk(id, st)) {
            s.stage = 'quiet';
            s.run = 0;
            s.since = line.date;
          }
        } else if (s.stage === 'quiet') {
          const need = s.woken ? PATH.WOKEN_TO_OFF : PATH.QUIET_TO_OFF;
          if (s.run >= need && floorHolds(id, countedLines, s) && windowClean(id, countedLines) && (s.everFired || !!positive[id])) {
            s.stage = 'off';
            s.run = 0;
            s.woken = false;
            s.since = line.date;
          }
        }
      }
    }
  }
  return { st, positive, countedLines, realLines, matesEver, realGames };
}

function stagesOf(st) {
  const out = {};
  for (const id of PATH.MATERIAL_LOOKS) out[id] = st[id].stage;
  return out;
}

export function compute(digest, now = Date.now()) {
  const lines = sortLines(digest);
  const newest = lines.length ? lines[lines.length - 1] : null;
  let newestReal = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) if (!lines[i].again) { newestReal = lines[i]; break; }
  const full = fold(lines);
  const prior = fold(newestReal ? lines.filter((l) => l !== newestReal) : lines);
  const { st, positive, countedLines, realLines, matesEver, realGames } = full;
  const win = countedLines.slice(-PATH.FLOOR_WINDOW);
  const countedGames = countedLines.length;
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const review = !!newest && nowMs - Date.parse(newest.date) >= PATH.IDLE_DAYS * DAY_MS;

  // the window counts per look
  const win3 = {};
  for (const id of PATH.LOOKS) {
    let n3 = 0, w3 = 0, netLoss3 = 0;
    for (const l of win) {
      const e = entry(l, id);
      if (!e) continue;
      n3 += Math.max(0, num(e.n));
      w3 += Math.max(0, num(e.w));
      netLoss3 += num(e.netLoss);
    }
    win3[id] = { n3, w3, netLoss3, nGame: newestReal ? recs(newestReal, id) : 0 };
  }

  // current: the first material look at asking, pawns against free by the window; else the first at quiet
  const asking = PATH.MATERIAL_LOOKS.filter((id) => st[id].stage === 'asking');
  let current = null;
  let tied = [];
  if (asking.includes('pawns') && asking.includes('free')) {
    const p = win3.pawns, f = win3.free;
    if (f.n3 > p.n3) current = 'free';
    else if (f.n3 < p.n3) current = 'pawns';
    else if (f.netLoss3 > p.netLoss3) current = 'free';
    else if (f.netLoss3 < p.netLoss3) current = 'pawns';
    else { current = 'pawns'; tied = ['pawns', 'free']; }
  } else if (asking.length) {
    current = asking[0];
  } else {
    const quiet = PATH.MATERIAL_LOOKS.filter((id) => st[id].stage === 'quiet');
    const movable = quiet.filter((id) => st[id].everFired || !!positive[id]);
    current = movable.length ? quiet[0] : null;
  }

  // the mates word: 'back' when the newest real game holds a record; 'quiet' when the last
  // MATE_WINDOW counted games (and every real game since the first of them) hold none and a
  // record exists before that window; else 'asking'. A mate-win is evidence of nothing.
  let word = 'asking';
  if (newestReal && recs(newestReal, 'mates') > 0) word = 'back';
  else if (matesEver && countedGames >= PATH.MATE_WINDOW) {
    const start = realLines.indexOf(countedLines[countedLines.length - PATH.MATE_WINDOW]);
    const inWindow = realLines.slice(start).some((l) => recs(l, 'mates') > 0);
    const earlier = realLines.slice(0, start).some((l) => recs(l, 'mates') > 0);
    if (!inWindow && earlier) word = 'quiet';
  }

  const looks = PATH.LOOKS.map((id) => {
    const w = win3[id];
    if (id === 'mates') {
      return { id, stage: 'asking', woken: false, run: 0, everFired: matesEver, state: 'always', word, ...w, since: null };
    }
    const s = st[id];
    let state;
    if (id === current) state = 'current';
    else if (!s.everFired && countedGames < PATH.NOT_YET_GAMES) state = 'not_yet';
    else if (s.stage === 'off') state = 'off';
    else if (s.woken) state = 'back';
    else state = s.stage;
    return { id, stage: s.stage, woken: s.woken, run: s.run, everFired: s.everFired, state, word: null, ...w, since: s.since };
  });

  return deepFreeze({
    looks,
    stages: stagesOf(st),
    before: stagesOf(prior.st),
    current,
    tied,
    review,
    countedGames,
    realGames,
    newest: newest ? JSON.parse(JSON.stringify(newest)) : null,
    newestReal: newestReal ? JSON.parse(JSON.stringify(newestReal)) : null,
    positive: { free: positive.free, their_last_move: positive.their_last_move },
    // the floor window, kept for the countdown (the last FLOOR_WINDOW counted lines)
    window: win.map((l) => JSON.parse(JSON.stringify(l))),
    cleanTail: Object.fromEntries(PATH.MATERIAL_LOOKS.map((id) => {
      let k = 0;
      for (let i = countedLines.length - 1; i >= 0 && recs(countedLines[i], id) === 0; i -= 1) k += 1;
      return [id, k];
    })),
  });
}

// ---------------------------------------------------------------------------------------------
// The plan for one game
// ---------------------------------------------------------------------------------------------
function lookOf(state, id) {
  return (state.looks || []).find((l) => l.id === id) || null;
}
function levelOf(stage, review) {
  if (stage === 'quiet') return 'bare';
  if (stage === 'off') return review ? 'bare' : 'off';
  return 'full';
}
function usableK3(k3, state) {
  if (!isObj(k3) || !state.current || !state.newestReal) return null;
  return k3.nodeId === state.current && k3.gameId === state.newestReal.id ? k3 : null;
}
function diffStages(baseline, stages) {
  const out = [];
  for (const look of PATH.MATERIAL_LOOKS) {
    const b = baseline[look], s = stages[look];
    if (!PATH.STAGES.includes(b) || !PATH.STAGES.includes(s) || b === s) continue;
    let kind;
    if (s === 'asking') kind = 'WAKE';
    else if (s === 'quiet') kind = b === 'off' ? 'SLIP' : 'QUIET';
    else kind = 'OFF';
    out.push({ look, kind });
  }
  return out;
}
// The honest countdown for the current look: the further clean counted games to the next stage
// while every floor holds; the look's FLOOR sentence otherwise; nothing when it cannot be reached.
function countdownOf(state) {
  const look = lookOf(state, state.current);
  if (!look || look.id === 'mates') return null;
  const s = { everFired: look.everFired };
  const positive = !!(state.positive && state.positive[look.id]);
  const counted = state.window || [];
  // the floor over the trailing window as it stands (the guards floor counts the games so far)
  const floor = look.id === 'guards' ? state.countedGames >= PATH.GUARDS_HISTORY : floorHolds(look.id, counted, s);
  if (!floor) return COPY.PATH.COUNTDOWN.FLOOR[look.id] || null;
  if (look.stage === 'asking') {
    const n = Math.max(1, PATH.CLEAN_TO_QUIET - look.run);
    return n === 1 ? COPY.PATH.COUNTDOWN.QUIET_ONE : fill(COPY.PATH.COUNTDOWN.QUIET_MANY, { n: cap(countWord(n)) });
  }
  if (look.stage === 'quiet') {
    if (!look.everFired && !positive) return null;
    const byRun = Math.max(1, (look.woken ? PATH.WOKEN_TO_OFF : PATH.QUIET_TO_OFF) - look.run);
    const tail = state.cleanTail ? num(state.cleanTail[look.id]) : 0;
    const byWindow = Math.max(0, PATH.OFF_WINDOW - Math.min(tail, state.countedGames));
    const n = Math.max(byRun, byWindow);
    return n === 1 ? COPY.PATH.COUNTDOWN.OFF_ONE : fill(COPY.PATH.COUNTDOWN.OFF_MANY, { n: cap(countWord(n)) });
  }
  return null;
}
function whereOf(state) {
  if (state.current === null) return COPY.PATH.WHERE.ALL_OFF;
  // one game played (counted or not) is not enough to know him; a short-game player with many
  // games is past that line even with none counted
  if (num(state.realGames) <= 1) return COPY.PATH.WHERE.FIRST;
  const offs = PATH.MATERIAL_LOOKS.filter((id) => state.stages[id] === 'off').length;
  // every row still held, the mates row among them
  const rest = countWord(PATH.LOOKS.length - offs);
  if (offs === 0) return COPY.PATH.WHERE.NONE_OFF;
  if (offs >= PATH.MATERIAL_LOOKS.length) return COPY.PATH.WHERE.ALL_OFF;
  if (offs === 1) return fill(COPY.PATH.WHERE.ONE_OFF, { rest });
  return fill(COPY.PATH.WHERE.SOME_OFF, { n: cap(countWord(offs)), rest });
}
// Records of a line as he saw them (n less the landed ones); landed falls back to the stage he
// had before the line when a hand-built line carries no count.
function seen(line, id, before) {
  const e = entry(line, id);
  if (!e) return { shown: 0, landed: 0 };
  const n = Math.max(0, num(e.n));
  const landed = Number.isFinite(Number(e.landed)) && e.landed !== null ? Math.min(n, Math.max(0, num(e.landed))) : before[id] === 'off' ? n : 0;
  return { shown: n - landed, landed };
}
// One game's holds as the close line reads them: the shown holds of any look (total), those of
// the current look, the looks whose hand was off and let a piece land (why 'hand'), and the
// current look's landed records let go by the pair or quiet rule.
function tallyHolds(holds, current) {
  const mine = (Array.isArray(holds) ? holds : []).filter(isObj).filter((h) => nodeOf(h));
  const shownAll = mine.filter((h) => PATH.SHOWN_OUTCOMES.includes(h.outcome) && h.outcome !== 'again');
  const landed = mine.filter((h) => h.outcome === 'landed');
  return {
    total: shownAll.length,
    curShown: shownAll.filter((h) => nodeOf(h) === current).length,
    handLanded: landed.filter((h) => h.why === 'hand').map((h) => nodeOf(h)),
    curLet: landed.filter((h) => h.why !== 'hand' && nodeOf(h) === current).length,
  };
}
// The same tally from the digest line alone (no summary): a landed record of a look that was off
// before the line was the hand's; of the current look otherwise, the pair or quiet rule's.
function tallyLine(state) {
  const line = state.newestReal;
  let total = 0;
  const handLanded = [];
  let curLet = 0;
  for (const id of PATH.LOOKS) {
    const v = seen(line, id, state.before);
    total += v.shown;
    if (v.landed > 0 && state.before[id] === 'off') handLanded.push(id);
    else if (v.landed > 0 && id === state.current) curLet += v.landed;
  }
  return { total, curShown: seen(line, state.current, state.before).shown, handLanded, curLet };
}
function byCurrentThenLadder(current) {
  return (a, b) => ((a === current ? 0 : 1) - (b === current ? 0 : 1)) || (ladderIndex(a) - ladderIndex(b));
}
// The serif close line from a tally. A piece the faded hand let land names its own look (the
// slip is the sentence that matters); then a let-go landing of the current look; then the shown
// holds against the current look. `first`: this is his first real game.
function closeFromTally(state, t, first) {
  const C = COPY.PATH.CLOSE;
  const look = COPY.PATH.LOOK_WORDS[state.current];
  const hand = t.handLanded.filter((id) => C.LANDED[id]).sort(byCurrentThenLadder(state.current));
  if (hand.length) return C.LANDED[hand[0]];
  if (state.current === null) return C.NOTHING_LEFT;
  if (t.curLet > 0 && C.LANDED_LET[state.current]) return C.LANDED_LET[state.current];
  const { total, curShown } = t;
  if (total === 0) return first && state.current === 'pawns' ? C.NONE_FIRST : fill(C.NONE, { look });
  if (curShown === total) return total === 1 ? fill(C.ONE, { look }) : fill(C.ALL, { n: cap(countWord(total)), look });
  if (curShown === 0) return total === 1 ? fill(C.OTHER_ONE, { look }) : fill(C.OTHER, { n: cap(countWord(total)), look });
  return fill(C.SOME, { n: cap(countWord(total)), k: countWord(curShown), look });
}
function closeLineOf(state, games) {
  if (!state.newest) return state.current ? COPY.PATH.CLOSE.NONE_FIRST : COPY.PATH.CLOSE.NOTHING_LEFT;
  if (state.newest.again) return COPY.PATH.CLOSE.AGAIN;
  if (!state.newestReal) return COPY.PATH.CLOSE.NOTHING_LEFT;
  const g = newestRealGame(games, state);
  const t = g ? tallyHolds(g.holds, state.current) : tallyLine(state);
  return closeFromTally(state, t, state.realGames <= 1);
}

// The close line for the card on screen, from the holds the card itself lists (the tutorial's
// among them, so the line never contradicts the counts above it): card = { holds, again, stored }.
// A game that was not stored (given up before any move) counts nothing.
export function closeLineFor(state, card = {}) {
  const S = isObj(state) && Array.isArray(state.looks) ? state : compute([]);
  const c = isObj(card) ? card : {};
  if (c.again) return COPY.PATH.CLOSE.AGAIN;
  const stored = c.stored !== false;
  const holds = stored && Array.isArray(c.holds) ? c.holds.filter(isObj).map(normRecord) : [];
  const first = stored ? num(S.realGames) <= 1 : num(S.realGames) === 0;
  return closeFromTally(S, tallyHolds(holds, S.current), first);
}
function normGames(games) {
  return (Array.isArray(games) ? games : []).filter(isObj).map(norm);
}
function sortGames(games) {
  return normGames(games).sort((a, b) => (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
// The summary of the state's newest real game (matched by id); without a state, the newest
// non-again summary. A summary that is not the digest's newest real line is never used for it.
function newestRealGame(games, state) {
  const sorted = sortGames(games).filter((g) => !g.again);
  if (!sorted.length) return null;
  if (state && state.newestReal) return sorted.find((g) => g.id === String(state.newestReal.id)) || null;
  return sorted[sorted.length - 1];
}
function drillOf(state, games) {
  if (!state.current || !state.newest || state.newest.again) return null;
  const g = newestRealGame(games, state);
  if (!g) return null;
  // a record the drill can rebuild: an answer set, and a refutation (a missed mate or a
  // stalemate has none: the gate writes [] for both, and recordVerdict needs none for them)
  const drillable = (h) => isObj(h.answer) && Array.isArray(h.answer.squares) && h.answer.squares.length > 0
    && ((Array.isArray(h.refutation) && h.refutation.length > 0) || h.category === 'missed_mate' || h.category === 'allowed_stalemate');
  // his worst moment: the larger loss, then the later move
  const worse = (h, best) => !best || num(h.netLoss) > num(best.netLoss) || (num(h.netLoss) === num(best.netLoss) && num(h.ply) >= num(best.ply));
  const pick = (look) => {
    let best = null;
    for (const h of g.holds) {
      if (h.outcome !== 'anyway' && h.outcome !== 'landed') continue;
      if (nodeOf(h) !== look) continue;
      if (!drillable(h)) continue;
      if (worse(h, best)) best = h;
    }
    return best;
  };
  const record = pick(state.current) || pick('mates');
  return record ? { record: JSON.parse(JSON.stringify(record)), gameId: g.id } : null;
}

// The SLIP of a look woken by a hold he was shown (the newest real line has a record of it that
// did not land): the bare hold of the review or a loss of five or more spoke, so 'I said
// nothing' would be false. A hand-built line without a landed count reads as landed.
function slipWasShown(state, id) {
  const e = state.newestReal ? entry(state.newestReal, id) : null;
  if (!e || e.landed == null || !Number.isFinite(Number(e.landed))) return false;
  return Math.min(num(e.n), num(e.landed)) < num(e.n);
}

// The plan for one game (frozen; game.js keeps it on S for the whole game). The digest holds no
// records, so the drill and the exact close-line counts read the stored summaries: pass them as
// the fifth argument (store.list(KEYS.GAMES)); without them drill is null and the close line
// counts from the digest line.
export function plan(state, k3 = null, shown = null, said = [], games = null) {
  const S = isObj(state) && Array.isArray(state.looks) ? state : compute([]);
  const saidList = Array.isArray(said) ? said.filter((x) => typeof x === 'string') : [];
  const current = S.current;
  const stage = (id) => S.stages[id];
  // the material slots are set below, once the announcement is known
  const hand = { hanging_after_move: null, ignored_attack: null, free_piece_ignored: null, allowed_mate: 'full', missed_mate: 'full', allowed_stalemate: 'full' };
  // the review game holds an off free look again, so the opponent leaves pieces as for a held one
  const giftRate = stage('free') === 'off' && !S.review ? PATH.GIFT_RATE.off : PATH.GIFT_RATE.on;
  const k3use = usableK3(k3, S);
  const baseline = isObj(shown) && Object.keys(shown).length ? shown : S.before;
  const transitions = diffStages(baseline, S.stages);
  const byCurrent = (a, b) => ((a.look === current ? 0 : 1) - (b.look === current ? 0 : 1)) || (ladderIndex(a.look) - ladderIndex(b.look));
  const ofKind = (kind) => transitions.filter((t) => t.kind === kind).sort(byCurrent);
  // an off look whose OFF line has not been said yet: the diff may have lost it (another sentence
  // took the one slot, or a merge reset shown), so 'said' is the record of what was announced
  const offUnsaid = PATH.MATERIAL_LOOKS.filter((id) => stage(id) === 'off' && !saidList.includes(`off:${id}`))
    .sort((a, b) => byCurrent({ look: a }, { look: b }));

  let announce = null;
  if (S.review) announce = { kind: 'REVIEW', look: current };
  else if (ofKind('WAKE').length) announce = { kind: 'WAKE', look: ofKind('WAKE')[0].look };
  else if (ofKind('SLIP').length) announce = { kind: 'SLIP', look: ofKind('SLIP')[0].look };
  else if (S.newestReal && offUnsaid.length) announce = { kind: 'OFF', look: offUnsaid[0] };
  else if (ofKind('QUIET').length) announce = { kind: 'QUIET', look: ofKind('QUIET')[0].look };
  // a loss by mate is never 'early' from his chair: the mate line is said instead (below)
  else if (S.newestReal && !counted(S.newestReal) && S.newestReal.result !== 'mate-loss' && !saidList.includes(`nc:${S.newestReal.id}`)) announce = { kind: 'NOT_COUNTED', look: current };

  // the hand comes off only once it has been said: an off look whose OFF line is not said before
  // this game's first move holds with the bare question until it is
  const level = (id) => {
    const l = levelOf(stage(id), S.review);
    if (l !== 'off') return l;
    return saidList.includes(`off:${id}`) || (announce && announce.kind === 'OFF' && announce.look === id) ? 'off' : 'bare';
  };
  hand.hanging_after_move = { pawn: level('pawns'), piece: level('takers'), takes_back: level('takes_back') };
  hand.ignored_attack = { already: level('their_last_move'), lost_guard: level('guards'), opened_line: level('guards') };
  hand.free_piece_ignored = level('free');

  const countdown = countdownOf(S);
  const transitionSaid = !!announce;
  let line = null;
  if (S.newestReal) {
    const parts = [];
    if (announce) {
      if (announce.kind === 'REVIEW') parts.push(COPY.PATH.TRANSITION.REVIEW);
      else if (announce.kind === 'NOT_COUNTED') parts.push(COPY.PATH.NOT_COUNTED);
      else if (announce.kind === 'SLIP' && slipWasShown(S, announce.look)) parts.push(COPY.PATH.TRANSITION.SLIP_HELD[announce.look]);
      else parts.push(COPY.PATH.TRANSITION[announce.kind][announce.look]);
    }
    if (current === null) parts.push(COPY.PATH.NOTHING_LEFT);
    else if (k3use && str(k3use.next).trim()) parts.push(str(k3use.next).trim());
    else if (!announce && S.newestReal.result === 'mate-loss') parts.push(COPY.PATH.MATE_LOSS);   // replaces OPEN
    // the countdown rides on OPEN alone: after an announcement the line stays short (28 words)
    else parts.push(COPY.PATH.OPEN[current] + (countdown && !transitionSaid ? ' ' + countdown : ''));
    line = parts.filter(Boolean).join(' ');
  }

  // the remembering question per slot: K3's for the current look; for guards only for the
  // sub-case K3 was written about (k3.slot), since one question cannot be true of both
  const question = {};
  if (current && current !== 'mates') {
    for (const slot of SLOTS[current] || [current]) {
      const fits = !SLOTS[current] || (k3use && k3use.slot === slot);
      const own = fits && k3use && str(k3use.question).trim();
      question[slot] = own || COPY.PATH.QUESTION[slot];
    }
  }
  const askFirst = (k3use && k3use.askFirst != null ? k3use.askFirst : null) ?? (current ? PATH.ASK_FIRST[current] : null) ?? null;
  const focus = (k3use && k3use.focus != null ? k3use.focus : null) ?? S.tied[0] ?? null;

  return deepFreeze({
    hand,
    giftRate,
    review: S.review,
    current,
    tied: S.tied.slice(),
    transitions,
    line,
    announce,
    countdown,
    question,
    askFirst,
    focus,
    closeLine: closeLineOf(S, games),
    // the stages this plan's line tells him about (game.js writes them to shown once it says it)
    shownAfter: { ...S.stages },
    where: whereOf(S),
    drill: drillOf(S, games),
    k3: k3use ? JSON.parse(JSON.stringify(k3use)) : null,
  });
}

// ---------------------------------------------------------------------------------------------
// The face and the K3 facts, in words only
// ---------------------------------------------------------------------------------------------
function captionOf(look, state, nowMs) {
  const C = COPY.PATH.CAPTION;
  switch (look.state) {
    case 'current':
      if (state.realGames <= 1 && look.nGame > 0) return fill(C.CURRENT_GAME, { n: cap(timesWords(look.nGame)) });
      if (look.n3 > 0) return fill(C.CURRENT_RECENT, { n: cap(timesWords(look.n3)) });
      return C.CURRENT;
    case 'asking': return C.ASKING;
    case 'quiet': return C.QUIET;
    case 'back': return C.BACK;
    case 'always': return look.word === 'quiet' ? C.MATES_QUIET : C.MATES;
    case 'off': {
      const since = Date.parse(look.since);
      if (!Number.isFinite(since)) return C.OFF;
      const sinceDate = new Date(since);
      const nowDate = new Date(nowMs);
      if (sameLocalDay(sinceDate, nowDate) || nowMs - since < 0) return C.OFF;
      if (nowMs - since < PATH.SINCE_WEEK_DAYS * DAY_MS) return fill(C.OFF_SINCE, { day: WEEKDAYS[sinceDate.getDay()] });
      return C.OFF_WHILE;
    }
    default: return C.ASKING;
  }
}
function inkOf(state) {
  if (state === 'current' || state === 'off') return 'ink';
  if (state === 'not_yet') return 'muted';
  return 'coach';
}
// The piece on a square of the position after the record's move, as a word ('nothing' when empty).
function pieceOn(chess, square) {
  try {
    const p = chess && typeof square === 'string' ? chess.get(square) : null;
    return p ? PIECE_WORDS[p.type] : 'nothing';
  } catch (e) {
    return 'nothing';
  }
}
function afterMove(record) {
  try {
    const chess = new Chess(record.fen);
    return chess.move(record.san) ? chess : null;
  } catch (e) {
    return null;
  }
}
function firstTapOf(record) {
  const taps = Array.isArray(record.taps) ? record.taps : [];
  const first = taps[0];
  if (isObj(first) && (first.grade === 'right' || first.grade === 'partial')) return 'right';
  if (taps.some((t) => isObj(t) && t.grade === 'named')) return 'shown';
  return 'none';
}
function holdFacts(record) {
  const chess = afterMove(record);
  return {
    look: nodeOf(record),
    piece: PIECE_WORDS[record.piece] || 'piece',
    taker: pieceOn(chess, record.best),
    outcome: str(record.outcome),
    firstTap: firstTapOf(record),
    when: num(record.ply) <= EARLY_PLY ? 'early' : 'late',
  };
}

export function words(state, ctx = {}) {
  const S = isObj(state) && Array.isArray(state.looks) ? state : compute([]);
  const c = isObj(ctx) ? ctx : {};
  const nowMs = Number.isFinite(Number(c.now)) ? Number(c.now) : Date.now();
  const rows = [];
  let notYet = 0;
  for (const look of S.looks) {
    if (look.state === 'not_yet') { notYet += 1; continue; }
    rows.push({ id: look.id, sentence: COPY.PATH.SENTENCES[look.id], state: look.state, caption: captionOf(look, S, nowMs), ink: inkOf(look.state) });
  }
  const collapsed = notYet === 0 ? null : notYet === 1 ? COPY.PATH.COLLAPSED_ONE : fill(COPY.PATH.COLLAPSED, { n: cap(countWord(notYet)) });
  const k3use = usableK3(c.k3, S);
  const where = k3use && str(k3use.where).trim() ? str(k3use.where).trim() : whereOf(S);

  // the newest real game, in words
  const g = newestRealGame(c.games, S);
  const line = S.newestReal;
  const records = g ? g.holds.filter((h) => PATH.RECORD_OUTCOMES.includes(h.outcome) && nodeOf(h)) : [];
  const game = {
    holds: records.map(holdFacts),
    observed: countWord(g ? g.observed : line ? line.observed : 0),
    gifts: {
      offered: countWord(g ? g.gifts.offered : line && line.gifts ? line.gifts.offered : 0),
      taken: countWord(g ? g.gifts.taken : line && line.gifts ? line.gifts.taken : 0),
    },
    escapes: countWord(g ? g.rewards.filter((r) => r.kind === 'escaped').length : line ? line.escapes : 0),
    freeTaken: countWord(g ? Math.max(g.freeTaken, g.rewards.filter((r) => r.kind === 'free_taken').length) : 0),
  };

  // the current look over the last three counted games
  const cur = lookOf(S, S.current);
  let lastThree = 'none';
  if (cur && cur.n3 > 0) {
    const ids = new Set((S.window || []).map((l) => String(l.id)));
    const backs = sortGames(c.games).filter((x) => ids.has(x.id)).reduce((t, x) => t + x.holds.filter((h) => h.outcome === 'back' && nodeOf(h) === cur.id).length, 0);
    lastThree = `${countWord(cur.n3)} ${cur.n3 === 1 ? 'hold' : 'holds'} in the last three counted games, ${countWord(backs)} taken back`;
  }

  // what he wrote, as given (coach.js masks it before it enters a prompt)
  let said = [];
  if (Array.isArray(c.saidTexts)) {
    said = c.saidTexts.filter((t) => isObj(t) ? typeof t.text === 'string' && t.text : typeof t === 'string' && t)
      .map((t) => (isObj(t) ? { look: str(t.look) || null, text: t.text } : { look: null, text: t }));
  } else {
    said = records.filter((h) => typeof h.said === 'string' && h.said.trim()).map((h) => ({ look: nodeOf(h), text: h.said }));
  }

  const drill = isObj(c.drill) && isObj(c.drill.record) ? c.drill.record : null;
  const drillLook = drill ? nodeOf(drill) : null;
  const again = drill ? `your ${PIECE_WORDS[drill.piece] || 'piece'}: ${COPY.PATH.MEANING[drillLook] || COPY.PATH.MEANING.mates}` : 'none';

  const facts = {
    looks: S.looks.map((l) => ({ id: l.id, meaning: COPY.PATH.MEANING[l.id], word: l.id === 'mates' ? l.word : l.stage })),
    current: S.current,
    yours: PATH.MATERIAL_LOOKS.filter((id) => S.stages[id] === 'off'),
    changed: (Array.isArray(c.transitions) ? c.transitions : []).filter(isObj).map((t) => ({ id: t.look, kind: t.kind })),
    game,
    lastThree,
    said,
    again,
    allowed: Object.fromEntries(PATH.LOOKS.map((id) => [id, (PATH.QUESTION_PIECES[id] || []).slice()])),
    asks: (Array.isArray(c.offeredAsks) ? c.offeredAsks : []).filter((k) => typeof k === 'string'),
    tied: S.tied.slice(),
    // guards: the sub-case K3's question is written for (game.js: the newest guards hold's slot)
    guardsCase: typeof c.guardsSlot === 'string' && SLOTS.guards.includes(c.guardsSlot) ? c.guardsSlot : null,
  };
  return deepFreeze({ rows, collapsed, where, facts });
}

// ---------------------------------------------------------------------------------------------
// The still: the newest record of a look across the newest non-again games
// ---------------------------------------------------------------------------------------------
export function stillOf(games, lookId) {
  const sorted = sortGames(games).filter((g) => !g.again).reverse();
  for (const g of sorted) {
    let best = null;
    for (const h of g.holds) {
      if (!PATH.RECORD_OUTCOMES.includes(h.outcome) || nodeOf(h) !== lookId) continue;
      if (!best || num(h.ply) >= num(best.ply)) best = h;
    }
    if (!best) continue;
    const chess = afterMove(best);
    return chess ? Object.freeze({ record: deepFreeze(best), chess }) : null;
  }
  return null;
}
