#!/usr/bin/env bash
# tests/test-git-branching.sh — integration tests for Phase 5 branching + PR lifecycle
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
TESTS_PASSED=0; TESTS_FAILED=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
GIT_CLI="$PROJECT_ROOT/lib/git/index.js"
GH_CLI="$PROJECT_ROOT/lib/github/index.js"
MOCK_GIT="$SCRIPT_DIR/fixtures/mock-git.sh"

pass() { echo -e "${GREEN}✓ PASS:${NC} $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo -e "${RED}✗ FAIL:${NC} $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
info() { echo -e "${YELLOW}INFO:${NC} $1"; }

setup() {
    TEST_DIR=$(mktemp -d)
    MOCK_GIT_DIR=$(mktemp -d)
    cp "$MOCK_GIT" "$MOCK_GIT_DIR/git"
    chmod +x "$MOCK_GIT_DIR/git"
    export MOCK_GIT_CALL_LOG="$TEST_DIR/git-calls.log"
    : > "$MOCK_GIT_CALL_LOG"
    export PATH="$MOCK_GIT_DIR:$PATH"
    info "Test dir: $TEST_DIR; mock git: $MOCK_GIT_DIR/git"
}

cleanup() {
    rm -rf "$TEST_DIR" "$MOCK_GIT_DIR" 2>/dev/null || true
}
trap cleanup EXIT

test_cli_slugify() {
    echo ""; echo "Test 1: lib/git/index.js slugify"
    local output exit_code
    output=$(node "$GIT_CLI" slugify --input "Add JWT Validation!" 2>&1) && exit_code=0 || exit_code=$?
    if [ $exit_code -eq 0 ] && echo "$output" | jq -e '.slug == "add-jwt-validation"' >/dev/null; then
        pass "slugify returns correct slug"
    else
        fail "slugify. exit=$exit_code output=$output"
    fi
}

test_cli_branch_name() {
    echo ""; echo "Test 2: lib/git/index.js branch-name"
    local output
    output=$(node "$GIT_CLI" branch-name --prd-slug foo --task-id task-3 --title "Add X")
    if echo "$output" | jq -e '.branchName == "ralph/foo/task-3-add-x"' >/dev/null; then
        pass "branch-name composes correctly"
    else
        fail "branch-name. output=$output"
    fi
}

test_cli_current_branch_via_mock() {
    echo ""; echo "Test 3: current-branch reads mock git"
    local output
    output=$(node "$GIT_CLI" current-branch 2>&1)
    if echo "$output" | jq -e '.branch == "main"' >/dev/null; then
        pass "current-branch returns main"
    else
        fail "current-branch. output=$output"
    fi
    if grep -q "rev-parse --abbrev-ref HEAD" "$MOCK_GIT_CALL_LOG"; then
        pass "mock git logged the rev-parse call"
    else
        fail "mock git did not log rev-parse"
    fi
}

test_cli_ensure_branch_via_mock() {
    echo ""; echo "Test 4: ensure-branch creates branch when show-ref fails"
    local output
    output=$(node "$GIT_CLI" ensure-branch --name ralph/x/task-1-y --base main 2>&1)
    if echo "$output" | jq -e '.created == true' >/dev/null; then
        pass "ensure-branch reports created=true"
    else
        fail "ensure-branch. output=$output"
    fi
    if grep -q 'branch ralph/x/task-1-y main' "$MOCK_GIT_CALL_LOG"; then
        pass "mock git saw branch creation call"
    else
        fail "mock git never saw branch create"
    fi
}

test_cli_commit_iteration_via_mock() {
    echo ""; echo "Test 5: commit-iteration runs git add + git commit via mock"
    : > "$MOCK_GIT_CALL_LOG"
    local output
    output=$(node "$GIT_CLI" commit-iteration \
        --task-id task-3 --task-title "Add X" \
        --iteration 1 --max-iterations 10 \
        --pass-count 1 --total-count 2 \
        --issue 42 --status in-progress 2>&1)
    if echo "$output" | jq -e '.sha == "abc1234567890abcdef0000000000000000000"' >/dev/null; then
        pass "commit-iteration returns sha"
    else
        fail "commit-iteration. output=$output"
    fi
    if grep -q "^add -A" "$MOCK_GIT_CALL_LOG" && grep -q "^commit -F" "$MOCK_GIT_CALL_LOG"; then
        pass "commit-iteration issued add -A and commit -F"
    else
        fail "commit-iteration did not call add + commit. log=$(cat "$MOCK_GIT_CALL_LOG")"
    fi
}

test_no_branch_end_to_end() {
    echo ""; echo "Test 6: --no-branch skips all branching side effects"
    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "No branch test", "tasks": [{
    "id": "task-1", "title": "T", "category": "C", "priority": 1,
    "acceptanceCriteria": ["x"], "passes": false, "attempts": 0
  }]
}
EOF
    : > "$MOCK_GIT_CALL_LOG"
    local s output exit_code
    s=$(mktemp -d)
    output=$("$PROJECT_ROOT/ralph-loop" "$TEST_DIR/prd.json" --state-dir "$s" --no-branch --dry-run 2>&1) && exit_code=0 || exit_code=$?
    rm -rf "$s"
    if [ $exit_code -eq 0 ]; then
        pass "--no-branch + --dry-run exits 0"
    else
        fail "--no-branch + --dry-run failed. exit=$exit_code output=$output"
    fi
    # No commit/branch/push calls expected
    if grep -Eq "^(commit|push|branch|checkout)" "$MOCK_GIT_CALL_LOG"; then
        fail "branching side effects leaked under --no-branch. log=$(cat "$MOCK_GIT_CALL_LOG")"
    else
        pass "no git side effects under --no-branch"
    fi
}

setup
test_cli_slugify
test_cli_branch_name
test_cli_current_branch_via_mock
test_cli_ensure_branch_via_mock
test_cli_commit_iteration_via_mock
test_no_branch_end_to_end

echo ""
echo "────────────────────────────────────────────────"
echo "Phase 5 integration: $TESTS_PASSED passed, $TESTS_FAILED failed"
[ $TESTS_FAILED -eq 0 ] || exit 1
