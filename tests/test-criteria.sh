#!/usr/bin/env bash
# tests/test-criteria.sh — Integration tests for criteria verification

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CRITERIA_CLI="$PROJECT_ROOT/lib/criteria/index.js"

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

test_criteria_verify_all_pass() {
    echo ""
    echo "Test 1: criteria verify with all passing criteria"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "Test",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "acceptanceCriteria": [
      {"text": "true exits 0", "type": "shell", "command": "true", "expectExitCode": 0}
    ],
    "passes": false,
    "attempts": 0
  }]
}
EOF

    local output
    output=$(node "$CRITERIA_CLI" verify --task-file "$TEST_DIR/prd.json" --task-id task-1 2>&1)
    local exit_code=$?

    if [ "$exit_code" -eq 0 ]; then
        pass "Criteria verify exits 0 when all pass"
    else
        fail "Criteria verify exited $exit_code, expected 0. Output: $output"
    fi

    if echo "$output" | jq -e '.passed == true' > /dev/null 2>&1; then
        pass "Criteria verify returns passed:true"
    else
        fail "Criteria verify did not return passed:true. Output: $output"
    fi
}

test_criteria_verify_some_fail() {
    echo ""
    echo "Test 2: criteria verify with failing criteria"

    cat > "$TEST_DIR/prd2.json" << 'EOF'
{
  "title": "Test",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "acceptanceCriteria": [
      {"text": "true exits 0", "type": "shell", "command": "true", "expectExitCode": 0},
      {"text": "false exits 0", "type": "shell", "command": "false", "expectExitCode": 0}
    ],
    "passes": false,
    "attempts": 0
  }]
}
EOF

    local output
    output=$(node "$CRITERIA_CLI" verify --task-file "$TEST_DIR/prd2.json" --task-id task-1 2>&1) || true

    if echo "$output" | jq -e '.passed == false' > /dev/null 2>&1; then
        pass "Criteria verify returns passed:false when some fail"
    else
        fail "Criteria verify did not return passed:false. Output: $output"
    fi
}

test_criteria_verify_file_exists() {
    echo ""
    echo "Test 3: criteria verify with file-exists type"

    touch "$TEST_DIR/target-file.txt"

    cat > "$TEST_DIR/prd3.json" << EOF
{
  "title": "Test",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "acceptanceCriteria": [
      {"text": "File exists", "type": "file-exists", "path": "$TEST_DIR/target-file.txt"}
    ],
    "passes": false,
    "attempts": 0
  }]
}
EOF

    local output
    output=$(node "$CRITERIA_CLI" verify --task-file "$TEST_DIR/prd3.json" --task-id task-1 2>&1)

    if echo "$output" | jq -e '.passed == true' > /dev/null 2>&1; then
        pass "file-exists criterion passes for existing file"
    else
        fail "file-exists criterion failed. Output: $output"
    fi
}

test_criteria_normalize_legacy_strings() {
    echo ""
    echo "Test 4: criteria verify normalizes legacy string criteria"

    cat > "$TEST_DIR/prd4.json" << 'EOF'
{
  "title": "Test",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "acceptanceCriteria": [
      "Users can log in"
    ],
    "passes": false,
    "attempts": 0
  }]
}
EOF

    local output
    output=$(node "$CRITERIA_CLI" verify --task-file "$TEST_DIR/prd4.json" --task-id task-1 2>&1)
    local exit_code=$?

    if [ "$exit_code" -eq 0 ]; then
        pass "Legacy string criteria are normalized and skipped as manual"
    else
        fail "Legacy string criteria caused failure. Output: $output"
    fi
}

test_validate_json_valid() {
    echo ""
    echo "Test 5: validate-json with valid JSON"

    echo '{"valid": true}' > "$TEST_DIR/valid.json"
    local output
    output=$(node "$CRITERIA_CLI" validate-json --file "$TEST_DIR/valid.json" 2>&1)

    if echo "$output" | jq -e '.valid == true' > /dev/null 2>&1; then
        pass "validate-json reports valid JSON as valid"
    else
        fail "validate-json failed on valid JSON. Output: $output"
    fi
}

test_validate_json_invalid() {
    echo ""
    echo "Test 6: validate-json with invalid JSON"

    echo 'not json at all' > "$TEST_DIR/invalid.json"
    local output
    output=$(node "$CRITERIA_CLI" validate-json --file "$TEST_DIR/invalid.json" 2>&1) || true

    if echo "$output" | jq -e '.valid == false' > /dev/null 2>&1; then
        pass "validate-json reports invalid JSON as invalid"
    else
        fail "validate-json did not detect invalid JSON. Output: $output"
    fi
}

# Run tests
setup
trap cleanup EXIT

test_criteria_verify_all_pass
test_criteria_verify_some_fail
test_criteria_verify_file_exists
test_criteria_normalize_legacy_strings
test_validate_json_valid
test_validate_json_invalid

echo ""
echo "════════════════════════════════════════════════════════════════════════════"
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
echo "════════════════════════════════════════════════════════════════════════════"

if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
fi
