# Research artifacts from the ideation critics

Produced during the critique round, verified against the vendored engines in this repo:

- `tutorial_table.json` / `tutorial_table.py`: every legal White move in the Italian after
  1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6, judged at depth 20, with the reply, the capture mechanism
  (target square, piece, defended or not, cheapest attacker, takers) and the net loss. The
  source of `app/data/tutorial.json`.
- `holdon_bot_sim.py`, `bot_sim2.py` … `bot_sim5.py` with `*-out.json`: self-play simulations of
  the opponent recipe (punish-always, verified gifts, Skill Level sampler, resignation) against
  Stockfish at UCI_Elo 1320, using the native Stockfish binary. `bot_sim5.py` is the recipe the
  spec adopted (10 games, 2.5 verified gifts a game, 8/10 against a piece-hanging 1320, 0.5/10
  against one that never hangs). The source of `scripts/bot_sim.py`.
- `probe.js` / `probe-out.json`: headless-Chromium timings of the WASM engine (warm-up, verdict
  searches at depth 10-14, options supported).
- `measure.js`, `measure2.js`: headless measurements of the coach line's copy at phone geometry.
- `scan_kpk.py`: king-and-pawn ending scans used for the placement and gate tests.
