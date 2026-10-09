# Hold On — architecture of the MVP

The build contract is `product/PRODUCT.md`; this file is the plan that makes six builders agree
on names. Where the spec is silent, the decision is here and marked **Decided**. `app/js/contract.js`
holds every shared constant (categories, values, copy templates, timings, keys, DOM hooks); nothing
here contradicts it, and when a name is in both, contract.js wins.

Plain ES modules, no build step, no framework, no CDN scripts. One `app/index.html`, one
`app/styles.css`, modules under `app/js/`, data under `app/data/`, engines under `app/vendor/`.
`app/package.json` has `"type": "module"` so node imports the modules directly for unit tests.

## 1. Build groups and file ownership

| group  | owns |
|--------|------|
| shell  | `app/index.html`, `app/styles.css`, `app/js/board.js`, `app/assets/pieces.svg` (and `app/LICENSE.md` if cburnett is vendored) |
| engine | `app/js/engine.js`, `app/js/bot.js`, `app/data/book.json`, `scripts/bot_sim.py` |
| logic  | `app/js/facts.js`, `app/js/gate.js`, `app/data/tutorial.json`, `app/data/positions.json`, `scripts/test_gate.mjs`, `scripts/record_positions.py` (generator for positions.json) |
| hold   | `app/js/game.js`, `app/js/hold.js`, `app/js/ghost.js` |
| coach  | `app/js/coach.js`, `app/js/validate.js`, `app/js/store.js`, `scripts/test_validate.mjs` |
| tests  | `scripts/scenarios/holdon.js`, `scripts/copy_check.js`, the stub extension inside `scripts/app_check.js`, `scripts/test_all.sh` |
| architect (done) | `app/ARCHITECTURE.md`, `app/js/contract.js`, `app/package.json`, `app/dev/.gitignore` |

Scratch pages go in `app/dev/` (gitignored) or the scratchpad. Nobody edits another group's file; if a
group needs something from another file, it is requested through the integrator, not patched.

## 2. Module graph

```
index.html ──(type=module)──> js/game.js
                                 ├─ contract.js            (everyone)
                                 ├─ vendor/chess.js        (game, facts, gate tests, bot, ghost)
                                 ├─ board.js               (shell)      DOM of the board only
                                 ├─ engine.js              (engine)     Worker + UCI queue
                                 ├─ bot.js                 (engine)     opponent recipe, book
                                 ├─ facts.js               (logic)      fact sheet, pure
                                 ├─ gate.js                (logic)      verdict/reward/copy/asks/grade, pure
                                 ├─ hold.js                (hold)       hold presentation + grading UI
                                 ├─ ghost.js               (hold)       Show me
                                 ├─ coach.js               (coach)      claude.use('sample'), K2, K1
                                 │    └─ validate.js       (coach)      pure pipeline
                                 └─ store.js               (coach)      localStorage
data/tutorial.json, data/book.json, data/positions.json are fetched with fetch() relative to the page
(same-origin files only). game.js fetches tutorial.json; bot.js fetches book.json; positions.json is
test data only (never fetched by the page).
```

Dependency rules: `board.js`, `engine.js`, `store.js`, `validate.js`, `facts.js`, `gate.js` import nothing
from the app except `contract.js` (and chess.js where noted). `hold.js`, `ghost.js`, `coach.js`,
`bot.js` import from the layer below. Only `game.js` wires everything and owns `window.__app`.

## 3. index.html element tree

```
<!doctype html> <html lang="en" [data-theme="light"|"dark"]>
<head>
  <meta charset> <meta name=viewport content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Hold On</title>
  <link rel="icon" href="data:,">
  <link rel="preload" href="./assets/fonts/source-serif-4-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="./assets/fonts/ibm-plex-sans-latin.woff2" as="font" type="font/woff2" crossorigin>   <!-- the two faces are self-hosted (integration): @font-face in styles.css -->
  <link rel="stylesheet" href="./styles.css">
  <script>/* theme boot: read localStorage holdon.v1.theme (try/catch) and set data-theme before paint */</script>
</head>
<body>
  <svg id="defs" aria-hidden="true" style="display:none"> <symbol id="pc-wK" viewBox="0 0 100 100">…</symbol> … 12 symbols pc-{w|b}{K|Q|R|B|N|P} </svg>
  <header id="top" class="top">
    <span id="brand" class="brand">Hold On</span>
    <span class="top-right">
      <button id="giveup" class="link muted" data-action="giveup" type="button">Give up</button>
      <button id="theme" class="theme-dot" data-action="theme" type="button" aria-label="Switch theme"></button>
    </span>
  </header>
  <main class="stage">
    <p id="coach" class="coach" aria-live="polite">Your move.</p>      <!-- fixed four-line box; may contain <span class="echo"> -->
    <nav id="links" class="links" aria-label="Coach">                    <!-- 24 px row, 44 px targets; empty when nothing applies -->
      <button class="link" data-action="showme" type="button" hidden>Show me</button>
      <button class="link" data-action="but" type="button" hidden>Hear me out</button>
    </nav>
    <div id="boardwrap" class="boardwrap">
      <div id="board" class="board" data-state="idle" data-hold="" data-input="move" role="group" aria-label="Board">
        <div id="squares" class="squares">  <!-- 64 × <button class="sq light|dark" data-square="a8" type="button" tabindex="-1"> in a8..h1 order; the a-file and rank-1 squares contain <span class="coord">… -->
        </div>
        <div id="pieces" class="pieces">    <!-- N × <button class="pc" data-square="e2" data-piece="wP" data-id="7" type="button" aria-label="White pawn on e2"><svg><use href="#pc-wP"/></svg></button>; moved by transform -->
        </div>
        <div id="ghosts" class="ghosts" aria-hidden="true">  <!-- <div class="ghost" data-square data-piece> during Show me -->
        </div>
      </div>
      <div id="loss" class="loss" aria-hidden="true" hidden></div>  <!-- the 28 px serif '-N' label: in the wrapper, outside the board (overflow hidden), so it rises from under the board and never crosses a square -->
      <div id="edge" class="edge" aria-hidden="true"><span class="edge-dot"></span><span class="edge-caption"></span></div>
    </div>
    <div id="actions" class="actions" aria-live="polite"></div>   <!-- 56 px; empty until a decision is needed -->
    <section id="close" class="close" hidden>
      <p class="close-sum"></p>
      <ul class="close-holds"></ul>
      <button class="btn primary" data-action="again" type="button">Again</button>
    </section>
  </main>
  <script type="module" src="./js/game.js"></script>
</body>
```

Action bar contents (game.js/hold.js write them; shell styles them; everything is a `<button type=button data-action=…>` or the one `<input>`):

- hold answered: `<button class="btn primary" data-action="takeback">Take it back</button> <button class="btn quiet" data-action="anyway">Play it anyway</button>`; takeback receives focus.
- Hear me out open: `<form class="say"><input id="say" class="say-input" type="text" enterkeyhint="done" autocomplete="off" maxlength="120" placeholder="Say what you were going for"><button class="btn primary" data-action="send" type="submit">Send</button></form><p class="note">The first time, your browser will ask whether the coach may think. That is all it is.</p>` — the two decision buttons are hidden while the input is open and come back when it closes; the bar is never rebuilt under the open input (the buttons timer and a tap that answers the hold only set `buttonsShown`), so what he typed and his focus survive; the 'Hear me out' link hides while its input is open.
- give up: `<span class="ask">Give up this one?</span> <button class="btn primary" data-action="giveup-yes">Yes</button> <button class="btn quiet" data-action="keep">Keep playing</button>`
- mercy: the line says 'This one is gone. Start again?'; the bar holds `[data-action=startagain]` (primary) and `[data-action=keep]`.
- over: the bar is empty; the close card holds `[data-action=again]`.

**Decided** DOM points the spec leaves open:
- Squares are `<button>`s with `tabindex=-1` so a keyboard user can answer: arrow keys on a focused piece or square move focus across the grid (board.js), Enter/Space taps. Pieces are tabbable buttons with a visible focus ring (`:focus-visible` outline in `--coach`).
- The hold dim is CSS: `.board[data-state=held] .sq:not(.amber)::after { background: var(--dim) }`; no per-square class.
- Pieces are positioned by two custom properties set by board.js (`--tx`, `--ty` as percentages of the piece box) and CSS composes `transform: translate(var(--tx), var(--ty))`; `.lifted` and `.picked` append `translateY(-6px) scale(1.06)`. A 150 ms `transition: transform` (0 under reduced motion and when `html[data-fast]` is set).
- `html[data-fast="1"]` is set by game.js when `window.__app.fast` is true so CSS durations are 0 in test runs.
- The board edge for the opponent (`#edge`) sits above the board (Black at the top).
- Theme dot: 12 px circle, filled `--ink` in light, hollow (2 px ring) in dark; 44 px target.
- The coach line's echo during Hear me out: `#coach` gets class `looking`, its text is 'Looking...' followed by his words with no marks around them (the guillemets live only inside the prompt), `<span class="echo">his words</span>` on the next line in `--muted`.
- Fonts: Source Serif 4 and IBM Plex Sans (latin subsets, OFL) are served from `app/assets/fonts/` through `@font-face` in styles.css with the fallback stacks from the spec. **Integration change**: the Google Fonts `<link>` was dropped because the harness's Chromium cannot verify the proxy's CA here (ERR_CERT_AUTHORITY_INVALID made `report.ok` false on every run) and because the page then makes no request outside its own files.

## 4. The state machine (game.js)

`#board[data-state]` is one of `idle | pending | held | reply | over`. Sub-flags: `data-hold=<category>`
while held, `data-input=move|answer|locked`, `data-ghost=1` during Show me, `data-warm=1` while a bot
move truly waits on warm-up.

```
boot ─┬─ tutorial flag absent ─> load TUTORIAL_FEN, tutorial=true, line TUTORIAL_OPEN ─> idle
      └─ else ─> START_FEN, line = remembered line or YOUR_MOVE ─> idle, pre-search

idle (player to move; pre-search running or cached)
  tap own piece ─> picked (dots/rings)  tap target ─> drop
  drop ─> pending
pending (input locked; dot on the piece after 250 ms)
  tutorial     ─> tutorial.json verdict (0 ms)
  engine cold or dead ─> commit, no verdict, no reward (dead: an 'error' event after readyok, or a search silent for ENGINE.WATCHDOG_MS; isReady() turns false)
  else         ─> engine.stop(); maybe re-search pre; post search depth 12 mpv 2; facts; gate.verdict()
  verdict.held ─> held           verdict clean ─> commit ─> reward? ─> reply
held (piece lifted, amber, dim, question at 0 ms, action bar empty, links Show me [+ Hear me out])
  tap square  ─> grade (right | partial | wrong | named) ─> after right/partial/second wrong: buttons
  8 s (300 fast) with no tap ─> buttons
  Show me     ─> data-ghost=1 ... rewind ─> held (state unchanged)
  Hear me out ─> input ─> send ─> looking ─> K2 reply (or fallback) ─> ask question ─> next tap graded by the ask
  Take it back─> unmove (150 ms) ─> log outcome 'back' ─> idle (cached pre-search reused; 'Your move.')
  Play it anyway ─> commit ─> log 'anyway' ─> reply (true best, depth 12) ─> anyway sentence ─> idle
reply (bot thinking; at least 400 ms after his move; edge dot at 800 ms)
  book | forced | gift | sampled | guarded | anyway | test(forced by botMove)
  apply move ─> game over? ─> over      resignation? ─> over      else ─> idle, pre-search
over (close card shown; Again ─> new game at START_FEN)
Any state: Give up (header) ─> action bar confirm ─> over('giveup').  Mercy offer appears once in idle.
```

`load(fen)` (test API) from any state: aborts calls and timers, closes a hold without logging, replaces
the position within the current game (counters, anyways, hold log, quiet budget, pair exclusions are
kept), tutorial=false, state idle, pre-search started; resolves when the pre-search has finished or the
engine is cold. `newGame()` resets everything a page reload would (counters, log, giftDue) and starts a
new game id, without touching localStorage flags.

### The drop in detail

1. `board.move(move)` animates; `data-state=pending`, `data-input=locked`; the 250 ms dot timer starts.
2. Tutorial: look up `tutorial.json.moves[san]`; held rows become a verdict with the canned answer set
   and refutation; everything else commits; no engine. Any path sets `KEYS.TUTORIAL_SEEN`.
3. Not ready (`engine.isReady()` false, including a Worker that died after readyok): commit with
   `verdict=null` (no reward, no hold, not counted). A drop overtaken by `load()`, `newGame()` or the end
   of the game returns 'illegal' after `board.setPosition(chess)` and keeps nothing (no pre, no mercy tick).
4. Ready: `await engine.stop()` (the stopped pre-search result is kept if its depth >= 8, otherwise
   `search(preFen, {depth: 10, multipv: 2})` runs first); build `factsBefore` (cached from the pre
   position) and `factsAfter` (scratch Chess with the move applied); `search(postFen, {depth: 12,
   multipv: 2})`; `gate.verdict(pre, post, factsBefore, factsAfter, gameState)`.
5. `verdict.held` → `hold.open(...)`; else commit, `gate.reward(..., lastMove)` under the quiet budget (the
   opponent's own verified gift, taken, is `free_taken` by construction whatever the pre-search's first
   line preferred), then the reply.

### The quiet budget

`rewardsSaid` counts reward lines this game; a reward line shows only if `rewardsSaid < 4` and the last
reward was not on the previous player move (`lastRewardPly !== ply - 2`). Otherwise the ring shows
without words (reward 1) or nothing (reward 2). Reward 1 (free piece taken) wins when both apply, and
counts what his capture wins net of what the opponent's last capture on that square took (`lastMove`), so
an even trade (…Nxe3 fxe3, …Qxe5 dxe5) is never 'Free knight'; `load(fen)` has no last move, so the
FEN-derivable rule stands there.

### Play-anyway bookkeeping

- `anyways` counts Play it anyway this game; `playedPairs` holds `${piece}${to}` strings (e.g. `ne5`)
  that are not held again this game.
- After `anyways >= 2` the gate holds only `ALWAYS_HOLD` categories and holds with `netLoss >= 5`.
- `givenAway` counts: play-anyways whose hold had `netLoss >= 2`, plus committed moves whose verdict
  matched a category but was suppressed (pair rule or quiet rule) with `netLoss >= 2`; only for the
  categories where his own piece is lost (hanging_after_move, ignored_attack), and only when the reply
  really landed on the hold's target square (a missed free piece played anyway is not 'given away').
- The play-anyway sentence is phrased after the reply: when the reply did not land on the hold's piece
  (it chose something else) the base line is `COPY.ANYWAY.elsewhere` ('They chose something else; your
  knight is still there.') with the same saw_it / next_time tail; 'You saw it coming' counts only taps
  graded against the hold's own look (an ask that is not the category's own, e.g. safe_square, is a
  different look). The first '-N' a browser sees is named once on this path too (`firstFloatLine`).

### Mercy and resignation

- Mercy: each pre-search's `evalBefore` (player side) at or below -900 increments `mercyStreak`, else
  resets it; at 3, once per game, the line offers MERCY with [Start again] [Keep playing].
- Resignation: bot.js returns the full-strength look's top score from the bot's side; at or below -900
  for three consecutive bot moves after the bot's sixth move the bot resigns, unless the player has a
  queen or a rook and the bot has only king and pawns (then it plays on). The line is `ENDS.RESIGN`
  with `materialWords()` of the extra pieces the player has (per type: player count minus bot count,
  negatives dropped), or `ENDS.RESIGN_PLAIN` when nothing is extra.

### Ends

Checkmate by the player → `ENDS.MATE_WIN`, by the bot → `ENDS.MATE_LOSS`; stalemate, insufficient
material, threefold, fifty moves → `ENDS.DRAW`; resignation; give up / start again → `ENDS.GAVE_UP`.
A hold open when the game ends (cannot happen in v1 except via load) logs outcome `ended`.
Game over → state `over`, the close card is filled and shown, the game summary and holds are stored,
`GIFT_RATE` steps down one notch if `givenAway === 0`.

## 5. Data shapes

### FactSheet (facts.js, pure, from a Chess instance)

```
{
  fen, turn: 'w'|'b', player: 'w',
  pieces: [{ square, type, color, value }],                  // every occupied square, a8..h1 order
  bySquare: { [square]: PieceInfo },
  hanging: { w: [PieceInfo], b: [PieceInfo] },               // attacked and (undefended or by cheaper); kings excluded; pawns included
  material: { w, b, diff },                                  // diff from the player's side
  inCheck, isCheckmate, isStalemate, isGameOver,
  mateInOne: [{ san, uci, from, to, piece }] | null,         // for the side to move (null when not computed)
  legal: [VerboseMove]                                       // chess.moves({verbose:true}) for the side to move
}
PieceInfo = { square, type, color, value,
  attackers: [{ square, type, value }],   // chess.attackers(square, opp) geometry (pins ignored)
  defenders: [{ square, type, value }],   // chess.attackers(square, color)
  cheapestAttacker: number|null,          // min attacker value, the king excluded when the piece is defended
  hanging: boolean }                      // attackers.length>0 && (defenders.length===0 || cheapestAttacker < value)
```

**Decided** "free" (for his captures and for `what_is_free`) is the same predicate as hanging, seen from
the other side, restricted to value >= 2 where the spec says "worth two or more". `legalTakers(chess,
square)` returns the side to move's legal captures onto a square (used for answer sets in the post
position, where it is the opponent's turn); `attackers` geometry is used where it is not that side's
turn. `safeSquares(chess, from)` returns the piece's legal destinations plus its origin where (a) no
enemy piece attacks the square and (b) no enemy pawn can attack it with one legal pawn move (a push
one square, or a double push from its start rank, with the intermediate squares empty). (b) is what
makes g5 wrong and f3 right in the spec's acceptance after Nxe5 in the 6...d6 position: Ng5 is not
attacked (the e7 bishop is blocked by the f6 knight) but ...h6 kicks it.

### Engine results (engine.js)

```
SearchResult = { id, fen, depth,                         // depth of line 1
  lines: [{ multipv, depth, score: { cp: number } | { mate: number }, pv: [uci, ...] }],  // sorted by multipv
  bestmove: uci | null, ponder: uci|null, ms, stopped: boolean }
```
Scores are side-to-move as Stockfish reports them. gate.js converts with `toPlayer(score,
sideToMoveIsPlayer)`: cp as is or negated; mate N → `sign(N) * (10000 - |N|)`, then negated when the
side to move is the opponent.

### Pre and post (built by game.js from SearchResults, consumed by gate.js)

```
pre  = { fen, evalBefore,                                      // player side
         best: { uci, san, from, to, piece, captured|null, isMate: boolean },   // line 1's first move, SAN via chess.js
         mateIn: number|null,                                   // positive: the player mates in N
         line2: { uci, san, ... } | null, depth, stopped } | null                 // null when the engine was cold
post = { fen, evalAfter,                                        // player side (negated from Black's)
         lines: [{ reply: { uci, san, from, to, piece, captured|null, isCapture, isCheck, isMate }, score, pv: [uci] }],   // up to 2
         replyMateIn: number|null,                              // positive: the opponent mates in N after his move
         depth } | null
```

### Verdict (gate.js)

```
{ held: boolean, category: string|null, sub: 'already'|'lost_guard'|'opened_line'|null, variant: 'takes_back'|null,
  cpLoss: number|null, netLoss: number|null,            // netLoss positive = his loss in piece points over the refutation
  target: square|null,                                  // the piece the question is about (his moved piece, his attacked piece, their free piece, their king, the landing square)
  targetPiece: type|null, targetColor: 'w'|'b'|null,
  answer: { squares: [sq], best: sq|null, partial: [sq] },      // squares = right taps; best = the one named after two wrongs; partial = legitimate-but-not-best taps
  takers: [{ square, type, value }],                    // for hanging: the legal takers; for ignored_attack: the attackers
  refutation: [uci, uci?],                              // ghost plies: the capture, and the recapture when the pv's next ply recaptures on the same square
  refutationFrom: 'post'|'pre',                         // 'pre' for free_piece_ignored: the plies play from the position before his move (the capture he walked past)
  gained: [type],                                       // what he gets back over the refutation (his capture + the recapture), for 'A knight for a pawn'
  pawnAmongTakers: boolean,
  suppressed: null | 'pair' | 'quiet',                  // category matched but the hold is not shown
  reward: null | { kind: 'free_taken', piece: type, square } | { kind: 'escaped', piece: type, attacker: type },
  reason: string }                                      // one line for logs and tests
```
`verdict()` fires the first matching category in `CATEGORIES` order; `suppressed` is set instead of
`held` when the pair rule or the quiet rule applies (the category is still reported so `givenAway` can
count it). `reward(pre, factsBefore, factsAfter, move)` is a separate pure export used only when
`held` is false and `cpLoss < 200`; its fifth argument `lastMove` (the opponent's last verbose move, or
null) makes reward 1 net of an exchange on that square. Two guards run before the table: the only legal
move is never held ('clean: the only legal move'), and a mate-scored pre-search against a plain-cp post
at or above `GATE.STILL_WINNING_CP` (300) reads cpLoss 0 (the win stands; letting it go keeps the raw
loss). A reply from post line 2 counts only when its own score is a hold-sized loss too
(`pre.evalBefore - line.score >= 200`): the story the page tells must be the one that happens.

Category tests, exactly (player = White; "reply" = `post.lines[0].reply`, "either line" = lines 0 or 1):
1. allowed_mate: `post.replyMateIn === 1` → answer: that reply's `to` (best) plus every other mating
   destination chess.js finds in the post position (`factsAfter.mateInOne`); partial: none; netLoss null.
2. missed_mate: `pre.mateIn === 1 && !factsAfter.isCheckmate` → answer: `pre.best.to`; if several
   mating moves exist (facts.mateInOne of the pre position) all their `to` squares are right, best is
   `pre.best.to`.
3. ignored_attack: `cpLoss >= 200`, either line's reply captures a White piece with value >= 2 that is
   not on `move.to`, and in `factsAfter` that piece is hanging → sub `already` if it was hanging in
   `factsBefore` (same square, same piece); `opened_line` if it was not attacked at all before (his move
   opened an enemy line onto it: a pinned piece moved, a piece stepped off a file; the defenders are
   unchanged); else `lost_guard` (it was attacked and defended; a guard left); answer: the piece's
   square (best), plus `move.to` when the other reply line takes the piece he moved for a net loss >= 2
   too (both hang: tapping either is right, the victim stays best so the named square and the ghost
   agree); partial: the attackers' squares (legal takers in the post position); netLoss = value − (the
   pv's recapture gain if the next ply recaptures on that square, else 0).
4. hanging_after_move: `cpLoss >= 200`, either line's reply captures on `move.to`, the moved piece is
   hanging in `factsAfter`, netLoss >= 2 where netLoss = `material(before) − material(after refutation)`
   from White's side (his own capture counted in his favour) → answer: all legal takers' squares; best =
   the capturing reply's `from`; partial = only the takers dearer than the best (or a king when the best
   is not the king): equal takers (two pawns) are both right; `variant='takes_back'` when his move
   captured; `pawnAmongTakers`.
5. free_piece_ignored: `pre.best` captures a Black piece with value >= 2 that is free in
   `factsBefore` (still on the board after his move), `cpLoss >= 200`, and his move is not that capture
   → answer: that square; partial: other free Black pieces (value >= 2) in `factsBefore`; netLoss = value
   if undefended else value − cheapest attacker value; refutation = `[pre.best.uci]` with
   `refutationFrom: 'pre'` (Show me plays the capture he walked past, his own piece, from the position
   before his move, and floats nothing: there is no exchange to count).
6. allowed_stalemate: `factsAfter.isStalemate && factsBefore.material.diff >= 5` → answer: the Black
   king's square.
Then: clean when none matched or `cpLoss < 200` for 3-5 (mates and stalemate ignore cpLoss).
Suppression: pair rule (`${piece}${to}` in `gameState.playedPairs`) and quiet rule (`gameState.anyways
>= 2` unless category in ALWAYS_HOLD or netLoss >= 5).

### HoldCopy (gate.js `holdCopy(verdict, facts)`)

```
{ question, if_right(square)->string, if_partial(square)->string, if_wrong, named, anyway(sawIt: boolean)->string,
  fallback /* K2 fallback line */, caption /* close-card caption without the outcome */ }
```
Built from `COPY` with piece words; `if_right` for hanging uses `gained`; `if_partial` for hanging picks
the `_king` variant when the tapped taker is a king or not dearer than the best; `if_wrong` picks the
`_pawn` variant when a pawn is among the takers; `anyway(sawIt)` appends `ANYWAY.saw_it` or
`ANYWAY.next_time` with `LOOK_WORDS` keyed by the best answer's piece (pawn → 'the pawns', mate
categories → 'the check', a king taker → 'what takes back', stalemate → 'their king's squares', else
'their {piece}'). `if_right(square)` for ignored_attack answers for the tapped square: the second hanging
piece (the one he moved) gets 'Yes, the knight. The queen takes it next move.' from its own cheapest taker.

### Asks (gate.js `asksFor(verdict, factsBefore, factsAfter, move)`)

```
[{ kind: ASK_KIND, question, squares: [sq], best: sq|null, partial: [sq], own: boolean, copy?: { if_right, if_wrong, named, if_partial? } }]
```
Offered per category: the category's own look (hanging → what_takes_it / what_takes_back; ignored →
attacked_piece; free → what_is_free; allowed_mate → their_check; missed_mate → your_mate; stalemate →
their_king), plus `safe_square` when the moved piece is not a king and has at least one safe square,
plus `what_is_free` when a free Black piece worth >= 2 exists in factsBefore and it is not already the
category's look, plus `attacked_piece` when a White piece worth >= 2 hangs in factsBefore and it is not
already the look. Grading an ask: a tap in `squares` is right (`best` null means any), in `partial` is
partial, else wrong. `own` marks the category's own look; its grades use the hold's own lines (and K1's
when they arrived). Any other look carries its own follow-up copy from `ASKS[kind].copy` ({piece} is the
piece on the tapped square, or the moved piece for safe_square; {square} the square named), and the
second wrong tap glows `best || squares[0]` and names that same square ('The knight is safe on f3.'):
the hold's lines ('Yes, the pawn. A knight for a pawn.') would be false for a safe square. The K1 lines
are used only for the hold's own look and, for if_right, only on its best square.

### Hold (game.js state; `state().hold`)

```
{ category, sub, variant, san, from, to, piece, captured, answer: {squares, best, partial}, answerSquares: [sq],  // answerSquares mirrors answer.squares for the tests
  question, copy: HoldCopy, asks: [Ask], ask: ASK_KIND|null,                 // ask set after a K2 reply
  taps: [{ square, grade: 'right'|'partial'|'wrong'|'named', ask: ASK_KIND|null }], answered: boolean, buttonsShown: boolean,   // ask: the look the tap answered
  netLoss, refutation: [uci], tutorial: boolean, firstHold: boolean,
  claude: { k2: 'none'|'asking'|'shown'|'failed', k1: 'none'|'pending'|'ready'|'failed'|'late', k1Lines: K1|null, coachShown: boolean },
  openedAt: number }
```

### HoldRecord (log; `holds()`; stored under KEYS.HOLDS with gameId)

```
{ fen, san, category, sub, taps: [{square, grade, ask}], outcome: 'back'|'anyway'|'ended', coachShown: boolean, netLoss, piece, to, best, ply, gameId }
```
`coachShown` is true when any validated Claude text (K2 say or a K1 line) was shown in this hold.

### GameSummary (stored under KEYS.GAMES, last five)

```
{ id: string (Date.now().toString(36)), date: ISO string, result: 'mate-win'|'mate-loss'|'draw'|'resign'|'giveup',
  givenAway, holds: [HoldRecord], freeTaken, playedAnyway, plies, backs }
```

### Stats (`stats()`)

```
{ holdsCount, backs, anyways, givenAway, freeTaken, rewardsSaid, plies, lastGivenAway: number|null, gameId }
```

### State snapshot (`state()`, the live object; tests may set `giftDue`)

```
{ state, tutorial, engineReady /* a getter: engine.isReady(), false again once the Worker died */, hold: Hold|null, plies, anyways, playedPairs: [string], rewardsSaid, lastRewardPly,
  mercyOffered, mercyStreak, resignStreak, botMoveNo, result: null|string, giftDue: boolean, lastGift: null|{ san, verified, square, piece, how },
  consented: boolean, coachAvailable: boolean, resting: boolean, pre: pre|null, lastVerdict: Verdict|null, forcedReply: san|null }
```

### tutorial.json (logic; shaped from product/research/tutorial_table.json)

```
{ fen, best: { san: 'Ng5', cp: 39 }, verifiedAt: { depth: 20, source: 'product/research/tutorial_table.json' },
  moves: { [san]: { held: boolean, category: 'hanging_after_move'|null, variant: 'takes_back'|null, cpLoss, cpAfter,
                    reply: san, line: [san, san?] /* refutation plies for Show me */, netLoss,
                    answer: { squares, best, partial }, takers: [{square, type, value}], pawnAmongTakers, gained: [type] } }
}
```
Held: Bxf7+ {e8}, Nxe5 {c6}, Nd4 {e5 best, c6}, Ba6 {b7}, Be6 {d7 best, f7}; all 33 SANs present.

### book.json (engine)

```
{ verifiedAt: { depth: 18, maxLossCp: 50, command: 'python3 scripts/engine_check.py move "<fen>" <san> --depth 18' },
  entries: { [fen4 /* placement turn castling ep */]: { reply: san, line: '1.e4 e5', cpLoss } } }
```
Entries: after 1.e4 → e5; 1.e4 e5 2.Nf3 → Nc6; 2.Nf3 Nc6 3.Bc4 → Nf6; 3.Bb5 → a6; 2.Qh5 → Nc6; 2.Qh5 Nc6
3.Bc4 → g6; 2.Bc4 → Nf6; and from the tutorial position 4.d3 → Be7, 4.Nc3 → Bc5, 4.O-O → Bc5, 4.d4 →
exd4, 4.Ng5 → d5. Lookup key: `chess.fen().split(' ').slice(0, 4).join(' ')`.

### positions.json (logic; test data)

```
[{ id, name, fen, verified: { depth, date, command }, 
   pre: SearchResult-shaped recording from the native engine (depth 14, multipv 2) converted to the `pre` shape,
   moves: { [san]: { expect: 'held'|'committed'|'over', category?, sub?, answer?: {squares, best, partial}, reward?: 'free_taken'|'escaped',
                     post: the `post` shape recorded at depth 12 multipv 2 } } }]
```
Positions: the 6...d6 Italian, the tutorial Italian, the Ruy after 3...a6, the Italian after 4.d3 Nxe4,
the placement after 7...O-O, after 5...Ng4, 1.f3 e5, the Scholar's from White's side (all from the
spec), plus the start position. `scripts/test_gate.mjs` runs `verdict()` on each move with facts built
by chess.js in node and asserts `expect`, `category`, `answer`, `reward`.

### K2 and K1 contracts (coach.js, validate.js)

K2 reply: `{ say: string, ask: ASK_KIND|null, squares: [square] }`. Valid when `say` has at most two
sentences of at most 20 words each and at most 32 words in all (`CLAUDE.K2_MAX_WORDS`; the spec's 31-word
example passes; 32 plus the 8-word ask question is what fits the four-line box at 400 px), no question mark; `ask` is null or one of the hold's offered kinds;
`squares` is at most three, each in the allowed set (fact-sheet squares, every occupied square, the held
piece's legal destinations). K1 reply: `{ if_right, if_partial, if_wrong, and_then, anyway }`, each at
most 20 words (if_wrong 14, and_then 12 or empty), squares only from the fact-sheet set, if_wrong naming
no answer square. Both pass the ordered pipeline in validate.js (squares → piece-on-square → mask → SAN
→ digits → banned words → caps). The spec's two example outputs pass.

validate contexts:
```
K2ctx = { allowedSquares: [sq], piecesOn: { [sq]: { type, color } }, allowedMoves: [], offeredAsks: [kind] }
K1ctx = { allowedSquares: [sq] /* fact-sheet squares */, piecesOn, allowedMoves: [], answerSquares: [sq] }
```
Fact-sheet squares = the held move's from and to, every taker/attacker square, the answer squares, the
target, and the refutation's squares.

### The K2 prompt (coach.js builds it, about 1.6 KB, three blocks)

Block 1 fixed (`CLAUDE.PROMPT_VERSION` v2): `PERSONA` (the coach, the plain-words rules, 'use only the
facts below; if nothing in their idea is true here, say so plainly and invent no merit') plus `K2_TASK`
(answer their idea, two sentences of 20 words each, choose one look); `K2_FIXED` is the two joined and K1
carries `PERSONA` only, never the K2 task. Block 2 the fact sheet rendered in the spec's words, where the
FEN and the piece list describe the same position, the one on the board with the held move made
('Position (FEN, with the held move made): … Player is White. Move being held: knight from f3 to e5,
taking a pawn (f3 is now empty). If it lands: the pawn on d6 takes the knight (the knight on c6 could
also). Nothing of White's takes back. Net: a knight for a pawn. Pieces on the board with the held move
made: … Squares you may name: …'; a held move that gives check adds 'It gives check.' after the held-move line, and the fact sheet continues '… Moves you may name: none. Looks you
may choose (kind: meaning): … This game so far: 1 hold, taken back. The player wrote: «…».'), block 3
the JSON contract. K1 swaps the instruction and the contract as the spec words them. Calls:
`sample.json(prompt, { modelTier: 'quick', cache: false, signal })` for K2; `sample.json(prompt,
{ modelTier: 'quick', signal })` (default cache) for K1. Never `tools`.

## 6. Module APIs (exact exports)

### board.js (shell)

```
export function createBoard(root: HTMLElement, opts: { onTap(square: string, info: { piece: 'wN'|null, kind: 'piece'|'square' }): void }): Board
Board = {
  setPosition(chess: Chess, { animate = false } = {}): void,   // diff the piece layer to chess.board(); pieces keep data-id when they stay on their square
  move(mv: VerboseMove): Promise<void>,                        // slide from→to (castle rook too), hide the captured piece (incl. en passant), promote; resolves after MOVE_MS
  unmove(mv: VerboseMove): Promise<void>,                      // the reverse, restoring the captured piece
  setMarks(marks: { tint?: [sq, sq], dots?: [sq], rings?: [sq], amber?: sq|null, ok?: [sq], glow?: sq|null, lit?: [sq] }): void,  // declarative; a key left out is cleared
  setState(state: 'idle'|'pending'|'held'|'reply'|'over', hold: string|null): void,  // data-state, data-hold
  setInput(mode: 'move'|'answer'|'locked'): void,              // data-input; taps still reach onTap, game.js decides
  pick(square: sq|null): void,                                 // .picked on one piece or none
  lift(square: sq|null): void,                                 // .lifted on one piece or none
  pending(square: sq|null): void,                              // .pending dot
  pieceAt(square): HTMLButtonElement|null, squareEl(square): HTMLButtonElement,
  ghosts: { add(piece: 'bP', square): HTMLElement, move(el, square): Promise<void>, remove(el): void, clear(): void, setDim(on: boolean): void },  // real layer to 35 percent when dim
  float(text: string, { reduced, fast }): Promise<void>,       // the .loss element: show text, rise 24 px over FLOAT_MS, fade; resolves when done
  flip: false,                                                 // v1: White at the bottom
  destroy(): void }
```
Tap detection: pointerdown/pointerup within TAP_MAX_PX and TAP_MAX_MS on a `.pc` or `.sq`
(`touch-action: none` on the board); click events from keyboard also tap. board.js never imports
chess.js; it only draws what it is told.

### engine.js (engine)

```
export function createEngine({ workerUrl = ENGINE.WORKER_URL, Worker = globalThis.Worker } = {}): Engine
Engine = {
  ready: Promise<void>,                 // uci → uciok → setoption Hash/MultiPV → isready → readyok → ucinewgame
  isReady(): boolean,                   // false before readyok and again once the Worker died
  dead(): boolean,                      // the Worker died after readyok (error/messageerror event, or a search silent for ENGINE.WATCHDOG_MS = 4 s): every running and queued search resolved empty and stopped; the page's cold policy applies
  setOptions(opts: { 'Skill Level'?: number, MultiPV?: number, UCI_LimitStrength?: boolean, UCI_Elo?: number }): void,  // queued setoption lines
  newGame(): void,                      // queues ucinewgame
  search(fen: string, { depth, multipv = 1, skill = 20, newGame = false }): Promise<SearchResult>,  // serialized: sent only after the previous bestmove; the promise resolves with the lines seen so far when stopped (stopped: true)
  stop(): Promise<void>,                // sends stop for the running search (no-op when idle); resolves when its bestmove has arrived
  current(): { id, fen } | null,
  terminate(): void }
```
Search ids are integers; a late `bestmove` whose id is not the running one is discarded; `info` lines are
parsed with `depth`, `multipv`, `score cp|mate`, `pv`; lines of a lower depth than already seen for that
multipv are ignored. `search()` sets `Skill Level` only when it differs from the last value sent.

### bot.js (engine)

```
export async function loadBook(url = './data/book.json'): Promise<void>
export function bookReply(chess: Chess): { san, uci } | null
export function giftCandidates(chess: Chess): [{ san, uci, square /* the minor piece left hanging */, piece }]   // chess.js only
export function guardsOk(chessAfter: Chess, botColor): boolean          // no bot rook/queen hanging, no mate in one for the player
export async function chooseBotMove(engine, chess, { botMoveNo, giftRate, giftDue = false, anyway = false, random = Math.random }):
  Promise<{ san, uci, how: 'book'|'forced'|'gift'|'sampled'|'guarded'|'anyway', botEval: number /* bot side, from the full-strength look; null for book */,
            gift: null | { verified: true, square, piece } , checked: number }>
export function shouldResign({ botEvals: number[], botMoveNo, chess, player }): boolean   // the streak rule with the king-and-pawns exception
export function materialExtra(chess, player): { q, r, b, n, p }   // player count minus bot count per type, negatives 0
```
Order inside `chooseBotMove`: book (any `botMoveNo`) → `anyway` (Skill 20, depth 12, line 1) →
full-strength look (Skill 20, depth 8, multipv 2) → forced capture/mate (the top move is a capture that
leads line 2 by `BOT.FORCED_LEAD_CP` = 150, or line 2 captures on the same square, or the capture wins
`BOT.FORCED_NET` = 2 or more by count (`captureNet`: the captured value minus the capturer's when the
pv's next ply takes back on that square), or a mate; so two hanging pieces or a queen hanging to a rook
are taken too) → gift roll (when `giftDue` or
`random() < giftRate`, and `botMoveNo >= 3`) → sampler (Skill 3, depth 2, up to 2 re-picks) → guarded
top move. `botEval` is the look's top score; book moves return null and do not count for resignation.
When `giftDue` is true and no candidate verifies, `gift` is null and `how` continues down the ladder.

### facts.js (logic)

```
export const VALUES  // re-export from contract
export function pieceInfo(chess, square): PieceInfo|null
export function buildFacts(chess, { player = 'w', mateInOne = true } = {}): FactSheet
export function hangingPieces(chess, color): [PieceInfo]
export function legalTakers(chess, square): [{ square, type, value, san, uci }]
export function safeSquares(chess, from): [square]
export function pawnCanKick(chess, square, byColor): boolean
export function mateInOneMoves(chess): [VerboseMove]
export function material(chess): { w, b }
export function materialAfter(chess, plies: [uci|san]): { w, b }     // scratch copy; plies applied in order
export function uciToMove(chess, uci): VerboseMove|null               // via chess.moves({verbose:true}) matching from/to/promotion
export function pieceWord(type), colorWord(color)
```

### gate.js (logic, pure)

```
export function toPlayer(score: {cp}|{mate}, sideToMoveIsPlayer: boolean): number
export function verdict(pre, post, factsBefore, factsAfter, gameState: { move: VerboseMove, anyways: number, playedPairs: [string] }): Verdict
export function reward(pre, factsBefore, factsAfter, move): Verdict['reward']
export function holdCopy(verdict, factsAfter): HoldCopy
export function asksFor(verdict, factsBefore, factsAfter, move, chessBefore): [Ask]
export function grade(answer: {squares, best, partial}, square): 'right'|'partial'|'wrong'
export function tutorialVerdict(row, move, chessBefore): Verdict          // tutorial.json row → Verdict (same shape)
export function remembered(lastGame: GameSummary|null): string|null     // the next game's line
export function closeCaption(record: HoldRecord): string
```

### hold.js (hold)

```
export function createHold({ board, coachLine, actions, links, store, fast: () => boolean, reduced: () => boolean }): HoldUI
HoldUI = {
  open(hold: Hold): void,                   // lift, amber, dim, answer mode, question at 0 ms, links, start the 8 s timer
  tap(square): 'right'|'partial'|'wrong'|'named'|null,   // grades against hold.ask (if set) else hold.answer; writes the line (the ask's own copy for a look that is not the hold's, else template or K1); ok/glow marks; shows buttons after right/partial/second wrong (never over the open input or the give-up confirm)
  showButtons(): void,                      // [Take it back] focused + [Play it anyway]; idempotent
  setK1(lines: K1|null): void,              // validated K1 follow-ups to use after the tap
  showSay(reply: { say, ask, squares }, askQuestion: string): void,   // K2: say + lit squares + the page's question; sets hold.ask
  showFallback(): void,                     // the template answer 'Still want to?'
  looking(text: string): void, unlooking(): void,
  openInput(): void, closeInput(): void,    // the Hear me out form in the action bar
  setLink(name: 'but', state: 'hidden'|'hear'|'retry'): void,
  close(): void }                           // clears marks, classes, timers, input
```

### ghost.js (hold)

```
export function showMe({ board, chess /* the pre-move Chess */, move: VerboseMove, refutation: [uci], netLoss, fromBefore = false, fast, reduced, firstFloat: boolean, coachLine, store }): { done: Promise<void>, abort(): void }
```
Plays his move already on the board (it is), then each refutation ply as ghosts at 50 percent while the
real layer dims to 35 percent (`board.ghosts.setDim(true)`); the real piece a ghost capture lands on gets
class `taken` (hidden) so the ghost replaces it; floats `-${netLoss}` when the capture lands, names it
once if `firstFloat` (sets KEYS.FIRST_FLOAT_SEEN), beat, rewind; `abort()` rewinds at once. With
`fromBefore` (free_piece_ignored) the plies play from the position before his move and nothing floats.
The '-N' label (`#loss`, in the board's wrapper) rises 24 px from under the board on the h-file side and
never crosses a square; under reduced motion it is the same plated label, static, just under the board.
A tap during Show me only aborts it: game.js does not grade it.
State stays `held`; `#board[data-ghost=1]` during play.

### coach.js (coach)

```
export function createCoach({ store, onAvailable(available: boolean): void }): Coach
Coach = {
  available(): boolean, consented(): boolean, resting(): boolean,
  hearMeOut({ facts, hold, asks, text, holdsSoFar, signal }): Promise<{ ok: true, value: { say, ask, squares } } | { ok: false, code: string }>,
  followUps({ facts, hold, holdsSoFar, remembered, signal }): Promise<{ ok: true, value: K1 } | { ok: false, code }>,
  buildK2Prompt(ctx): string, buildK1Prompt(ctx): string,
  k2Context(facts, hold, asks): K2ctx, k1Context(facts, hold): K1ctx }
```
`claude.use('sample')` is awaited once at `createCoach` (lazily, after first paint); `onAvailable(true)`
shows the link on real holds. Every error code is mapped: HIDE_FOR_VIEW codes → `onAvailable(false)`
for the view; `rate_limited` → `resting()` true for 60 s and the line RESTING; `invalid_json` → the
link becomes 'Try again' once; `cancelled` → nothing; anything else → the fallback line. A rejected
validation increments `window.__coachRejects` and returns `{ ok: false, code: 'rejected' }`.

### validate.js (coach, pure)

```
export const BANNED: string[]                      // built from char codes at module load
export function squaresIn(text): [square]
export function validateText(text, ctx, { maxWords, maxSentences = Infinity, noQuestion = false, forbidSquares = [] }): { ok: boolean, reason?: string, masked?: string }
export function validateK2(reply, ctx): { ok: true, value } | { ok: false, reason }
export function validateK1(reply, ctx): { ok: true, value } | { ok: false, reason }
export function wordCount(text), sentenceCount(text)
export function templateRules(text): { ok, reason }   // the square and SAN rules only, for copy_check over COPY
```

### store.js (coach)

```
export const store = { get(key, fallback = null), set(key, value): boolean, remove(key), append(key, item, max): array, list(key): array }
```
Values are JSON; flags are the string '1'; every call is try/catch and returns the fallback on failure.

### game.js (hold) — `window.__app`

```
window.__app = {
  load(fen): Promise<void>,
  play(san): Promise<'committed'|'held'|'illegal'|'over'>,   // 'committed' resolves after the opponent's reply has landed (state idle); 'held' at the hold; 'over' when the game ended on his move or the reply
  tap(square): 'right'|'partial'|'wrong'|'named'|null,       // in answer mode grades synchronously; in move mode acts as a board tap (select / move) and returns null
  action(name): Promise<void>,                                // one of DOM.actions; resolves when the action's immediate effect is done ('anyway': after the reply landed; 'showme': after the rewind; 'takeback': after the slide)
  say(text): Promise<void>,                                   // opens the input if needed, fills it, sends; resolves when the reply or error has been handled
  botMove(san): void,                                         // test mode only (throws unless fast): queues the opponent's NEXT reply; call it before play()
  fen(): string, state(): State, waitEngine(): Promise<boolean>, holds(): [HoldRecord], stats(): Stats,
  newGame(): Promise<void>,
  fast: false }
window.__coachRejects = 0
```

## 7. Decisions where the spec is silent

- **Player colour**: White only in v1; the bot replies as Black; `#edge` is at the top.
- **Best answer** in hanging holds is the capturing reply's `from` square (the engine's refutation),
  not the cheapest taker; the partial copy switches to the `_king` wording when the tapped taker is a
  king or not dearer than the best (Bxf7+ in the 6...d6 position: f8 best, g8 partial).
- **Takers** are legal captures (pins honoured) in the post position; hanging/defended tests use
  `attackers()` geometry as the research did.
- **safe_square** adds the pawn-kick rule (see facts).
- **netLoss** is material before his move minus material after the refutation plies (his own capture
  in his favour); the refutation is the reply capture plus the pv's next ply only when it recaptures on
  the same square; Show me's `-N` is this number.
- **cpLoss** uses the pre-search's line 1 (depth >= 8 after a stop, else re-searched at depth 10) and
  the post search's line 1, both on the player's side.
- **Rewards** come from `gate.reward()`; reward 1 wins over reward 2; the quiet budget is per game.
- **play() resolution**: after the opponent's reply has landed, so scenarios chain without sleeps.
- **botMove(san)** queues the next reply; it must be called before `play()`. It throws unless
  `__app.fast` is true.
- **load(fen)** keeps the game's counters (so two play-anyways followed by `load()` keep the gate
  quiet); `newGame()` resets them. Page load decides the tutorial; `load()` never enters the tutorial.
- **Engine stub for tests**: the scenario overrides `window.Worker` with a class that never answers
  (`page.addInitScript`) and reloads; game.js treats the cold engine per the cold policy. No page hook.
- **Fast mode**: `window.__app.fast = true` is read lazily at each timer start; game.js mirrors it to
  `html[data-fast=1]` so CSS durations are 0.
- **The remembered line** shows only when `KEYS.GAMES` has at least one game; it is `COPY.REMEMBERED`
  keyed by the last game's hold count and whether every hold was a hanging hold with a pawn among the takers.
- **Close caption outcome words**: 'taken back' / 'played anyway' / 'the game ended'.
- **'Give up' confirm** replaces whatever the action bar holds and owns it until Yes or Keep playing:
  hold.js never rebuilds the bar while `[data-action=giveup-yes]` is in it; Keep playing restores it (a
  hold's buttons come back if they were shown, including when the timer fired under the confirm).
- **Only one legal move**: never held (the gate returns clean), so the close card never calls it 'played anyway'.
- **rate_limited** shows 'Coach is resting.' for REWARD_MS and then puts the open hold question back; the link stays hidden for RESTING_MS.
- **The tutorial's 'Safe.' line** is said once: after the tutorial has already stopped his hand, a safe move reads 'Your move.'
- **Close card**: with holds and no take-backs the summary is `COPY.CLOSE.SUMMARY_NO_BACKS` ('you played every one'); once the game is over the empty action bar gives up its 56 px (`.stage:has(#board[data-state=over]) .actions:empty`) and, if Again still sits below the fold, `fillCloseCard()` scrolls it into view.
- **Theme dot** writes `data-theme` on `<html>` and `KEYS.THEME`; unset follows the system.
- **Coordinates**: inside the a-file and rank-1 squares, 11 px Plex Sans, in the opposite square tint; the
  board's parity is a tournament board's (`(file + rank) % 2 === 0` is light: a1 dark, h1 light).
- **Palette amendments** (styles.css, mirrored in PRODUCT.md): light `--muted` #646b78 (AA on the
  background), `--tint` rgba(45,79,158,.30) light / rgba(157,180,232,.36) dark with a 1.5 px inset edge so
  an empty origin square reads as deliberate, `--dot` rgba(0,0,0,.4) in both themes, the hold/ok rings
  and the answer glow carry a 1 px `--bg` hairline (or an inset amber ring for the glow) so they keep an
  edge on the square they match in luminance.
- **Promotion** auto-queens; the piece button swaps its `<use>` and `data-piece`.
- **Copy source**: templates live in `contract.js` (COPY), not in a `data/copy.json`; copy_check runs
  validate's template rules over COPY and scans `app/index.html`, `app/js/*` (except validate.js),
  `app/styles.css` and `app/data/*.json`.
- **Give up while a hold is open**: the hold is logged with outcome `ended`, the move is not committed.
- **The pending dot** appears only if the verdict takes longer than 250 ms (code path, untested).
- **Hear me out and the keyboard**: `--vvh` (visualViewport.height in px) is set on `:root` by game.js
  on `resize` of visualViewport; the board width uses `min(100vw - 32px, 62vh, calc(var(--vvh) - 260px))`
  when the input is open (`body.typing`).

## 8. Integration order

1. contract.js (done) → shell (index.html, styles, board.js, pieces) renders the start position with a
   dev page; engine (engine.js, bot.js, book.json) proven in a dev page; logic (facts, gate, tutorial.json,
   positions.json) proven with `node scripts/test_gate.mjs`; coach (validate, store, coach) proven with
   `node scripts/test_validate.mjs` — these four run in parallel.
2. hold (game.js, hold.js, ghost.js) wires them: boot, tutorial, drop, verdict, hold, Show me, buttons,
   reply, ends, close card, `window.__app`.
3. tests (scenario, stub extension, copy_check, test_all.sh) run against the integrated page; failures
   go back to the owning group.
