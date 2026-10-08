// game.js - the controller. Boots the page (theme, tutorial flag, remembered line, engine warm-up,
// coach availability), runs the pre-search schedule, the drop (pending -> verdict -> hold or
// commit), rewards under the quiet budget, the hold lifecycle (tap, Show me, Hear me out, K1,
// take back, play anyway), the opponent's reply, ends, mercy, give up, the close card, the next
// game's line, logging to the store, and window.__app for the tests. Everything that is chess is
// decided by chess.js, the engine and gate.js before anything is drawn or asked.

import { Chess } from '../vendor/chess.js';
import {
  START_FEN, TUTORIAL_FEN, PLAYER, BOT, ENGINE, GATE, REWARDS, KEYS, KEEP, DOM, COPY, CLAUDE, PIECE_WORDS,
  fill, timing, timesWord, materialWords,
} from './contract.js';
import { createBoard } from './board.js';
import { createEngine } from './engine.js';
import { loadBook, bookReply, chooseBotMove, shouldResign, materialExtra } from './bot.js';
import { buildFacts, uciToMove } from './facts.js';
import * as gate from './gate.js';
import { createHold } from './hold.js';
import { showMe } from './ghost.js';
import { createCoach } from './coach.js';
import { store } from './store.js';

const SQUARE_RE = /^[a-h][1-8]$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const byId = (id) => document.getElementById(id);
// Flags are the string '1' in the store; compare as strings so a parsed number reads the same.
const flagSet = (key) => String(store.get(key, '')) === '1';

// ---------------------------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------------------------
const boardEl = byId(DOM.ids.board);
const coachEl = byId(DOM.ids.coach);
const linksEl = byId(DOM.ids.links);
const actionsEl = byId(DOM.ids.actions);
const edgeEl = byId(DOM.ids.edge);
const closeEl = byId(DOM.ids.close);

// ---------------------------------------------------------------------------------------------
// Fast mode and reduced motion
// ---------------------------------------------------------------------------------------------
let fastFlag = false;
function fastNow() { return fastFlag === true; }
function setFast(v) {
  fastFlag = v === true;
  if (fastFlag) document.documentElement.dataset.fast = '1';
  else delete document.documentElement.dataset.fast;
}
function reducedNow() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
const T = (name) => timing(name, fastNow());

// ---------------------------------------------------------------------------------------------
// The coach line
// ---------------------------------------------------------------------------------------------
let lineTimer = null;
let lineHold = false;  // the line shows a reward, the anyway sentence or an end: idle keeps it
function cancelLineTimer() {
  if (lineTimer) { clearTimeout(lineTimer); lineTimer = null; }
}
const coachLine = {
  say(text) {
    cancelLineTimer();
    coachEl.classList.remove(DOM.coach.looking);
    const t = text == null ? '' : String(text);
    coachEl.textContent = t;
    // a line past the measured four-line cap (the K2 say plus the page's question) sets the
    // smaller phone size so five lines fit the same box and the board never moves
    coachEl.classList.toggle(DOM.coach.long, t.trim().split(/\s+/).filter(Boolean).length > CLAUDE.LONG_LINE_WORDS);
  },
  echo(words) {
    const span = document.createElement('span');
    span.className = DOM.coach.echo;
    span.textContent = `«${words}»`;
    coachEl.appendChild(span);
  },
  pulse(on) {
    coachEl.classList.toggle(DOM.coach.looking, !!on);
  },
  clear() { this.say(''); },
  text() {
    const first = coachEl.firstChild;
    return first && first.nodeType === 3 ? first.textContent : coachEl.textContent;
  },
};
// A line that stays for `ms`, then 'Your move.' if nothing else happened and the game is idle.
function sayFor(text, ms) {
  coachLine.say(text);
  lineHold = true;
  const id = setTimeout(() => {
    if (lineTimer !== id) return;
    lineTimer = null;
    lineHold = false;
    if (S.state === 'idle') coachLine.say(COPY.YOUR_MOVE);
  }, ms);
  lineTimer = id;
}
function sayHeld(text) {
  coachLine.say(text);
  lineHold = true;
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------
const S = {
  state: 'idle', tutorial: false, engineReady: false, hold: null, plies: 0, anyways: 0, playedPairs: [],
  rewardsSaid: 0, lastRewardPly: -10, mercyOffered: false, mercyStreak: 0, resignStreak: 0, botMoveNo: 0,
  result: null, giftDue: false, lastGift: null, consented: false, coachAvailable: false, resting: false,
  pre: null, lastVerdict: null, forcedReply: null,
};
let chess = new Chess(START_FEN);   // the truth: the position before any held move
let gameId = Date.now().toString(36);
let holdLog = [];
let backs = 0;
let givenAway = 0;
let freeTaken = 0;
let botEvals = [];
let lastMove = null;                // the last committed move (tint)
let ringSquare = null;              // the green ring of a free piece taken, while it shows
let picked = null;                  // the tapped piece's square in move mode
let turnToken = 0;                  // bumps on load/newGame/end so late replies are dropped
let mercyPending = false;
let mercyPly = -1;
let factsCache = null;              // { fen, facts } for the idle position
let ghost = null;                   // the running Show me
let restingTimer = null;
let ringTimer = null;
let barBefore = null;               // the action bar's contents before a give-up confirm
let coachHidden = false;            // a not_granted-family code hid the coach for this view
let previousGame = store.list(KEYS.GAMES).slice(-1)[0] || null;   // the game before this one

// pre-search bookkeeping
let preFen = null;                  // the fen the current pre-search is for
let preResult = null;               // the raw SearchResult kept for the drop
let prePromise = Promise.resolve(null);
let preToken = 0;

// tutorial
let tutorialData = null;
let tutorialReady = Promise.resolve(null);

// ---------------------------------------------------------------------------------------------
// Board, engine, book, hold UI, coach
// ---------------------------------------------------------------------------------------------
const board = createBoard(boardEl, { onTap: onBoardTap });
const engine = createEngine();
const bookReady = loadBook();
const holdUI = createHold({ board, coachLine, actions: actionsEl, links: linksEl, store, fast: fastNow, reduced: reducedNow });
let coach = null;

engine.ready.then(() => {
  S.engineReady = true;
  if (S.state === 'idle' && !S.tutorial && preFen !== chess.fen()) startPre();
});

function canHear() {
  return !!(coach && !coachHidden && coach.available() && !S.resting && !(coach.resting && coach.resting()) && S.hold && !S.hold.tutorial);
}
function applyLinkPolicy() {
  if (!S.hold) return;
  const retry = S.hold.claude && S.hold.claude.retry;
  holdUI.setLink('but', canHear() && S.hold.claude.k2 !== 'shown' && !S.hold.claude.linkGone ? (retry ? 'retry' : 'hear') : 'hidden');
}
function bootCoach() {
  try {
    coach = createCoach({
      store,
      onAvailable(available) {
        S.coachAvailable = !!available;
        applyLinkPolicy();
      },
    });
  } catch { coach = null; }
}

// ---------------------------------------------------------------------------------------------
// Theme, viewport
// ---------------------------------------------------------------------------------------------
function applyTheme() {
  const t = store.get(KEYS.THEME);
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
function toggleTheme() {
  let cur = document.documentElement.dataset.theme;
  if (cur !== 'light' && cur !== 'dark') {
    let dark = false;
    try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { dark = false; }
    cur = dark ? 'dark' : 'light';
  }
  const next = cur === 'dark' ? 'light' : 'dark';
  store.set(KEYS.THEME, next);
  document.documentElement.dataset.theme = next;
}
function setVvh() {
  try {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vvh', `${Math.round(h)}px`);
  } catch { /* no viewport: the CSS fallback stands */ }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
function moveSummary(mv) {
  return mv ? { uci: mv.from + mv.to + (mv.promotion || ''), san: mv.san, from: mv.from, to: mv.to, piece: mv.piece, captured: mv.captured || null } : null;
}
function mateOf(score) {
  return score && typeof score.mate === 'number' && score.mate > 0 ? score.mate : null;
}
function toPre(result) {
  if (!result || !result.lines || !result.lines[0] || !result.lines[0].pv || !result.lines[0].pv.length) return null;
  const l1 = result.lines[0];
  const l2 = result.lines[1] || null;
  const sc = new Chess(result.fen);
  const best = uciToMove(sc, l1.pv[0]);
  if (!best) return null;
  const line2 = l2 && l2.pv && l2.pv[0] ? uciToMove(sc, l2.pv[0]) : null;
  return {
    fen: result.fen,
    evalBefore: gate.toPlayer(l1.score, true),
    best: { ...moveSummary(best), isMate: /#$/.test(best.san) },
    mateIn: mateOf(l1.score),
    line2: line2 ? moveSummary(line2) : null,
    depth: result.depth,
    stopped: !!result.stopped,
  };
}
function toPost(result, postFen) {
  if (!result) return null;
  const lines = [];
  for (const l of result.lines || []) {
    if (!l.pv || !l.pv.length) continue;
    const sc = new Chess(postFen);
    const reply = uciToMove(sc, l.pv[0]);
    if (!reply) continue;
    sc.move({ from: reply.from, to: reply.to, promotion: reply.promotion });
    lines.push({
      reply: { ...moveSummary(reply), isCapture: !!reply.captured, isCheck: sc.isCheck(), isMate: sc.isCheckmate() },
      score: gate.toPlayer(l.score, false),
      pv: l.pv,
    });
  }
  const l1 = result.lines && result.lines[0];
  return {
    fen: postFen,
    evalAfter: lines[0] ? lines[0].score : 0,
    lines,
    replyMateIn: l1 ? mateOf(l1.score) : null,
    depth: result.depth || 0,
  };
}
function factsBefore() {
  const fen = chess.fen();
  if (!factsCache || factsCache.fen !== fen) factsCache = { fen, facts: buildFacts(chess, { player: PLAYER }) };
  return factsCache.facts;
}
function findMove(san) {
  if (typeof san !== 'string') return null;
  const sc = new Chess(chess.fen());
  let mv = null;
  try { mv = sc.move(san.trim()); } catch { mv = null; }
  return mv;
}
function verboseMove(from, to) {
  return chess.moves({ square: from, verbose: true }).find((m) => m.to === to && (!m.promotion || m.promotion === 'q')) || null;
}
function rememberedLine() {
  try { return previousGame ? gate.remembered(previousGame) : null; } catch { return null; }
}
function baseMarks() {
  return { tint: lastMove ? [lastMove.from, lastMove.to] : [], ok: ringSquare ? [ringSquare] : [] };
}
function paint() {
  board.setMarks(baseMarks());
}
function giftRateNow() {
  const v = Number(store.get(KEYS.GIFT_RATE, BOT.GIFT_RATE));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : BOT.GIFT_RATE;
}
function drawEnd() {
  return chess.isStalemate() || chess.isInsufficientMaterial() || chess.isThreefoldRepetition() || chess.isDrawByFiftyMoves() || chess.isDraw();
}

// ---------------------------------------------------------------------------------------------
// Pre-search
// ---------------------------------------------------------------------------------------------
function startPre() {
  const fen = chess.fen();
  preFen = fen;
  preResult = null;
  S.pre = null;
  const token = ++preToken;
  if (S.tutorial || !engine.isReady() || chess.isGameOver()) { prePromise = Promise.resolve(null); return prePromise; }
  prePromise = engine.search(fen, { depth: ENGINE.PRE_DEPTH, multipv: ENGINE.MULTIPV, skill: ENGINE.FULL_SKILL, newGame: true })
    .then((r) => {
      if (token !== preToken) return null;
      preResult = r;
      S.pre = toPre(r);
      if (S.pre && r.depth >= ENGINE.PRE_MIN_DEPTH) noteMercy(S.pre.evalBefore);
      return r;
    });
  return prePromise;
}
function noteMercy(evalBefore) {
  if (mercyPly === S.plies) return;
  mercyPly = S.plies;
  if (evalBefore <= BOT.MERCY_CP) S.mercyStreak += 1;
  else S.mercyStreak = 0;
  if (S.mercyStreak >= BOT.MERCY_STREAK && !S.mercyOffered) {
    S.mercyOffered = true;
    if (S.state === 'idle') offerMercy();
    else mercyPending = true;
  }
}
function offerMercy() {
  mercyPending = false;
  if (S.state !== 'idle') return;
  sayHeld(COPY.MERCY);
  actionsEl.textContent = '';
  actionsEl.appendChild(button(DOM.buttonClasses.primary, 'startagain', COPY.BUTTONS.START_AGAIN));
  actionsEl.appendChild(button(DOM.buttonClasses.quiet, 'keep', COPY.BUTTONS.KEEP_PLAYING));
}
function button(cls, action, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.dataset.action = action;
  b.textContent = label;
  return b;
}

// ---------------------------------------------------------------------------------------------
// Idle input
// ---------------------------------------------------------------------------------------------
function clearPick() {
  picked = null;
  board.pick(null);
  paint();
}
function pickSquare(sq) {
  picked = sq;
  board.pick(sq);
  const moves = chess.moves({ square: sq, verbose: true });
  const dots = [], rings = [];
  for (const m of moves) (m.captured ? rings : dots).push(m.to);
  board.setMarks({ ...baseMarks(), dots, rings });
}
function onBoardTap(sq, info) {
  if (!SQUARE_RE.test(String(sq))) return;
  if (S.state === 'held') {
    if (ghost) ghost.abort();
    holdUI.tap(sq);
    return;
  }
  if (S.state !== 'idle') return;
  const own = info && info.piece && info.piece[0] === PLAYER ? info.piece : null;
  if (picked) {
    const mv = verboseMove(picked, sq);
    if (mv) { drop(mv); return; }
    if (own && sq !== picked) { pickSquare(sq); return; }
    clearPick();
    return;
  }
  if (own) pickSquare(sq);
}

// ---------------------------------------------------------------------------------------------
// The drop
// ---------------------------------------------------------------------------------------------
let dropPromise = null;
function drop(mv) {
  if (S.state !== 'idle') return Promise.resolve('illegal');
  const token = turnToken;
  const run = dropNow(mv).catch((err) => {
    // never leave the board locked: resync to the truth and go idle, then surface the error
    if (token === turnToken && S.state === 'pending') {
      board.setPosition(chess);
      paint();
      goIdle();
      coachLine.say(COPY.YOUR_MOVE);
    }
    throw err;
  });
  dropPromise = run;
  return run;
}
async function dropNow(mv) {
  const token = turnToken;
  const droppedAt = now();
  // a mercy offer or a give-up confirm on the bar is answered by moving; a sticky line is released
  actionsEl.textContent = '';
  barBefore = null;
  cancelLineTimer();
  lineHold = false;
  picked = null;
  board.pick(null);
  S.state = 'pending';
  board.setState('pending', null);
  board.setInput('locked');
  paint();

  const preFenNow = chess.fen();
  const before = factsBefore();
  const scratch = new Chess(preFenNow);
  const applied = scratch.move({ from: mv.from, to: mv.to, promotion: mv.promotion || (mv.flags && mv.flags.includes('p') ? 'q' : undefined) });
  const slide = board.move(applied);
  const dotTimer = setTimeout(() => { if (S.state === 'pending') board.pending(applied.to); }, T('PENDING_DOT_MS'));

  let verdict = null;
  let pre = null;
  let after = null;
  let wasTutorial = false;
  try {
    if (S.tutorial) {
      await tutorialReady;
      if (S.tutorial && tutorialData && tutorialData.moves) {
        wasTutorial = true;
        store.set(KEYS.TUTORIAL_SEEN, '1');
        after = buildFacts(scratch, { player: PLAYER });
        const row = tutorialData.moves[applied.san];
        if (row) {
          try { verdict = gate.tutorialVerdict(row, applied, chess); } catch { verdict = null; }
        }
      }
    }
    if (!wasTutorial && engine.isReady()) {
      await engine.stop();
      // a pre-search for this fen that started after the stop (it was queued) is stopped too
      while (engine.current() && engine.current().fen === preFenNow) await engine.stop();
      let raw = await prePromise;
      const kept = preResult && preResult.fen === preFenNow ? preResult : null;
      if (!raw || raw.fen !== preFenNow || (kept && kept.depth > raw.depth)) raw = kept;
      if (!raw || raw.depth < ENGINE.PRE_MIN_DEPTH) {
        raw = await engine.search(preFenNow, { depth: ENGINE.PRE_RESEARCH_DEPTH, multipv: ENGINE.MULTIPV, skill: ENGINE.FULL_SKILL });
      }
      preResult = raw;
      pre = toPre(raw);
      S.pre = pre;
      if (pre) noteMercy(pre.evalBefore);
      after = buildFacts(scratch, { player: PLAYER });
      let post = null;
      if (scratch.isGameOver()) {
        post = { fen: scratch.fen(), evalAfter: scratch.isCheckmate() ? GATE.MATE_SCORE : 0, lines: [], replyMateIn: null, depth: 0 };
      } else {
        const postRaw = await engine.search(scratch.fen(), { depth: ENGINE.VERDICT_DEPTH, multipv: ENGINE.MULTIPV, skill: ENGINE.FULL_SKILL });
        post = toPost(postRaw, scratch.fen());
      }
      if (pre && post) {
        try {
          verdict = gate.verdict(pre, post, before, after, { move: applied, anyways: S.anyways, playedPairs: S.playedPairs });
        } catch { verdict = null; }
      }
    }
  } finally {
    clearTimeout(dotTimer);
    board.pending(null);
  }
  if (token !== turnToken || S.state !== 'pending') return 'illegal';
  S.lastVerdict = verdict;
  if (!after) after = buildFacts(scratch, { player: PLAYER });

  if (verdict && verdict.held) {
    await slide;
    openHold(applied, verdict, before, after, scratch, { tint: baseMarks().tint });
    return 'held';
  }
  return commit(applied, { verdict, pre, before, after, droppedAt, wasTutorial, slide });
}

// ---------------------------------------------------------------------------------------------
// Commit and the reply
// ---------------------------------------------------------------------------------------------
async function commit(applied, { verdict = null, pre = null, before = null, after = null, droppedAt = now(), wasTutorial = false, slide = null, anyway = false, sawIt = false, anywayLine = null } = {}) {
  const token = turnToken;
  const real = chess.move({ from: applied.from, to: applied.to, promotion: applied.promotion });
  if (!real) return 'illegal';
  S.plies += 1;
  lastMove = real;
  factsCache = null;
  paint();
  if (slide) await slide;

  if (wasTutorial) {
    S.tutorial = false;
    sayHeld(COPY.TUTORIAL_SAFE);
  } else if (anyway) {
    // the anyway sentence is said after the reply
  } else if (verdict && verdict.suppressed) {
    if (typeof verdict.netLoss === 'number' && verdict.netLoss >= GATE.NET_MIN) givenAway += 1;
  } else if (pre && before && after && !(verdict && verdict.held)) {
    const cpOk = !verdict || verdict.cpLoss == null || verdict.cpLoss < GATE.HOLD_CP;
    let rw = verdict && verdict.reward ? verdict.reward : null;
    if (!rw && cpOk) { try { rw = gate.reward(pre, before, after, applied); } catch { rw = null; } }
    if (rw) applyReward(rw, real);
  }

  if (chess.isCheckmate()) { endGame('mate-win', COPY.ENDS.MATE_WIN); return 'over'; }
  if (drawEnd()) { endGame('draw', COPY.ENDS.DRAW); return 'over'; }

  const outcome = await reply({ droppedAt, anyway, token });
  if (outcome === 'cancelled') return 'illegal';
  if (outcome === 'over') return 'over';
  if (anyway && anywayLine) sayHeld(anywayLine);
  else if (!lineHold) coachLine.say(COPY.YOUR_MOVE);
  return 'committed';
}

function applyReward(rw, real) {
  const ply = S.plies;
  const budget = S.rewardsSaid < REWARDS.MAX_PER_GAME && S.lastRewardPly !== ply - 2;
  let said = false;
  if (rw.kind === 'free_taken') {
    freeTaken += 1;
    ringSquare = rw.square || real.to;
    paint();
    if (ringTimer) clearTimeout(ringTimer);
    ringTimer = setTimeout(() => { ringTimer = null; ringSquare = null; paint(); }, T('RING_MS'));
    if (budget) { sayFor(fill(COPY.REWARD_FREE, { piece: wordOf(rw.piece) }), T('REWARD_MS')); said = true; }
  } else if (rw.kind === 'escaped') {
    if (budget) { sayFor(fill(COPY.REWARD_ESCAPED, { piece: wordOf(rw.piece), attacker: wordOf(rw.attacker) }), T('REWARD_MS')); said = true; }
  }
  if (said) { S.rewardsSaid += 1; S.lastRewardPly = ply; }
  return said;
}
function wordOf(type) {
  return PIECE_WORDS[type] || String(type || 'piece');
}

let edgeTimer = null;
function edge(on, caption = '') {
  if (edgeTimer) { clearTimeout(edgeTimer); edgeTimer = null; }
  if (!edgeEl) return;
  edgeEl.classList.toggle('waiting', !!on);
  const cap = edgeEl.querySelector('.edge-caption');
  if (cap) cap.textContent = caption;
  if (caption) boardEl.dataset.warm = '1';
  else delete boardEl.dataset.warm;
}

async function reply({ droppedAt = now(), anyway = false, token = turnToken } = {}) {
  S.state = 'reply';
  board.setState('reply', null);
  board.setInput('locked');
  edgeTimer = setTimeout(() => { edgeTimer = null; if (S.state === 'reply' && token === turnToken) edge(true); }, T('EDGE_DOT_MS'));

  let chosen = null;
  const botMoveNo = chess.moveNumber();
  if (S.forcedReply) {
    const mv = findMove(S.forcedReply);
    S.forcedReply = null;
    if (mv) chosen = { san: mv.san, uci: mv.from + mv.to + (mv.promotion || ''), how: 'forced', botEval: null, gift: null, checked: 0, test: true };
  }
  if (!chosen) {
    await bookReady;
    const book = bookReply(chess);
    if (book) chosen = { ...book, how: 'book', botEval: null, gift: null, checked: 0 };
  }
  if (!chosen) {
    if (!engine.isReady()) {
      edge(true, COPY.WARMING);
      await engine.ready;
      if (token !== turnToken) { edge(false); return 'cancelled'; }
    }
    const giftDue = S.giftDue === true;
    S.giftDue = false;
    try {
      chosen = await chooseBotMove(engine, chess, { botMoveNo, giftRate: giftRateNow(), giftDue, anyway });
    } catch { chosen = null; }
    if (!chosen) {
      const legal = chess.moves({ verbose: true });
      if (!legal.length) { edge(false); return 'over'; }
      chosen = { san: legal[0].san, uci: legal[0].from + legal[0].to, how: 'guarded', botEval: null, gift: null, checked: 0 };
    }
  }
  if (token !== turnToken) { edge(false); return 'cancelled'; }

  const wait = T('REPLY_MIN_MS') - (now() - droppedAt);
  if (wait > 0) await sleep(wait);
  if (token !== turnToken) { edge(false); return 'cancelled'; }

  if (!chosen.test && typeof chosen.botEval === 'number') {
    botEvals.push(chosen.botEval);
    S.resignStreak = chosen.botEval <= BOT.RESIGN_CP ? S.resignStreak + 1 : 0;
  }
  S.botMoveNo = botMoveNo;
  if (!chosen.test && shouldResign({ botEvals, botMoveNo, chess, player: PLAYER })) {
    edge(false);
    let extra = {};
    try { extra = materialExtra(chess, PLAYER); } catch { extra = {}; }
    const words = materialWords(extra);
    endGame('resign', words ? fill(COPY.ENDS.RESIGN, { material: words }) : COPY.ENDS.RESIGN_PLAIN);
    return 'over';
  }

  const mv = findMove(chosen.san);
  if (!mv) { edge(false); return 'over'; }
  chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
  S.plies += 1;
  lastMove = mv;
  factsCache = null;
  S.lastGift = chosen.gift ? { san: chosen.san, verified: true, square: chosen.gift.square, piece: chosen.gift.piece, how: chosen.how } : null;
  edge(false);
  await board.move(mv);
  paint();
  if (token !== turnToken) return 'cancelled';

  if (chess.isCheckmate()) { endGame('mate-loss', COPY.ENDS.MATE_LOSS); return 'over'; }
  if (drawEnd()) { endGame('draw', COPY.ENDS.DRAW); return 'over'; }
  goIdle();
  return 'idle';
}

function goIdle() {
  S.state = 'idle';
  board.setState('idle', null);
  board.setInput('move');
  board.lift(null);
  board.pending(null);
  picked = null;
  board.pick(null);
  startPre();
  if (mercyPending) offerMercy();
}

// ---------------------------------------------------------------------------------------------
// Holds
// ---------------------------------------------------------------------------------------------
function openHold(applied, verdict, before, after, scratch, { tint = [] } = {}) {
  let copy;
  try { copy = gate.holdCopy(verdict, after, applied); } catch { copy = null; }
  if (!copy) copy = plainCopy(verdict);
  let asks = [];
  try { asks = gate.asksFor(verdict, before, after, applied, chess) || []; } catch { asks = []; }
  const hold = {
    category: verdict.category, sub: verdict.sub || null, variant: verdict.variant || null,
    san: applied.san, from: applied.from, to: applied.to, piece: applied.piece, captured: applied.captured || null,
    answer: verdict.answer || { squares: [], best: null, partial: [] },
    answerSquares: (verdict.answer && verdict.answer.squares) || [],
    question: copy.question, copy, asks, ask: null, taps: [], answered: false, buttonsShown: false,
    netLoss: typeof verdict.netLoss === 'number' ? verdict.netLoss : null,
    refutation: verdict.refutation || [], tutorial: S.tutorial,
    firstHold: !flagSet(KEYS.FIRST_HOLD_SEEN),
    claude: { k2: 'none', k1: 'none', k1Lines: null, coachShown: false, retry: false, linkGone: false },
    openedAt: now(),
    // for the coach and the log
    move: applied, verdict, factsBefore: before, factsAfter: after, fenBefore: chess.fen(), fenAfter: scratch.fen(),
    ply: S.plies + 1, tint,
    k1Ctl: null, k2Ctl: null,
  };
  S.hold = hold;
  S.state = 'held';
  holdUI.open(hold, { hear: false });
  applyLinkPolicy();
  if (!hold.tutorial && coach && !coachHidden && coach.consented() && coach.available()) fireK1(hold);
}

// A last-resort copy set when gate.holdCopy throws: templates filled with the plain words.
function plainCopy(verdict) {
  const piece = wordOf(verdict.targetPiece || 'piece');
  const q = COPY.QUESTION[verdict.category] || COPY.QUESTION.hanging_after_move;
  return {
    question: fill(q, { piece }),
    if_right: () => fill(COPY.IF_RIGHT[verdict.category] || 'Yes.', { piece, taker: 'piece', gained: 'nothing', attacker: 'piece' }),
    if_partial: () => fill(COPY.IF_PARTIAL[verdict.category] || COPY.IF_PARTIAL.hanging_after_move, { piece, square: '', attacker: 'piece' }),
    if_wrong: COPY.IF_WRONG[verdict.category] || COPY.IF_WRONG.hanging_after_move,
    named: fill(COPY.NAMED.piece, { piece, square: (verdict.answer && verdict.answer.best) || '' }),
    anyway: (sawIt) => `${fill(COPY.ANYWAY[verdict.category] || COPY.ANYWAY.allowed_mate, { piece, gained: 'nothing' })} ${sawIt ? COPY.ANYWAY.saw_it : ''}`.trim(),
    fallback: fill(COPY.K2_FALLBACK[verdict.category] || COPY.K2_FALLBACK.allowed_stalemate, { piece, taker: 'piece', square: '', attacker: 'piece' }),
    caption: '',
  };
}

function fireK1(hold) {
  if (!coach || typeof coach.followUps !== 'function') return;
  const ctl = new AbortController();
  hold.k1Ctl = ctl;
  hold.claude.k1 = 'pending';
  Promise.resolve()
    .then(() => coach.followUps({ facts: hold.factsAfter, hold, holdsSoFar: holdLog.slice(), remembered: rememberedLine(), signal: ctl.signal }))
    .then((r) => {
      if (S.hold !== hold) { hold.claude.k1 = 'late'; return; }
      if (r && r.ok && r.value) { hold.claude.k1 = 'ready'; holdUI.setK1(r.value); }
      else hold.claude.k1 = 'failed';
    })
    .catch(() => { if (S.hold === hold) hold.claude.k1 = 'failed'; });
}

function abortHoldCalls(hold) {
  if (!hold) return;
  for (const key of ['k1Ctl', 'k2Ctl']) {
    const c = hold[key];
    hold[key] = null;
    if (c) { try { c.abort(); } catch { /* already done */ } }
  }
}
function abortGhost() {
  if (ghost) { const g = ghost; ghost = null; g.abort(); }
}

function holdRecord(hold, outcome) {
  return {
    fen: hold.fenBefore, san: hold.san, category: hold.category, sub: hold.sub,
    taps: hold.taps.map((t) => ({ square: t.square, grade: t.grade })), outcome,
    coachShown: !!(hold.claude && hold.claude.coachShown), netLoss: hold.netLoss, piece: hold.piece, to: hold.to,
    best: hold.answer ? hold.answer.best : null, ply: hold.ply, gameId,
  };
}
function logHold(hold, outcome) {
  const rec = holdRecord(hold, outcome);
  holdLog.push(rec);
  return rec;
}

async function takeBack() {
  const hold = S.hold;
  if (!hold || S.state !== 'held') return;
  abortGhost();
  abortHoldCalls(hold);
  holdUI.close();
  S.hold = null;
  logHold(hold, 'back');
  backs += 1;
  await board.unmove(hold.move);
  S.state = 'idle';
  board.setState('idle', null);
  board.setInput('move');
  paint();
  lineHold = false;
  if (hold.tutorial) sayHeld(COPY.TUTORIAL_BACK);
  else coachLine.say(COPY.YOUR_MOVE);
  // the cached pre-search is reused; no new search unless there is none for this position
  if (!hold.tutorial && (!preResult || preResult.fen !== chess.fen())) startPre();
  if (mercyPending) offerMercy();
}

async function playAnyway() {
  const hold = S.hold;
  if (!hold || S.state !== 'held') return;
  abortGhost();
  abortHoldCalls(hold);
  const sawIt = hold.taps.some((t) => t.grade === 'right' || t.grade === 'partial');
  holdUI.close();
  S.hold = null;
  S.anyways += 1;
  S.playedPairs.push(`${hold.piece}${hold.to}`);
  if (typeof hold.netLoss === 'number' && hold.netLoss >= GATE.NET_MIN) givenAway += 1;
  logHold(hold, 'anyway');
  S.state = 'pending';
  board.setState('pending', null);
  board.setInput('locked');

  if (hold.tutorial) {
    await tutorialAnyway(hold);
    return;
  }
  let line = null;
  try { line = hold.copy.anyway(sawIt); } catch { line = null; }
  const k1 = hold.claude && hold.claude.k1Lines;
  if (k1 && typeof k1.anyway === 'string' && k1.anyway.trim()) {
    let suffix = '';
    if (sawIt) suffix = COPY.ANYWAY.saw_it;
    else if (line) { const i = line.indexOf('Next time'); if (i >= 0) suffix = line.slice(i); }
    line = suffix ? `${k1.anyway.trim()} ${suffix}` : k1.anyway.trim();
    hold.claude.coachShown = true;
    const rec = holdLog[holdLog.length - 1];
    if (rec) rec.coachShown = true;
  }
  await commit(hold.move, { verdict: hold.verdict, pre: S.pre, before: hold.factsBefore, after: hold.factsAfter, anyway: true, sawIt, anywayLine: line });
}

// The tutorial's play-anyway: the move lands, the refutation takes for real, the '-N' floats,
// 'Now you have felt it. Here is a fresh game.', and the start position loads.
async function tutorialAnyway(hold) {
  const token = turnToken;
  S.tutorial = false;
  store.set(KEYS.TUTORIAL_SEEN, '1');
  chess.move({ from: hold.move.from, to: hold.move.to, promotion: hold.move.promotion });
  S.plies += 1;
  lastMove = hold.move;
  paint();
  S.state = 'reply';
  board.setState('reply', null);
  const wait = T('REPLY_MIN_MS');
  if (wait > 0) await sleep(wait);
  if (token !== turnToken) return;
  const ply = hold.refutation && hold.refutation[0];
  const mv = ply ? uciToMove(chess, ply) : null;
  if (mv) {
    chess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    S.plies += 1;
    lastMove = mv;
    await board.move(mv);
    paint();
  }
  if (token !== turnToken) return;
  sayHeld(COPY.TUTORIAL_ANYWAY);
  if (typeof hold.netLoss === 'number' && hold.netLoss > 0) {
    try { await board.float(`-${hold.netLoss}`, { reduced: reducedNow(), fast: fastNow() }); } catch { /* the float is decoration */ }
    store.set(KEYS.FIRST_FLOAT_SEEN, '1');
  }
  if (token !== turnToken) return;
  resetGame();   // 'Here is a fresh game.': nothing from the tutorial carries into it
  await startGame(START_FEN, { line: COPY.TUTORIAL_ANYWAY, keepLine: true });
}

// ---------------------------------------------------------------------------------------------
// Show me and Hear me out
// ---------------------------------------------------------------------------------------------
async function doShowMe() {
  const hold = S.hold;
  if (!hold || S.state !== 'held') return;
  if (ghost) { abortGhost(); return; }
  const g = showMe({
    board, chess, move: hold.move, refutation: hold.refutation, netLoss: hold.netLoss,
    fast: fastNow(), reduced: reducedNow(), firstFloat: !flagSet(KEYS.FIRST_FLOAT_SEEN), coachLine, store,
  });
  ghost = g;
  await g.done;
  if (ghost === g) ghost = null;
}

function openHearMeOut() {
  const hold = S.hold;
  if (!hold || S.state !== 'held' || !canHear() || hold.claude.k2 === 'shown' || hold.claude.linkGone) return;
  abortGhost();
  holdUI.openInput();
}

async function sendHearMeOut(textIn) {
  const hold = S.hold;
  if (!hold || S.state !== 'held' || !coach) return;
  const text = String(textIn == null ? holdUI.inputValue() : textIn).trim();
  if (!text) return;
  abortGhost();
  holdUI.closeInput();
  holdUI.setLink('but', 'hidden');
  const lineBefore = coachLine.text();
  holdUI.looking(text);
  hold.claude.k2 = 'asking';
  const ctl = new AbortController();
  hold.k2Ctl = ctl;
  let r;
  try {
    r = await coach.hearMeOut({ facts: hold.factsAfter, hold, asks: hold.asks, text, holdsSoFar: holdLog.slice(), signal: ctl.signal });
  } catch (e) {
    r = { ok: false, code: e && e.code ? e.code : 'upstream_error' };
  }
  if (hold.k2Ctl === ctl) hold.k2Ctl = null;
  S.consented = !!(coach.consented && coach.consented());
  if (S.hold !== hold || S.state !== 'held') return;
  holdUI.unlooking();
  if (r && r.ok && r.value) {
    const ask = r.value.ask ? hold.asks.find((a) => a && a.kind === r.value.ask) : null;
    holdUI.showSay(r.value, ask ? ask.question : '');
    hold.claude.linkGone = true;
    applyLinkPolicy();
    return;
  }
  const code = r && r.code ? r.code : 'upstream_error';
  if (CLAUDE.HIDE_FOR_VIEW.includes(code)) {
    S.coachAvailable = false;
    coachHidden = true;
    hold.claude.k2 = 'failed';
    hold.claude.linkGone = true;
    coachLine.say(lineBefore);
    applyLinkPolicy();
    return;
  }
  if (code === CLAUDE.RESTING) {
    hold.claude.k2 = 'failed';
    hold.claude.linkGone = true;
    S.resting = true;
    if (restingTimer) clearTimeout(restingTimer);
    restingTimer = setTimeout(() => { restingTimer = null; S.resting = false; applyLinkPolicy(); }, T('RESTING_MS'));
    sayHeld(COPY.RESTING);
    applyLinkPolicy();
    return;
  }
  if (code === CLAUDE.SILENT) {
    hold.claude.k2 = 'failed';
    coachLine.say(lineBefore);
    applyLinkPolicy();
    return;
  }
  if (code === CLAUDE.RETRY_ONCE && !hold.claude.retry) {
    hold.claude.retry = true;
    holdUI.showFallback();
    applyLinkPolicy();
    return;
  }
  hold.claude.linkGone = true;
  holdUI.showFallback();
  applyLinkPolicy();
}

// ---------------------------------------------------------------------------------------------
// Give up, mercy, ends, the close card
// ---------------------------------------------------------------------------------------------
function askGiveUp() {
  if (S.state === 'over') return;
  if (actionsEl.querySelector('[data-action="giveup-yes"]')) return;
  if (S.hold && holdUI.inputIsOpen()) holdUI.closeInput();
  barBefore = Array.from(actionsEl.childNodes);
  actionsEl.textContent = '';
  const ask = document.createElement('span');
  ask.className = 'ask';
  ask.textContent = COPY.GIVE_UP_ASK;
  actionsEl.appendChild(ask);
  actionsEl.appendChild(button(DOM.buttonClasses.primary, 'giveup-yes', COPY.BUTTONS.YES));
  actionsEl.appendChild(button(DOM.buttonClasses.quiet, 'keep', COPY.BUTTONS.KEEP_PLAYING));
}
function keepPlaying() {
  if (actionsEl.querySelector('[data-action="giveup-yes"]')) {
    actionsEl.textContent = '';
    if (S.hold) holdUI.restore();
    else if (barBefore) for (const n of barBefore) actionsEl.appendChild(n);
    barBefore = null;
    return;
  }
  if (actionsEl.querySelector('[data-action="startagain"]')) {
    actionsEl.textContent = '';
    lineHold = false;
    if (S.state === 'idle') coachLine.say(COPY.YOUR_MOVE);
  }
}
function giveUp() {
  if (S.state === 'over') return;
  endGame('giveup', COPY.ENDS.GAVE_UP);
}

function endGame(result, line) {
  turnToken += 1;
  preToken += 1;
  abortGhost();
  if (S.hold) {
    const hold = S.hold;
    abortHoldCalls(hold);
    logHold(hold, 'ended');
    holdUI.close();
    S.hold = null;
  }
  edge(false);
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
  mercyPending = false;
  barBefore = null;
  S.result = result;
  S.state = 'over';
  board.setState('over', null);
  board.setInput('locked');
  board.lift(null);
  board.pick(null);
  ringSquare = null;
  paint();
  actionsEl.textContent = '';
  sayHeld(line);
  if (S.plies > 0 || holdLog.length) storeGame(result);
  fillCloseCard();
}

function storeGame(result) {
  const summary = {
    id: gameId, date: new Date().toISOString(), result, givenAway, holds: holdLog.slice(),
    freeTaken, playedAnyway: S.anyways, plies: S.plies, backs,
  };
  store.append(KEYS.GAMES, summary, KEEP.GAMES);
  for (const h of holdLog) store.append(KEYS.HOLDS, h, KEEP.HOLDS);
  if (givenAway === 0) {
    const steps = BOT.GIFT_RATE_STEPS;
    const cur = Number(store.get(KEYS.GIFT_RATE, steps[0]));
    const i = steps.indexOf(cur);
    const next = i < 0 ? steps[Math.min(1, steps.length - 1)] : steps[Math.min(i + 1, steps.length - 1)];
    store.set(KEYS.GIFT_RATE, next);
  }
}

function fillCloseCard() {
  if (!closeEl) return;
  const sum = closeEl.querySelector('.close-sum');
  const list = closeEl.querySelector('.close-holds');
  const before = previousGame;
  const vars = {
    times: timesWord(holdLog.length), back: timesWord(backs), g: String(givenAway),
    last: before ? fill(COPY.CLOSE.LAST, { n: String(before.givenAway) }) : '', f: String(freeTaken),
  };
  if (sum) sum.textContent = fill(holdLog.length ? COPY.CLOSE.SUMMARY : COPY.CLOSE.SUMMARY_NONE, vars);
  if (list) {
    list.textContent = '';
    for (const rec of holdLog) {
      let caption = '';
      try { caption = gate.closeCaption(rec); } catch { caption = ''; }
      if (!caption) caption = `${wordOf(rec.piece)} to ${rec.to}: ${COPY.CLOSE.OUTCOME[rec.outcome] || rec.outcome}.`;
      const li = document.createElement('li');
      li.textContent = caption.charAt(0).toUpperCase() + caption.slice(1);
      list.appendChild(li);
    }
  }
  closeEl.hidden = false;
}

// ---------------------------------------------------------------------------------------------
// Games: start, load, new
// ---------------------------------------------------------------------------------------------
function resetGame() {
  gameId = Date.now().toString(36);
  holdLog = [];
  backs = 0;
  givenAway = 0;
  freeTaken = 0;
  botEvals = [];
  S.plies = 0;
  S.anyways = 0;
  S.playedPairs = [];
  S.rewardsSaid = 0;
  S.lastRewardPly = -10;
  S.mercyOffered = false;
  S.mercyStreak = 0;
  S.resignStreak = 0;
  S.botMoveNo = 0;
  S.result = null;
  S.giftDue = false;
  S.lastGift = null;
  S.lastVerdict = null;
  S.forcedReply = null;
  mercyPly = -1;
}
function dropEverything() {
  turnToken += 1;
  abortGhost();
  if (S.hold) { abortHoldCalls(S.hold); holdUI.close(); S.hold = null; }
  edge(false);
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
  ringSquare = null;
  mercyPly = -1;
  cancelLineTimer();
  lineHold = false;
  mercyPending = false;
  barBefore = null;
  picked = null;
  actionsEl.textContent = '';
  if (closeEl) closeEl.hidden = true;
  try { document.body.classList.remove('typing'); } catch { /* ignore */ }
}
// Put a position on the board and go idle. `tutorial` opens the tutorial on it.
async function startGame(fen, { line = null, tutorial = false, keepLine = false } = {}) {
  dropEverything();
  chess = new Chess(fen);
  lastMove = null;
  factsCache = null;
  S.lastRewardPly = -10;   // a loaded position starts a new move sequence; the budget count stays
  S.tutorial = !!tutorial;
  S.result = null;
  board.setPosition(chess);
  board.setMarks({});
  board.pick(null);
  board.lift(null);
  board.pending(null);
  S.state = 'idle';
  board.setState('idle', null);
  board.setInput('move');
  if (line) { coachLine.say(line); lineHold = !!keepLine; }
  else coachLine.say(COPY.YOUR_MOVE);
  if (chess.isGameOver()) {
    if (chess.isCheckmate()) endGame(chess.turn() === PLAYER ? 'mate-loss' : 'mate-win', chess.turn() === PLAYER ? COPY.ENDS.MATE_LOSS : COPY.ENDS.MATE_WIN);
    else endGame('draw', COPY.ENDS.DRAW);
    return;
  }
  await startPre();
}

async function newGame({ line } = {}) {
  dropEverything();
  resetGame();
  previousGame = store.list(KEYS.GAMES).slice(-1)[0] || null;
  const remembered = line || rememberedLine() || COPY.YOUR_MOVE;
  await startGame(START_FEN, { line: remembered, keepLine: remembered !== COPY.YOUR_MOVE });
}

async function loadFen(fen) {
  let ok = null;
  try { ok = new Chess(fen); } catch { ok = null; }
  if (!ok) return;
  await startGame(fen, { line: COPY.YOUR_MOVE });
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------
async function doAction(name) {
  switch (name) {
    case 'takeback': return takeBack();
    case 'anyway': return playAnyway();
    case 'showme': return doShowMe();
    case 'but': return openHearMeOut();
    case 'send': return sendHearMeOut();
    case 'giveup': return askGiveUp();
    case 'giveup-yes': return giveUp();
    case 'keep': return keepPlaying();
    case 'startagain': return giveUp();
    case 'again': return S.state === 'over' ? newGame() : undefined;
    case 'theme': return toggleTheme();
    default: return undefined;
  }
}
async function sayText(text) {
  const hold = S.hold;
  if (!hold || S.state !== 'held' || !canHear()) return;
  if (!holdUI.inputIsOpen()) openHearMeOut();
  if (!holdUI.inputIsOpen()) return;
  const input = byId(DOM.ids.sayInput);
  if (input) input.value = String(text == null ? '' : text);
  await sendHearMeOut(String(text == null ? '' : text));
}

// A running Show me is aborted by any action button; a second Show me tap only aborts.
function actionFromUi(name) {
  if (!DOM.actions.includes(name)) return Promise.resolve();
  const wasGhost = !!ghost;
  if (wasGhost && name !== 'theme') abortGhost();
  if (wasGhost && name === 'showme') return Promise.resolve();
  return doAction(name);
}
document.addEventListener('click', (ev) => {
  const t = ev.target instanceof Element ? ev.target.closest('[data-action]') : null;
  if (!t) return;
  actionFromUi(t.dataset.action);
});
actionsEl.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  const t = ev.target;
  if (t && t.id === DOM.ids.sayInput) { ev.preventDefault(); doAction('send'); }
});
boardEl.addEventListener('pointerdown', () => { if (ghost) abortGhost(); });
try {
  if (window.visualViewport) window.visualViewport.addEventListener('resize', setVvh);
  window.addEventListener('resize', setVvh);
} catch { /* ignore */ }

// ---------------------------------------------------------------------------------------------
// window.__app
// ---------------------------------------------------------------------------------------------
const app = {
  async load(fen) {
    await loadFen(fen);
  },
  async play(san) {
    if (S.state === 'over') return 'over';
    if (S.state !== 'idle') return 'illegal';
    const mv = findMove(san);
    if (!mv) return 'illegal';
    const r = await drop(mv);
    return r;
  },
  tap(square) {
    if (!SQUARE_RE.test(String(square))) return null;
    if (S.state === 'held') {
      if (ghost) abortGhost();
      return holdUI.tap(square);
    }
    if (S.state === 'idle') {
      const p = chess.get(square);
      onBoardTap(square, { piece: p ? p.color + p.type.toUpperCase() : null, kind: p ? 'piece' : 'square' });
    }
    return null;
  },
  async action(name) {
    await actionFromUi(name);
  },
  say: sayText,
  botMove(san) {
    if (!fastNow()) throw new Error('botMove is test mode only: set __app.fast = true first');
    S.forcedReply = typeof san === 'string' ? san : null;
  },
  fen: () => chess.fen(),
  state: () => S,
  waitEngine() {
    return Promise.race([engine.ready.then(() => true), sleep(ENGINE.WAIT_READY_MS).then(() => false)]);
  },
  holds: () => holdLog.slice(),
  stats: () => ({
    holdsCount: holdLog.length, backs, anyways: S.anyways, givenAway, freeTaken, rewardsSaid: S.rewardsSaid,
    plies: S.plies, lastGivenAway: previousGame ? previousGame.givenAway : null, gameId,
  }),
  newGame: () => newGame(),
};
Object.defineProperty(app, 'fast', { get: fastNow, set: setFast, enumerable: true });
window.__app = app;

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------
function fetchTutorial() {
  tutorialReady = (async () => {
    try {
      const r = await fetch('./data/tutorial.json');
      if (!r || !r.ok) throw new Error('no tutorial table');
      const j = await r.json();
      if (!j || !j.moves) throw new Error('bad tutorial table');
      tutorialData = j;
    } catch {
      tutorialData = null;
      // no table: the tutorial position is played as a real game
      if (S.tutorial) { S.tutorial = false; if (S.state === 'idle') startPre(); }
    }
    return tutorialData;
  })();
  return tutorialReady;
}

function boot() {
  applyTheme();
  setVvh();
  resetGame();
  const firstVisit = !flagSet(KEYS.TUTORIAL_SEEN);
  if (firstVisit) {
    fetchTutorial();
    startGame(TUTORIAL_FEN, { line: COPY.TUTORIAL_OPEN, tutorial: true, keepLine: true });
  } else {
    const remembered = rememberedLine();
    startGame(START_FEN, { line: remembered || COPY.YOUR_MOVE, keepLine: !!remembered });
  }
  // the coach after first paint
  const later = () => setTimeout(bootCoach, 0);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(later);
  else later();
}
boot();
