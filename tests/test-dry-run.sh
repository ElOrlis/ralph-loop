#!/usr/bin/env bash
# tests/test-dry-run.sh — Integration tests for --dry-run flag

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RALPH_LOOP="$PROJECT_ROOT/ralph-loop"

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
    STATE_TMP=$(mktemp -d)
    info "Created test directory: $TEST_DIR"
}

cleanup() {
    if [ -n "$TEST_DIR" ] && [ -d "$TEST_DIR" ]; then
        rm -rf "$TEST_DIR"
        info "Cleaned up test directory"
    fi
    if [ -n "$STATE_TMP" ] && [ -d "$STATE_TMP" ]; then
        rm -rf "$STATE_TMP"
    fi
}

run_ralph() {
    # Run ralph-loop from the project root so relative paths (lib/) resolve correctly
    (cd "$PROJECT_ROOT" && "$RALPH_LOOP" "$@")
}

test_dry_run_shows_prompt() {
    echo ""
    echo "Test 1: --dry-run shows prompt and exits"

    local s
    s=$(mktemp -d)

    cat > "$TEST_DIR/test.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "description": "A test task.",
    "acceptanceCriteria": ["Criterion 1"],
    "passes": false,
    "completedAt": null,
    "attempts": 0
  }]
}
EOF

    output=$(run_ralph "$TEST_DIR/test.json" --state-dir "$s" --dry-run 2>&1) || true

    if echo "$output" | grep -q "task-1\|Test task"; then
        pass "--dry-run displays task information"
    else
        fail "--dry-run did not display task information. Output: $output"
    fi

    rm -rf "$s"
}

test_dry_run_does_not_call_claude() {
    echo ""
    echo "Test 2: --dry-run does not call Claude API"

    local s
    s=$(mktemp -d)

    cat > "$TEST_DIR/test2.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "description": "A test task.",
    "acceptanceCriteria": ["Criterion 1"],
    "passes": false,
    "completedAt": null,
    "attempts": 0
  }]
}
EOF

    output=$(run_ralph "$TEST_DIR/test2.json" --state-dir "$s" --dry-run 2>&1) || true

    if echo "$output" | grep -qi "calling claude\|API call"; then
        fail "--dry-run appears to call Claude API"
    else
        pass "--dry-run does not call Claude API"
    fi

    rm -rf "$s"
}

test_no_github_flag_accepted() {
    echo ""
    echo "Test 3: --no-github flag is accepted without error"

    local s
    s=$(mktemp -d)

    cat > "$TEST_DIR/test3.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "description": "A test task.",
    "acceptanceCriteria": ["Criterion 1"],
    "passes": false,
    "completedAt": null,
    "attempts": 0
  }]
}
EOF

    output=$(run_ralph "$TEST_DIR/test3.json" --state-dir "$s" --no-github --dry-run 2>&1) || true

    if echo "$output" | grep -qi "unknown option"; then
        fail "--no-github flag not recognized"
    else
        pass "--no-github flag accepted"
    fi

    rm -rf "$s"
}

# Run tests
setup
trap cleanup EXIT

test_dry_run_shows_prompt
test_dry_run_does_not_call_claude
test_no_github_flag_accepted

echo ""
echo "════════════════════════════════════════════════════════════════════════════"
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
echo "════════════════════════════════════════════════════════════════════════════"

if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
fi
