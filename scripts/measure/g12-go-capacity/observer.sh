#!/bin/sh
# Runtime-internal metrics + fake-provider stats observer (VC-R58).
#
# Shares ONLY the runtime container's network namespace (docker --network
# container:<cid>) in its own cgroup: companiond's /actuator/prometheus and
# the netns-loopback fake provider's /g12/stats are reachable, while the
# observer's own CPU/memory stay outside every measured container. Caddy does
# not proxy Prometheus, and nothing here publishes a port or weakens the
# production edge. Read-only BusyBox wget only.
#
# Usage: observer.sh <interval-seconds>
# Appends one JSON line per interval to /frames/observer.jsonl.
set -u
interval="${1:-1}"
out="/frames/observer.jsonl"
metrics_url="http://127.0.0.1:8080/actuator/prometheus"
stats_url="http://127.0.0.1:19091/g12/stats"

# Same busybox %N normalization as reader_frames.sh: epoch-nanoseconds.
ts_now() {
  v="$(date +%s%N)"
  case "$v" in
    *[!0-9]*) v="$(date +%s)";;
  esac
  while [ "${#v}" -lt 19 ]; do v="${v}0"; done
  printf '%s' "$v"
}

while :; do
  ts="$(ts_now)"
  kv="$(wget -q -O - -T 3 "$metrics_url" 2>/dev/null \
    | grep -E '^(process_cpu_seconds_total|process_open_fds|go_goroutines|vc_generation_active|vc_generation_peak|vc_db_pool_acquired|vc_realtime_subscribers) ' \
    | awk '{printf "\"%s\":%s,", $1, $2}')"
  kv="${kv%,}"
  fstats="$(wget -q -O - -T 3 "$stats_url" 2>/dev/null | tr -d '\n')"
  printf '{"ts_ns":%s,"metrics":{%s},"provider":%s}\n' \
    "$ts" "$kv" "${fstats:-null}" >> "$out"
  sleep "$interval"
done
