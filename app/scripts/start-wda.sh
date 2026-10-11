#!/usr/bin/env bash
#
# start-wda.sh — bring up WebDriverAgent on a connected iPhone so log-doctor's
# `phone` mode and the mobile-mcp Claude Code MCP server can drive the device.
#
# Idempotent: if WDA is already responding on localhost:8100, exits 0 immediately.
# Graceful skip: if no device is connected, prints a hint and exits 0 so the
# rest of `npm run dev` keeps working.
#
# Daily bring-up entry point — invoked by `npm run dev` via concurrently.
# The one-time WDA install (clone, sign, resign, install on the phone) is not
# done here; this only starts an installed one.
#
# Env overrides:
#   WDA_PORT         (default 8100)
#   IOS_UDID         (default: first device from `ios list`)
#   WDA_BUNDLE_ID    (default: auto-discovered from installed apps)

set -uo pipefail

WDA_PORT="${WDA_PORT:-8100}"
UDID="${IOS_UDID:-}"
WDA_BUNDLE="${WDA_BUNDLE_ID:-}"

log() { printf '[wda] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# ─── Cleanup on exit ────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  log "shutting down WDA bring-up…"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  # Give children a moment to flush
  sleep 0.2
  for pid in "${PIDS[@]}"; do
    kill -9 "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

# ─── Step 1: already running? ───────────────────────────────────────────────
if curl -fsS --max-time 2 "http://localhost:$WDA_PORT/status" 2>/dev/null | grep -q '"ready" : true'; then
  log "WDA already running on http://localhost:${WDA_PORT} — nothing to do"
  trap - EXIT INT TERM
  exit 0
fi

# ─── Step 2: prereqs ────────────────────────────────────────────────────────
if ! command -v ios >/dev/null 2>&1; then
  log "go-ios not installed — skipping WDA bring-up."
  log "  install with: npm install -g go-ios"
  log "  setup guide:  docs/device-automation.md"
  trap - EXIT INT TERM
  exit 0
fi

# ─── Step 3: device discovery ───────────────────────────────────────────────
DEVICE_JSON=$(ios list 2>/dev/null | tail -1)
DEVICE_COUNT=$(printf '%s' "$DEVICE_JSON" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print(len(d.get('deviceList', [])))
except Exception:
    print(0)
" 2>/dev/null)

if [ "${DEVICE_COUNT:-0}" = "0" ]; then
  log "no iOS device connected — skipping WDA bring-up."
  log "  plug in your iPhone via USB and tap 'Trust' if prompted, then re-run."
  trap - EXIT INT TERM
  exit 0
fi

if [ -z "$UDID" ]; then
  UDID=$(printf '%s' "$DEVICE_JSON" | python3 -c "
import json, sys
print(json.loads(sys.stdin.read())['deviceList'][0])
" 2>/dev/null) || die "failed to extract UDID from \`ios list\`"
fi
log "device: $UDID"

# ─── Step 4: WDA installed? ─────────────────────────────────────────────────
if [ -z "$WDA_BUNDLE" ]; then
  WDA_BUNDLE=$(ios apps --list --udid="$UDID" 2>/dev/null \
    | grep -oE '[a-zA-Z0-9._-]+\.WebDriverAgentRunner\.xctrunner' \
    | head -1)
fi
if [ -z "$WDA_BUNDLE" ]; then
  log "WebDriverAgent is not installed on the device."
  log "  one-time install: see docs/device-automation.md → \"Installing WebDriverAgent\""
  log "  (build, deep-sign, ios install — takes ~5 min the first time)"
  trap - EXIT INT TERM
  exit 0
fi
log "WDA bundle: $WDA_BUNDLE"

# ─── Step 5: developer disk image ───────────────────────────────────────────
DDI_STATUS=$(ios image list --udid="$UDID" 2>&1 || true)
if printf '%s' "$DDI_STATUS" | grep -q '"none"'; then
  log "developer disk image not mounted — fetching + mounting…"
  mkdir -p "$HOME/dev/wda-ddi"
  if ! ios image auto --basedir="$HOME/dev/wda-ddi" --udid="$UDID" 2>&1 \
       | sed 's/^/[wda:ddi] /' >&2; then
    die "developer disk image mount failed — see [wda:ddi] log above"
  fi
fi

# ─── Step 6: tunnel ─────────────────────────────────────────────────────────
log "starting userspace tunnel…"
ios tunnel start --userspace 2>&1 | sed 's/^/[wda:tunnel] /' >&2 &
PIDS+=($!)

# Wait for tunnel
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if ios tunnel ls 2>/dev/null | grep -q "userspaceTunPort"; then
    log "tunnel up after ${i} attempts"
    break
  fi
  sleep 0.5
  if [ "$i" = "15" ]; then
    die "tunnel did not come up — try \`ios tunnel ls\` to debug"
  fi
done

# Settle: `tunnel ls` showing the tunnel as registered does NOT mean RSD
# (Remote Service Discoverer) on the device has finished initializing its
# XPC services. There's a race window of ~3s where any RSD request fatals
# with `RST INTERNAL_ERROR`. Empirically, a 4-second sleep here makes the
# difference between every runwda call failing and every one succeeding.
log "settling tunnel (4s) so RSD can finish initializing…"
sleep 4
# Probe RSD by reading device info — if this fails, runwda will fail too,
# and we want to know now rather than burn the runwda timeout.
if ! ios info 2>/dev/null | head -1 | grep -q '"DeviceClass"'; then
  log "WARN: ios info failed after tunnel settle — RSD may still be sick"
  log "      retrying once after a longer settle (5s)"
  sleep 5
fi

# ─── Step 7: launch WDA via XCUITest ────────────────────────────────────────
#
# go-ios's runwda is flaky on iOS 26: sometimes the test-runner gets killed
# by testmanagerd (`conn1 closed unexpectedly`/`lost connection to
# testmanagerd`) ~30-45s after the XPC handshake succeeds. A clean retry
# of just the runwda step (without restarting the tunnel) usually
# recovers. Try up to 3 times before giving up.
#
# IMPORTANT: process substitution `> >(sed …)` is used here instead of a
# pipeline `| sed …` so that `$!` resolves to the `ios runwda` PID, not the
# `sed` PID. With a pipeline, killing `$!` only kills sed and runwda dies
# from a broken pipe — leaving the [wda:runner] log output uncaptured and
# making diagnosis impossible.
launch_runwda() {
  ios runwda \
    --bundleid="$WDA_BUNDLE" \
    --testrunnerbundleid="$WDA_BUNDLE" \
    --xctestconfig=WebDriverAgentRunner.xctest \
    --udid="$UDID" \
    > >(sed 's/^/[wda:runner] /' >&2) 2>&1 &
  RUNWDA_PID=$!
  PIDS+=("$RUNWDA_PID")
}

# Forwarder is fragile on iOS 26: it occasionally dies immediately with an
# RSD STREAM_CLOSED error if started before WDA's HTTP server is fully
# bound on the device side. We use the same process-substitution trick as
# runwda so $! resolves to the actual `ios forward` PID and we can detect
# its death and restart it cleanly.
FWD_PID=""
launch_forwarder() {
  ios forward "$WDA_PORT" "$WDA_PORT" --udid="$UDID" \
    > >(sed 's/^/[wda:fwd] /' >&2) 2>&1 &
  FWD_PID=$!
  PIDS+=("$FWD_PID")
}

# ─── Step 8: launch WDA + forwarder ─────────────────────────────────────────
#
# runwda starts first and stays alive for the lifetime of the WDA daemon.
# The forwarder is restarted on demand if it dies — see step 9.
log "launching WDA on the device…"
launch_runwda
log "forwarding localhost:${WDA_PORT} → device:${WDA_PORT}…"
launch_forwarder

# ─── Step 9: wait until WDA HTTP is ready ──────────────────────────────────
#
# Generous 120s budget — `runwda` can take 15-30s to bring WDA up after
# the XPC handshake completes, and the forwarder may need 1-2 restarts
# along the way. Bail fast if runwda itself dies (no point waiting).
RUNWDA_TIMEOUT_SEC=120
log "waiting for WDA HTTP… (timeout ${RUNWDA_TIMEOUT_SEC}s)"
READY=0
for i in $(seq 1 $RUNWDA_TIMEOUT_SEC); do
  if curl -fsS --max-time 2 "http://localhost:$WDA_PORT/status" 2>/dev/null \
       | grep -q '"ready" : true'; then
    READY=1
    log "WDA READY ✓  http://localhost:$WDA_PORT  (after ${i}s)"
    log "drive it from CLI:    npm run log-doctor -- phone tree"
    log "or live in Claude:    mobile-mcp tools are connected automatically"
    break
  fi
  # Bail early if runwda dies — WDA can't come up without it.
  if ! kill -0 "$RUNWDA_PID" 2>/dev/null; then
    log "runwda child exited unexpectedly — bailing wait early"
    break
  fi
  # Restart the forwarder if it died — common on iOS 26 if started before
  # WDA's HTTP server is bound. Re-attempt on every poll until WDA is up.
  if ! kill -0 "$FWD_PID" 2>/dev/null; then
    log "forwarder died — restarting"
    launch_forwarder
  fi
  sleep 1
done

if [ "$READY" = "0" ]; then
  die "WDA did not become ready within ${RUNWDA_TIMEOUT_SEC}s — scroll up for [wda:runner] errors"
fi

# ─── Step 10: stay alive while children run ─────────────────────────────────
# `wait` blocks until any child exits; we re-wait so we keep all of them alive
# until the process group is signaled (Ctrl-C from concurrently or interactive
# shell). Cleanup trap fires on EXIT/INT/TERM.
while true; do
  wait "${PIDS[@]}" 2>/dev/null || true
  # If we get here, one of the children died unexpectedly. Log and exit.
  log "one of the WDA child processes exited — shutting down"
  exit 1
done
