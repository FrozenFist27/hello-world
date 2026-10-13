#!/usr/bin/env bash
# test_all.sh - the whole Hold On check in one command, from any cwd:
#   bash scripts/test_all.sh [--sim] [--out <dir>]
# Steps, each with a one-line verdict, stopping at the first failure (exit 1):
#   1. node scripts/test_gate.mjs        the pure gate on the recorded positions (and the hand, rewards, records)
#   2. node scripts/test_validate.mjs    the validator, the prompts (K1, K2, K3), the store
#   3. node scripts/test_path.mjs        the pathway's model (path.js) over synthetic logs
#   4. node scripts/test_sync.mjs        the mirror's merge (sync.js) and the store's mirror
#   5. node scripts/copy_check.js        the copy guard
#   6. the copy guard's self-check: a temp copy of app with a digit injected into COPY.PATH must fail (exit 1)
#   7. python3 scripts/build_artifact.py --check   the capability declaration: exactly sample, db, user
#   8. the harness with the stub over scripts/scenarios/holdon.js,path.js   (scripts/app_check.js --scenarios)
#   9. the harness with --no-stub over scripts/scenarios/holdon.js
#  10. with --sim: python3 scripts/bot_sim.py 10  (about 25 s; the opponent targets)
# Each harness pass prints its seconds against HARNESS_BUDGET_S (default 330; product/PATHWAY.md
# 'Risks': when the machine is slower the budget is raised here, in one place, never the scenarios
# cut) and fails over it. The five minutes were measured against an MVP stub run of 221 s; on the
# integration machine the MVP's own stub run measures about 245 s (some ten per cent slower), and the
# stub pass over holdon.js,path.js measured 290 to 299 s, so the budget was raised once, here, by that
# ten per cent (app/ARCHITECTURE.md 8.11). Harness reports go to <out>/stub/report.json and <out>/nostub/report.json.
#
# Note: the page serves its two fonts from app/assets/fonts, so no request leaves the page and a
# clean run has zero failed requests. The judge below still tolerates (with a printed caveat) a
# failed fonts.googleapis.com request, in case the page ever links Google Fonts again and runs in
# a container whose Chromium does not trust the HTTPS proxy's CA; any other error fails.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
export NODE_PATH="${NODE_PATH:-/opt/node22/lib/node_modules}"
HARNESS_BUDGET_S="${HARNESS_BUDGET_S:-330}"
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
SCRATCH="/tmp/claude-0/-home-user-hello-world/272d20b6-49d9-50c7-82a4-431be1d3a0e1/scratchpad"
if [ -z "$OUT" ]; then
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

# The copy guard must catch a digit in COPY.PATH: a temp copy of the files it scans, one digit
# injected into COPY.PATH.NOTHING_LEFT, and copy_check must exit 1 on it (any other code fails).
copy_selfcheck() {
  local tmp
  tmp="$(mktemp -d "$OUT/copy_selfcheck.XXXXXX")"
  cp -R "$ROOT/app/js" "$ROOT/app/data" "$tmp/"
  cp "$ROOT/app/index.html" "$ROOT/app/styles.css" "$ROOT/app/package.json" "$tmp/"
  sed -i "s/NOTHING_LEFT: 'There is nothing left for me to hold\. Your move\.'/NOTHING_LEFT: 'There is nothing left for me to hold. Your 2 moves.'/" "$tmp/js/contract.js"
  if ! grep -q "Your 2 moves" "$tmp/js/contract.js"; then echo "the digit was not injected (COPY.PATH.NOTHING_LEFT moved?)"; return 1; fi
  local code=0
  node "$HERE/copy_check.js" --dir "$tmp" || code=$?
  rm -rf "$tmp"
  if [ "$code" = "1" ]; then echo "copy_check exits 1 on a digit injected into COPY.PATH"; return 0; fi
  echo "copy_check exited $code on a digit injected into COPY.PATH (expected 1)"
  return 1
}

# The republish's capability declaration: exactly sample, db and user (never permissions).
build_check() {
  local json
  json="$(python3 "$ROOT/scripts/build_artifact.py" --check)"
  node -e '
    let d = null;
    try { d = JSON.parse(process.argv[1]); } catch (e) { console.log("build --check printed no JSON: " + process.argv[1]); process.exit(1); }
    const caps = d && d.capabilities;
    const names = caps && typeof caps === "object" ? Object.keys(caps).sort() : [];
    if (JSON.stringify(names) !== JSON.stringify(["db", "sample", "user"])) { console.log("capabilities are " + JSON.stringify(names) + ", expected db, sample, user"); process.exit(1); }
    const extra = names.filter((n) => JSON.stringify(caps[n]) !== "{}");
    if (extra.length) { console.log("capabilities carry config: " + extra.join(", ")); process.exit(1); }
    console.log("capabilities: " + ["sample", "db", "user"].join(", "));
  ' "$json"
}

# harness <label> <scenario list> [--no-stub]: runs app_check over the scenarios; judges the JSON report
harness() {
  local label="$1"; shift
  local scenarios="$1"; shift
  local dir="$OUT/$label"
  mkdir -p "$dir"
  local t=$(date +%s)
  local code=0
  # a free port: the harness's default 8787 may be held by a stray server from another session
  local port
  port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
  local list=""
  local s
  IFS=',' read -ra parts <<< "$scenarios"
  for s in "${parts[@]}"; do list="${list:+$list,}$HERE/scenarios/$s"; done
  node "$HERE/app_check.js" --dir "$ROOT/app" --page index.html --port "$port" --scenarios "$list" --out "$dir" "$@" >"$dir/report.json" 2>"$dir/stderr.log" || code=$?
  local secs=$(( $(date +%s) - t ))
  local verdict
  verdict="$(node -e '
    const fs = require("fs");
    const [file, code, secs, budget] = process.argv.slice(1);
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
    if (Number(secs) > Number(budget)) problems.push("over budget: " + secs + "s of " + budget + "s");
    const caveat = fontFails ? " [caveat: " + fontFails + " Google Fonts request(s) failed: Chromium in this container does not trust the proxy CA]" : "";
    const line = secs + "s of " + budget + "s budget, " + r.shots.length + " shots, " + (r.sampleCallsRun != null ? r.sampleCallsRun : (r.sampleCalls || []).length) + " sample calls";
    if (!problems.length && (r.ok || fontFails)) console.log("PASS " + line + caveat);
    else console.log("FAIL " + line + ": " + (problems.join(" | ") || ("exit " + code)) + caveat);
  ' "$dir/report.json" "$code" "$secs" "$HARNESS_BUDGET_S")"
  echo "${verdict%% *}  harness $label  ${verdict#* }"
  if [ "${verdict%% *}" != "PASS" ]; then
    echo "--- $dir/stderr.log (tail):"; tail -n 12 "$dir/stderr.log" || true
    exit 1
  fi
}

echo "test_all: $(date -u +%FT%TZ) out=$OUT budget=${HARNESS_BUDGET_S}s per harness pass"
step "test_gate" node "$HERE/test_gate.mjs"
step "test_validate" node "$HERE/test_validate.mjs"
step "test_path" node "$HERE/test_path.mjs"
step "test_sync" node "$HERE/test_sync.mjs"
step "copy_check" node "$HERE/copy_check.js" --dir "$ROOT/app"
step "copy_check self-check" copy_selfcheck
step "build --check" build_check
harness stub "holdon.js,path.js"
harness nostub "holdon.js" --no-stub
if [ "$SIM" = "1" ]; then
  step "bot_sim 10" python3 "$HERE/bot_sim.py" 10
fi
echo "test_all: all steps passed in $(elapsed)"
