#!/bin/bash
# SessionStart hook: on Claude Code on the web, get the chess tools ready before the session
# starts (python-chess, the tintins Stockfish/MCP review tool, learno's npm deps).
# Locally this is a no-op; run `bash setup-chess.sh` yourself once.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
bash setup-chess.sh
