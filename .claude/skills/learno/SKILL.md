---
name: learno
description: |
  Structured chess lessons with learno: a multi-session tutor with free-text answers graded by
  a model, spaced-repetition reviews, teach-backs, projects, and a mastery dashboard. Invoke for
  /learno, "let's study", "teach me", "what's due", "continue my lessons", or any question about
  study progress.
---

# learno (chess study) — repo-root wrapper

The learno study workspace is `chess-study/` (the folder containing `learno.json`). Claude Code
opens this repo at its root, so:

1. Run every learno command from the study folder: prefix it with `cd chess-study &&`
   (for example `cd chess-study && make local`, `cd chess-study && node bin/learno.js status`).
2. Read `chess-study/SKILL.md` now and follow it exactly. It is the full session loop: first-run
   interview, lessons, teach-backs, reviews, projects. Every path in it is relative to
   `chess-study/`.
3. For anything about progress, mastery, what is due, or what to study next, use the
   `learno-analyst` agent (available in this repo), or run
   `cd chess-study && node bin/learno.js status | due | misconceptions | lesson <id>` yourself.
   Never assert a score or a due review from memory.
4. The learner may not be technical: never ask them to run a command, run it yourself.
5. **Chess content is designed by the `chess-master` agent, not by you.** Keep the tutor
   loop (interview, session opening, grading, close-out, NEXT.md, learning records) and
   delegate everything about *what* to teach and *how* in chess to the agent: the
   diagnosis and placement, the verdict proposal, the source shortlist, the curriculum
   patterns in MISSION.md, and every lesson, review and project in `chess-study/`. Spawn
   it with the mission, NOTES.md, the latest learning records, the due concepts and the
   per-section scores it needs, and let it write the files. It verifies every position
   with Stockfish (`scripts/engine_check.py`) and renders boards with the `board`
   component. You then build nothing yourself: open what it built, run the session.
