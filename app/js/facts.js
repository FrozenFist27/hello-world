// facts.js — the chess.js fact sheet. Pure: a Chess instance in, plain data out. Nothing here
// touches the DOM, the engine or Claude. gate.js reads these facts; coach.js renders them into
// the prompt; game.js builds them once per position.
//
// chess.attackers(square, color) in chess.js 1.4.0 returns the squares of `color`'s pieces that
// reach `square` by geometry (pins ignored; a piece's own colour counts, so it also lists the
// defenders of a piece of that colour). That is the predicate the research used and the one the
// spec's "attacked and undefended, or attacked by a cheaper piece" means.

import { Chess } from '../vendor/chess.js';
import { VALUES as CONTRACT_VALUES, PIECE_WORDS, COLOR_WORDS, SQUARES, PLAYER } from './contract.js';

export const VALUES = CONTRACT_VALUES;

const FILES = 'abcdefgh';
const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

export function pieceWord(type) {
  return type in PIECE_WORDS ? PIECE_WORDS[type] : String(type);
}
export function colorWord(color) {
  return color in COLOR_WORDS ? COLOR_WORDS[color] : String(color);
}

function other(color) {
  return color === 'w' ? 'b' : 'w';
}

function squareOf(file, rank) {
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;
  return FILES[file] + rank;
}

function withPiece(chess, squares) {
  return squares.map((sq) => {
    const p = chess.get(sq);
    return { square: sq, type: p ? p.type : null, value: p ? VALUES[p.type] : 0 };
  });
}

// { square, type, color, value, attackers, defenders, cheapestAttacker, hanging } or null when empty.
export function pieceInfo(chess, square) {
  const piece = chess.get(square);
  if (!piece) return null;
  const value = VALUES[piece.type];
  const attackers = withPiece(chess, chess.attackers(square, other(piece.color)));
  const defenders = withPiece(chess, chess.attackers(square, piece.color));
  let cheapestAttacker = null;
  if (attackers.length) {
    // A king cannot take a defended piece, so it never counts as the cheaper attacker then.
    const pool = defenders.length ? attackers.filter((a) => a.type !== 'k') : attackers;
    if (pool.length) cheapestAttacker = Math.min(...pool.map((a) => a.value));
  }
  const hanging =
    piece.type !== 'k' &&
    attackers.length > 0 &&
    (defenders.length === 0 || (cheapestAttacker !== null && cheapestAttacker < value));
  return { square, type: piece.type, color: piece.color, value, attackers, defenders, cheapestAttacker, hanging };
}

// Every piece of `color` that is attacked and (undefended, or attacked by a cheaper piece).
// Kings are never hanging; pawns are included (consumers filter value >= 2 where the spec says so).
export function hangingPieces(chess, color) {
  const out = [];
  for (const sq of SQUARES) {
    const p = chess.get(sq);
    if (!p || p.color !== color || p.type === 'k') continue;
    const info = pieceInfo(chess, sq);
    if (info && info.hanging) out.push(info);
  }
  return out;
}

// The side to move's legal captures onto `square` (pins honoured). One entry per origin square.
export function legalTakers(chess, square) {
  const out = [];
  const seen = new Set();
  for (const m of chess.moves({ verbose: true })) {
    if (m.to !== square || !m.captured || seen.has(m.from)) continue;
    seen.add(m.from);
    out.push({ square: m.from, type: m.piece, value: VALUES[m.piece], san: m.san, uci: m.from + m.to + (m.promotion || '') });
  }
  return out;
}

// True when a pawn of `byColor` can attack `square` after one legal-looking pawn move: a push one
// square, or a double push from its start rank with both squares in front of it empty.
export function pawnCanKick(chess, square, byColor) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  // A pawn of byColor attacks `square` from (file +/- 1, rank - dir) where dir is its direction.
  const dir = byColor === 'w' ? 1 : -1;
  const startRank = byColor === 'w' ? 2 : 7;
  for (const df of [-1, 1]) {
    const f = file + df;
    const attackRank = rank - dir; // where the pawn would stand to attack `square`
    const landing = squareOf(f, attackRank);
    if (!landing || chess.get(landing)) continue; // it must be able to land there
    // one push
    const one = squareOf(f, attackRank - dir);
    const p1 = one ? chess.get(one) : null;
    if (p1 && p1.type === 'p' && p1.color === byColor) return true;
    // double push from the start rank: the pawn two squares back, the square between empty
    const two = squareOf(f, attackRank - 2 * dir);
    if (two && attackRank - 2 * dir === startRank && one && !chess.get(one)) {
      const p2 = chess.get(two);
      if (p2 && p2.type === 'p' && p2.color === byColor) return true;
    }
  }
  return false;
}

// The piece's legal destinations plus its origin where no enemy piece attacks the square and no
// enemy pawn can attack it with one pawn move. Destinations are tested on a scratch copy with the
// piece already there, so a ray the piece itself was blocking counts.
export function safeSquares(chess, from) {
  const piece = chess.get(from);
  if (!piece) return [];
  const enemy = other(piece.color);
  const out = [];
  if (chess.attackers(from, enemy).length === 0 && !pawnCanKick(chess, from, enemy)) out.push(from);
  const scratch = new Chess(chess.fen());
  for (const m of chess.moves({ square: from, verbose: true })) {
    if (out.includes(m.to)) continue;
    scratch.move({ from: m.from, to: m.to, promotion: m.promotion });
    const safe = scratch.attackers(m.to, enemy).length === 0 && !pawnCanKick(scratch, m.to, enemy);
    scratch.undo();
    if (safe) out.push(m.to);
  }
  return out;
}

// The side to move's moves that checkmate.
export function mateInOneMoves(chess) {
  const scratch = new Chess(chess.fen());
  const out = [];
  for (const m of scratch.moves({ verbose: true })) {
    scratch.move({ from: m.from, to: m.to, promotion: m.promotion });
    const mate = scratch.isCheckmate();
    scratch.undo();
    if (mate) out.push(m);
  }
  return out;
}

// Piece points per side.
export function material(chess) {
  const out = { w: 0, b: 0 };
  for (const row of chess.board()) {
    for (const p of row) if (p) out[p.color] += VALUES[p.type];
  }
  return out;
}

function applyPly(scratch, ply) {
  if (typeof ply !== 'string') return null;
  if (UCI_RE.test(ply)) {
    return scratch.move({ from: ply.slice(0, 2), to: ply.slice(2, 4), promotion: ply[4] || undefined });
  }
  return scratch.move(ply);
}

// Material on a scratch copy after the plies (uci or san), applied in order; an illegal ply stops.
export function materialAfter(chess, plies) {
  const scratch = new Chess(chess.fen());
  for (const ply of plies || []) {
    let ok = null;
    try { ok = applyPly(scratch, ply); } catch { ok = null; }
    if (!ok) break;
  }
  return material(scratch);
}

// The plies (uci or san) as uci strings, applied in order on a scratch copy; stops at the first
// illegal ply. Used by gate.tutorialVerdict to turn a SAN refutation into ghost plies.
export function lineToUci(chess, plies) {
  const scratch = new Chess(chess.fen());
  const out = [];
  for (const ply of plies || []) {
    let m = null;
    try { m = applyPly(scratch, ply); } catch { m = null; }
    if (!m) break;
    out.push(m.from + m.to + (m.promotion || ''));
  }
  return out;
}

// A uci string as the matching verbose move of the side to move, or null.
export function uciToMove(chess, uci) {
  if (typeof uci !== 'string' || uci.length < 4) return null;
  const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci[4] || null;
  for (const m of chess.moves({ verbose: true })) {
    if (m.from === from && m.to === to && (m.promotion || null) === promo) return m;
  }
  return null;
}

// The FactSheet (ARCHITECTURE.md section 5).
export function buildFacts(chess, { player = PLAYER, mateInOne = true } = {}) {
  const pieces = [];
  const bySquare = {};
  const hanging = { w: [], b: [] };
  const mat = { w: 0, b: 0 };
  for (const sq of SQUARES) {
    const info = pieceInfo(chess, sq);
    if (!info) continue;
    pieces.push({ square: sq, type: info.type, color: info.color, value: info.value });
    bySquare[sq] = info;
    mat[info.color] += info.value;
    if (info.hanging) hanging[info.color].push(info);
  }
  const diff = player === 'w' ? mat.w - mat.b : mat.b - mat.w;
  const legal = chess.moves({ verbose: true });
  return {
    fen: chess.fen(),
    turn: chess.turn(),
    player,
    pieces,
    bySquare,
    hanging,
    material: { w: mat.w, b: mat.b, diff },
    inCheck: chess.inCheck(),
    isCheckmate: chess.isCheckmate(),
    isStalemate: chess.isStalemate(),
    isGameOver: chess.isGameOver(),
    mateInOne: mateInOne
      ? mateInOneMoves(chess).map((m) => ({ san: m.san, uci: m.from + m.to + (m.promotion || ''), from: m.from, to: m.to, piece: m.piece }))
      : null,
    legal,
  };
}
