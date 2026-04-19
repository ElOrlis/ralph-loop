#!/usr/bin/env bash
# tests/test-phase5-failed-iteration.sh — a corrupted JSON writes a Ralph-Status: failed commit
set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
TESTS_PASSED=0; TESTS_FAILED=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RALPH_LOOP="$PROJECT_ROOT/ralph-loop"
pass() { echo -e "${GREEN}✓ PASS:${NC} $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo -e "${RED}✗ FAIL:${NC} $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

test_failed_iteration_trailer_present_in_code() {
    echo ""; echo "Test: the JSON-corruption branch invokes commit_iteration with status=failed"
    if grep -A6 'JSON file corrupted during iteration' "$RALPH_LOOP" | grep -q 'commit_iteration.*"failed"'; then
        pass "failed-iteration commit is wired in the corruption branch"
    else
        fail "corruption branch does not commit with Ralph-Status: failed"
    fi
}

test_failed_iteration_trailer_present_in_code

echo ""
echo "Phase 5 failed-iteration recovery: $TESTS_PASSED passed, $TESTS_FAILED failed"
[ $TESTS_FAILED -eq 0 ] || exit 1
