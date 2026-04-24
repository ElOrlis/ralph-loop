#!/usr/bin/env bash
# tests/test-dependency-graph.sh — Phase 6 end-to-end
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
TESTS_PASSED=0; TESTS_FAILED=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RALPH_LOOP="$PROJECT_ROOT/ralph-loop"

pass() { echo -e "${GREEN}✓ PASS:${NC} $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo -e "${RED}✗ FAIL:${NC} $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
info() { echo -e "${YELLOW}INFO:${NC} $1"; }

setup()   { TEST_DIR=$(mktemp -d); }
cleanup() { rm -rf "$TEST_DIR"; }

test_find_next_task_respects_deps() {
    echo ""; echo "Test: ralph-loop picks dep-free task first, skipping a higher-priority blocked one"

    # task-1 priority 2, no deps. task-2 priority 1 (normally first) but depends on task-1.
    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x",
  "tasks": [
    { "id": "task-1", "title": "First", "category": "C", "priority": 2,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0 },
    { "id": "task-2", "title": "Second", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
      "dependsOn": ["task-1"] }
  ]
}
EOF

    local output
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github 2>&1)
    if echo "$output" | grep -q "Task: task-1 - First"; then
        pass "picks unblocked task-1 even though task-2 has lower priority"
    else
        fail "expected task-1 to be selected. Got:\n$output"
    fi
}

setup
trap cleanup EXIT
test_find_next_task_respects_deps

echo ""
echo "Phase 6 dependency graph: $TESTS_PASSED passed, $TESTS_FAILED failed"
[ $TESTS_FAILED -eq 0 ] || exit 1
