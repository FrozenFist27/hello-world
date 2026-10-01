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
