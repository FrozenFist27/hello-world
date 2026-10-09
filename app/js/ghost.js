// ghost.js - Show me. The refutation plies play as translucent ghosts on the #ghosts layer while
// the real pieces dim; when the capture lands the '-N' floats off the player's edge (named once
// in words the first time a browser sees one); a beat; everything slides back. Any abort rewinds
// at once. The real position is never touched: a scratch Chess places the ghosts.

import { Chess } from '../vendor/chess.js';
import { COPY, KEYS, VALUES, PIECE_WORDS, fill, numberWord, timing } from './contract.js';

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function applyPly(chess, ply) {
  try {
    if (typeof ply === 'string' && UCI_RE.test(ply)) {
      return chess.move({ from: ply.slice(0, 2), to: ply.slice(2, 4), promotion: ply[4] || undefined });
    }
    if (typeof ply === 'string') return chess.move(ply);
    if (ply && ply.from && ply.to) return chess.move({ from: ply.from, to: ply.to, promotion: ply.promotion });
  } catch { /* an illegal ply ends the line */ }
  return null;
}

// The one-time sentence: 'Minus two: a knight counts three, a pawn one.'
export function firstFloatLine(move, netLoss) {
  const piece = move && move.piece ? move.piece : 'p';
  const vars = { n: numberWord(netLoss), piece: PIECE_WORDS[piece], v: numberWord(VALUES[piece]) };
  if (move && move.captured) {
    return fill(COPY.FIRST_FLOAT, { ...vars, captured: PIECE_WORDS[move.captured], v2: numberWord(VALUES[move.captured]) });
  }
  return fill(COPY.FIRST_FLOAT_PLAIN, vars);
}

// `fromBefore`: the plies play from the position before his move (free_piece_ignored shows the
// capture he walked past, with no loss to float); otherwise after it.
export function showMe({ board, chess, move, refutation = [], netLoss = null, fromBefore = false, fast = false, reduced = false, firstFloat = false, coachLine = null, store = null } = {}) {
  let aborted = false;
  let wake = null;
  const ghosts = [];          // { el, from, to }
  const lineBefore = coachLine && typeof coachLine.text === 'function' ? coachLine.text() : null;
  let lineChanged = false;

  const ms = (name) => timing(name, fast);
  const sleep = (t) => new Promise((resolve) => {
    if (aborted || t <= 0) { resolve(); return; }
    const id = setTimeout(() => { wake = null; resolve(); }, t);
    wake = () => { clearTimeout(id); wake = null; resolve(); };
  });

  // The scratch position after his move, then the plies as verbose moves.
  const scratch = new Chess(chess.fen());
  const plies = [];
  if (fromBefore || applyPly(scratch, move)) {
    for (const ply of refutation) {
      const mv = applyPly(scratch, ply);
      if (!mv) break;
      plies.push(mv);
    }
  }
  const hasLoss = !fromBefore && typeof netLoss === 'number' && netLoss > 0;
  const take = (mv) => { if (mv.captured && board.ghosts.take) board.ghosts.take(mv.to, true); };

  function cleanup() {
    board.ghosts.clear();
    board.ghosts.setDim(false);
    if (board.ghosts.untakeAll) board.ghosts.untakeAll();
    ghosts.length = 0;
    if (lineChanged && coachLine && lineBefore != null) coachLine.say(lineBefore);
    lineChanged = false;
  }

  async function floatLoss() {
    if (!hasLoss) return;
    if (firstFloat && coachLine) {
      coachLine.say(firstFloatLine(move, netLoss));
      lineChanged = true;
      if (store) store.set(KEYS.FIRST_FLOAT_SEEN, '1');
    }
    const p = board.float(`-${netLoss}`, { reduced, fast });
    await Promise.race([p, sleep(reduced ? ms('REDUCED_STATIC_MS') : ms('FLOAT_MS'))]);
  }

  async function run() {
    if (!plies.length) return;
    board.ghosts.setDim(true);
    if (reduced) {
      // The final position, statically, with the label beside the board.
      for (const mv of plies) {
        const code = mv.color + mv.piece.toUpperCase();
        const el = board.ghosts.add(mv.promotion ? mv.color + mv.promotion.toUpperCase() : code, mv.to);
        ghosts.push({ el, from: mv.from, to: mv.to });
        take(mv);
      }
      const label = floatLoss();
      await sleep(ms('REDUCED_STATIC_MS'));
      await label;
      return;
    }
    let first = true;
    for (const mv of plies) {
      if (aborted) return;
      const code = mv.color + mv.piece.toUpperCase();
      const el = board.ghosts.add(code, mv.from);
      ghosts.push({ el, from: mv.from, to: mv.to });
      // let the browser paint the ghost at its origin before it slides
      await sleep(16);
      if (aborted) return;
      const slide = board.ghosts.move(el, mv.to, ms('GHOST_PLY_MS'));
      await Promise.race([slide, sleep(ms('GHOST_PLY_MS'))]);
      if (aborted) return;
      if (mv.promotion) el.dataset.piece = mv.color + mv.promotion.toUpperCase();
      take(mv);
      if (first && mv.captured) {
        first = false;
        await floatLoss();
      }
    }
    if (aborted) return;
    await sleep(ms('BEAT_MS'));
    if (aborted) return;
    // rewind: every ghost slides back to where it came from and the taken pieces reappear
    if (board.ghosts.untakeAll) board.ghosts.untakeAll();
    const back = ghosts.map((g) => board.ghosts.move(g.el, g.from, ms('REWIND_MS')));
    await Promise.race([Promise.all(back), sleep(ms('REWIND_MS') + 16)]);
  }

  const done = run().catch(() => { /* a broken ply never breaks the hold */ }).then(cleanup);

  function abort() {
    if (aborted) return;
    aborted = true;
    if (wake) wake();
    cleanup();
  }

  return { done, abort };
}
