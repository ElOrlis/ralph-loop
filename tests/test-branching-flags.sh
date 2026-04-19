#!/usr/bin/env bash
# tests/test-branching-flags.sh — --no-branch flag parsing
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
TESTS_PASSED=0; TESTS_FAILED=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RALPH_LOOP="$PROJECT_ROOT/ralph-loop"

pass() { echo -e "${GREEN}✓ PASS:${NC} $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo -e "${RED}✗ FAIL:${NC} $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
info() { echo -e "${YELLOW}INFO:${NC} $1"; }

setup() { TEST_DIR=$(mktemp -d); }
cleanup() { rm -rf "$TEST_DIR"; }

make_minimal_prd() {
    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x", "tasks": [{
    "id": "task-1", "title": "T", "category": "C", "priority": 1,
    "acceptanceCriteria": ["x"], "passes": false, "attempts": 0
  }]
}
EOF
}

test_no_branch_flag_parses() {
    echo ""; echo "Test: --no-branch flag is accepted"
    make_minimal_prd
    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --no-branch --dry-run 2>&1) && exit_code=0 || exit_code=$?
    if [ $exit_code -eq 0 ]; then pass "--no-branch accepted"; else fail "rejected --no-branch. Output: $output"; fi
}

test_help_documents_no_branch() {
    echo ""; echo "Test: --help documents --no-branch"
    local output
    output=$("$RALPH_LOOP" --help 2>&1)
    if echo "$output" | grep -q -- "--no-branch"; then pass "help documents --no-branch"
    else fail "--help does not mention --no-branch"; fi
}

test_no_github_implies_no_branch() {
    echo ""; echo "Test: --no-github implies BRANCH_ENABLED=false (debug-surface)"
    make_minimal_prd
    local output
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --no-github --debug --dry-run 2>&1)
    if echo "$output" | grep -q "BRANCH_ENABLED: false"; then pass "--no-github implies --no-branch"
    else fail "--no-github did not disable branching. Output: $output"; fi
}

test_snapshot_and_branch_functions_exist() {
    echo ""; echo "Test: ralph-loop defines snapshot_working_tree + ensure_task_branch + restore_working_tree"
    for fn in snapshot_working_tree ensure_task_branch restore_working_tree capture_original_branch git_branching_preflight; do
        if grep -q "^${fn}()" "$RALPH_LOOP"; then
            pass "defines ${fn}"
        else
            fail "missing function ${fn}"
        fi
    done
}

test_commit_iteration_defined() {
    echo ""; echo "Test: ralph-loop defines commit_iteration"
    if grep -q "^commit_iteration()" "$RALPH_LOOP"; then pass "defines commit_iteration"
    else fail "missing function commit_iteration"; fi
}

test_pr_helpers_defined() {
    echo ""; echo "Test: ralph-loop defines ensure_task_pr + mark_pr_ready + push_task_branch"
    for fn in ensure_task_pr mark_pr_ready push_task_branch; do
        if grep -q "^${fn}()" "$RALPH_LOOP"; then pass "defines ${fn}"
        else fail "missing function ${fn}"; fi
    done
}

setup
trap cleanup EXIT
test_no_branch_flag_parses
test_help_documents_no_branch
test_no_github_implies_no_branch
test_snapshot_and_branch_functions_exist
test_commit_iteration_defined
test_pr_helpers_defined

echo ""
echo "────────────────────────────────────────────────"
echo "Branching flags: $TESTS_PASSED passed, $TESTS_FAILED failed"
[ $TESTS_FAILED -eq 0 ] || exit 1
