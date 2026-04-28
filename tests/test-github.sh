#!/usr/bin/env bash
# tests/test-github.sh — Integration tests for GitHub module CLI

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
GITHUB_CLI="$PROJECT_ROOT/lib/github/index.js"

pass() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

info() {
    echo -e "${YELLOW}INFO:${NC} $1"
}

setup() {
    TEST_DIR=$(mktemp -d)
    info "Created test directory: $TEST_DIR"
}

cleanup() {
    if [ -n "$TEST_DIR" ] && [ -d "$TEST_DIR" ]; then
        rm -rf "$TEST_DIR"
        info "Cleaned up test directory"
    fi
}

# --- Tests ---

test_resolve_repo_with_cli_flag() {
    echo ""
    echo "Test 1: resolve-repo with --repo flag"

    local output exit_code
    output=$(node "$GITHUB_CLI" resolve-repo --repo test-owner/test-repo 2>&1) && exit_code=0 || exit_code=$?

    if [ "$exit_code" -eq 0 ]; then
        pass "resolve-repo exits 0 with valid --repo"
    else
        fail "resolve-repo exited $exit_code, expected 0. Output: $output"
    fi

    if echo "$output" | jq -e '.repo == "test-owner/test-repo"' > /dev/null 2>&1; then
        pass "resolve-repo returns correct repo"
    else
        fail "resolve-repo did not return expected repo. Output: $output"
    fi
}

test_resolve_repo_with_prd_field() {
    echo ""
    echo "Test 2: resolve-repo from PRD repository field"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "Test PRD",
  "repository": "prd-owner/prd-repo",
  "tasks": []
}
EOF

    local output exit_code
    output=$(node "$GITHUB_CLI" resolve-repo --task-file "$TEST_DIR/prd.json" 2>&1) && exit_code=0 || exit_code=$?

    if [ "$exit_code" -eq 0 ]; then
        pass "resolve-repo exits 0 with PRD repository field"
    else
        fail "resolve-repo exited $exit_code. Output: $output"
    fi

    if echo "$output" | jq -e '.repo == "prd-owner/prd-repo"' > /dev/null 2>&1; then
        pass "resolve-repo returns PRD repo"
    else
        fail "resolve-repo did not return PRD repo. Output: $output"
    fi
}

test_resolve_repo_cli_overrides_prd() {
    echo ""
    echo "Test 3: --repo flag overrides PRD repository field"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "Test PRD",
  "repository": "prd-owner/prd-repo",
  "tasks": []
}
EOF

    local output
    output=$(node "$GITHUB_CLI" resolve-repo --repo cli-owner/cli-repo --task-file "$TEST_DIR/prd.json" 2>&1)

    if echo "$output" | jq -e '.repo == "cli-owner/cli-repo"' > /dev/null 2>&1; then
        pass "CLI --repo overrides PRD repository field"
    else
        fail "CLI --repo did not override. Output: $output"
    fi
}

test_resolve_repo_invalid_format() {
    echo ""
    echo "Test 4: resolve-repo rejects invalid format"

    local output exit_code
    output=$(node "$GITHUB_CLI" resolve-repo --repo "no-slash" 2>&1) && exit_code=0 || exit_code=$?

    if [ "$exit_code" -ne 0 ]; then
        pass "resolve-repo rejects invalid format"
    else
        fail "resolve-repo accepted invalid format. Output: $output"
    fi
}

test_unknown_command() {
    echo ""
    echo "Test 5: unknown command exits with error"

    local output exit_code
    output=$(node "$GITHUB_CLI" nonsense 2>&1) && exit_code=0 || exit_code=$?

    if [ "$exit_code" -ne 0 ]; then
        pass "Unknown command exits non-zero"
    else
        fail "Unknown command exited 0. Output: $output"
    fi
}

test_repo_flag_in_ralph_loop() {
    echo ""
    echo "Test 6: --repo flag accepted by ralph-loop"

    # Create a fresh PRD in temp dir to avoid progress file prompts
    cat > "$TEST_DIR/test-prd.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "acceptanceCriteria": ["Test criterion"],
    "passes": false,
    "completedAt": null,
    "attempts": 0
  }]
}
EOF

    local s
    s=$(mktemp -d)
    local output exit_code
    output=$("$PROJECT_ROOT/ralph-loop" "$TEST_DIR/test-prd.json" --state-dir "$s" --dry-run --repo test/repo 2>&1) && exit_code=0 || exit_code=$?
    rm -rf "$s"

    if echo "$output" | grep -q "Unknown option: --repo"; then
        fail "--repo flag was rejected as unknown option. Output: $output"
    elif echo "$output" | grep -q "Arguments validated successfully"; then
        pass "--repo flag accepted by ralph-loop with --dry-run"
    else
        fail "--repo flag caused unexpected error. Exit: $exit_code Output: $output"
    fi
}

test_no_github_skips_resolution() {
    echo ""
    echo "Test 7: --no-github skips repo resolution"

    cat > "$TEST_DIR/test-prd2.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "acceptanceCriteria": ["Test criterion"],
    "passes": false,
    "completedAt": null,
    "attempts": 0
  }]
}
EOF

    local s2
    s2=$(mktemp -d)
    local output
    output=$("$PROJECT_ROOT/ralph-loop" "$TEST_DIR/test-prd2.json" --state-dir "$s2" --dry-run --no-github --verbose 2>&1)
    rm -rf "$s2"

    if echo "$output" | grep -q "Target GitHub repo"; then
        fail "--no-github should skip repo resolution"
    else
        pass "--no-github skips repo resolution"
    fi
}

# --- Main ---

trap cleanup EXIT
setup

echo "═══════════════════════════════════════════════════"
echo " GitHub Module Integration Tests"
echo "═══════════════════════════════════════════════════"

test_resolve_repo_with_cli_flag
test_resolve_repo_with_prd_field
test_resolve_repo_cli_overrides_prd
test_resolve_repo_invalid_format
test_unknown_command
test_repo_flag_in_ralph_loop
test_no_github_skips_resolution

echo ""
echo "═══════════════════════════════════════════════════"
echo " Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
echo "═══════════════════════════════════════════════════"

if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
fi

exit 0
