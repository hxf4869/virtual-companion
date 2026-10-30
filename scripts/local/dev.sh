#!/usr/bin/env bash
# Local stack entrypoint. Secrets stay outside the repo.
set -euo pipefail
umask 077
cd "$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
main "$@"
