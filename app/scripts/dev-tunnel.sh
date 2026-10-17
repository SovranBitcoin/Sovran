#!/usr/bin/env bash
# Run `bun run dev` for this checkout behind its own named Expo (ngrok) tunnel,
# so a phone anywhere can load it, and several checkouts can run at once.
#
#   bun run dev:tunnel [name]             in this terminal
#   bun run dev:tunnel --detach [name]    in a background screen session, once the tunnel answers
#   bun run dev:tunnel --list             what is running, with each one's link
#   bun run dev:tunnel --stop <name>      stop one; Metro and its tunnel close with it
#
# Each checkout gets the first free Metro port from 8082 and the tunnel
# https://sovran-<name>.ngrok.io (Expo's ngrok account: the owner's own is on
# the free plan, which allows no names). <name> defaults to the branch, without
# a feat/, fix/ or similar prefix, or to the worktree folder when detached.
#
# Open https://sovran-<name>.ngrok.io/_expo/link?choice=expo-dev-client on the
# phone: Expo answers with a redirect into the installed Sovran dev client,
# which then loads this checkout. Tapped in a chat, it opens like any web link.
# Reattach with `screen -r sovran-<name>` (Expo's r, m and j keys work there);
# leave with Ctrl-a d. Logs go to this checkout's app/LOG.txt.
set -euo pipefail

link() { echo "https://$1.ngrok.io/_expo/link?choice=expo-dev-client"; }
# ngrok allows lower-case letters, digits and hyphens, up to 63 of them.
subdomain_for() {
  local name
  name=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-' | sed -E 's/-+/-/g; s/^-|-$//g' | cut -c1-48)
  name="sovran-${name#sovran-}"
  echo "${name%-}"
}
sessions() { { screen -ls || true; } | awk '$1 ~ /\.sovran-/ {sub(/^[0-9]+\./, "", $1); print $1}'; }

detach=0
case "${1:-}" in
  --list)
    found=$(sessions)
    [[ -n "$found" ]] || { echo "dev-tunnel: none running"; exit 0; }
    for s in $found; do echo "$s  $(link "$s")"; done
    exit 0 ;;
  --detach) detach=1; shift ;;
  --stop)
    [[ -n "${2:-}" ]] || { echo "dev-tunnel: --stop needs a name" >&2; exit 1; }
    session=$(subdomain_for "${2#*/}")
    pid=$({ screen -ls || true; } | awk -v s="$session" '$1 ~ "\\."s"$" {split($1, a, "."); print a[1]}')
    [[ -n "$pid" ]] || { echo "dev-tunnel: $session is not running" >&2; exit 1; }
    # Ctrl-c typed into screen does not get through `script`'s terminal, so
    # interrupt Expo itself; it closes Metro and its tunnel on the way out.
    descendants() { local c; for c in $(pgrep -P "$1"); do echo "$c"; descendants "$c"; done; }
    for c in $(descendants "$pid"); do
      ps -o command= -p "$c" | grep -q 'expo start' && kill -INT "$c"
    done
    for _ in $(seq 1 30); do
      { screen -ls || true; } | grep -q "\.$session[[:space:]]" || { echo "dev-tunnel: stopped $session"; exit 0; }
      sleep 1
    done
    echo "dev-tunnel: $session did not stop; screen -r $session to look" >&2
    exit 1 ;;
esac

root=$(git rev-parse --show-toplevel)
if [[ -z "${1:-}" ]]; then
  branch=$(git rev-parse --abbrev-ref HEAD)
  folder=$(basename "$root")
  if [[ "$branch" == HEAD ]]; then
    set -- "${folder#sovran-app-}"
  elif [[ "$branch" == main ]]; then
    set -- main
  else
    set -- "${branch#*/}"
  fi
fi
subdomain=$(subdomain_for "$1")

if { screen -ls || true; } | grep -q "\.$subdomain[[:space:]]"; then
  echo "dev-tunnel: $subdomain is already running; open $(link "$subdomain")" >&2
  exit 1
fi

port=8082
while lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do port=$((port + 1)); done

# Expo's tunnel runs `adb reverse` on every attached Android device and aborts if
# any is unauthorized (a phone plugged in without accepting USB debugging). Give
# Expo an SDK whose adb hides unauthorized devices; everything else is the real adb.
real_sdk=${ANDROID_HOME:-$HOME/Library/Android/sdk}
if [[ -x "$real_sdk/platform-tools/adb" ]]; then
  shim=${TMPDIR:-/tmp}/sovran-dev-sdk
  mkdir -p "$shim/platform-tools"
  for entry in "$real_sdk"/*; do
    [[ "$(basename "$entry")" == platform-tools ]] || ln -sfn "$entry" "$shim/$(basename "$entry")"
  done
  cat > "$shim/platform-tools/adb" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == devices ]]; then
  "$real_sdk/platform-tools/adb" "\$@" | grep -v '[[:space:]]unauthorized'
  exit \${PIPESTATUS[0]}
fi
exec "$real_sdk/platform-tools/adb" "\$@"
EOF
  chmod +x "$shim/platform-tools/adb"
  export ANDROID_HOME="$shim"
fi

echo "dev-tunnel: $root on Metro port $port"
cd "$root/app"
export EXPO_TUNNEL_SUBDOMAIN="$subdomain"
if [[ $detach == 0 ]]; then
  echo "dev-tunnel: open $(link "$subdomain") on the phone once Expo says the tunnel is ready"
  exec bun run dev --tunnel --port "$port"
fi

# Expo stops when its input closes, so it needs a terminal of its own.
screen -dmS "$subdomain" bun run dev --tunnel --port "$port"
# Ready means the tunnel itself answers with the redirect into the dev client.
for _ in $(seq 1 120); do
  location=$(curl -s --max-time 5 -o /dev/null -w '%{redirect_url}' -A 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' "$(link "$subdomain")" || true)
  if [[ "$location" == exp+sovran://* ]]; then
    echo "dev-tunnel: ready in screen session $subdomain"
    echo "dev-tunnel: open $(link "$subdomain")"
    exit 0
  fi
  { screen -ls || true; } | grep -q "\.$subdomain[[:space:]]" || {
    echo "dev-tunnel: Expo exited; see $root/app/LOG.txt" >&2
    exit 1
  }
  sleep 1
done
echo "dev-tunnel: the tunnel did not answer in 2 minutes; screen -r $subdomain to look" >&2
exit 1
