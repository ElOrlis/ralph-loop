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

test_sync_blocked_statuses_writes_to_json() {
    echo ""; echo "Test: after one iteration, blocked tasks have status=blocked + blockedBy populated"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x",
  "tasks": [
    { "id": "task-1", "title": "First", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0 },
    { "id": "task-2", "title": "Second", "category": "C", "priority": 2,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
      "dependsOn": ["task-1"] }
  ]
}
EOF

    # --dry-run still exercises sync_blocked_statuses (it runs before find_next_task).
    "$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github >/dev/null 2>&1 || true

    local t1_status t2_status t2_blocked_by
    t1_status=$(jq -r '.tasks[0].status // empty' "$TEST_DIR/prd.json")
    t2_status=$(jq -r '.tasks[1].status // empty' "$TEST_DIR/prd.json")
    t2_blocked_by=$(jq -c '.tasks[1].blockedBy // empty' "$TEST_DIR/prd.json")

    if [ "$t1_status" = "ready" ]; then pass "task-1 marked ready"
    else fail "task-1 status should be ready, got: $t1_status"; fi

    if [ "$t2_status" = "blocked" ]; then pass "task-2 marked blocked"
    else fail "task-2 status should be blocked, got: $t2_status"; fi

    if [ "$t2_blocked_by" = '["task-1"]' ]; then pass "task-2 blockedBy = [task-1]"
    else fail "task-2 blockedBy should be [\"task-1\"], got: $t2_blocked_by"; fi
}

test_merge_dependency_branches_function_exists() {
    echo ""; echo "Test: ralph-loop defines merge_dependency_branches"
    if grep -q "^merge_dependency_branches()" "$RALPH_LOOP"; then
        pass "defines merge_dependency_branches"
    else
        fail "missing function merge_dependency_branches"
    fi
}

test_loop_wires_merge_dependency_branches() {
    echo ""; echo "Test: run_ralph_loop calls merge_dependency_branches after ensure_task_branch"
    if grep -A2 'ensure_task_branch "\$next_task_id"' "$RALPH_LOOP" | grep -q 'merge_dependency_branches'; then
        pass "run_ralph_loop wires merge_dependency_branches"
    else
        fail "merge_dependency_branches not wired after ensure_task_branch"
    fi
}

setup
trap cleanup EXIT
test_find_next_task_respects_deps
test_sync_blocked_statuses_writes_to_json
test_merge_dependency_branches_function_exists
test_loop_wires_merge_dependency_branches

echo ""
echo "Phase 6 dependency graph: $TESTS_PASSED passed, $TESTS_FAILED failed"
[ $TESTS_FAILED -eq 0 ] || exit 1
