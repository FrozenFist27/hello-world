// bot.js — the opponent recipe, exactly as PRODUCT.md 'The opponent' spells it out.
//
//   loadBook(url)                 fetch ./data/book.json once; failures leave the book empty
//   bookReply(chess)              { san, uci } | null, keyed by the first four FEN fields
//   giftCandidates(chess)         legal bot moves that leave a bot minor piece attacked-and-undefended or
//                                 attacked by a pawn, give no check, hang nothing worth >= 5, allow no mate in one
//   guardsOk(chessAfter, bot)     no bot rook or queen hanging, no mate in one for the player
//   chooseBotMove(engine, chess, { botMoveNo, giftRate, giftDue, anyway, random })
//                                 book -> anyway -> look (forced) -> gift -> sampler -> guarded
//   shouldResign({ botEvals, botMoveNo, chess, player })
//   materialExtra(chess, player)  { q, r, b, n, p } the player has more of, for the resignation line
//
// Every chess fact here comes from chess.js on scratch copies; the engine instance is passed in.

import { BOT, BOT_COLOR, PLAYER, VALUES, GATE, ENGINE } from './contract.js';
import { Chess } from '../vendor/chess.js';

// ---------------------------------------------------------------------------------------------
// Book
// ---------------------------------------------------------------------------------------------
let book = { entries: {} };
let bookPromise = null;

export function fen4(fen) {
  return String(fen).split(' ').slice(0, 4).join(' ');
}

// Fetches the book once; a second call returns the same promise. Passing an object with `entries`
// (node tests) installs it directly.
export function loadBook(url = './data/book.json') {
  if (url && typeof url === 'object') {
    book = url.entries ? url : { entries: {} };
    bookPromise = Promise.resolve();
    return bookPromise;
  }
  if (bookPromise) return bookPromise;
  bookPromise = (async () => {
    try {
      const r = await fetch(url);
      if (!r || !r.ok) return;
      const j = await r.json();
      if (j && j.entries && typeof j.entries === 'object') book = j;
    } catch { /* the book stays empty; the engine covers the opening */ }
  })();
  return bookPromise;
}

export function bookReply(chess) {
  const entry = book.entries[fen4(chess.fen())];
  if (!entry || !entry.reply) return null;
  const sc = new Chess(chess.fen());
  let mv = null;
  try { mv = sc.move(entry.reply); } catch { mv = null; }
  if (!mv) return null;
  return { san: mv.san, uci: uciOf(mv) };
}

// ---------------------------------------------------------------------------------------------
// chess.js helpers
// ---------------------------------------------------------------------------------------------
export function uciOf(mv) {
  return mv.from + mv.to + (mv.promotion || '');
}

export function uciToMove(chess, uci) {
  if (!uci || uci.length < 4) return null;
  const from = uci.slice(0, 2), to = uci.slice(2, 4), promotion = uci[4] || undefined;
  for (const mv of chess.moves({ verbose: true })) {
    if (mv.from === from && mv.to === to && (promotion ? mv.promotion === promotion : !mv.promotion || mv.promotion === 'q')) return mv;
  }
  return null;
}

function other(color) { return color === 'w' ? 'b' : 'w'; }

function pieceAt(chess, square) {
  const p = chess.get(square);
  return p ? { square, type: p.type, color: p.color, value: VALUES[p.type] } : null;
}

// The fact-sheet predicate: attacked and (undefended, or the cheapest attacker is worth less than the
// piece; the king never counts as the cheaper attacker of a defended piece). Kings never hang.
export function isHanging(chess, square) {
  const p = pieceAt(chess, square);
  if (!p || p.type === 'k') return false;
  const attackers = chess.attackers(square, other(p.color));
  if (!attackers.length) return false;
  const defenders = chess.attackers(square, p.color);
  if (!defenders.length) return true;
  let cheapest = Infinity;
  for (const a of attackers) {
    const ap = chess.get(a);
    if (!ap || ap.type === 'k') continue;
    cheapest = Math.min(cheapest, VALUES[ap.type]);
  }
  return cheapest < p.value;
}

// Attacked by a pawn of the other colour.
function attackedByPawn(chess, square, byColor) {
  return chess.attackers(square, byColor).some((a) => { const ap = chess.get(a); return ap && ap.type === 'p'; });
}

function piecesOf(chess, color) {
  const out = [];
  for (const row of chess.board()) for (const cell of row) if (cell && cell.color === color) out.push({ square: cell.square, type: cell.type, value: VALUES[cell.type] });
  return out;
}

export function hangingPieces(chess, color, minValue = 0) {
  return piecesOf(chess, color).filter((p) => p.type !== 'k' && p.value >= minValue && isHanging(chess, p.square));
}

// Does the side to move have a checkmate in one? (Enumerates its legal moves on a scratch copy.)
export function hasMateInOne(chess) {
  const sc = new Chess(chess.fen());
  for (const mv of sc.moves({ verbose: true })) {
    sc.move(mv);
    const mate = sc.isCheckmate();
    sc.undo();
    if (mate) return true;
  }
  return false;
}

// The sampler's guards on the position after the bot's move (the player to move).
export function guardsOk(chessAfter, botColor = BOT_COLOR) {
  if (hangingPieces(chessAfter, botColor, BOT.GUARD_HANG_VALUE).length) return false;
  if (hasMateInOne(chessAfter)) return false;
  return true;
}

// Legal bot moves after which a bot knight or bishop is attacked-and-undefended or attacked by a pawn,
// giving no check, hanging nothing worth >= GUARD_HANG_VALUE and allowing no mate in one.
// Each candidate: { san, uci, square, piece, hung: [square] } (square = the hung minor, the moved piece first).
export function giftCandidates(chess) {
  const bot = chess.turn();
  const player = other(bot);
  const out = [];
  const base = new Chess(chess.fen());
  for (const mv of base.moves({ verbose: true })) {
    const sc = new Chess(chess.fen());
    sc.move(mv);
    if (sc.isCheck()) continue;
    const hung = [];
    for (const p of piecesOf(sc, bot)) {
      if (p.type !== 'n' && p.type !== 'b') continue;
      const attackers = sc.attackers(p.square, player);
      if (!attackers.length) continue;
      const undefended = sc.attackers(p.square, bot).length === 0;
      if (undefended || attackedByPawn(sc, p.square, player)) hung.push(p.square);
    }
    if (!hung.length) continue;
    if (hangingPieces(sc, bot, BOT.GUARD_HANG_VALUE).length) continue;
    if (hasMateInOne(sc)) continue;
    hung.sort((a, b) => (a === mv.to ? -1 : b === mv.to ? 1 : 0));
    out.push({ san: mv.san, uci: uciOf(mv), square: hung[0], piece: sc.get(hung[0]).type, hung });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------------------------
// A side-to-move score as a number for that side: cp as is; mate N -> sign(N) * (MATE_SCORE - |N|).
export function sideScore(score) {
  if (!score) return 0;
  if (typeof score.cp === 'number') return score.cp;
  if (typeof score.mate === 'number') return score.mate === 0 ? -GATE.MATE_SCORE : Math.sign(score.mate) * (GATE.MATE_SCORE - Math.abs(score.mate));
  return 0;
}

function shuffle(arr, random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function firstMove(result) {
  const l1 = result && result.lines && result.lines[0];
  return (l1 && l1.pv && l1.pv[0]) || (result && result.bestmove) || null;
}

function answer(mv, how, botEval, gift, checked) {
  return { san: mv.san, uci: uciOf(mv), how, botEval, gift, checked };
}

// ---------------------------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------------------------
export async function chooseBotMove(engine, chess, { botMoveNo = 1, giftRate = BOT.GIFT_RATE, giftDue = false, anyway = false, random = Math.random } = {}) {
  const fen = chess.fen();
  const bot = chess.turn();
  const legal = chess.moves({ verbose: true });
  if (!legal.length) return null;

  // (0) the book, at any move number
  const fromBook = bookReply(chess);
  if (fromBook) return { ...fromBook, how: 'book', botEval: null, gift: null, checked: 0 };

  // (1) play it anyway: the true best reply so the punishment is certain
  if (anyway) {
    const r = await engine.search(fen, { depth: BOT.ANYWAY_DEPTH, multipv: 1, skill: ENGINE.FULL_SKILL });
    const mv = uciToMove(chess, firstMove(r)) || legal[0];
    const botEval = r.lines[0] ? sideScore(r.lines[0].score) : null;
    return answer(mv, 'anyway', botEval, null, 0);
  }

  // (2) the full-strength look
  const look = await engine.search(fen, { depth: BOT.LOOK_DEPTH, multipv: ENGINE.MULTIPV, skill: ENGINE.FULL_SKILL });
  const l1 = look.lines[0] || null;
  const l2 = look.lines[1] || null;
  const topMove = uciToMove(chess, firstMove(look)) || legal[0];
  const botEval = l1 ? sideScore(l1.score) : 0;
  const runner = l2 ? sideScore(l2.score) : -Infinity;
  const isMate = !!(l1 && typeof l1.score.mate === 'number' && l1.score.mate > 0);
  // Punish-always: the top move is a capture that leads line 2 by FORCED_LEAD_CP, or a mate. When line 2
  // captures on the same square the piece is taken either way, so that counts as a lead too.
  const second = l2 ? uciToMove(chess, l2.pv[0]) : null;
  const sameSquare = !!(second && second.captured && second.to === topMove.to);
  if ((topMove.captured && (botEval - runner >= BOT.FORCED_LEAD_CP || sameSquare)) || isMate) {
    return answer(topMove, 'forced', botEval, null, 0);
  }

  // (3) the gift, from the bot's third move
  let checked = 0;
  if (botMoveNo >= BOT.GIFT_FROM_MOVE && (giftDue || random() < giftRate)) {
    const cands = shuffle(giftCandidates(chess), random);
    for (const cand of cands.slice(0, BOT.GIFT_MAX_CHECKS)) {
      const sc = new Chess(fen);
      const mv = sc.move(cand.san);
      if (!mv) continue;
      const r = await engine.search(sc.fen(), { depth: BOT.GIFT_DEPTH, multipv: 1, skill: ENGINE.FULL_SKILL });
      checked++;
      if (!r.lines[0]) continue;
      const reply = uciToMove(sc, firstMove(r));
      const playerScore = sideScore(r.lines[0].score);      // the player is to move after the candidate
      const gain = playerScore - (-botEval);
      if (reply && reply.captured && cand.hung.includes(reply.to) && gain >= BOT.GIFT_MIN_GAIN_CP && playerScore < BOT.GIFT_CAP_CP) {
        const hung = sc.get(reply.to);
        return answer(mv, 'gift', botEval, { verified: true, square: reply.to, piece: hung ? hung.type : cand.piece }, checked);
      }
    }
  }

  // (4) the sampler with chess.js guards, re-picked up to SAMPLE_RETRIES times
  for (let attempt = 0; attempt <= BOT.SAMPLE_RETRIES; attempt++) {
    const r = await engine.search(fen, { depth: BOT.SAMPLE_DEPTH, multipv: 1, skill: BOT.SKILL });
    const mv = uciToMove(chess, r.bestmove || firstMove(r));
    if (!mv) continue;
    const sc = new Chess(fen);
    sc.move(mv);
    if (guardsOk(sc, bot)) return answer(mv, 'sampled', botEval, null, checked);
  }

  // (5) the look's top move
  return answer(topMove, 'guarded', botEval, null, checked);
}

// ---------------------------------------------------------------------------------------------
// Ends
// ---------------------------------------------------------------------------------------------
function counts(chess, color) {
  const c = { q: 0, r: 0, b: 0, n: 0, p: 0, k: 0 };
  for (const p of piecesOf(chess, color)) c[p.type]++;
  return c;
}

// Bot-side eval <= RESIGN_CP for RESIGN_STREAK consecutive bot moves after RESIGN_AFTER_MOVE, unless the
// player has a queen or a rook and the bot has only king and pawns (then it plays on for the mate).
export function shouldResign({ botEvals = [], botMoveNo = 0, chess, player = PLAYER }) {
  if (botMoveNo <= BOT.RESIGN_AFTER_MOVE) return false;
  const evals = botEvals.filter((v) => typeof v === 'number');
  if (evals.length < BOT.RESIGN_STREAK) return false;
  const last = evals.slice(-BOT.RESIGN_STREAK);
  if (!last.every((v) => v <= BOT.RESIGN_CP)) return false;
  if (chess) {
    const bot = other(player);
    const mine = counts(chess, player);
    const theirs = counts(chess, bot);
    const playerHasHeavy = mine.q > 0 || mine.r > 0;
    const botOnlyKingAndPawns = theirs.q === 0 && theirs.r === 0 && theirs.b === 0 && theirs.n === 0;
    if (playerHasHeavy && botOnlyKingAndPawns) return false;
  }
  return true;
}

// Player count minus bot count per type, negatives dropped, for COPY.ENDS.RESIGN via materialWords().
export function materialExtra(chess, player = PLAYER) {
  const mine = counts(chess, player);
  const theirs = counts(chess, other(player));
  const out = {};
  for (const t of ['q', 'r', 'b', 'n', 'p']) out[t] = Math.max(0, mine[t] - theirs[t]);
  return out;
}
