# Iteration brief: a well-defined learning pathway model for Hold On

Read `product/BRIEF.md` (platform facts) and `product/PRODUCT.md` (what Hold On is and the
decisions already made) first. This brief adds only what this iteration needs.

## The ask, in the user's words

"I was thinking if it could have a really well defined learning pathway(s) model too somehow,
let's ideate something and build that in the next iteration."

So: Hold On currently makes you better one hold at a time, with a remembered line between
games. The user wants a *model* of learning with a well-defined pathway (or pathways): where a
player is, what they are working on, what comes next, and how they move along it. It must be
designed, not bolted on: in Hold On's language (silence, the board as hero, no dashboards), for
Sambudh first (under 1000, studied nothing, phone in one hand, ten to fifteen minutes), and it
must use the LLM for something a rule table cannot do. The pathway must be defined precisely
enough to be implemented, tested headlessly, and explained to a beginner in one sentence.

## What Hold On already records (verified data shapes, from app/ARCHITECTURE.md)

- Every hold: `{ fen, san, category, sub, taps: [{square, grade, ask}], outcome: 'back'|'anyway'|'ended', coachShown, netLoss, piece, to, best, ply, gameId }`.
  Categories, in priority order: `allowed_mate`, `missed_mate`, `ignored_attack` (sub-cases
  `already`, `lost_guard`, `opened_line`), `hanging_after_move`, `free_piece_ignored`,
  `allowed_staletmate`. Taps are graded right / partial / wrong / named (the answer was shown).
  Asks (the looks Claude can choose after "Hear me out"): `safe_square`, `what_is_free`,
  `attacked_piece`, and the hold's own look.
- Every game: `{ id, date, result: 'mate-win'|'mate-loss'|'draw'|'resign'|'giveup', givenAway, holds, freeTaken, playedAnyway, plies, backs }` (last five kept).
- Rewards actually said: `free_taken` (a free piece he took), `you_looked` (a piece of his was
  hanging before the move and nothing hangs after). Quiet budget: at most four a game.
- The opponent: punish-always, verified gifts at GIFT_RATE 0.12 stepping to 0.08 after a
  zero-given-away game, Skill Level 3 sampler, resignation and mercy rules, an eight-line book.
- Persistence today: `localStorage` only (keys `holdon.v1.*`), per browser.

## What the chess master already defined (chess-study/MISSION.md, under-1000 band)

Four patterns, each named as a result, each closing with a project that is games or puzzles:
1. **I stop hanging pieces**: the three looks before every move; counting attackers and
   defenders; forcing moves first. Concept ids: `hanging-piece`, `last-move-threat`,
   `blunder-check`, `capture-count`, `piece-values`, `forcing-moves`.
2. **I can mate with a queen or a rook**: checkmate vs stalemate; queen and king; rook and king,
   the two-rook ladder. Ids: `checkmate-vs-stalemate`, `queen-king-mate`, `two-rook-ladder`,
   `rook-king-mate`.
3. **I get out of the opening alive**: centre, develop, castle; the early queen; one setup after
   1.e4 e5. Ids: `opening-principles`, `early-queen`, `italian-setup`.
4. **I see one-move threats before they land**: their next capture; their next mate; one move,
   two targets. Ids: `threat-to-piece`, `mate-in-one-threat`, `double-attack-defence`.

learno's mastery model (chess-study/SKILL.md): a concept is mastered by evidence from three
sources (demonstrated in conversation, a scored teach-back, a project under a new constraint);
SM-2 spacing (next day, a week, a month) with reviews harder at each interval; the zone of
proximal development: the next thing is one step beyond what is already demonstrated and serves
the verdict. Hold On's verdict (MISSION.md): estimated 1000 against the bot by 1 February 2027.

## What the spec already deferred to this iteration (PRODUCT.md, Later)

- The question that remembers: the coach asks the look you keep skipping, from your own hold
  log across games, prefetched so it is on screen at 0 ms; a habit with zero instances in three
  games retires ("You stopped doing that").
- `db` + `user` behind store.js so progress survives the move from laptop to phone.
- "Play it again from here": resume the worst moment of the last game with the hold active.
- The fading hand: a per-game hold budget that falls toward zero across clean games.

## Platform facts for persistence (verified from the capability contracts)

- `db` capability: per-artifact JSON document store; each viewer's own `data/users/<id>/`
  subtree is private (nobody else, the owner included, sees it); writes need the `interact`
  level or above (the artifact's owner always; others only when shared as Contributor or
  higher); reads and `onSnapshot` are live; survives republishes. `user` capability: `id()`
  needs `capabilities: {user: {}}`; store only ids. Both resolve `null` outside the viewer
  (local file, other hosts), so the page keeps `localStorage` as the always-there layer and
  mirrors to `db` when it resolves. The owner's page is private until shared; a friend sent the
  link as a Viewer can play but cannot write progress.
- `sample` (Claude) as before: quick tier about a second; calls only on explicit action or one
  stable load-time prompt; the page validates every word before it reaches the board.
- Everything stays one page; a second "screen" is a state of the same page, reached and left
  without reloading.

## What exists in the world (beat it)

Chess.com Lessons (a linear course list with videos and quizzes), Lichess Learn/Practice (fixed
drills), Chessable (spaced repetition of lines), Aimchess (a stats dashboard that prescribes
drills from your online games), Duolingo-style paths (a winding road of nodes with XP), Dr.
Wolf's "skills" counters. All of them separate learning from playing: you study, then you play,
and the app infers little from how you actually play. None builds the path out of the player's
own real-game evidence, measured by the silence of a coach who stops interrupting.

## What good looks like here

- **Well defined**: a written model with named nodes (habits or looks), what counts as evidence
  for each (which hold categories, taps, rewards, game outcomes), a mastery rule that can be
  computed from the log and tested in node, an ordering or graph with prerequisites, and a rule
  for what the next game or drill is. A beginner can state the path in one sentence.
- **Felt, then shown**: progress is felt in the game first (the hand fades, the coach asks the
  one look you keep missing, the opponent changes); a visible pathway exists and is beautiful
  but is never the first screen and never a dashboard of numbers.
- **The LLM does what tables cannot**: narrates where the player is in their own words, chooses
  which look to ask from the log, turns a played-anyway hold into a drill position with a
  question, writes the one line that opens the next game. Every chess fact still comes from the
  engine first.
- **Buildable this iteration**: one more state of the same page, a pure `path.js` model with
  unit tests over synthetic logs, a store that mirrors to `db`+`user` when available, scenarios
  added to `scripts/scenarios/holdon.js`, the copy rules and the visual direction unchanged.
