#!/usr/bin/env bash
# G3/G7: companiond pgx owner-bound short transactions, RLS, least-privilege,
# and Relationship/Conversation/Message core API against an ephemeral
# PostgreSQL 18 + pgvector (same frozen image as run-rls-tests.sh).
# Does not touch a current production database and does not connect a provider.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if ! command -v go >/dev/null; then
  echo "need Go (backend/go.mod locks go1.26.7)" >&2
  exit 1
fi
if ! command -v docker >/dev/null; then
  echo "need docker for the synthetic PostgreSQL harness" >&2
  exit 1
fi
export GOPROXY="${GOPROXY:-off}"
go test -C "$ROOT/backend" -mod=vendor -tags=integration -count=1 -timeout 10m ./internal/store/postgres/
go test -C "$ROOT/backend" -mod=vendor -tags=integration -count=1 -timeout 10m ./internal/httpapi/
