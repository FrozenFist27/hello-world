// contract.js — the shared constants of Hold On. Every module imports from here and nowhere else
// for names that two modules must agree on: categories, piece values, copy templates, timings,
// bot constants, storage keys, DOM hooks. Pure data and two tiny helpers; no DOM, no imports.
//
// Rules for this file (enforced by scripts/copy_check.js):
//  - sentence case, no emoji, no Unicode chess glyphs, nothing that names a move in SAN,
//  - never the words the spec bans (see validate.js, which builds that list from char codes),
//  - template placeholders are {name}; fill() replaces them; a template never names a square
//    except through a placeholder.

// ---------------------------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------------------------
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Italian after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 (lesson 0001 p3, depth 20). The tutorial opens here.
export const TUTORIAL_FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
export const PLAYER = 'w'; // v1: the player is always White; the bot is always Black.
export const BOT_COLOR = 'b';

// ---------------------------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------------------------
// Piece points. The king is 0 so it is never "worth" anything and never the cheapest attacker of a
// defended piece (a king cannot take a defended piece; facts.js excludes it from that clause).
export const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_WORDS = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
export const COLOR_WORDS = { w: 'white', b: 'black' };
export const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const SQUARES = (() => {
  const out = [];
  for (const r of '87654321') for (const f of 'abcdefgh') out.push(f + r);
  return out;
})();

// ---------------------------------------------------------------------------------------------
// Gate: categories in priority order, thresholds, sub-cases
// ---------------------------------------------------------------------------------------------
export const CATEGORIES = [
  'allowed_mate',
  'missed_mate',
  'ignored_attack',
  'hanging_after_move',
  'free_piece_ignored',
  'allowed_stalemate',
];
export const SUBCASES = { ALREADY: 'already', LOST_GUARD: 'lost_guard' };
// Categories that still hold after the second play-anyway (plus any hold with netLoss >= BIG_LOSS).
export const ALWAYS_HOLD = ['allowed_mate', 'missed_mate', 'allowed_stalemate'];
export const GATE = {
  HOLD_CP: 200,          // cpLoss at or above this is needed for the three material categories
  NET_MIN: 2,            // net piece points lost for hanging_after_move; "worth two or more" everywhere
  BIG_LOSS: 5,           // a hold with netLoss >= 5 ignores the quiet-after-two rule
  STALEMATE_AHEAD: 5,    // allowed_stalemate only when he is this many points up
  MATE_SCORE: 10000,     // mate N maps to +/-(MATE_SCORE - N) on the player's side
  QUIET_AFTER_ANYWAYS: 2,
};
export const REWARDS = {
  MAX_PER_GAME: 4,       // reward lines per game; beyond it the ring shows with no words
  MIN_VALUE: 2,          // the captured / escaped piece must be worth this much
};

// ---------------------------------------------------------------------------------------------
// Engine and opponent
// ---------------------------------------------------------------------------------------------
export const ENGINE = {
  WORKER_URL: './vendor/stockfish-18-lite-single.js',
  HASH_MB: 16,
  PRE_DEPTH: 14,           // pre-search on the player's position, multipv 2, Skill Level 20, after ucinewgame
  PRE_MIN_DEPTH: 8,        // if the stopped pre-search reached less than this ...
  PRE_RESEARCH_DEPTH: 10,  // ... a go depth 10 on the pre position runs before the verdict search
  VERDICT_DEPTH: 12,       // post-move search, multipv 2
  MULTIPV: 2,
  FULL_SKILL: 20,
  VERDICT_BUDGET_MS: 300,  // headless budget from drop to verdict (600 on a phone); informational
  WAIT_READY_MS: 20000,    // __app.waitEngine() gives up after this
};
export const BOT = {
  GIFT_RATE: 0.12,                 // probability of a gift roll per bot move from GIFT_FROM_MOVE
  GIFT_RATE_STEPS: [0.12, 0.08],   // one notch down after a game with zero pieces given away
  GIFT_FROM_MOVE: 3,               // the bot's third move onward
  GIFT_MAX_CHECKS: 6,              // candidates verified at depth GIFT_DEPTH
  GIFT_DEPTH: 10,
  GIFT_MIN_GAIN_CP: 200,           // the player's best reply must gain this much (his side)
  GIFT_CAP_CP: 900,                // and leave him under this
  LOOK_DEPTH: 8,                   // full-strength look, multipv 2
  FORCED_LEAD_CP: 150,             // a capture leading line 2 by this much is played always
  SKILL: 3,                        // the sampler's Skill Level
  SAMPLE_DEPTH: 2,                 // the sampler's depth
  SAMPLE_RETRIES: 2,               // re-picks when the guards reject the sample
  GUARD_HANG_VALUE: 5,             // the sampler may not leave a rook or queen hanging
  ANYWAY_DEPTH: 12,                // the true best reply after Play it anyway
  RESIGN_CP: -900,                 // bot-side eval at or below this ...
  RESIGN_STREAK: 3,                // ... for this many consecutive bot moves ...
  RESIGN_AFTER_MOVE: 6,            // ... after the bot's sixth move
  MERCY_CP: -900,                  // player-side eval at or below this ...
  MERCY_STREAK: 3,                 // ... for this many consecutive player moves offers Start again once
  BOOK_DEPTH: 18,                  // every book reply verified under BOOK_MAX_LOSS_CP at this depth
  BOOK_MAX_LOSS_CP: 50,
};

// ---------------------------------------------------------------------------------------------
// Timing (ms). FAST overrides apply when window.__app.fast is true; REDUCED when the viewer
// prefers reduced motion (every motion duration 0, the breathe a static ring, the float static).
// ---------------------------------------------------------------------------------------------
export const TIMING = {
  MOVE_MS: 150,            // a piece slide, a take-back slide, a ghost rewind step
  PICK_MS: 100,            // scale to 1.06 with shadow when picked up
  PENDING_DOT_MS: 250,     // the faint dot on the pending piece appears after this
  REPLY_MIN_MS: 400,       // the opponent never replies sooner than this after his move
  REPLY_SOFT_MAX_MS: 1000, // informational: the reply should be in by now on non-gift moves
  EDGE_DOT_MS: 800,        // the opponent's-edge dot appears if the reply is still pending
  BUTTONS_MS: 8000,        // the action bar fills without a tap after this
  RING_MS: 900,            // the green ring
  REWARD_MS: 2000,         // a reward line stays this long, then 'Your move.'
  ANYWAY_LINE_MS: 0,       // the play-anyway sentence stays until the next event (never auto-cleared)
  GHOST_PLY_MS: 600,       // Show me: per ply
  FLOAT_MS: 700,           // the -N rises 24 px and fades
  BEAT_MS: 500,            // the beat after the float
  REWIND_MS: 300,          // everything slides back
  BREATHE_MS: 1600,        // the amber inset glow loop
  LOOKING_PULSE_MS: 1000,  // 'Looking...' pulse loop
  REDUCED_STATIC_MS: 1200, // reduced motion: the final ghost position and the static label
  RESTING_MS: 60000,       // 'Hear me out' hidden after rate_limited
  TAP_MAX_PX: 8,           // pointerup within this distance ...
  TAP_MAX_MS: 300,         // ... and this time is a tap
};
export const FAST = {
  MOVE_MS: 0, PICK_MS: 0, PENDING_DOT_MS: 250, REPLY_MIN_MS: 0, EDGE_DOT_MS: 800, BUTTONS_MS: 300,
  RING_MS: 90, REWARD_MS: 200, GHOST_PLY_MS: 60, FLOAT_MS: 70, BEAT_MS: 50, REWIND_MS: 30,
  REDUCED_STATIC_MS: 120, RESTING_MS: 60000,
};
export function timing(name, fast = false) {
  return fast && name in FAST ? FAST[name] : TIMING[name];
}

// ---------------------------------------------------------------------------------------------
// localStorage keys (store.js wraps every access in try/catch)
// ---------------------------------------------------------------------------------------------
export const KEYS = {
  TUTORIAL_SEEN: 'holdon.v1.tutorialSeen',   // '1'
  FIRST_HOLD_SEEN: 'holdon.v1.firstHoldSeen', // '1'
  FIRST_FLOAT_SEEN: 'holdon.v1.firstFloatSeen', // '1'
  THEME: 'holdon.v1.theme',                   // 'light' | 'dark' | unset
  GIFT_RATE: 'holdon.v1.giftRate',            // number: the current notch (0.12 | 0.08)
  GAMES: 'holdon.v1.games',                   // JSON array, last five GameSummary
  HOLDS: 'holdon.v1.holds',                   // JSON array, last thirty HoldRecord (+ gameId)
};
export const KEEP = { GAMES: 5, HOLDS: 30 };

// ---------------------------------------------------------------------------------------------
// DOM contract: ids, classes, data attributes, action names, states
// ---------------------------------------------------------------------------------------------
export const DOM = {
  ids: {
    top: 'top', brand: 'brand', giveup: 'giveup', theme: 'theme', coach: 'coach', links: 'links',
    boardwrap: 'boardwrap', board: 'board', squares: 'squares', pieces: 'pieces', ghosts: 'ghosts',
    loss: 'loss', edge: 'edge', actions: 'actions', close: 'close', sayInput: 'say', defs: 'defs',
  },
  // classes on squares (div.sq inside #squares) and pieces (button.pc inside #pieces)
  sq: {
    base: 'sq', light: 'light', dark: 'dark', coord: 'coord',
    tint: 'tint',    // last move from and to
    dot: 'dot',      // legal destination (10 px, ink at 35 percent)
    ring: 'ring',    // legal capture (2 px ring)
    amber: 'amber',  // the held destination (inset glow, breathing)
    ok: 'ok',        // green ring: a right tap, a free piece taken
    glow: 'glow',    // the answer square after a second wrong tap (amber fill at 25 percent)
    lit: 'lit',      // Claude's marked squares: four --coach corner marks
  },
  pc: {
    base: 'pc', picked: 'picked', lifted: 'lifted', pending: 'pending', captured: 'captured',
    ghost: 'ghost',   // pieces on the #ghosts layer
  },
  coach: { base: 'coach', echo: 'echo', looking: 'looking', first: 'first', long: 'long' },  // long: more than LONG_LINE_WORDS words (phone: 17 px, five lines in the same box)
  states: ['idle', 'pending', 'held', 'reply', 'over'],  // #board[data-state]
  // #board[data-hold] = category while held, '' otherwise; #board[data-input] = 'move' | 'answer' | 'locked'
  // #board[data-ghost] = '1' while Show me plays; #board[data-warm] = '1' when a bot move waits on warm-up
  actions: [
    'takeback', 'anyway', 'showme', 'but', 'send', 'giveup', 'giveup-yes', 'keep',
    'startagain', 'again', 'theme',
  ],
  buttonClasses: { primary: 'btn primary', quiet: 'btn quiet', link: 'link' },
};
export const PIECE_SYMBOL_PREFIX = 'pc-'; // <symbol id="pc-wN"> ... <use href="#pc-wN">

// ---------------------------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------------------------
export const CLAUDE = {
  TIER: 'quick',
  PROMPT_VERSION: 'v2',
  K2_MAX_WORDS: 20, K2_MAX_SENTENCES: 2, K2_MAX_SQUARES: 3,
  K1_MAX_WORDS: 20, K1_WRONG_MAX_WORDS: 14, K1_AND_THEN_MAX_WORDS: 12,
  ASK_QUESTION_MAX_WORDS: 8,
  TEMPLATE_MAX_WORDS: 16,
  LONG_LINE_WORDS: 28,       // the measured four-line cap at 19 px / 368 px; longer lines get DOM.coach.long
  HIDE_FOR_VIEW: ['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'],
  RESTING: 'rate_limited',
  RETRY_ONCE: 'invalid_json',
  SILENT: 'cancelled',
};
// The looks chess.js can compute for a hold. K2 may choose one; the page asks its question and
// grades the next tap against the look's answer set. 'question' is the page's own words (<= 8).
export const ASKS = {
  what_takes_it: { question: 'Tap the piece that takes it.', meaning: 'the piece that takes the {piece} on {square}' },
  what_takes_back: { question: 'Tap what takes back.', meaning: 'the piece that takes back on {square}' },
  safe_square: { question: 'Tap a square where the {piece} is safe.', meaning: 'a square the {piece} can go to instead where nothing takes it and no pawn can kick it' },
  what_is_free: { question: 'Tap the piece of theirs that is free.', meaning: 'a piece of theirs that is free right now' },
  attacked_piece: { question: 'Tap the piece of yours under attack.', meaning: 'the piece of yours that is under attack right now' },
  their_check: { question: 'Tap where their check lands.', meaning: 'the square their checking piece lands on' },
  your_mate: { question: 'Tap where your checkmate lands.', meaning: 'the square your mating piece lands on' },
  their_king: { question: 'Tap their king.', meaning: 'their king' },
};
export const ASK_KINDS = Object.keys(ASKS);

// ---------------------------------------------------------------------------------------------
// Copy. Every line the page can say, as templates. {piece} is the held or named piece in piece
// words, {taker} the best answering piece, {gained} what he gets ('a pawn', 'nothing'), {square}
// a square, {attacker} the attacking piece, {look} 'the pawns' | 'their knight' | 'the check'.
// The coach line is one serif paragraph of at most four lines; questions are at most 16 words.
// ---------------------------------------------------------------------------------------------
export const COPY = {
  YOUR_MOVE: 'Your move.',
  WARMING: 'Warming up the other side...',
  LOOKING: 'Looking...',

  TUTORIAL_OPEN: 'Try one. Most people take the pawn in front of the king here. Go on.',
  TUTORIAL_BACK: 'Good. That is all I do: I hold the move, I ask, you decide. Your move.',
  TUTORIAL_ANYWAY: 'Now you have felt it. Here is a fresh game.',
  TUTORIAL_SAFE: 'Safe. I will stop your hand the first time a piece is about to be given away.',
  FIRST_HOLD: 'Take it back costs nothing; play it anyway is real.',
  // {n} 'two', {piece} 'bishop', {v} 'three', {captured} 'pawn', {v2} 'one'
  FIRST_FLOAT: 'Minus {n}: a {piece} counts {v}, a {captured} {v2}.',
  FIRST_FLOAT_PLAIN: 'Minus {n}: a {piece} counts {v}.',

  QUESTION: {
    hanging_after_move: 'Hold on. If the {piece} lands there, what takes it? Tap it.',
    hanging_after_move_takes_back: 'Hold on. Before you take there: what takes back? Tap it.',
    ignored_attack_already: 'Hold on. One of yours is already under attack. Tap it.',
    ignored_attack_lost_guard: 'Hold on. Something of yours just lost its guard. Tap it.',
    free_piece_ignored: 'Hold on. Something of theirs is free right now. Tap it.',
    allowed_mate: 'Hold on. Their {piece} has a check next move. Where does it land? Tap it.',
    missed_mate: 'Hold on. You have a checkmate on the board. Tap the square.',
    allowed_stalemate: 'Hold on. After this, can their king move at all? Tap their king.',
  },
  IF_RIGHT: {
    hanging_after_move: 'Yes, the {taker}. A {piece} for {gained}.',
    ignored_attack_already: 'Yes, the {piece}. The {attacker} takes it next move.',
    ignored_attack_lost_guard: 'Yes, the {piece}. Your move took its guard away.',
    free_piece_ignored: 'Yes, the {piece}. It was yours for the taking.',
    allowed_mate: 'Yes, there. Their {piece} lands and the king has no way out.',
    missed_mate: 'Yes, there. Your {piece} lands and it is checkmate.',
    allowed_stalemate: 'Yes, their king. It cannot move, and that is a draw, not a win.',
  },
  IF_PARTIAL: {
    hanging_after_move: 'The {piece} on {square} could too. Is there something cheaper? Tap it.',
    hanging_after_move_king: 'The {piece} on {square} could too. Which one would they really use? Tap it.',
    ignored_attack: 'That is the {attacker}. Now tap the piece it reaches.',
    free_piece_ignored: 'That one is free too. Is there something bigger? Tap it.',
  },
  IF_WRONG: {
    hanging_after_move_pawn: 'Not that one. Look at the pawns next to it.',
    hanging_after_move: 'Not that one. Look at what reaches that square.',
    ignored_attack: 'Not that one. Look at what their last move pointed at.',
    free_piece_ignored: 'Not that one. Look at their pieces nothing is guarding.',
    allowed_mate: 'Not that one. Look at the squares around your king.',
    missed_mate: 'Not that one. Look at the squares around their king.',
    allowed_stalemate: 'Not that one. Tap their king.',
  },
  // after the second wrong tap: the answer square glows and is named
  NAMED: {
    piece: 'The {piece} on {square}.',          // hanging (the taker), free_piece_ignored
    yours: 'Your {piece} on {square}.',         // ignored_attack
    their_lands: 'Their {piece} lands on {square}.', // allowed_mate
    your_lands: 'Your {piece} to {square}.',    // missed_mate
    their_king: 'Their king on {square}.',      // allowed_stalemate
  },
  ANYWAY: {
    hanging_after_move: 'There it goes. A {piece} for {gained}.',
    ignored_attack: 'There it goes. The {piece} is gone.',
    free_piece_ignored: 'There it goes. The free {piece} is not free any more.',
    missed_mate: 'There it goes. The checkmate was there.',
    allowed_mate: 'There it goes.',     // the mate's own line follows at game over
    allowed_stalemate: 'There it goes.', // the draw's own line follows at game over
    saw_it: 'You saw it coming; that counts.',
    next_time: 'Next time, {look} first.',
  },
  LOOK_WORDS: { pawn: 'the pawns', check: 'the check', other: 'their {piece}' },

  REWARD_FREE: 'Free {piece}. You looked.',
  REWARD_ESCAPED: 'You looked. The {attacker} was on your {piece}.',

  K2_FALLBACK: {
    hanging_after_move: 'The {taker} on {square} takes the {piece}. Still want to?',
    ignored_attack: 'The {attacker} takes your {piece} next move. Still want to?',
    free_piece_ignored: 'Their {piece} on {square} is free right now. Still want to?',
    allowed_mate: 'Their {piece} lands on {square} and it is mate. Still want to?',
    missed_mate: 'Your {piece} to {square} is checkmate. Still want to?',
    allowed_stalemate: 'Their king cannot move after this. Still want to?',
  },
  RESTING: 'Coach is resting.',

  LINKS: { SHOW_ME: 'Show me', HEAR_ME_OUT: 'Hear me out', TRY_AGAIN: 'Try again' },
  BUTTONS: {
    TAKE_BACK: 'Take it back', PLAY_ANYWAY: 'Play it anyway', SEND: 'Send', GIVE_UP: 'Give up',
    YES: 'Yes', KEEP_PLAYING: 'Keep playing', START_AGAIN: 'Start again', AGAIN: 'Again',
  },
  SAY_PLACEHOLDER: 'Say what you were going for',
  SAY_NOTE: 'The first time, your browser will ask whether the coach may think. That is all it is.',
  GIVE_UP_ASK: 'Give up this one?',
  MERCY: 'This one is gone. Start again?',

  ENDS: {
    MATE_WIN: 'Checkmate. Well played.',
    MATE_LOSS: 'That one got away.',
    DRAW: 'A draw.',
    RESIGN: 'Black gives up. You are {material} ahead and it knows it.',
    RESIGN_PLAIN: 'Black gives up. It knows where this is going.',
    GAVE_UP: 'You gave up.',
  },
  CLOSE: {
    // {times} 'once' | 'twice' | '3 times'; {back} same; {g} numeral; {last} '' | ' (last game 4)'; {f} numeral
    SUMMARY: 'I stopped your hand {times}; you took it back {back}. Pieces given away: {g}{last}. Free pieces you took: {f}.',
    SUMMARY_NONE: 'I never stopped your hand. Pieces given away: {g}{last}. Free pieces you took: {f}.',
    LAST: ' (last game {n})',
    // one caption per hold: '{Piece} to {square}, {waiting}: {outcome}.'
    CAPTION: '{piece} to {square}, {waiting}: {outcome}.',
    WAITING: {
      hanging_after_move: 'a {taker} was waiting',
      ignored_attack: 'your {piece} was under attack',
      free_piece_ignored: 'a free {piece} was there',
      allowed_mate: 'their check next move was mate',
      missed_mate: 'you had a checkmate',
      allowed_stalemate: 'their king had no move',
    },
    OUTCOME: { back: 'taken back', anyway: 'played anyway', ended: 'the game ended' },
  },
  REMEMBERED: {
    NONE: 'No holds last game. Your move.',
    ONE_PAWN: 'One hold last game, a pawn you did not see. Watch the pawns.',
    ONE: 'One hold last game. Before the piece lands, look from their chair.',
    ALL_PAWNS_TWO: 'Two holds last game, both a pawn you did not see. Watch the pawns.',
    ALL_PAWNS: '{n} holds last game, all a pawn you did not see. Watch the pawns.',
    MIXED: '{n} holds last game. Before the piece lands, look from their chair.',
  },
  TIMES: { 0: 'never', 1: 'once', 2: 'twice' }, // n >= 3 -> `${n} times`
};

// Replace {name} placeholders; a missing value leaves the placeholder, which copy_check flags.
export function fill(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in vars && vars[k] != null ? String(vars[k]) : m));
}
// 'once' | 'twice' | '3 times'
export function timesWord(n) {
  return n in COPY.TIMES ? COPY.TIMES[n] : `${n} times`;
}
export function numberWord(n) {
  return NUMBER_WORDS[n] ?? String(n);
}
// 'a pawn' | 'a pawn and a knight' | 'nothing'
export function gainedWords(types) {
  if (!types || !types.length) return 'nothing';
  return types.map((t) => 'a ' + PIECE_WORDS[t]).join(' and ');
}
// Material in words from a map of extra pieces, e.g. {r: 1, b: 1} -> 'a rook and a bishop',
// {p: 2} -> 'two pawns'. Used by the resignation line (chess.js counts, bot.js/game.js phrase).
export function materialWords(extra) {
  const parts = [];
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    const n = extra[t] || 0;
    if (n === 1) parts.push('a ' + PIECE_WORDS[t]);
    else if (n > 1) parts.push(`${numberWord(n)} ${PIECE_WORDS[t]}s`);
  }
  return parts.join(' and ');
}

// ---------------------------------------------------------------------------------------------
// Test API names (window.__app) — the page exposes exactly these; see ARCHITECTURE.md.
// ---------------------------------------------------------------------------------------------
export const TEST_API = ['load', 'play', 'tap', 'action', 'say', 'botMove', 'fen', 'state', 'waitEngine', 'holds', 'stats', 'newGame', 'fast'];
