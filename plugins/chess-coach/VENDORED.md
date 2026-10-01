# chess-coach (vendored)

Copied from https://github.com/yongqyu/claude-chess at commit
783eeb00c3d791adba5eda6c410690cbda638fb6 (`plugins/chess-coach/`), MIT licensed per its README.

The two skills that drive it live in this repo's `.claude/skills/chess-coach/` and
`.claude/skills/extract-persona/` (moved out of `skills/` here so Claude Code loads them as
project skills). They reference the scripts by the fixed path `plugins/chess-coach/scripts/`,
so this directory must stay where it is.

To update: re-copy `plugins/chess-coach/` from upstream, move `skills/*` into
`.claude/skills/`, and re-apply the one-line install note change in `chess-coach/SKILL.md`.
