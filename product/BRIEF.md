# Team brief: an LLM-native interactive chess guide, coach and playground

This is the shared context packet for every team partner. Read all of it before ideating,
reviewing or building. Everything here is verified unless marked as an assumption.

## The ask, in the user's words

"Build something intuitively good and nice, something that is not there in the world. Something
that uses the new LLM intelligence to build an interactive chess guide/coach/playground. Build it
systematically, with different team partners who each add their own perspective, orchestrate the
context sharing between them, then build the product starting with an MVP, iteratively."

## Who it is for, first

Sambudh. Played chess before, rating once under 1000 and forgotten, no games to show, has studied
nothing, writes English, opens with 1.e4. In the last session a chess master placed him at the
under-1000 band: games at this level are decided by hanging pieces and one-move threats. He wants
something that feels intuitively good and nice, not a dashboard. He will be the first user and
the first tester. Design for him, and for the millions like him; do not design for titled players.

## What already exists in this repo (reuse, do not rebuild)

- `plugins/chess-coach/scripts/` (Python): a terminal play-and-coach loop with move rating,
  ELO estimate, personas. Its coaching heuristics (`coach.py`, `common.py`) are worth reading
  for what "coaching text" looked like before this product.
- `tools/tintins-chess-analysis` (gitignored checkout) and the `chess` MCP server: Stockfish
  game review with plain-English mistakes, rated puzzles, a weakness profile. Terminal-side only.
- `chess-study/`: learno, a lesson engine. Lessons `0000-placement` and `0001-blunder-check`
  (written by the chess-master agent) and `components/local/board.js` (a FEN board renderer in
  plain HTML/CSS, no library) show the pedagogy and the visual direction so far.
- `scripts/engine_check.py`: Stockfish verification CLI (mate / move / line / eval / pgn) used
  so no lesson teaches a hallucinated line.
- `.claude/agents/chess-master.md`: the coach persona, with its rating-band beliefs. Read it for
  what a real coach would and would not teach at each level.
- `product/` is where this product's documents live; `app/` is where its source will live.

## The platform: a published interactive page (claude.ai Artifact)

The product ships as a web page published from this repo, viewable and shareable by link in the
user's browser and in the Claude app, plus runnable locally from `app/`. Constraints, all verified:

- One HTML page plus supporting files published alongside it (JS, CSS, WASM, data). The page is
  wrapped in a skeleton at publish; it carries its own `<title>` and `<style>`. 16 MB max per text
  file, 15 MB per binary. Phone width (about 400 px) must work; no horizontal page scroll; light
  and dark theme both required through CSS tokens; `alert/confirm/prompt` do nothing; no
  `window.print`; no iframes of other sites; no network fetches except to the page's own files.
- External scripts only from cdnjs / jsdelivr / unpkg (allowed in the viewer's browser but
  BLOCKED from the build container, so for testability everything is vendored as the page's own
  files; that is already done in `app/vendor/`).
- **The engine runs in the browser.** `app/vendor/stockfish-18-lite-single.js` + `.wasm`
  (7.3 MB, single-threaded, no special headers) proven in a Web Worker from same-origin files:
  `uci` → `uciok` → `position fen …` → `go depth 14` returned `bestmove` in 1.3 s in headless
  Chromium with zero console errors. Far stronger than any human; depth 12-16 is instant enough
  for live use. `app/vendor/chess.js` (chess.js 1.4.0, ES module) proven for rules, legality,
  SAN/UCI, FEN/PGN.
- **Claude runs in the page**, through the `sample` runtime capability (declared at publish; the
  viewer consents once per view; calls spend the viewer's own Claude usage; no API key anywhere):
  `const sample = await claude.use("sample")` (null → hide the feature), then
  `await sample(input, {onText, signal, tools, modelTier, cache})` → `{text, truncated}`, or
  `sample.json(...)` for structured data. `input` is a prompt string or user/assistant turns the
  page keeps (Claude remembers nothing between calls; the page sends instructions + state each
  time; 256 KiB cap). `modelTier: "quick"` answers in about a second with no thinking;
  `"default"`/`"complex"` think first (5-60 s before text). **`tools`**: the page can hand Claude
  functions it may call mid-answer (for example `evaluate(fen)` backed by the in-page Stockfish,
  `legal_moves(fen)`, `play(move)`, `highlight(squares)`); each tool round is another request
  (about a second on quick), a handful of rounds max; tool calls are never cached. Calls must
  come from explicit viewer actions or one stable load-time prompt, never loops or timers;
  errors are a `{code}` to branch on (not_granted → hide, rate_limited → back off), never retry
  from code. The exact contract is in the session's `sample.d.ts`; builders must read it.
- Other capabilities available: `db` + `user` (per-person persistent state: games, progress,
  mistakes, rating; private per viewer; survives republishes), `downloads` (offer a PGN file),
  `room` (live presence between people who have the page open; nothing persists), `comments`.
  Browser `localStorage` works but is per-browser only; use it for conveniences.
- Testing here: serve `app/` with `python3 -m http.server`, drive it with Node Playwright
  (`NODE_PATH=/opt/node22/lib/node_modules node script.js`, Chromium preinstalled), screenshot
  at desktop and 400 px widths in both color schemes. The `sample` capability does not exist
  outside the viewer, so the page must render and play fully without it, and the coach must be
  testable through a stub (`window.__stubSample`) that returns canned text.

## What exists in the world (beat it, do not copy it)

Lichess (free, engine analysis, puzzles, studies, Learn), Chess.com (Game Review, Coach bots,
Lessons, Insights), Chessable (spaced-repetition courses), Aimchess (stats-driven training),
DecodeChess (explains engine moves), ChessGPT / Noctie / "chat with Stockfish" apps, Tintin's
chess analysis and the chess-coach terminal plugin in this very repo. All of them either show you
an evaluation and leave the understanding to you, or explain after the fact. None has an LLM that
can act on the board as a thinking partner, in the moment, grounded by a real engine, with a
memory of what you personally keep getting wrong, in a page you can send to a friend.

## What good looks like

- Intuitively good: a beginner understands the first screen in five seconds and never reads a
  manual. One primary thing to do at any moment. The board is the hero.
- Nice: a considered visual identity (see the design rules below), delightful feedback, no
  dashboard sprawl, both themes, phone-first.
- Not in the world: the LLM does something only an LLM can do, grounded by the engine so it is
  never wrong about chess facts. "Chat with an engine" is not new; name the new interaction.
- Honest about cost and latency: a quick-tier call is a second; a default-tier call with tools
  is 30-90 s. Design the moments where waiting is worth it and the moments that must be instant
  (the engine answers instantly; use it for everything that does not need language).
- MVP in this session: one page, one core loop, polished; then iterate from real use.

## Design rules the build must follow (from the artifact design contract)

Tokens on `:root` for every color, dark theme via `prefers-color-scheme` guarded by
`:root:not([data-theme="light"])` and again under `:root[data-theme="dark"]`; explicit `body`
background; Google Fonts allowed (with fallback stacks); phone width with 16 px gutters; no
AI-default look (no cream-and-terracotta, no acid-green-on-black, no purple gradient hero, no
Inter-by-default, no emoji section markers, no rounded-cards-everywhere); copy written from the
player's side ("Your move", not "Submit action"); the first frame shows the product working, never
an empty shell; keyboard focus visible; `prefers-reduced-motion` respected.

## Licensing note

Stockfish is GPLv3 (`app/vendor/stockfish.COPYING.txt`); chess.js is BSD-2 (`chess.js.LICENSE`).
Shipping the engine inside the page means the page's own source should be published under a
GPL-compatible license. Flag, do not solve, in the MVP.
