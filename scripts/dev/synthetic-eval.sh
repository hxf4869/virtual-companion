#!/usr/bin/env bash
# S0-24-A opt-in synthetic eval gate. This is deliberately separate from the
# seconds-level scripts/check.sh: it builds the current runtime, runs the fixed
# offline safety/adapter/admission suite, then exercises two real-browser
# provider journeys against loopback only. The browser stage temporarily uses
# BETA in its disposable database, then verifies restoration to SYNTHETIC; it
# never touches or advances a real environment gate.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [ -z "${JAVA_HOME:-}" ] \
    && [ -d /opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home ]; then
    export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home
fi

if [ -n "${E2E_BASE_URL:-}" ]; then
    echo "E2E_BASE_URL is forbidden for synthetic eval; the stack must stay on loopback" >&2
    exit 9
fi

echo "SYNTHETIC_EVAL_START profile=e2e-synthetic-v1 release_gate=SYNTHETIC/eval=false"

./mvnw --batch-mode --no-transfer-progress \
    -pl service/apps/runtime,service/tests/openai-chat-completions-contract-tests \
    -am \
    '-Dtest=MeasureRedTeamCorpusTest,CompositeSafetyClassifierTest,GenerationAdmissionPolicyTest,GenerationAdmissionServiceTest,ReleaseGateTest,OpenAiCompatModerationClientTest,OpenAiChatCompletionsFailureContractTest,OpenAiChatCompletionsTimeoutCancellationContractTest' \
    -Dsurefire.failIfNoSpecifiedTests=false \
    package

E2E_RELEASE_MODE=synthetic-eval \
E2E_REUSE_STACK=0 \
E2E_STACK_KEEP=0 \
E2E_DOCKER_CONTEXT=orbstack \
    pnpm --dir frontend exec playwright test \
    e2e/journeys/03-relationship-chat.spec.ts \
    e2e/journeys/07-provider-faults.spec.ts

echo "SYNTHETIC_EVAL_RESULT=PASS profile=e2e-synthetic-v1 release_gate=SYNTHETIC/eval=false"
