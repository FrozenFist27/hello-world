# The engine

For people changing learno itself. Studying with it needs none of this.

## Lessons are two files

Claude never writes HTML. A lesson is a `.json` that says which blocks appear and in what
order, and a `.yml` with every word a person reads. A string in the JSON that starts with `@`
is a path into the YAML.

```json
{ "component": "recall",
  "props": { "conceptId": "hash_ring", "phase": "2",
             "question": "@p2.question", "summary": "@p2.summary" } }
```

The build refuses to write a page with any error, because a lesson missing a block still
looks finished. It checks that every component exists, that props have the declared shape,
that every `@` reference resolves, that no YAML key goes unused, that diagrams fit their
`viewBox`, and that every concept a `recall` cites is declared in the lesson, since the
server drops undeclared ones when grading.

```sh
make lesson SRC=lessons/0011-async-jobs   # must report no errors and no warnings
make build                                # every lesson, review and project
make catalog                              # regenerate COMPONENTS.md and the gallery
```

There are 15 components: `analogy`, `phase`, `prose`, `code`, `diagram`, `quiz`, `recall`,
`teachback`, `flashcards`, `table`, `compare`, `callout`, `source`, `rubric`, `deliverable`.
Naming anything else fails the build. A new one goes in `components/local/` and joins the
registry and the gallery on the next build. The full contract is
[LESSON-FORMAT.md](../LESSON-FORMAT.md), and the list with every prop is
[COMPONENTS.md](../COMPONENTS.md).

## The server

`server/` is a small Express app. It grades answers, stores progress, and serves the study
folder over `http://localhost`, which the microphone needs (it does not work over `file://`).

| Route | Purpose |
|---|---|
| `GET  /api/health` | Lessons call it on load to decide between online and offline. |
| `POST /api/validate` | Grade a free-text answer: score, feedback, misconceptions. |
| `POST /api/progress` | Record a finished lesson or project and schedule its reviews. |
| `GET  /api/progress` | Mastery, schedule and grouped misconceptions, for the dashboard. |
| `GET  /api/catalog` | Every lesson, review and project on disk, for the library. |
| `GET  /api/next` | `NEXT.md` split into a decision, a button and a reason. |
| `GET  /api/strings` | The interface words in the study's language. |

## The progress store

`learno.db` is SQLite through Node's built-in `node:sqlite`, which is why Node 22.13 is the
minimum. It has five tables: `concepts` (schedule and mastery), `concept_history` (every
score with its source), `lessons` (completions), `section_results` (each graded answer, with
what you wrote, the feedback and the misconceptions) and `conversations`.

Read it from the terminal. Every command opens the file read-only:

```bash
node bin/learno.js status
node bin/learno.js due
node bin/learno.js misconceptions
node bin/learno.js lesson 0011
node bin/learno.js sql "select concept_id, next_review from concepts"
```

## The progress analyst

`agents/learno-analyst.md` is a read-only Claude Code subagent, linked from `.claude/agents/`
so every clone has it. It answers "how did I do on lesson 9?" or "what is due?" from the
store instead of from memory, and `CLAUDE.md` tells the main agent to ask it before making any
claim about your progress.

## Working on the engine

The sandbox serves fake lessons and data, with a stand-in grader, so nothing real is touched
and nothing is spent:

```sh
make sandbox-local  # fixtures on :9991
make check          # syntax-check the server and the build, validate the seed
make check-errors   # prove the build still refuses every kind of broken lesson
```

Start an answer with `!0`, `!p`, `!ok` or `!m` to force each score band. See
[sandbox/README.md](../sandbox/README.md).
