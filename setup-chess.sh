#!/usr/bin/env bash
# setup-chess.sh — one-shot, idempotent setup for the chess-learning tools in this repo.
#
#   bash setup-chess.sh               # everything
#   bash setup-chess.sh --no-tintins  # skip the Stockfish game-review tool
#
# 1. chess-coach  (vendored in plugins/chess-coach)  → installs python-chess
# 2. tintins-chess-analysis                           → clones into tools/ (gitignored), builds
#                                                       its env with uv, downloads Stockfish,
#                                                       runs its self-check
# 3. learno study workspace (chess-study/)            → installs its npm dependencies
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
ROOT="$PWD"

TINTINS_REPO="https://github.com/Chess-analysis-mcp/tintins-chess-analysis.git"
TINTINS_DIR="$ROOT/tools/tintins-chess-analysis"
WITH_TINTINS=1
for a in "$@"; do case "$a" in --no-tintins) WITH_TINTINS=0 ;; esac; done

ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
info() { printf '\033[34m›\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!\033[0m %s\n' "$1"; }

export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

# ── 0. uv: manages the tintins Python env and is the most reliable way to install python-chess
if ! command -v uv >/dev/null 2>&1; then
  info "Installing uv…"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  command -v uv >/dev/null 2>&1 || { warn "uv installed but not on PATH; open a new terminal and re-run."; exit 1; }
fi
ok "uv $(uv --version | awk '{print $2}')"

# ── 1. chess-coach: python-chess
if python3 -c "import chess" 2>/dev/null; then
  ok "python-chess already installed"
else
  info "Installing python-chess…"
  uv pip install --system --break-system-packages chess >/dev/null 2>&1 \
    || pip3 install --break-system-packages chess >/dev/null 2>&1 \
    || pip3 install chess >/dev/null 2>&1 \
    || { warn "Could not install python-chess. Try manually: pip install chess"; exit 1; }
  ok "python-chess installed"
fi

# ── 2. tintins-chess-analysis (Stockfish game review + puzzle trainer, as an MCP server)
if [ "$WITH_TINTINS" = 1 ]; then
  if [ -d "$TINTINS_DIR/.git" ]; then
    info "Updating tintins-chess-analysis…"
    git -C "$TINTINS_DIR" pull --quiet --ff-only || warn "Could not update tintins (offline?). Using the existing checkout."
  else
    info "Cloning tintins-chess-analysis into tools/…"
    mkdir -p "$ROOT/tools"
    git clone --quiet --depth 1 "$TINTINS_REPO" "$TINTINS_DIR"
  fi
  info "Building the tintins Python environment (first run downloads dependencies)…"
  (cd "$TINTINS_DIR" && uv sync --quiet)
  ok "tintins environment ready"

  if command -v stockfish >/dev/null 2>&1; then
    ok "Stockfish on PATH: $(command -v stockfish)"
  else
    info "Installing Stockfish (official static build, no sudo)…"
    (cd "$TINTINS_DIR" && uv run python scripts/download_stockfish.py) \
      || warn "Stockfish download failed. Install it from https://stockfishchess.org/download/ and re-run."
  fi
  echo
  (cd "$TINTINS_DIR" && uv run python -m server.doctor) || true
  echo
fi

# ── 3. learno study workspace
if [ -f "$ROOT/chess-study/package.json" ]; then
  for sub in . server; do
    if [ ! -d "$ROOT/chess-study/$sub/node_modules" ]; then
      info "Installing learno dependencies ($sub)…"
      (cd "$ROOT/chess-study/$sub" && npm install --silent --no-audit --no-fund)
    fi
  done
  ok "learno (chess-study/) ready"
fi

echo
ok "Done. In Claude Code, from this folder:"
echo "   • Play with live coaching:  say \"Let's play chess\""
echo "   • Review a real game:       paste a PGN and say \"analyze this game\"  (chess MCP server)"
echo "   • Structured lessons:       type /learno"
