#!/usr/bin/env bash
# Port discovery for the isolated harness (sourced by verify-clean-stack.sh and its tests).
# The harness sets every MTK_*_PORT to 0 so Docker binds each published port ATOMICALLY on 127.0.0.1;
# the real port is read back with `docker compose port` AFTER the services start.  Nothing here ever
# picks, probes or releases a port before binding.

# parse_published_port <text>: print the port of the single 127.0.0.1:<port> mapping in `docker compose port`
# output.  Anything else (empty, other host, non-numeric, 0, >65535, conflicting mappings) returns 1.
parse_published_port() {
  local line port found=""
  while IFS= read -r line; do
    line="${line//[$'\r ']/}"; [ -n "$line" ] || continue
    [[ "$line" =~ ^127\.0\.0\.1:([0-9]{1,5})$ ]] || return 1
    port=$((10#${BASH_REMATCH[1]}))
    { [ "$port" -ge 1 ] && [ "$port" -le 65535 ]; } || return 1
    if [ -n "$found" ] && [ "$found" != "$port" ]; then return 1; fi
    found="$port"
  done <<<"$1"
  [ -n "$found" ] || return 1
  printf '%s\n' "$found"
}

# resolve_published_port <compose-function> <service> <container-port> [attempts=15] [delay=2]
# Bounded: at most <attempts> `compose port` calls.  Prints the host port; on failure prints why to stderr, returns 1.
resolve_published_port() {
  local fn="$1" svc="$2" cport="$3" attempts="${4:-15}" delay="${5:-2}" i out port="" last=""
  for ((i = 1; i <= attempts; i++)); do
    out="$("$fn" port "$svc" "$cport" 2>&1)"; last="$out"
    if port="$(parse_published_port "$out")"; then printf '%s\n' "$port"; return 0; fi
    [ "$i" -lt "$attempts" ] && sleep "$delay"
  done
  echo "could not discover a valid 127.0.0.1 host port for $svc:$cport after $attempts attempts (last output: ${last:0:200})" >&2
  return 1
}
