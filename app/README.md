# Hold On

*Chess that holds your move and asks. You answer on the board.*

Live page (private to the owner until shared from its Share menu):
https://claude.ai/artifact/TJBnf32VWqWbhnrRxghYDc

The spec is `../product/PRODUCT.md`; the architecture and every decision the spec left open are
in `ARCHITECTURE.md`; the team's ideation record is `../product/IDEATION.md`.

## Run it locally

```bash
python3 -m http.server 8787 --directory app     # from the repo root
# open http://localhost:8787/
```

Plain ES modules, no build step. The engine (Stockfish 18 lite, single-threaded WASM) runs in a
Web Worker from `vendor/`; chess.js handles the rules; nothing is fetched from outside the page.
Opened outside the claude.ai viewer the page plays fully; "Hear me out" (the one Claude moment)
appears only where the viewer grants the page's `sample` capability.

## Test it

```bash
bash scripts/test_all.sh --sim        # unit tests, copy guard, headless acceptance suite, opponent sim
node scripts/test_gate.mjs            # the gate's verdicts over data/positions.json
node scripts/test_validate.mjs        # the validator that keeps Claude's words on the board
NODE_PATH=/opt/node22/lib/node_modules node scripts/app_check.js --dir app --script scripts/scenarios/holdon.js
python3 scripts/bot_sim.py 10         # the opponent recipe against Stockfish at 1320
```

## Publish it

```bash
python3 scripts/build_artifact.py           # writes app/artifact.html (wrapper stripped, CSS inlined)
python3 scripts/build_artifact.py --check   # prints the capability declaration the republish carries
```

Then publish `app/artifact.html` with the files under `js/`, `data/`, `assets/` and `vendor/`
alongside it, to the same URL (republishing keeps the link), declaring the capabilities in full
and with no rules:

```json
{ "sample": {}, "db": {}, "user": {} }
```

`sample` is the coach. `db` and `user` are the mirror: one document per viewer, at
`data/users/<id>/holdon` (the viewer's own private subtree under the default rules), holding the
games, the three first-time flags and the path (`{ v: 2, updatedAt, games, flags, path }`). The
theme stays per device and consent per view. `permissions` is never declared; the page reads
`permissions.state('db')` only where the runtime offers it. Outside the viewer every capability
resolves null and the page plays fully from localStorage, so the headless runs are unchanged.

The mirror is proven headless against a stub (`scripts/scenarios/path.js`, `scripts/test_sync.mjs`):
no write before a read in any view, the deferred read over the close card, read-only on
`invalid_argument`, one retry on `unavailable`, two devices converging. Two things are checked by
hand after each republish, because only the live platform has them:

1. The live consent dialog: in a fresh view where db is not yet granted, play one game through;
   the dialog appears over the close card (never over the board), and Again waits on nothing.
   Declining it leaves the page playing as before, with nothing said.
2. The laptop-to-phone round trip: play a game on the laptop, open the page on the phone signed in
   as the same person, play the tutorial and one game there, then reload the laptop. Both hold
   both games, and the phone's first game never replaced the laptop's log.

## Licences

Stockfish is GPLv3 (`vendor/stockfish.COPYING.txt`), chess.js BSD-2 (`vendor/chess.js.LICENSE`),
the two fonts SIL OFL 1.1 (`assets/fonts/README.txt`). The page's own source has no licence yet;
with the engine inside it, a GPL-compatible one is the honest choice.
