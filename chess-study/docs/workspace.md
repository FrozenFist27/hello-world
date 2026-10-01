# Your study folder

`npx muricristino/learno new <folder>` clones this repository into `<folder>`, empties the
study, installs the dependencies and makes a first commit. The engine and your study share
the same folder, so there is nothing to install separately and Claude can change the engine
in place when a lesson needs it.

## What is in it

```
chess/
│
│  your study ───────────────────────────────────
├── learno.db                 ← your progress: answers, scores, schedule, mistakes (SQLite)
├── learno.json               ← the interface language
├── MISSION.md                ← why you are learning this, and the curriculum as patterns
├── NOTES.md                  ← how you learn, your time, what to avoid
├── NEXT.md                   ← what to do now; the dashboard opens with it
├── RESOURCES.md              ← the sources lessons stand on, in tiers
├── lessons/                  ← NNNN-name.json + .yml → .html
├── review/                   ← spaced reviews, same format
├── projects/                 ← briefs for what you build when a pattern closes
├── learning-records/         ← short notes on what you showed you understand
├── reference/
│   ├── my-learning.html      ← the dashboard
│   ├── library.html          ← every lesson, review and project, with scores
│   └── glossary.html         ← the concept vocabulary
│
│  the engine ────────────────────────────────────
├── SKILL.md                  ← how Claude teaches: the session loop and its rules
├── LESSON-FORMAT.md          ← how a lesson is written
├── COMPONENTS.md             ← the blocks a lesson can use (generated)
├── .claude/                  ← makes /learno and the progress analyst available
├── components/               ← those blocks; components/local/ is yours
├── build/                    ← turns .json + .yml into pages, and refuses broken ones
├── assets/                   ← the design system and the lesson page script
├── server/                   ← grading and the progress store
├── bin/learno.js             ← read your progress from the terminal
└── sandbox/                  ← fake data for working on the engine
```

The whole folder is a git repository, `learno.db` included, so your history of answers is
versioned along with the lessons.

## Seeing your lessons

Claude starts the local server when it needs it. To start it yourself:

```bash
make local        # http://localhost:9990
make start        # the same, plus a public Cloudflare URL for your phone
```

`make start` needs `cloudflared`. The URL it prints has no password: anyone who has it can
open your study and spend your grading quota, so use `make local` at a desk.

## Language

`learno.json` sets the language of the interface: buttons, labels, dates, the dashboard, the
dictation default and the grader's feedback.

```json
{ "lang": "en" }
```

`en` is the default and the fallback for any missing word; `pt` is the other one available.
Adding a language is one entry in `build/strings.js`. Lesson content is whatever Claude wrote,
in the language you study in, so a lesson can be in Spanish with English buttons.

After changing it, run `make build` so existing lessons are regenerated.

## Settings

Everything works without a `.env`. These are the optional overrides, read from `.env` at the
root (see [`.env.example`](../.env.example)):

| Variable | Default | What it changes |
|---|---|---|
| `PORT` | `9990` | The server port. |
| `LEARNO_DB` | `learno.db` | Where progress is stored. |
| `GEMINI_API_KEY` | none | Grade with Gemini (about 2 to 3 s) instead of Claude Code (about 10 s). |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Which Gemini model grades. |
| `LEARNO_GRADER` | `gemini` with a key, else `claude` | Force one grader. |
| `LEARNO_CLAUDE_MODEL` | `haiku` | Which Claude model grades. Try `sonnet` if grading feels too generous. |
| `LEARNO_WORKSPACE` | the repo root | Which folder to serve. Only the sandbox uses it. |
| `LEARNO_MODE` | none | `sandbox` swaps in fake data and a fake grader. |

Grading with Claude Code uses your plan's quota. If your Claude Code is logged in with an API
key instead of a subscription, each graded answer is billed to that key.

## Updating the engine

The folder keeps this repository as `upstream`:

```bash
git pull upstream master
```

This repository still carries its author's own lessons, which `learno new` deletes from your
copy. If upstream changes one of them, a pull can bring it back or conflict, and you can delete
it again. If Claude edited an engine file in your study, expect to resolve that file by hand.
