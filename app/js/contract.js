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
// Italian after 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 (the chess study's first page, depth 20). The tutorial opens here.
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
// ignored_attack sub-cases: the piece was attacked before his move (already); it was attacked and
// defended and his move removed the guard (lost_guard); it was not attacked at all and his move
// opened an enemy line onto it, a pinned piece moving or a piece stepping off a file (opened_line).
export const SUBCASES = { ALREADY: 'already', LOST_GUARD: 'lost_guard', OPENED_LINE: 'opened_line' };
// Categories that still hold after the second play-anyway (plus any hold with netLoss >= BIG_LOSS).
export const ALWAYS_HOLD = ['allowed_mate', 'missed_mate', 'allowed_stalemate'];
export const GATE = {
  HOLD_CP: 200,          // cpLoss at or above this is needed for the three material categories
  NET_MIN: 2,            // net piece points lost for hanging_after_move; "worth two or more" everywhere
  BIG_LOSS: 5,           // a hold with netLoss >= 5 ignores the quiet-after-two rule
  STALEMATE_AHEAD: 5,    // allowed_stalemate only when he is this many points up
  MATE_SCORE: 10000,     // mate N maps to +/-(MATE_SCORE - N) on the player's side
  STILL_WINNING_CP: 300, // a mate-scored pre-search followed by a plain cp post at or above this is no loss (cpLoss 0)
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
  WATCHDOG_MS: 4000,       // a running search silent (no info line, no bestmove) for this long: the Worker is dead, the engine goes cold (a live depth-14 search prints a line every few ms)
};
export const BOT = {
  GIFT_RATE: 0.12,                 // probability of a gift roll per bot move from GIFT_FROM_MOVE
  // Iteration two: the notch follows the path (PATH.GIFT_RATE, plan.giftRate); the old
  // GIFT_RATE_STEPS ladder is gone (game.js no longer writes KEYS.GIFT_RATE).
  GIFT_FROM_MOVE: 3,               // the bot's third move onward
  GIFT_MAX_CHECKS: 6,              // candidates verified at depth GIFT_DEPTH
  GIFT_DEPTH: 10,
  GIFT_MIN_GAIN_CP: 200,           // the player's best reply must gain this much (his side)
  GIFT_CAP_CP: 900,                // and leave him under this
  LOOK_DEPTH: 8,                   // full-strength look, multipv 2
  FORCED_LEAD_CP: 150,             // a capture leading line 2 by this much is played always ...
  FORCED_NET: 2,                   // ... as is a capture winning this much material by count (the recapture on the same square deducted)
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
  GIFT_RATE: 'holdon.v1.giftRate',            // number: the v1 notch; read once as a fallback, never written again
  GAMES: 'holdon.v1.games',                   // JSON array of GameSummary: KEEP.GAMES newest non-again games plus KEEP.AGAIN_GAMES newest again games
  HOLDS: 'holdon.v1.holds',                   // JSON array, last thirty HoldRecord (+ gameId); still written, read by nothing new
  PATH: 'holdon.v1.path',                     // { v: 1, k3, said: [lookId], digest: [DigestLine], shown: { lookId: stage } }
  SYNC: 'holdon.v1.sync',                     // { uid, at }: the last successful mirror read in this browser
};
// The summaries trim: the newest GAMES non-again games plus the newest AGAIN_GAMES again games,
// in date order (sync.trimGames); the digest is trimmed separately to PATH.DIGEST_MAX.
export const KEEP = { GAMES: 12, AGAIN_GAMES: 3, HOLDS: 30 };

// ---------------------------------------------------------------------------------------------
// The pathway (iteration two): seven looks on a ladder, the hand per look, the digest. Every
// rule is in product/PATHWAY.md; path.js folds the digest with these constants and nothing else.
// ---------------------------------------------------------------------------------------------
export const PATH = {
  // the ladder, in order; mates is words-only and never current; the first six are material looks
  LOOKS: ['pawns', 'takers', 'takes_back', 'their_last_move', 'free', 'guards', 'mates'],
  MATERIAL_LOOKS: ['pawns', 'takers', 'takes_back', 'their_last_move', 'free', 'guards'],
  PREREQUISITE: { takers: 'pawns', takes_back: 'takers', guards: 'their_last_move' },
  STAGES: ['asking', 'quiet', 'off'],                 // the hand per look (mates: words only, always 'asking')
  FACE_STATES: ['not_yet', 'current', 'asking', 'quiet', 'off', 'back', 'always'],
  HAND_LEVELS: ['full', 'bare', 'off'],              // plan.hand values: full question, bare question, no hold
  CLEAN_TO_QUIET: 2,        // clean counted games from asking to quiet
  QUIET_TO_OFF: 1,          // one further clean counted game from quiet to off ...
  WOKEN_TO_OFF: 2,          // ... two when the look was woken (off -> quiet by one slip)
  OFF_WINDOW: 5,            // off also needs this many counted games to exist with zero records of the look in the last OFF_WINDOW of them
  FLOOR_WINDOW: 3,          // every floor reads the last FLOOR_WINDOW counted games including the current one
  OBSERVED_MIN: 20,         // a counted game: observed >= this ...
  OBSERVED_DECISIVE_MIN: 8, // ... or a decisive result (mate-win, mate-loss, resign) with observed >= this
  IDLE_DAYS: 14,            // this long since the newest digest line of any kind: every off look reads quiet for one game
  MATE_WINDOW: 5,           // the mates word 'quiet': zero records in the last MATE_WINDOW counted games and one earlier
  GUARDS_HISTORY: 5,        // the guards floor: at least this many counted games in the digest
  CAPTURES_MIN: 3,          // takes_back floor: captures summed over the floor window
  ESCAPES_MIN: 2,           // their_last_move floor: escapes summed over the floor window (or everFired)
  GIFTS_MIN: 2,             // free floor: gifts offered summed over the window, and taken >= offered - 1
  DIGEST_MAX: 200,          // digest lines kept, newest; never trimmed with the summaries
  MAX_COUNT_WORD: 12,       // counts above this read as COPY.PATH.MANY on the face and in prompts
  NOT_YET_GAMES: 3,         // a look that never fired collapses into the muted line while fewer counted games exist
  SINCE_WEEK_DAYS: 7,       // 'Yours since Tuesday' within a week of going off, 'Yours for a while' after
  GIFT_RATE: { on: 0.12, off: 0.08 },   // plan.giftRate: on while free is asking or quiet, off once free is off
  SAID_TEXT_MAX: 120,       // HoldRecord.said is trimmed to this many characters, stored raw
  ID_SUFFIX: 2,             // game id = Date.now().toString(36) plus this many random base-36 characters
  // outcomes: records of a look (in a non-again game) are these four; 'again' is the drill's
  // own take-back and never a record (again games hold no records at all); shown holds (the
  // close card's count, 'times', remembered(), K1's holdsSoFar) are the holds he saw: never a
  // landed one; the drill's 'again' is counted on the again game's own card only
  RECORD_OUTCOMES: ['back', 'anyway', 'ended', 'landed'],
  SHOWN_OUTCOMES: ['back', 'anyway', 'ended', 'again'],
  WHY: [null, 'pair', 'quiet', 'hand'],    // HoldRecord.why: the suppression reason of a landed record
  // the piece words a K3 remembering question may use, per look (validateK3; empty = none)
  QUESTION_PIECES: {
    pawns: ['pawn'], takers: ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'], takes_back: [],
    their_last_move: [], free: [], guards: [], mates: ['king', 'queen'],
  },
  // path.js's own ask_first rule (the K2 kind a hold of this look leans toward when K3 is silent)
  ASK_FIRST: { pawns: 'what_takes_it', takers: 'what_takes_it', takes_back: 'what_takes_back', their_last_move: 'attacked_piece', free: 'what_is_free', guards: 'attacked_piece', mates: null },
};
// The hand setting of a verdict-shaped thing ({ category, sub, variant, pawnAmongTakers }) under
// plan.hand: by category, then sub, then pawnAmongTakers (first), then variant. A missing hand,
// slot or unknown value reads 'full'; mates and stalemate are always 'full'. gate.verdict (the
// 'hand' suppression), game.js (the bare question) and the tests all read it from here.
export function handLevel(hand, v) {
  if (!hand || !v || !v.category) return 'full';
  if (ALWAYS_HOLD.includes(v.category)) return 'full';
  let level = 'full';
  if (v.category === 'hanging_after_move') {
    const slot = hand.hanging_after_move || {};
    level = v.pawnAmongTakers ? slot.pawn : v.variant === 'takes_back' ? slot.takes_back : slot.piece;
  } else if (v.category === 'ignored_attack') {
    const slot = hand.ignored_attack || {};
    level = slot[v.sub] || slot.already;
  } else if (v.category === 'free_piece_ignored') {
    level = hand.free_piece_ignored;
  }
  return PATH.HAND_LEVELS.includes(level) ? level : 'full';
}
// The plan.hand with every slot at one setting (an empty log, or the tests).
export function handAll(level = 'full') {
  return {
    hanging_after_move: { pawn: level, piece: level, takes_back: level },
    ignored_attack: { already: level, lost_guard: level, opened_line: level },
    free_piece_ignored: level,
    allowed_mate: 'full', missed_mate: 'full', allowed_stalemate: 'full',
  };
}

// ---------------------------------------------------------------------------------------------
// DOM contract: ids, classes, data attributes, action names, states
// ---------------------------------------------------------------------------------------------
export const DOM = {
  ids: {
    top: 'top', brand: 'brand', giveup: 'giveup', theme: 'theme', coach: 'coach', links: 'links',
    boardwrap: 'boardwrap', board: 'board', squares: 'squares', pieces: 'pieces', ghosts: 'ghosts',
    loss: 'loss', edge: 'edge', actions: 'actions', close: 'close', sayInput: 'say', defs: 'defs',
    stage: 'stage',          // <main id="stage" class="stage" [data-view="path"]>
    path: 'path',            // <section id="path"> beside #close: the shown state
    pathLooks: 'path-looks', // the <ol> of rows inside #path
  },
  // main#stage[data-view]: absent while playing and on the close card; 'path' in the shown state
  views: ['path'],
  // the path view's classes: <li class="row" data-look="pawns" data-stage="current"> holding
  // <span class="dot"> (the current row only), <button class="sentence" type="button"> and
  // <span class="caption">; the collapsed row is <li class="row collapsed">; the close card gains
  // <p class="close-path"> (the template line) and <p class="close-where"> (Claude's where line,
  // hidden when none, fading in)
  path: { row: 'row', sentence: 'sentence', caption: 'caption', dot: 'dot', collapsed: 'collapsed', closePath: 'close-path', closeWhere: 'close-where' },
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
    taken: 'taken',   // a real piece a ghost capture has landed on (hidden while the ghost stands there)
  },
  coach: { base: 'coach', echo: 'echo', looking: 'looking', first: 'first', long: 'long' },  // long: more than LONG_LINE_WORDS words (phone: 17 px, five lines in the same box)
  states: ['idle', 'pending', 'held', 'reply', 'over'],  // #board[data-state]
  // #board[data-hold] = category while held, '' otherwise; #board[data-input] = 'move' | 'answer' | 'locked'
  // #board[data-ghost] = '1' while Show me plays; #board[data-warm] = '1' when a bot move waits on warm-up
  actions: [
    'takeback', 'anyway', 'showme', 'but', 'send', 'giveup', 'giveup-yes', 'keep',
    'startagain', 'again', 'theme',
    'path',        // the close card's 'Where you are' link: enters the path view (state over only)
    'back',        // the path view's [Back] in the action bar: leaves it
    'again-from',  // the close card's 'Play it again from here' link: starts the again-from drill
  ],
  buttonClasses: { primary: 'btn primary', quiet: 'btn quiet', link: 'link' },
};
export const PIECE_SYMBOL_PREFIX = 'pc-'; // <symbol id="pc-wN"> ... <use href="#pc-wN">

// ---------------------------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------------------------
export const CLAUDE = {
  TIER: 'quick',
  PROMPT_VERSION: 'v3',      // v3: K3 (the close) added; K1 and K2 gain the two path fact lines
  // K3, the close: one call per game after storeGame, only when consented, never in an again game
  K3: {
    WHERE_MAX_WORDS: 18, WHERE_MAX_SENTENCES: 1,
    NEXT_MAX_WORDS: 12, NEXT_MAX_SENTENCES: 1,
    AGAIN_MAX_WORDS: 16, AGAIN_MAX_SENTENCES: 2,     // or empty
    QUESTION_MAX_WORDS: 14, QUESTION_MAX_SENTENCES: 4,
    QUESTION_START: 'Hold on.', QUESTION_END: 'Tap it.',
    FIELDS: ['where', 'next', 'again', 'question', 'ask_first', 'focus'],
    PROMPT_MAX_BYTES: 2048,
  },
  K2_MAX_WORDS: 32, K2_MAX_WORDS_PER_SENTENCE: 20, K2_MAX_SENTENCES: 2, K2_MAX_SQUARES: 3,   // 32 in all so the say plus the 8-word ask question fits the four-line box at 400 px
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
// A look that is not the category's own carries its own follow-up lines (copy): the hold's lines
// are written for the hold's look and would be false for it. {piece} is the piece on the tapped
// square ({piece} is the moved piece for safe_square), {square} the square the line names.
export const ASKS = {
  what_takes_it: { question: 'Tap the piece that takes it.', meaning: 'the piece that takes the {piece} on {square}' },
  what_takes_back: { question: 'Tap what takes back.', meaning: 'the piece that takes back on {square}' },
  safe_square: {
    question: 'Tap a square where the {piece} is safe.', meaning: 'a square the {piece} can go to instead where nothing takes it and no pawn can kick it',
    copy: { if_right: 'Yes, the {piece} is safe there.', if_wrong: 'Not that one. Something of theirs reaches that square.', named: 'The {piece} is safe on {square}.' },
  },
  what_is_free: {
    question: 'Tap the piece of theirs that is free.', meaning: 'a piece of theirs that is free right now',
    copy: { if_right: 'Yes, their {piece}. Nothing of theirs guards it.', if_wrong: 'Not that one. Look at their pieces nothing is guarding.', named: 'Their {piece} on {square} is free.' },
  },
  attacked_piece: {
    question: 'Tap the piece of yours under attack.', meaning: 'the piece of yours that is under attack right now',
    copy: { if_right: 'Yes, your {piece}. Something of theirs reaches it.', if_wrong: 'Not that one. Look at what their pieces reach.', named: 'Your {piece} on {square} is under attack.' },
  },
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

  TUTORIAL_OPEN: 'Try one. Most people take the pawn beside the king with the bishop here. Go on.',
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
    ignored_attack_opened_line: 'Hold on. Your move opens a line to something of yours. Tap it.',
    free_piece_ignored: 'Hold on. Something of theirs is free right now. Tap it.',
    // a guarded piece of theirs that a cheaper piece of his takes for a net gain (facts' hanging
    // by the cheaper attacker): not free, but won
    free_piece_ignored_cheap: 'Hold on. Something of theirs can be won right now. Tap it.',
    allowed_mate: 'Hold on. Their {piece} has a check next move. Where does it land? Tap it.',
    missed_mate: 'Hold on. You have a checkmate on the board. Tap the square.',
    allowed_stalemate: 'Hold on. After this, can their king move at all? Tap their king.',
    // the hand set to 'bare' (a quiet look, or an off look under review): the hold fires, the
    // piece lifts, the square breathes, every tap is graded as always, but this is all it says
    bare: 'Hold on. You know this one. Tap it.',
  },
  IF_RIGHT: {
    hanging_after_move: 'Yes, the {taker}. A {piece} for {gained}.',
    ignored_attack_already: 'Yes, the {piece}. The {attacker} takes it next move.',
    ignored_attack_lost_guard: 'Yes, the {piece}. Your move took its guard away.',
    ignored_attack_opened_line: 'Yes, the {piece}. The piece you moved was standing in the {attacker}\'s way.',
    free_piece_ignored: 'Yes, the {piece}. It was yours for the taking.',
    free_piece_ignored_cheap: 'Yes, the {piece}. It is worth more than what takes it.',
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
    // the attack was there before their last move (it did not make it)
    ignored_attack_already_old: 'Not that one. Look at what their pieces can already take.',
    ignored_attack_lost_guard: 'Not that one. Look for the piece that lost its guard.',
    ignored_attack_opened_line: 'Not that one. Look along the line your piece just left.',
    free_piece_ignored: 'Not that one. Look at their pieces nothing is guarding.',
    free_piece_ignored_cheap: 'Not that one. Look at what you can take with something cheaper.',
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
    free_piece_ignored_cheap: 'There it goes. The {piece} could have been won.',
    missed_mate: 'There it goes. The checkmate was there.',
    allowed_mate: 'There it goes.',     // the mate's own line follows at game over
    allowed_stalemate: 'There it goes.', // the draw's own line follows at game over
    elsewhere: 'There it goes. They chose something else; your {piece} is still there.',  // the reply did not land on the hold's piece
    saw_it: 'You saw it coming; that counts.',
    next_time: 'Next time, {look} first.',
  },
  LOOK_WORDS: { pawn: 'the pawns', check: 'the check', king: 'what takes back', stalemate: 'their king\'s squares', other: 'their {piece}' },

  REWARD_FREE: 'Free {piece}. You looked.',
  REWARD_ESCAPED: 'You looked. The {attacker} was on your {piece}.',

  K2_FALLBACK: {
    hanging_after_move: 'The {taker} on {square} takes the {piece}. Still want to?',
    ignored_attack: 'The {attacker} takes your {piece} next move. Still want to?',
    free_piece_ignored: 'Their {piece} on {square} is free right now. Still want to?',
    free_piece_ignored_cheap: 'Their {piece} on {square} can be won right now. Still want to?',
    allowed_mate: 'Their {piece} lands on {square} and it is mate. Still want to?',
    missed_mate: 'Your {piece} to {square} is checkmate. Still want to?',
    allowed_stalemate: 'Their king cannot move after this. Still want to?',
  },
  RESTING: 'Coach is resting.',

  LINKS: { SHOW_ME: 'Show me', HEAR_ME_OUT: 'Hear me out', TRY_AGAIN: 'Try again', WHERE_YOU_ARE: 'Where you are', AGAIN_FROM: 'Play it again from here' },
  BUTTONS: {
    TAKE_BACK: 'Take it back', PLAY_ANYWAY: 'Play it anyway', SEND: 'Send', GIVE_UP: 'Give up',
    YES: 'Yes', KEEP_PLAYING: 'Keep playing', START_AGAIN: 'Start again', AGAIN: 'Again', BACK: 'Back',
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
    SUMMARY_NO_BACKS: 'I stopped your hand {times}; you played every one. Pieces given away: {g}{last}. Free pieces you took: {f}.',
    SUMMARY_NONE: 'I never stopped your hand. Pieces given away: {g}{last}. Free pieces you took: {f}.',
    LAST: ' (last game {n})',
    // one caption per hold: '{Piece} to {square}, {waiting}: {outcome}.'
    CAPTION: '{piece} to {square}, {waiting}: {outcome}.',
    WAITING: {
      hanging_after_move: 'a {taker} was waiting',
      ignored_attack: 'your {piece} was under attack',
      free_piece_ignored: 'a free {piece} was there',
      free_piece_ignored_cheap: 'their {piece} could be won',
      allowed_mate: 'their check next move was mate',
      missed_mate: 'you had a checkmate',
      allowed_stalemate: 'their king had no move',
    },
    // 'landed': a verdict the gate matched but did not show (why 'pair' | 'quiet' | 'hand');
    // 'again': the drill's take-back ('Play it again from here')
    OUTCOME: { back: 'taken back', anyway: 'played anyway', ended: 'the game ended', landed: 'it landed', again: 'answered' },
    LANDED: 'it landed',
    // the whole caption of a landed free_piece_ignored record (nothing of his was lost)
    FREE_STAYED: 'A free {piece} was there: it stayed.',
    FREE_STAYED_CHEAP: 'Their {piece} could be won: it stayed.',
  },
  // The pathway's copy. Every string here is at most 28 words, holds no digit, passes
  // validate.templateRules and the banned list (copy_check); the LOOK sentences are under 34
  // characters each. {look} is COPY.PATH.LOOK_WORDS[lookId]; {n} a count in words (countWord);
  // {games} 'game' | 'games'; {day} a weekday name; {piece} a piece word.
  PATH: {
    // the seven sentences on the face, in ladder order (each under 34 characters)
    SENTENCES: {
      pawns: 'I see the pawn before it lands.',
      takers: 'I see what takes it first.',
      takes_back: 'Before I take, what takes back.',
      their_last_move: 'I answer their last move.',
      free: 'I take what is free.',
      guards: 'I see what my move leaves.',
      mates: 'I see the mate next move.',
    },
    // the look named inside a sentence: 'on {look}', 'about {look}'
    LOOK_WORDS: {
      pawns: 'the pawns', takers: 'what takes it', takes_back: 'what takes back', their_last_move: 'their last move',
      free: 'what is free', guards: 'what your move leaves', mates: 'the mate next move',
    },
    // one-line meanings for the prompts (K3 block 2, the K1 and K2 fact lines); no squares
    MEANING: {
      pawns: 'a piece left where a pawn takes it',
      takers: 'a piece left where something takes it',
      takes_back: 'a capture that loses to the recapture',
      their_last_move: 'a piece of yours under attack, left where it was',
      free: 'a free piece of theirs walked past',
      guards: 'a piece of yours left unguarded or opened up by your move',
      mates: 'a mate next move, theirs or yours, or a stalemate in a won game',
    },
    // the opening line of games two onward while the look is current (the countdown follows it)
    OPEN: {
      pawns: 'Still on the pawns.',
      takers: 'What takes it. Before the piece lands, look from their chair.',
      takes_back: 'Before you take, what takes back.',
      their_last_move: 'Before your move, their last move. What did it touch?',
      free: 'Something of theirs may be free today. Look before you plan.',
      guards: 'When a piece moves, what was it guarding?',
    },
    // the countdown in words, appended to OPEN while every floor holds; FLOOR when one does not
    COUNTDOWN: {
      QUIET_ONE: 'One more clean game and I ask with fewer words.',
      QUIET_MANY: '{n} more clean games and I ask with fewer words.',
      OFF_ONE: 'One more clean game and I stop asking.',
      OFF_MANY: '{n} more clean games and I stop asking.',
      FLOOR: {
        takes_back: 'Take a few more pieces first; then I can tell.',
        their_last_move: 'Let them attack something first; then I can tell.',
        free: 'Let them leave something free first; then I can tell.',
        guards: 'A few more games first; then I can tell.',
      },
    },
    // at most one of these opens a game, before OPEN: a change his own last game caused
    TRANSITION: {
      QUIET: {
        pawns: 'The pawns were clean again. I will ask with fewer words now.',
        takers: 'Nothing was left where a piece takes it. I will ask with fewer words now.',
        takes_back: 'Your captures held. I will ask with fewer words now.',
        their_last_move: 'You answered their last move every time. Fewer words from me now.',
        free: 'You took what was free. I will ask with fewer words now.',
        guards: 'Nothing of yours lost its guard. I will ask with fewer words now.',
      },
      OFF: {
        pawns: 'I will not ask about the pawns today. They are yours.',
        takers: 'I will not ask what takes it today. That look is yours.',
        takes_back: 'I will not ask what takes back today. That look is yours.',
        their_last_move: 'I will not ask about their last move today. It is yours.',
        free: 'I will not point at a free piece today. That look is yours.',
        guards: 'I will not ask what your move leaves today. That look is yours.',
      },
      SLIP: {
        pawns: 'The pawns, once, and I said nothing. I will ask again.',
        takers: 'A piece landed where something takes it, and I said nothing. I will ask again.',
        takes_back: 'A capture lost to the recapture, and I said nothing. I will ask again.',
        their_last_move: 'Their last move went unanswered, and I said nothing. I will ask again.',
        free: 'A free piece stayed where it was, and I said nothing. I will ask again.',
        guards: 'A guard went missing last game, and I said nothing. I will ask about those again.',
      },
      // a look that was off woken by one record of a hold he was shown (the fourteen-day review
      // or a loss of five or more): the hand spoke, so 'I said nothing' would be false
      SLIP_HELD: {
        pawns: 'The pawns, once, last game. I will ask again.',
        takers: 'A piece went where something takes it, once. I will ask again.',
        takes_back: 'A capture lost to the recapture, once. I will ask again.',
        their_last_move: 'Their last move went unanswered, once. I will ask again.',
        free: 'A free piece was walked past, once. I will ask again.',
        guards: 'A guard went missing last game. I will ask about those again.',
      },
      WAKE: {
        pawns: 'The pawns again. I am holding those once more.',
        takers: 'Pieces left where something takes them, again. I am holding those once more.',
        takes_back: 'Captures that lose to the recapture, again. I am holding those once more.',
        their_last_move: 'Their last move went unanswered again. I am holding those once more.',
        free: 'Free pieces walked past again. I am pointing at those once more.',
        guards: 'A guard went missing last game. I will ask about those again.',
      },
      REVIEW: 'It has been a while. I will hold a little more today.',
    },
    NOTHING_LEFT: 'There is nothing left for me to hold. Your move.',
    NOT_COUNTED: 'Games that end early do not count. Play one through.',
    MATE_LOSS: 'When their queen is near your king, their check first.',
    // the remembering question at 0 ms (a hold of the current look when the newest stored game
    // holds a record of that kind); every one passes validateK3's shape
    QUESTION: {
      pawns: 'Hold on. The pawns again. Which one reaches that square? Tap it.',
      takers: 'Hold on. Not a pawn this time. What reaches that square? Tap it.',
      takes_back: 'Hold on. This one again. Before you take there: what takes back? Tap it.',
      their_last_move: 'Hold on. Their last move pointed at something of yours. Tap it.',
      free: 'Hold on. Something of theirs is free again. Tap it.',
      guards_lost_guard: 'Hold on. The piece you are moving was guarding something. Tap it.',
      guards_opened_line: 'Hold on. Your move opens a line again. Tap it.',
    },
    // the close card's serif path line, in the coach's voice, under the counts
    CLOSE: {
      NONE_FIRST: 'I never stopped your hand. The pawns are the first thing I watch.',
      NONE: 'I never stopped your hand. We are still on {look}.',
      ONE: 'One hold today, on {look}. That is what we are on.',
      ALL: '{n} holds today, all on {look}. That is what we are on.',
      SOME: '{n} holds today, {k} on {look}. That is what we are on.',
      OTHER: '{n} holds today, none on {look}. That is still what we are on.',
      OTHER_ONE: 'One hold today, none on {look}. That is still what we are on.',
      // a landed record of a look whose hand was off (why 'hand'): the hand comes back
      LANDED: {
        pawns: 'A piece landed today where a pawn could take it, and I said nothing. I will ask about the pawns again.',
        takers: 'A piece landed today where something could take it, and I said nothing. I will ask again.',
        takes_back: 'A capture today lost to the recapture, and I said nothing. I will ask again.',
        their_last_move: 'Their last move went unanswered today, and I said nothing. I will ask again.',
        free: 'A free piece of theirs stayed today, and I said nothing. I will ask again.',
        guards: 'A piece of yours lost its guard today, and I said nothing. I will ask about those again.',
      },
      // a landed record of the current look let go by the pair or quiet rule (he had played
      // holds anyway, so the gate stopped asking for the rest of the game)
      LANDED_LET: {
        pawns: 'Later I let one go: a piece landed where a pawn could take it. The pawns are what we are on.',
        takers: 'Later I let one go: a piece landed where something could take it. That is what we are on.',
        takes_back: 'Later I let one go: a capture that lost to the recapture. That is what we are on.',
        their_last_move: 'Later I let one go: their last move went unanswered. That is what we are on.',
        free: 'Later I let one go: a free piece of theirs stayed. That is what we are on.',
        guards: 'Later I let one go: a piece of yours lost its guard. That is what we are on.',
      },
      AGAIN: 'That one was practice. Nothing in it counts for or against you.',
      NOTHING_LEFT: 'There is nothing left for me to hold.',
    },
    // the coach line above the path view, keyed by the counted-game count and the off count
    WHERE: {
      FIRST: 'One game is not enough to know you. Here is what I will be watching.',
      NONE_OFF: 'Nothing is yours yet. Here is what I still hold.',
      ONE_OFF: 'One of these is yours. I still hold {rest}.',
      SOME_OFF: '{n} of these are yours. I still hold {rest}.',
      ALL_OFF: 'There is nothing left for me to hold.',
    },
    // the Plex caption under each sentence
    CAPTION: {
      CURRENT: 'This is where we are.',
      CURRENT_RECENT: 'This is where we are. {n} in the last three games.',   // {n} 'Twice'
      CURRENT_GAME: 'This is where we are. {n} this game.',                  // the first close card
      ASKING: 'I still stop your hand here.',
      QUIET: 'I ask with fewer words now.',
      OFF: 'Yours.',
      OFF_SINCE: 'Yours since {day}.',
      OFF_WHILE: 'Yours for a while.',
      BACK: 'Again, for now.',
      MATES: 'Always. This one I never let go.',
      MATES_QUIET: 'Always. Quiet for five games.',
    },
    COLLAPSED: '{n} more, not come up yet.',       // {n} 'Three'
    COLLAPSED_ONE: 'One more, not come up yet.',
    // the drill: Claude's framing line or this one, above the page's own question; the line
    // after he keeps the piece
    AGAIN: 'You played this one. Look first this time.',
    ANSWERED: 'Answered.',
    MANY: 'many',                                  // a count above PATH.MAX_COUNT_WORD
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
export const TEST_API = [
  'load', 'play', 'tap', 'action', 'say', 'botMove', 'fen', 'state', 'waitEngine', 'holds', 'stats', 'newGame', 'fast',
  'path',   // path(): the frozen PathState this game was planned from
  'plan',   // plan(): the frozen plan on S (hand, giftRate, line, question, askFirst, closeLine, drill, review, transitions)
  'seed',   // seed({ games?, path?, giftRate? }): writes the log keys, recomputes as a reload would, starts a new game; resolves the PathState
  'view',   // view(): null | 'path'
  'again',  // again(): the again-from drill from the close card (state over with a drill); resolves when the hold is up
];
