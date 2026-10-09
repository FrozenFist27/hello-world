// gate.js — the silent gate, pure. verdict() takes the pre-search, the post-search and the two
// fact sheets and returns the first matching category in CATEGORIES order with its answer set;
// reward() the two clean-move rewards; holdCopy() the template lines; asksFor() the looks K2 may
// choose; grade() a tap; tutorialVerdict() a tutorial.json row; remembered() and closeCaption()
// the stored-game lines. No DOM, no engine, no Chess instance of its own (asksFor receives the
// pre-move Chess only to hand it to facts.safeSquares).

import {
  VALUES, PIECE_WORDS, CATEGORIES, SUBCASES, ALWAYS_HOLD, GATE, REWARDS, COPY, ASKS,
  fill, gainedWords, numberWord,
} from './contract.js';
import { safeSquares, lineToUci } from './facts.js';

const MATE = ['allowed_mate', 'missed_mate'];

// --------------------------------------------------------------------------------------------
// Scores
// --------------------------------------------------------------------------------------------

// Stockfish reports side-to-move; the gate thinks from the player's side.
export function toPlayer(score, sideToMoveIsPlayer) {
  let v;
  if (score && typeof score.mate === 'number') {
    const n = score.mate;
    // mate 0: the side to move is mated.
    v = n === 0 ? -GATE.MATE_SCORE : Math.sign(n) * (GATE.MATE_SCORE - Math.abs(n));
  } else {
    v = score && typeof score.cp === 'number' ? score.cp : 0;
  }
  return sideToMoveIsPlayer ? v : -v;
}

// --------------------------------------------------------------------------------------------
// Small helpers
// --------------------------------------------------------------------------------------------

function word(type) {
  return type in PIECE_WORDS ? PIECE_WORDS[type] : String(type == null ? '' : type);
}
function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
function value(type) {
  return type in VALUES ? VALUES[type] : 0;
}
function uciFrom(uci) {
  return typeof uci === 'string' ? uci.slice(0, 2) : null;
}
function uciTo(uci) {
  return typeof uci === 'string' ? uci.slice(2, 4) : null;
}
function uniq(list) {
  return [...new Set(list)];
}
// The side to move's legal captures onto `square` from a fact sheet, as {square, type, value}.
function takersFrom(facts, square) {
  const out = [];
  const seen = new Set();
  for (const m of facts.legal || []) {
    if (m.to !== square || !m.captured || seen.has(m.from)) continue;
    seen.add(m.from);
    out.push({ square: m.from, type: m.piece, value: value(m.piece) });
  }
  return out;
}
function cheapest(list) {
  return list.reduce((best, t) => (best === null || t.value < best.value ? t : best), null);
}
function dearest(list) {
  return list.reduce((best, t) => (best === null || t.value > best.value ? t : best), null);
}
// Does ply `uci` (the pv's next ply) recapture on `square`?
function recaptures(uci, square) {
  return !!uci && uciTo(uci) === square;
}
// The piece on `square` in a FEN placement, without chess.js: {type, color} or null.
function pieceAtFen(fen, square) {
  if (typeof fen !== 'string' || typeof square !== 'string' || square.length !== 2) return null;
  const rows = fen.split(' ')[0].split('/');
  const rank = 8 - Number(square[1]);
  const file = 'abcdefgh'.indexOf(square[0]);
  if (rank < 0 || rank > 7 || file < 0 || !rows[rank]) return null;
  let f = 0;
  for (const ch of rows[rank]) {
    if (/\d/.test(ch)) {
      f += Number(ch);
    } else {
      if (f === file) return { type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' };
      f += 1;
    }
    if (f > file) break;
  }
  return null;
}

// A reply from line 2 explains the measured loss only when its own score is a hold-sized loss
// too; otherwise the story the page would tell is not the one that happens on the board.
function explainsLoss(index, line, pre) {
  if (index === 0) return true;
  if (!pre || !Number.isFinite(pre.evalBefore) || !line || !Number.isFinite(line.score)) return false;
  return pre.evalBefore - line.score >= GATE.HOLD_CP;
}
// The net loss when either reply line takes the piece he just moved (hanging_after_move's own
// test), or null when no line does or the loss is under NET_MIN.
function hangingMovedLoss(ctx) {
  const { pre, post, fa, move } = ctx;
  const moved = fa.bySquare[move.to];
  if (!moved || moved.color !== 'w' || !moved.hanging) return null;
  for (const [i, line] of ((post && post.lines) || []).slice(0, 2).entries()) {
    const r = line && line.reply;
    if (!r || !r.captured || r.to !== move.to || !explainsLoss(i, line, pre)) continue;
    const back = recaptures(line.pv && line.pv[1], move.to);
    const netLoss = value(move.piece) - (move.captured ? value(move.captured) : 0) - (back ? value(r.piece) : 0);
    if (netLoss >= GATE.NET_MIN) return netLoss;
  }
  return null;
}

function blank(extra = {}) {
  return {
    held: false, category: null, sub: null, variant: null, cpLoss: null, netLoss: null,
    target: null, targetPiece: null, targetColor: null,
    answer: { squares: [], best: null, partial: [] },
    takers: [], refutation: [], refutationFrom: 'post', gained: [], pawnAmongTakers: false,
    suppressed: null, reward: null, reason: '',
    ...extra,
  };
}

// --------------------------------------------------------------------------------------------
// The category table
// --------------------------------------------------------------------------------------------

function matchCategory(category, ctx) {
  const { pre, post, fb, fa, move, cpLoss } = ctx;
  const lines = (post && post.lines) || [];
  const reply0 = lines[0] && lines[0].reply;

  if (category === 'allowed_mate') {
    if (!post || post.replyMateIn !== 1 || !reply0) return null;
    // every mating destination chess.js finds in the post position is right; the engine's is best
    const mates = (fa.mateInOne || []).map((m) => m.to);
    return {
      target: reply0.to, targetPiece: reply0.piece, targetColor: 'b', netLoss: null,
      answer: { squares: uniq([reply0.to, ...mates]), best: reply0.to, partial: [] },
      takers: [], refutation: [reply0.uci], gained: [], pawnAmongTakers: false,
      reason: `allowed_mate: ${word(reply0.piece)} to ${reply0.to} is mate next move`,
    };
  }

  if (category === 'missed_mate') {
    if (!pre || pre.mateIn !== 1 || !pre.best || fa.isCheckmate) return null;
    const mates = (fb.mateInOne || []).map((m) => m.to);
    const squares = uniq([pre.best.to, ...mates]);
    return {
      target: pre.best.to, targetPiece: pre.best.piece, targetColor: 'w', netLoss: null,
      answer: { squares, best: pre.best.to, partial: [] },
      takers: [], refutation: [], gained: [], pawnAmongTakers: false,
      reason: `missed_mate: ${word(pre.best.piece)} to ${pre.best.to} was mate; he played ${move.san}`,
    };
  }

  if (category === 'ignored_attack') {
    if (cpLoss === null || cpLoss < GATE.HOLD_CP) return null;
    for (const [i, line] of lines.slice(0, 2).entries()) {
      const r = line && line.reply;
      if (!r || !r.captured || value(r.captured) < GATE.NET_MIN || r.to === move.to) continue;
      if (!explainsLoss(i, line, pre)) continue;
      const victim = fa.bySquare[r.to];
      if (!victim || victim.color !== 'w' || !victim.hanging) continue;
      const before = fb.bySquare[r.to];
      const same = before && before.type === victim.type && before.color === 'w';
      // not attacked at all before his move: he opened the line onto it (a pinned piece moved,
      // a piece stepped off a file); attacked and defended before: a guard left; else: already
      let sub = SUBCASES.LOST_GUARD;
      if (same && before.hanging) sub = SUBCASES.ALREADY;
      else if (same && before.attackers.length === 0) sub = SUBCASES.OPENED_LINE;
      const takers = takersFrom(fa, r.to);
      if (!takers.some((t) => t.square === r.from)) takers.unshift({ square: r.from, type: r.piece, value: value(r.piece) });
      const next = line.pv && line.pv[1];
      const back = recaptures(next, r.to);
      const gained = [];
      if (move.captured) gained.push(move.captured);
      if (back) gained.push(r.piece);
      const netLoss = victim.value - (back ? value(r.piece) : 0);
      // a second piece hangs: the one he moved, when the other reply line takes it for a net loss
      // (tapping it is right too; the victim stays best so the named square and the ghost agree)
      const squares = [r.to];
      if (hangingMovedLoss(ctx) !== null) squares.push(move.to);
      return {
        sub, target: r.to, targetPiece: victim.type, targetColor: 'w', netLoss,
        answer: { squares, best: r.to, partial: takers.map((t) => t.square) },
        takers, refutation: back ? [r.uci, next] : [r.uci], gained,
        pawnAmongTakers: takers.some((t) => t.type === 'p'),
        reason: `ignored_attack (${sub}): ${word(victim.type)} on ${r.to} taken by ${word(r.piece)} from ${r.from}, net ${netLoss}, cpLoss ${cpLoss}`,
      };
    }
    return null;
  }

  if (category === 'hanging_after_move') {
    if (cpLoss === null || cpLoss < GATE.HOLD_CP) return null;
    const moved = fa.bySquare[move.to];
    if (!moved || moved.color !== 'w' || !moved.hanging) return null;
    for (const [i, line] of lines.slice(0, 2).entries()) {
      const r = line && line.reply;
      if (!r || !r.captured || r.to !== move.to) continue;
      if (!explainsLoss(i, line, pre)) continue;
      const next = line.pv && line.pv[1];
      const back = recaptures(next, move.to);
      // material before his move minus material after the refutation, from White's side:
      // he loses the piece he moved (as it was), keeps what he captured and what takes back.
      const netLoss = value(move.piece) - (move.captured ? value(move.captured) : 0) - (back ? value(r.piece) : 0);
      if (netLoss < GATE.NET_MIN) continue;
      const takers = takersFrom(fa, move.to);
      if (!takers.some((t) => t.square === r.from)) takers.unshift({ square: r.from, type: r.piece, value: value(r.piece) });
      const bestTaker = takers.find((t) => t.square === r.from);
      const others = takers.filter((t) => t.square !== r.from).sort((a, b) => (a.square < b.square ? -1 : 1));
      // every taker is right; a dearer one (or the king, when the engine's taker is not the king)
      // is partial: 'is there something cheaper?'
      const partial = others
        .filter((t) => (t.type === 'k' ? bestTaker.type !== 'k' : t.value > bestTaker.value))
        .map((t) => t.square);
      const gained = [];
      if (move.captured) gained.push(move.captured);
      if (back) gained.push(r.piece);
      return {
        variant: move.captured ? 'takes_back' : null,
        target: move.to, targetPiece: moved.type, targetColor: 'w', netLoss,
        answer: { squares: [r.from, ...others.map((t) => t.square)], best: r.from, partial },
        takers, refutation: back ? [r.uci, next] : [r.uci], gained,
        pawnAmongTakers: takers.some((t) => t.type === 'p'),
        reason: `hanging_after_move: ${word(moved.type)} on ${move.to} taken by ${word(r.piece)} from ${r.from}, net ${netLoss}, cpLoss ${cpLoss}`,
      };
    }
    return null;
  }

  if (category === 'free_piece_ignored') {
    if (cpLoss === null || cpLoss < GATE.HOLD_CP || !pre || !pre.best) return null;
    const b = pre.best;
    if (!b.captured || value(b.captured) < GATE.NET_MIN) return null;
    const free = fb.bySquare[b.to];
    if (!free || free.color !== 'b' || !free.hanging) return null;
    if (move.from === b.from && move.to === b.to) return null;
    const still = fa.bySquare[b.to];
    if (!still || still.color !== 'b' || still.type !== free.type) return null;
    const others = fb.hanging.b
      .filter((p) => p.square !== b.to && p.value >= GATE.NET_MIN && fa.bySquare[p.square] && fa.bySquare[p.square].color === 'b')
      .map((p) => p.square).sort();
    const netLoss = free.defenders.length === 0 ? free.value : free.value - (free.cheapestAttacker === null ? 0 : free.cheapestAttacker);
    const takers = takersFrom(fb, b.to);
    if (!takers.some((t) => t.square === b.from)) takers.unshift({ square: b.from, type: b.piece, value: value(b.piece) });
    // Show me plays the capture he walked past, from the position before his move (there is no
    // exchange to float: the free piece is simply still there)
    return {
      target: b.to, targetPiece: free.type, targetColor: 'b', netLoss,
      answer: { squares: [b.to, ...others], best: b.to, partial: others },
      takers, refutation: [b.uci], refutationFrom: 'pre', gained: [], pawnAmongTakers: takers.some((t) => t.type === 'p'),
      reason: `free_piece_ignored: ${word(free.type)} on ${b.to} was free (${b.san}), he played ${move.san}, net ${netLoss}, cpLoss ${cpLoss}`,
    };
  }

  if (category === 'allowed_stalemate') {
    if (!fa.isStalemate || fb.material.diff < GATE.STALEMATE_AHEAD) return null;
    const king = fa.pieces.find((p) => p.type === 'k' && p.color === 'b');
    if (!king) return null;
    return {
      target: king.square, targetPiece: 'k', targetColor: 'b', netLoss: null,
      answer: { squares: [king.square], best: king.square, partial: [] },
      takers: [], refutation: [], gained: [], pawnAmongTakers: false,
      reason: `allowed_stalemate: ${move.san} stalemates while ${fb.material.diff} up`,
    };
  }
  return null;
}

// The verdict: first matching category in CATEGORIES order, then the pair and quiet rules.
export function verdict(pre, post, factsBefore, factsAfter, gameState = {}) {
  const move = gameState.move || {};
  const anyways = gameState.anyways || 0;
  const playedPairs = gameState.playedPairs || [];
  if (!pre || !post) {
    return blank({ reason: 'clean: engine cold' });
  }
  // the only legal move is nothing to hold: there is nothing to take it back to
  if (factsBefore && Array.isArray(factsBefore.legal) && factsBefore.legal.length === 1) {
    return blank({ reason: 'clean: the only legal move' });
  }
  let cpLoss = Number.isFinite(pre.evalBefore) && Number.isFinite(post.evalAfter) ? pre.evalBefore - post.evalAfter : null;
  // a mate-scored pre-search against a plain-cp post-search is not a loss of a hundred pawns:
  // a move that keeps a winning position is clean; one that lets the win go keeps the raw loss
  if (cpLoss !== null && typeof pre.mateIn === 'number' && pre.mateIn > 0 && post.replyMateIn === null
    && Math.abs(post.evalAfter) < GATE.MATE_SCORE - 1000 && post.evalAfter >= GATE.STILL_WINNING_CP) {
    cpLoss = 0;
  }
  const ctx = { pre, post, fb: factsBefore, fa: factsAfter, move, cpLoss };
  for (const category of CATEGORIES) {
    let hit = null;
    try { hit = matchCategory(category, ctx); } catch (e) { hit = null; }
    if (!hit) continue;
    const v = blank({ category, cpLoss, sub: null, variant: null, ...hit });
    const pair = `${move.piece}${move.to}`;
    if (playedPairs.includes(pair)) {
      v.suppressed = 'pair';
    } else if (
      anyways >= GATE.QUIET_AFTER_ANYWAYS &&
      !ALWAYS_HOLD.includes(category) &&
      !(typeof v.netLoss === 'number' && v.netLoss >= GATE.BIG_LOSS)
    ) {
      v.suppressed = 'quiet';
    }
    v.held = v.suppressed === null;
    if (v.suppressed) v.reason += ` (suppressed: ${v.suppressed})`;
    return v;
  }
  const v = blank({ cpLoss, reason: cpLoss === null ? 'clean: no score' : `clean: cpLoss ${cpLoss}` });
  if (cpLoss !== null && cpLoss < GATE.HOLD_CP) v.reward = reward(pre, factsBefore, factsAfter, move, gameState.lastMove || null);
  return v;
}

// --------------------------------------------------------------------------------------------
// Rewards (clean moves only; the caller applies the quiet budget)
// --------------------------------------------------------------------------------------------

// `lastMove` (the opponent's last move, a verbose move, or null after load(fen)) keeps an even
// trade from being called a free piece: what his capture wins is counted net of what their
// capture on the same square just took.
export function reward(pre, factsBefore, factsAfter, move, lastMove = null) {
  if (!move || !factsBefore || !factsAfter) return null;
  // Reward 1: his capture took a piece that facts and the pre-search both called free, and the
  // exchange nets him two points or more.
  if (move.captured && value(move.captured) >= REWARDS.MIN_VALUE && pre && pre.best) {
    const taken = factsBefore.bySquare[move.to];
    const gaveUp = lastMove && lastMove.captured && lastMove.to === move.to ? value(lastMove.captured) : 0;
    const net = value(move.captured) - gaveUp;
    if (taken && taken.color === 'b' && taken.hanging && pre.best.from === move.from && pre.best.to === move.to && net >= REWARDS.MIN_VALUE) {
      return { kind: 'free_taken', piece: move.captured, square: move.to };
    }
  }
  // Reward 2: a non-pawn piece of his worth >= 2 was hanging and nothing of his worth that hangs now.
  const was = factsBefore.hanging.w.filter((p) => p.type !== 'p' && p.value >= REWARDS.MIN_VALUE);
  if (was.length) {
    const still = factsAfter.hanging.w.filter((p) => p.value >= REWARDS.MIN_VALUE);
    if (!still.length) {
      const piece = dearest(was);
      const pool = piece.defenders.length ? piece.attackers.filter((a) => a.type !== 'k') : piece.attackers;
      const attacker = cheapest(pool.length ? pool : piece.attackers);
      return { kind: 'escaped', piece: piece.type, attacker: attacker ? attacker.type : 'piece' };
    }
  }
  return null;
}

// --------------------------------------------------------------------------------------------
// Grading
// --------------------------------------------------------------------------------------------

export function grade(answer, square) {
  if (!answer || !square) return 'wrong';
  const squares = answer.squares || [];
  const partial = answer.partial || [];
  const best = answer.best == null ? null : answer.best;
  if (best !== null && square === best) return 'right';
  if (partial.includes(square)) return 'partial';
  if (squares.includes(square)) return 'right';
  return 'wrong';
}

// --------------------------------------------------------------------------------------------
// Template copy
// --------------------------------------------------------------------------------------------

// What the player should look at first, for the play-anyway sentence.
function lookWords(v) {
  if (MATE.includes(v.category)) return COPY.LOOK_WORDS.check;
  let type = null;
  if (v.category === 'allowed_stalemate') return COPY.LOOK_WORDS.stalemate;
  if (v.category === 'hanging_after_move') type = bestTaker(v)?.type;
  else if (v.category === 'ignored_attack') type = attackerOf(v)?.type;
  else if (v.category === 'free_piece_ignored') type = v.targetPiece;
  if (type === 'p') return COPY.LOOK_WORDS.pawn;
  if (type === 'k') return COPY.LOOK_WORDS.king;   // 'their king first' reads as nonsense after Bxf7+ Kxf7
  return fill(COPY.LOOK_WORDS.other, { piece: word(type || 'piece') });
}
function bestTaker(v) {
  const best = v.answer && v.answer.best;
  return (v.takers || []).find((t) => t.square === best) || cheapest(v.takers || []) || null;
}
// For ignored_attack: the piece that takes (the refutation's mover), else the cheapest attacker.
function attackerOf(v) {
  const from = uciFrom(v.refutation && v.refutation[0]);
  return (v.takers || []).find((t) => t.square === from) || cheapest(v.takers || []) || null;
}
function pieceOn(v, factsAfter, square) {
  const t = (v.takers || []).find((x) => x.square === square);
  if (t) return t;
  const p = factsAfter && factsAfter.bySquare && factsAfter.bySquare[square];
  return p ? { square, type: p.type, value: p.value } : null;
}

// `move` (his VerboseMove) is optional; it only sharpens the caption for the categories whose
// target is not the piece he moved.
export function holdCopy(v, factsAfter, move = null) {
  const c = v.category;
  const piece = word(v.targetPiece);
  const taker = bestTaker(v);
  const takerWord = taker ? word(taker.type) : 'piece';
  const attacker = attackerOf(v);
  const attackerWord = attacker ? word(attacker.type) : 'piece';
  const gained = gainedWords(v.gained || []);
  const best = v.answer && v.answer.best;

  let questionKey = c;
  if (c === 'hanging_after_move' && v.variant === 'takes_back') questionKey = 'hanging_after_move_takes_back';
  const subKey = `ignored_attack_${v.sub === SUBCASES.LOST_GUARD ? 'lost_guard' : v.sub === SUBCASES.OPENED_LINE ? 'opened_line' : 'already'}`;
  if (c === 'ignored_attack') questionKey = subKey;
  const question = fill(COPY.QUESTION[questionKey] || COPY.QUESTION[c] || '', { piece });

  let wrongKey = c;
  if (c === 'hanging_after_move' && v.pawnAmongTakers) wrongKey = 'hanging_after_move_pawn';
  if (c === 'ignored_attack' && v.sub === SUBCASES.OPENED_LINE) wrongKey = 'ignored_attack_opened_line';
  const if_wrong = fill(COPY.IF_WRONG[wrongKey] || COPY.IF_WRONG[c] || '', { piece });

  const if_right = (square) => {
    if (c === 'hanging_after_move') {
      const t = pieceOn(v, factsAfter, square) || taker;
      return fill(COPY.IF_RIGHT[c], { taker: t ? word(t.type) : takerWord, piece, gained });
    }
    if (c === 'ignored_attack') {
      if (square && square !== best && (v.answer.squares || []).includes(square)) {
        // the second hanging piece (the one he moved): what takes it next move
        const p = pieceOn(v, factsAfter, square);
        const a = cheapest(takersFrom(factsAfter, square));
        return fill(COPY.IF_RIGHT.ignored_attack_already, { piece: p ? word(p.type) : piece, attacker: a ? word(a.type) : 'piece' });
      }
      return fill(COPY.IF_RIGHT[subKey], { piece, attacker: attackerWord });
    }
    if (c === 'free_piece_ignored') {
      const p = (v.answer.squares || []).includes(square) && square !== best ? pieceOn(v, factsAfter, square) : null;
      return fill(COPY.IF_RIGHT[c], { piece: p ? word(p.type) : piece });
    }
    return fill(COPY.IF_RIGHT[c] || '', { piece });
  };

  const if_partial = (square) => {
    if (c === 'hanging_after_move') {
      const t = pieceOn(v, factsAfter, square);
      const king = !t || t.type === 'k' || (taker && t.value <= taker.value);
      return fill(COPY.IF_PARTIAL[king ? 'hanging_after_move_king' : 'hanging_after_move'], { piece: t ? word(t.type) : 'piece', square });
    }
    if (c === 'ignored_attack') {
      const a = pieceOn(v, factsAfter, square) || attacker;
      return fill(COPY.IF_PARTIAL[c], { attacker: a ? word(a.type) : attackerWord });
    }
    if (c === 'free_piece_ignored') return COPY.IF_PARTIAL[c];
    return if_wrong;
  };

  let named;
  if (c === 'hanging_after_move') named = fill(COPY.NAMED.piece, { piece: takerWord, square: best });
  else if (c === 'free_piece_ignored') named = fill(COPY.NAMED.piece, { piece, square: best });
  else if (c === 'ignored_attack') named = fill(COPY.NAMED.yours, { piece, square: best });
  else if (c === 'allowed_mate') named = fill(COPY.NAMED.their_lands, { piece, square: best });
  else if (c === 'missed_mate') named = fill(COPY.NAMED.your_lands, { piece, square: best });
  else named = fill(COPY.NAMED.their_king, { square: best });

  const anyway = (sawIt) => {
    const base = fill(COPY.ANYWAY[c] || COPY.ANYWAY.allowed_mate, { piece, gained });
    const tail = sawIt ? COPY.ANYWAY.saw_it : fill(COPY.ANYWAY.next_time, { look: lookWords(v) });
    return `${base} ${tail}`;
  };

  const fallback = fill(COPY.K2_FALLBACK[c] || '', { taker: takerWord, square: best, piece, attacker: attackerWord });

  const movedWord = word(move && move.piece ? move.piece : v.targetPiece);
  const movedTo = move && move.to ? move.to : v.target;
  const caption = `${cap(movedWord)} to ${movedTo}, ${fill(COPY.CLOSE.WAITING[c] || '', { taker: takerWord, piece })}`;

  return { question, if_right, if_partial, if_wrong, named, anyway, fallback, caption };
}

// --------------------------------------------------------------------------------------------
// The looks K2 may choose
// --------------------------------------------------------------------------------------------

export function asksFor(v, factsBefore, factsAfter, move, chessBefore) {
  if (!v || !v.category) return [];
  const asks = [];
  const piece = word(v.targetPiece);
  const own = {
    hanging_after_move: v.variant === 'takes_back' ? 'what_takes_back' : 'what_takes_it',
    ignored_attack: 'attacked_piece',
    free_piece_ignored: 'what_is_free',
    allowed_mate: 'their_check',
    missed_mate: 'your_mate',
    allowed_stalemate: 'their_king',
  }[v.category];
  // own: the category's own look, graded and answered with the hold's own lines; any other look
  // carries its own follow-up copy (ASKS[kind].copy, {piece}/{square} filled by the hold at tap time,
  // {piece} already the moved piece for safe_square)
  const push = (kind, squares, best, partial, vars, isOwn = false) => {
    if (!ASKS[kind] || !squares.length || asks.some((a) => a.kind === kind)) return;
    const ask = { kind, question: fill(ASKS[kind].question, vars), squares: [...squares], best, partial: [...partial], own: isOwn };
    if (!isOwn && ASKS[kind].copy) {
      ask.copy = {};
      for (const [k, t] of Object.entries(ASKS[kind].copy)) ask.copy[k] = kind === 'safe_square' ? fill(t, vars) : t;
    }
    asks.push(ask);
  };
  if (own) push(own, v.answer.squares, v.answer.best, v.answer.partial, { piece }, true);

  if (move && move.piece && move.piece !== 'k' && chessBefore) {
    let safe = [];
    try { safe = safeSquares(chessBefore, move.from); } catch { safe = []; }
    push('safe_square', safe, null, [], { piece: word(move.piece) });
  }
  if (factsBefore && factsBefore.hanging) {
    const free = factsBefore.hanging.b
      .filter((p) => p.value >= GATE.NET_MIN && (!move || p.square !== move.to))
      .map((p) => p.square);
    push('what_is_free', free, null, [], { piece });
    const attacked = factsBefore.hanging.w
      .filter((p) => p.value >= GATE.NET_MIN && (!move || p.square !== move.from))
      .map((p) => p.square);
    push('attacked_piece', attacked, null, [], { piece });
  }
  return asks;
}

// --------------------------------------------------------------------------------------------
// The tutorial table as verdicts
// --------------------------------------------------------------------------------------------

export function tutorialVerdict(row, move, chessBefore) {
  const cpLoss = row && typeof row.cpLoss === 'number' ? row.cpLoss : null;
  if (!row || !row.held) {
    return blank({ cpLoss, reason: `tutorial: ${move ? move.san : '?'} stands` });
  }
  let refutation = [];
  if (chessBefore && move) {
    // the tutorial line is one or two SANs after his move; resolve them to uci on a scratch copy
    refutation = lineToUci(chessBefore, [move.san, ...(row.line || [])]).slice(1);
  }
  const takers = (row.takers || []).map((t) => ({ square: t.square, type: t.type, value: typeof t.value === 'number' ? t.value : value(t.type) }));
  const answer = row.answer || { squares: takers.map((t) => t.square), best: null, partial: [] };
  return blank({
    held: true,
    category: row.category || 'hanging_after_move',
    sub: row.sub || null,
    variant: row.variant || (move && move.captured ? 'takes_back' : null),
    cpLoss,
    netLoss: typeof row.netLoss === 'number' ? row.netLoss : null,
    target: move ? move.to : null,
    targetPiece: move ? move.piece : null,
    targetColor: 'w',
    answer: { squares: [...(answer.squares || [])], best: answer.best == null ? null : answer.best, partial: [...(answer.partial || [])] },
    takers,
    refutation,
    gained: [...(row.gained || [])],
    pawnAmongTakers: !!row.pawnAmongTakers,
    reason: `tutorial: ${move ? move.san : '?'} held, ${row.category || 'hanging_after_move'}`,
  });
}

// --------------------------------------------------------------------------------------------
// Between games
// --------------------------------------------------------------------------------------------

function pawnHold(r) {
  if (!r || r.category !== 'hanging_after_move') return false;
  if (typeof r.pawnAmongTakers === 'boolean') return r.pawnAmongTakers;
  const p = pieceAtFen(r.fen, r.best);
  return !!p && p.type === 'p';
}

export function remembered(lastGame) {
  if (!lastGame) return null;
  const holds = Array.isArray(lastGame.holds) ? lastGame.holds : [];
  const n = holds.length;
  if (n === 0) return COPY.REMEMBERED.NONE;
  const allPawns = holds.every(pawnHold);
  if (n === 1) return allPawns ? COPY.REMEMBERED.ONE_PAWN : COPY.REMEMBERED.ONE;
  if (allPawns) return n === 2 ? COPY.REMEMBERED.ALL_PAWNS_TWO : fill(COPY.REMEMBERED.ALL_PAWNS, { n: cap(numberWord(n)) });
  return fill(COPY.REMEMBERED.MIXED, { n: cap(numberWord(n)) });
}

// 'Knight to e5, a pawn was waiting: taken back.'
export function closeCaption(record) {
  const c = record.category;
  const at = pieceAtFen(record.fen, record.best);
  const atWord = at ? word(at.type) : 'piece';
  const waiting = fill(COPY.CLOSE.WAITING[c] || '', { taker: atWord, piece: c === 'ignored_attack' || c === 'free_piece_ignored' ? atWord : word(record.piece) });
  const outcome = COPY.CLOSE.OUTCOME[record.outcome] || COPY.CLOSE.OUTCOME.ended;
  return fill(COPY.CLOSE.CAPTION, { piece: cap(word(record.piece)), square: record.to, waiting, outcome });
}
