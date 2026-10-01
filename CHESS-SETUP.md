# Learning chess with Claude Code

This branch turns the repo into a chess-learning workspace built on three open-source tools.

| Tool | What it gives you | Where it lives here |
|---|---|---|
| [claude-chess](https://github.com/yongqyu/claude-chess) (chess-coach) | Play against an adaptive AI in the terminal. Every move is rated with a better alternative, your ELO is estimated, personas (Fischer, Tal, Petrosian, Carlsen), Markdown game reviews. | Vendored in `plugins/chess-coach/`; skills in `.claude/skills/chess-coach` and `.claude/skills/extract-persona` |
| [tintins-chess-analysis](https://github.com/Chess-analysis-mcp/tintins-chess-analysis) | Stockfish review of your real games (Lichess, Chess.com, any PGN) with plain-English explanations, a cross-game weakness profile, and a rated puzzle trainer. | Cloned into `tools/` by `setup-chess.sh`; wired up as the `chess` MCP server in `.mcp.json` |
| [learno](https://github.com/muricristino/learno) | Structured lessons across sessions: interview, lessons, teach-backs, spaced reviews, projects. Your answers and scores are versioned with the repo. | Study workspace in `chess-study/`; `/learno` skill and `learno-analyst` agent in `.claude/` |

All three run on your Claude subscription through Claude Code. No API keys.

## Setup on your computer

Requirements: git, Python 3.10+, Node 22.13+, and Claude Code logged in. Stockfish and uv
are installed for you by the script.

```bash
git clone https://github.com/FrozenFist27/hello-world.git
cd hello-world
git checkout learning-chess
bash setup-chess.sh      # 2 to 3 minutes the first time; safe to re-run any time
claude                   # open Claude Code in this folder
```

The first time Claude Code sees `.mcp.json` it asks whether to trust the project's `chess`
MCP server. Say yes.

Optional, for game review: open `.mcp.json` and set `CHESS_USERNAME` to your Lichess or
Chess.com username so the tool knows which side is you. `LICHESS_TOKEN` is only needed if you
import so many games that Lichess rate-limits you.

## Setup on Claude Code on the web

Nothing to do. `.claude/hooks/session-start.sh` runs `setup-chess.sh` automatically when a
web session starts on this branch. It runs synchronously, so the first prompt waits a couple
of minutes while it installs; later sessions reuse the cached container state and are fast.

Two web-session limits: the tintins browser board and the learno dashboard are not reachable
from a web session (they listen on localhost inside the container), so you get their text
output through Claude instead. And on the very first web session the `chess` MCP server may
show as failed because it started before the hook finished. Type `/mcp` and reconnect it.

## Getting started

### 1. Play a game with live coaching (chess-coach)

Say **"Let's play chess"**. Claude asks what to call you, offers the standard AI or a persona,
sets a difficulty from your history, and prints the board after each move. Type moves as
`e4`, `Nf3`, `O-O`, `e2e4`, or "knight to f3". After the game a review lands in
`~/.chess_coach/reviews/` with your estimated ELO.

Other things to say: "coach mode" (Claude asks what you would play before each move),
"review my last game", "extract a persona from my games".

### 2. Review a real game with Stockfish (tintins)

Paste a PGN and say **"analyze this game as white"**. With `CHESS_USERNAME` set you can say
"fetch my latest Lichess game and analyze it". Then ask "why was move 12 bad?" or "what should
I have played instead?". For tactics: "give me a puzzle" or "train my weaknesses".

On your computer you also get the interactive board:

```bash
cd tools/tintins-chess-analysis
uv run python scripts/run_web.py path/to/game.pgn white   # opens http://127.0.0.1:8765
```

### 3. Structured lessons (learno)

Type **`/learno`** or say "let's start studying". The first session is an interview: what you
want to learn, why, by when, and how much time you have. Claude writes that into
`chess-study/MISSION.md` and starts the first lesson. Come back any day with `/learno`; it
opens with what is due. The dashboard is at http://localhost:9990 while the local server runs
(`cd chess-study && make local`).

Commit `chess-study/` as you go. The lessons, your answers, and `learno.db` are your progress.

## Layout

```
.claude/
  skills/chess-coach/      play-and-coach skill (from claude-chess)
  skills/extract-persona/  build a persona from a PGN or your own games
  skills/learno/           wrapper that points /learno at chess-study/
  agents/learno-analyst.md read-only progress analyst for learno
  hooks/session-start.sh   web-session auto-setup
  settings.json            registers the hooks above
.mcp.json                  the `chess` MCP server (tintins) for game review and puzzles
setup-chess.sh             one-shot, idempotent installer for everything
plugins/chess-coach/       vendored engine, coach, renderer, personas, tests
chess-study/               learno engine + your study (lessons, reviews, learno.db)
tools/                     gitignored; tintins-chess-analysis checkout lives here
```

## Updating the tools

- **chess-coach**: see `plugins/chess-coach/VENDORED.md`.
- **tintins**: `bash setup-chess.sh` pulls the latest checkout.
- **learno engine**: scaffold a fresh copy with `npx muricristino/learno new tmp-learno --no-launch`
  and copy its engine folders over `chess-study/` (`server/`, `build/`, `components/`, `assets/`,
  `bin/`, `formats/`, `SKILL.md`, `LESSON-FORMAT.md`, `COMPONENTS.md`), keeping your study files
  (`lessons/`, `review/`, `projects/`, `learning-records/`, `MISSION.md`, `NOTES.md`, `NEXT.md`,
  `RESOURCES.md`, `learno.db`, `learno.json`).

## Troubleshooting

- **pip cannot build python-chess** ("install_layout" error on Debian/Ubuntu): the setup script
  installs it with `uv pip install --system chess` instead.
- **`chess` MCP server failed**: run `bash setup-chess.sh`, then `/mcp` and reconnect (or restart
  Claude Code). Self-check: `cd tools/tintins-chess-analysis && uv run python -m server.doctor`.
- **Stockfish**: the script downloads the official build into tintins' data folder
  (`~/.local/share/tintin-ai-chess-analysis/data/engine/` on Linux). To use your own, set
  `STOCKFISH_PATH` in `.mcp.json`.
- **learno grading says it is billed to an API key**: that message appears when Claude Code is
  logged in with a token rather than a claude.ai subscription login. On a subscription login,
  grading uses your plan's quota.
