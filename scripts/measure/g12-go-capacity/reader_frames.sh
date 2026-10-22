#!/bin/sh
# Per-frame process-memory reader for one measured container (VC-R58).
#
# Runs inside the target's PID namespace (docker --pid=container:<cid>), read
# only, network-less, with the target's UID/GID so default permissions suffice
# — no ptrace/cap/privileged additions. It lives in its own cgroup, so the
# cgroup filter below both includes every target-cgroup process (healthcheck
# execs included, whatever their UID/PPid) and excludes this reader itself
# (the reader's cgroup is 0::/…-reader, never the target's).
#
# Every process is counted once at process granularity: /proc/<pid>/smaps_rollup
# already aggregates that process's threads, so threads are not re-summed.
# Processes whose smaps_rollup cannot be read (e.g. the UID-0 pg_isready
# healthcheck exec seen by the UID-999 db reader) are reported in "missing"
# and must be surfaced as PARTIAL by the collector — never dropped or zeroed.
#
# Usage: reader_frames.sh <component> <interval-seconds>
# Appends one JSON line per interval to /frames/<component>.jsonl.
set -u
comp="${1:?component name required}"
interval="${2:-1}"
out="/frames/${comp}.jsonl"

target_cg="$(awk -F: '$1 == "0" {print $3}' /proc/1/cgroup)"

sanitize() { printf '%s' "$1" | tr -cd 'a-zA-Z0-9._-'; }

# busybox date may not support %N (it then emits a literal or nothing), so
# normalize to epoch-nanoseconds: strip non-digits, then left-pad seconds to
# 19 digits. Sub-second resolution is not required at reader cadence.
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
  pids=""
  missing=""
  for d in /proc/[0-9]*; do
    pid="${d#/proc/}"
    cg="$(awk -F: '$1 == "0" {print $3}' "$d/cgroup" 2>/dev/null)" || continue
    [ "$cg" = "$target_cg" ] || continue
    name="$(awk '/^Name:/{print $2}' "$d/status" 2>/dev/null)"
    uid="$(awk '/^Uid:/{print $2}' "$d/status" 2>/dev/null)"
    fds="$(ls -1 "$d/fd" 2>/dev/null | wc -l)"
    roll="$(awk '/^Rss:/{r=$2} /^Pss:/{p=$2} END{if (r != "" && p != "") print r, p}' \
      "$d/smaps_rollup" 2>/dev/null)" || roll=""
    if [ -n "$roll" ]; then
      pids="${pids}{\"pid\":${pid},\"uid\":${uid:-0},\"comm\":\"$(sanitize "$name")\",\"rss_kb\":${roll% *},\"pss_kb\":${roll#* },\"fds\":${fds:-0}},"
    else
      missing="${missing}{\"pid\":${pid},\"comm\":\"$(sanitize "$name")\",\"reason\":\"smaps_rollup_unreadable\"},"
    fi
  done
  pids="${pids%,}"
  missing="${missing%,}"
  printf '{"ts_ns":%s,"self_pid":%s,"target_cgroup":"%s","pids":[%s],"missing":[%s]}\n' \
    "$ts" "$$" "$target_cg" "$pids" "$missing" >> "$out"
  sleep "$interval"
done
