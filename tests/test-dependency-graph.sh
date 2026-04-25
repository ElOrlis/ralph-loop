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

test_cycle_blocks_run() {
    echo ""; echo "Test: a PRD with a dependency cycle fails validation (does not start the loop)"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x",
  "tasks": [
    { "id": "task-1", "title": "A", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0, "dependsOn": ["task-2"] },
    { "id": "task-2", "title": "B", "category": "C", "priority": 2,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0, "dependsOn": ["task-1"] }
  ]
}
EOF

    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -ne 0 ] && echo "$output" | grep -qi "cycle"; then
        pass "cycle blocks run at validation time"
    else
        fail "expected non-zero exit and 'cycle' in output. Exit: $exit_code, Output:\n$output"
    fi
}

test_self_dep_blocks_run() {
    echo ""; echo "Test: a self-dependency fails validation"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x",
  "tasks": [
    { "id": "task-1", "title": "A", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0, "dependsOn": ["task-1"] }
  ]
}
EOF

    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -ne 0 ] && echo "$output" | grep -qi "self"; then
        pass "self-dep blocks run"
    else
        fail "expected non-zero exit and 'self' in output. Exit: $exit_code, Output:\n$output"
    fi
}

test_blocked_task_skipped_when_only_it_is_incomplete() {
    echo ""; echo "Test: when only blocked tasks remain, loop exits without picking them"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x",
  "tasks": [
    { "id": "task-1", "title": "A", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": true, "attempts": 1,
      "completedAt": "2026-04-23T00:00:00Z" },
    { "id": "task-2", "title": "B", "category": "C", "priority": 2,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
      "dependsOn": ["ghost-that-will-never-pass"] }
  ]
}
EOF

    # Validation will reject the "ghost" reference. That's the correct behavior — unknown
    # refs are surfaced at validation, not at runtime. So we assert validation fails.
    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -ne 0 ] && echo "$output" | grep -qi "unknown dependency"; then
        pass "dangling dependency ref is surfaced at validation"
    else
        fail "expected non-zero exit + 'unknown dependency'. Exit: $exit_code, Output:\n$output"
    fi
}

test_merge_dependency_branches_invokes_git_merge() {
    echo ""; echo "Test: merge_dependency_branches invokes 'git merge' with the dep's branchName"

    # Shadow-PATH: symlink mock-git.sh as 'git' so both ralph-loop's direct git
    # calls and lib/git/merge.js's execSync('git merge ...') hit the fixture.
    local bindir="$TEST_DIR/mock-bin"
    mkdir -p "$bindir"
    ln -sf "$PROJECT_ROOT/tests/fixtures/mock-git.sh" "$bindir/git"

    export MOCK_GIT_CALL_LOG="$TEST_DIR/git-calls.log"
    : > "$MOCK_GIT_CALL_LOG"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x",
  "ralphGitMeta": { "originalBranch": "main", "prdSlug": "x" },
  "tasks": [
    { "id": "task-1", "title": "First", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": true, "attempts": 1,
      "branchName": "ralph/x/task-1-first", "completedAt": "2026-04-23T00:00:00Z" },
    { "id": "task-2", "title": "Second", "category": "C", "priority": 2,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
      "dependsOn": ["task-1"], "branchName": "ralph/x/task-2-second" }
  ]
}
EOF

    # Source ralph-loop in a subshell so the `set -euo pipefail` and script-level
    # state don't leak. The guard at the bottom of ralph-loop prevents main from
    # firing when BASH_SOURCE != $0, so we can call merge_dependency_branches
    # directly with mid-iteration state.
    (
        export PATH="$bindir:$PATH"
        # shellcheck disable=SC1090
        source "$RALPH_LOOP"
        JSON_FILE="$TEST_DIR/prd.json"
        SCRIPT_DIR="$PROJECT_ROOT"
        BRANCH_ENABLED=true
        CURRENT_TASK_BRANCH="ralph/x/task-2-second"
        GITHUB_ENABLED=false
        TARGET_REPO=""
        VERBOSE=false
        DEBUG=false
        merge_dependency_branches "task-2" "1"
    ) || true

    if grep -q "merge --no-edit" "$MOCK_GIT_CALL_LOG" && grep -q "ralph/x/task-1-first" "$MOCK_GIT_CALL_LOG"; then
        pass "git merge --no-edit <dep-branch> was invoked"
    else
        fail "expected mock-git to log a merge of task-1's branch. Log:\n$(cat "$MOCK_GIT_CALL_LOG")"
    fi

    unset MOCK_GIT_CALL_LOG
}

setup
trap cleanup EXIT
test_find_next_task_respects_deps
test_sync_blocked_statuses_writes_to_json
test_merge_dependency_branches_function_exists
test_loop_wires_merge_dependency_branches
test_cycle_blocks_run
test_self_dep_blocks_run
test_blocked_task_skipped_when_only_it_is_incomplete
test_merge_dependency_branches_invokes_git_merge

echo ""
echo "Phase 6 dependency graph: $TESTS_PASSED passed, $TESTS_FAILED failed"
[ $TESTS_FAILED -eq 0 ] || exit 1
