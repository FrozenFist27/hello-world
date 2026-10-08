#!/usr/bin/env bash
# test_all.sh - the whole Hold On check in one command, from any cwd:
#   bash scripts/test_all.sh [--sim] [--out <dir>]
# Steps, each with a one-line verdict, stopping at the first failure (exit 1):
#   1. node scripts/test_gate.mjs        the pure gate on the recorded positions
#   2. node scripts/test_validate.mjs    the validator, the prompts, the store
#   3. node scripts/copy_check.js        the copy guard
#   4. the harness with the scenario, stub on   (scripts/app_check.js --script scripts/scenarios/holdon.js)
#   5. the harness with the scenario, --no-stub
#   6. with --sim: python3 scripts/bot_sim.py 10  (about 25 s; the opponent targets)
# Harness reports go to <out>/stub/report.json and <out>/nostub/report.json.
#
# Note: the page serves its two fonts from app/assets/fonts, so no request leaves the page and a
# clean run has zero failed requests. The judge below still tolerates (with a printed caveat) a
# failed fonts.googleapis.com request, in case the page ever links Google Fonts again and runs in
# a container whose Chromium does not trust the HTTPS proxy's CA; any other error fails.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
export NODE_PATH="${NODE_PATH:-/opt/node22/lib/node_modules}"
SIM=0
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --sim) SIM=1 ;;
    --out) OUT="$2"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
if [ -z "$OUT" ]; then
  SCRATCH="/tmp/claude-0/-home-user-hello-world/272d20b6-49d9-50c7-82a4-431be1d3a0e1/scratchpad"
  if [ -d "$SCRATCH" ]; then OUT="$(mktemp -d "$SCRATCH/test_all.XXXXXX")"; else OUT="$(mktemp -d)"; fi
fi
mkdir -p "$OUT"
T0=$(date +%s)
elapsed() { echo "$(( $(date +%s) - T0 ))s"; }

step() {   # step <name> <command...>: prints PASS/FAIL with the time; exits 1 on failure
  local name="$1"; shift
  local log="$OUT/$(echo "$name" | tr ' /' '__').log"
  local t=$(date +%s)
  if "$@" >"$log" 2>&1; then
    echo "PASS  $name  ($(( $(date +%s) - t ))s)  $(tail -n 1 "$log")"
  else
    echo "FAIL  $name  ($(( $(date +%s) - t ))s)  see $log"
    tail -n 15 "$log"
    exit 1
  fi
}

# harness <label> [--no-stub]: runs app_check with the scenario; judges the JSON report
harness() {
  local label="$1"; shift
  local dir="$OUT/$label"
  mkdir -p "$dir"
  local t=$(date +%s)
  local code=0
  # a free port: the harness's default 8787 may be held by a stray server from another session
  local port
  port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
  node "$HERE/app_check.js" --dir "$ROOT/app" --page index.html --port "$port" --script "$HERE/scenarios/holdon.js" --out "$dir" "$@" >"$dir/report.json" 2>"$dir/stderr.log" || code=$?
  local secs=$(( $(date +%s) - t ))
  local verdict
  verdict="$(node -e '
    const fs = require("fs");
    const [file, code, secs] = process.argv.slice(1);
    let r = null;
    try { r = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.log("FAIL no report (exit " + code + ")"); process.exit(0); }
    const font = (s) => /fonts\.googleapis\.com|ERR_CERT_AUTHORITY_INVALID/.test(s);
    const consoleOther = r.consoleErrors.filter((e) => !font(e));
    const failedOther = r.failedRequests.filter((e) => !font(e));
    const fontFails = r.failedRequests.length - failedOther.length;
    const overflow = r.shots.filter((s) => s.horizontalOverflow).map((s) => s.viewport + "/" + s.scheme);
    const problems = [];
    if (consoleOther.length) problems.push("console errors: " + consoleOther.join("; "));
    if (r.pageErrors.length) problems.push("page errors: " + r.pageErrors.join("; "));
    if (failedOther.length) problems.push("failed requests: " + failedOther.join("; "));
    if (overflow.length) problems.push("horizontal overflow: " + overflow.join(", "));
    if (r.shots.length !== 4) problems.push("shots: " + r.shots.length + " of 4 (the scenario threw; see stderr.log)");
    const caveat = fontFails ? " [caveat: " + fontFails + " Google Fonts request(s) failed: Chromium in this container does not trust the proxy CA]" : "";
    if (!problems.length && (r.ok || fontFails)) console.log("PASS " + secs + "s, 4 shots, " + (r.sampleCalls || []).length + " sample calls" + caveat);
    else console.log("FAIL " + secs + "s: " + (problems.join(" | ") || ("exit " + code)) + caveat);
  ' "$dir/report.json" "$code" "$secs")"
  echo "${verdict%% *}  harness $label  ${verdict#* }"
  if [ "${verdict%% *}" != "PASS" ]; then
    echo "--- $dir/stderr.log (tail):"; tail -n 12 "$dir/stderr.log" || true
    exit 1
  fi
}

echo "test_all: $(date -u +%FT%TZ) out=$OUT"
step "test_gate" node "$HERE/test_gate.mjs"
step "test_validate" node "$HERE/test_validate.mjs"
step "copy_check" node "$HERE/copy_check.js" --dir "$ROOT/app"
harness stub
harness nostub --no-stub
if [ "$SIM" = "1" ]; then
  step "bot_sim 10" python3 "$HERE/bot_sim.py" 10
fi
echo "test_all: all steps passed in $(elapsed)"
