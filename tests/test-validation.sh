#!/usr/bin/env bash

# Test suite for PRD validation logic

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
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

# Setup test environment
setup() {
    TEST_DIR=$(mktemp -d)
    info "Created test directory: $TEST_DIR"
}

# Cleanup test environment
cleanup() {
    if [ -n "$TEST_DIR" ] && [ -d "$TEST_DIR" ]; then
        rm -rf "$TEST_DIR"
        info "Cleaned up test directory"
    fi
}

# Test 1: Validates required top-level fields
test_required_top_level_fields() {
    echo ""
    echo "Test 1: Required top-level fields validation"

    # Missing title
    cat > "$TEST_DIR/missing-title.json" << 'EOF'
{
  "tasks": []
}
EOF

    ../ralph-loop "$TEST_DIR/missing-title.json" > "$TEST_DIR/output1.txt" 2>&1 || true

    if grep -qi "title" "$TEST_DIR/output1.txt" && \
       grep -qi "error\|missing\|required" "$TEST_DIR/output1.txt"; then
        pass "Detects missing title field"
    else
        fail "Did not detect missing title field"
    fi

    # Missing tasks array
    cat > "$TEST_DIR/missing-tasks.json" << 'EOF'
{
  "title": "Test PRD"
}
EOF

    ../ralph-loop "$TEST_DIR/missing-tasks.json" > "$TEST_DIR/output2.txt" 2>&1 || true

    if grep -qi "tasks" "$TEST_DIR/output2.txt" && \
       grep -qi "error\|missing\|required" "$TEST_DIR/output2.txt"; then
        pass "Detects missing tasks array"
    else
        fail "Did not detect missing tasks array"
    fi
}

# Test 2: Validates required task fields
test_required_task_fields() {
    echo ""
    echo "Test 2: Required task fields validation"

    # Missing priority field
    cat > "$TEST_DIR/missing-priority.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": [
    {
      "id": "task-1",
      "title": "Test Task",
      "category": "Testing",
      "acceptanceCriteria": ["Criterion 1"],
      "passes": false
    }
  ]
}
EOF

    ../ralph-loop "$TEST_DIR/missing-priority.json" > "$TEST_DIR/output3.txt" 2>&1 || true

    if grep -qi "priority" "$TEST_DIR/output3.txt" && \
       grep -qi "error\|missing\|required" "$TEST_DIR/output3.txt"; then
        pass "Detects missing priority field"
    else
        fail "Did not detect missing priority field"
    fi

    # Missing acceptanceCriteria field
    cat > "$TEST_DIR/missing-criteria.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": [
    {
      "id": "task-1",
      "title": "Test Task",
      "category": "Testing",
      "priority": 1,
      "passes": false
    }
  ]
}
EOF

    ../ralph-loop "$TEST_DIR/missing-criteria.json" > "$TEST_DIR/output4.txt" 2>&1 || true

    if grep -qi "acceptance" "$TEST_DIR/output4.txt" && \
       grep -qi "error\|missing\|required" "$TEST_DIR/output4.txt"; then
        pass "Detects missing acceptanceCriteria field"
    else
        fail "Did not detect missing acceptanceCriteria field"
    fi
}

# Test 3: Verifies priority values are unique integers
test_unique_priorities() {
    echo ""
    echo "Test 3: Unique priority validation"

    # Duplicate priorities
    cat > "$TEST_DIR/duplicate-priority.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": [
    {
      "id": "task-1",
      "title": "First Task",
      "category": "Testing",
      "priority": 1,
      "acceptanceCriteria": ["Criterion 1"],
      "passes": false
    },
    {
      "id": "task-2",
      "title": "Second Task",
      "category": "Testing",
      "priority": 1,
      "acceptanceCriteria": ["Criterion 2"],
      "passes": false
    }
  ]
}
EOF

    ../ralph-loop "$TEST_DIR/duplicate-priority.json" > "$TEST_DIR/output5.txt" 2>&1 || true

    if grep -qi "priority" "$TEST_DIR/output5.txt" && \
       grep -qi "duplicate\|unique" "$TEST_DIR/output5.txt"; then
        pass "Detects duplicate priority values"
    else
        fail "Did not detect duplicate priority values"
    fi
}

# Test 4: Ensures acceptanceCriteria arrays are not empty
test_empty_acceptance_criteria() {
    echo ""
    echo "Test 4: Empty acceptance criteria validation"

    cat > "$TEST_DIR/empty-criteria.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": [
    {
      "id": "task-1",
      "title": "Test Task",
      "category": "Testing",
      "priority": 1,
      "acceptanceCriteria": [],
      "passes": false
    }
  ]
}
EOF

    ../ralph-loop "$TEST_DIR/empty-criteria.json" > "$TEST_DIR/output6.txt" 2>&1 || true

    if grep -qi "acceptance" "$TEST_DIR/output6.txt" && \
       grep -qi "empty\|must have\|required" "$TEST_DIR/output6.txt"; then
        pass "Detects empty acceptanceCriteria array"
    else
        fail "Did not detect empty acceptanceCriteria array"
    fi
}

# Test 5: Shows clear error messages with task IDs
test_error_messages() {
    echo ""
    echo "Test 5: Clear error messages with task identification"

    cat > "$TEST_DIR/invalid-task.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": [
    {
      "id": "task-1",
      "title": "Valid Task",
      "category": "Testing",
      "priority": 1,
      "acceptanceCriteria": ["Criterion"],
      "passes": false
    },
    {
      "id": "task-2",
      "title": "Invalid Task",
      "category": "Testing",
      "acceptanceCriteria": ["Criterion"],
      "passes": false
    }
  ]
}
EOF

    ../ralph-loop "$TEST_DIR/invalid-task.json" > "$TEST_DIR/output7.txt" 2>&1 || true

    if grep -qi "task-2\|Invalid Task" "$TEST_DIR/output7.txt"; then
        pass "Error message identifies specific task"
    else
        fail "Error message does not identify specific task"
    fi
}

# Test 6: Exits with code 1 on validation failure
test_exit_code() {
    echo ""
    echo "Test 6: Exit code on validation failure"

    cat > "$TEST_DIR/invalid.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": []
}
EOF

    if ../ralph-loop "$TEST_DIR/invalid.json" > /dev/null 2>&1; then
        fail "Did not exit with non-zero code on invalid PRD"
    else
        pass "Exits with non-zero code on validation failure"
    fi
}

# Test 7: Passes validation with valid PRD
test_valid_prd() {
    echo ""
    echo "Test 7: Valid PRD passes validation"

    cat > "$TEST_DIR/valid.json" << 'EOF'
{
  "title": "Valid Test PRD",
  "tasks": [
    {
      "id": "task-1",
      "title": "First Task",
      "category": "Testing",
      "priority": 1,
      "description": "Test description",
      "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
      "passes": false,
      "attempts": 0,
      "completedAt": null
    },
    {
      "id": "task-2",
      "title": "Second Task",
      "category": "Testing",
      "priority": 2,
      "description": "Test description",
      "acceptanceCriteria": ["Criterion 1"],
      "passes": false,
      "attempts": 0,
      "completedAt": null
    }
  ]
}
EOF

    # Run with max-iterations 1 to prevent actual execution
    ../ralph-loop "$TEST_DIR/valid.json" --max-iterations 1 > "$TEST_DIR/output8.txt" 2>&1 || true

    if ! grep -qi "validation.*error\|invalid" "$TEST_DIR/output8.txt"; then
        pass "Valid PRD passes validation"
    else
        fail "Valid PRD failed validation"
    fi
}

# Test 8: Validates priority is an integer
test_priority_type() {
    echo ""
    echo "Test 8: Priority type validation"

    cat > "$TEST_DIR/string-priority.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": [
    {
      "id": "task-1",
      "title": "Test Task",
      "category": "Testing",
      "priority": "high",
      "acceptanceCriteria": ["Criterion"],
      "passes": false
    }
  ]
}
EOF

    ../ralph-loop "$TEST_DIR/string-priority.json" > "$TEST_DIR/output9.txt" 2>&1 || true

    if grep -qi "priority" "$TEST_DIR/output9.txt" && \
       grep -qi "integer\|number\|invalid" "$TEST_DIR/output9.txt"; then
        pass "Detects non-integer priority value"
    else
        fail "Did not detect non-integer priority value"
    fi
}

# Test 9: githubProject requires all required fields
test_githubproject_requires_all_fields() {
    echo ""
    echo "Test 9: githubProject requires all required fields"

    cat > "$TEST_DIR/githubproject-partial.json" << 'EOF'
{
  "title": "t",
  "githubProject": { "number": 1 },
  "tasks": [
    {
      "id": "t1", "title": "x", "category": "c",
      "priority": 1, "passes": false,
      "acceptanceCriteria": ["a"]
    }
  ]
}
EOF

    ../ralph-loop "$TEST_DIR/githubproject-partial.json" --analyze-prd > "$TEST_DIR/output9a.txt" 2>&1 || true

    if grep -q "missing required field" "$TEST_DIR/output9a.txt"; then
        pass "Detects githubProject missing required fields"
    else
        fail "expected missing-field error for incomplete githubProject"
    fi
}

# Test 10: task projectItemId must be a string
test_projectitem_id_must_be_string() {
    echo ""
    echo "Test 10: task projectItemId must be a string"

    cat > "$TEST_DIR/projectitemid-number.json" << 'EOF'
{ "title": "t", "tasks": [{ "id": "t1", "title": "x", "category": "c", "priority": 1, "passes": false, "acceptanceCriteria": ["a"], "projectItemId": 123 }] }
EOF

    ../ralph-loop "$TEST_DIR/projectitemid-number.json" > "$TEST_DIR/output10.txt" 2>&1 || true

    if grep -q "non-string projectItemId" "$TEST_DIR/output10.txt"; then
        pass "Detects non-string projectItemId"
    else
        fail "expected projectItemId error for numeric projectItemId"
    fi
}

# Test 11: Accepts optional ralphGitMeta + task-level branchName/prNumber/prUrl
test_accepts_ralph_git_meta() {
    echo ""
    echo "Test 11: accepts optional ralphGitMeta + task-level branchName/prNumber/prUrl"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "Phase 5 schema",
  "ralphGitMeta": { "originalBranch": "main", "prdSlug": "phase-5-schema" },
  "tasks": [{
    "id": "task-1", "title": "T", "category": "C", "priority": 1,
    "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
    "branchName": "ralph/phase-5-schema/task-1-t",
    "prNumber": 17,
    "prUrl": "https://github.com/o/r/pull/17"
  }]
}
EOF

    local output exit_code
    output=$("../ralph-loop" "$TEST_DIR/prd.json" --dry-run 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -eq 0 ]; then
        pass "accepts ralphGitMeta + branch fields"
    else
        fail "rejected valid PRD with Phase 5 fields. Output: $output"
    fi
}

# Test 12: Rejects non-string branchName
test_rejects_bad_branch_name_type() {
    echo ""
    echo "Test 12: rejects non-string branchName"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "Bad", "tasks": [{
    "id": "task-1", "title": "T", "category": "C", "priority": 1,
    "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
    "branchName": 42
  }]
}
EOF

    local output exit_code
    output=$("../ralph-loop" "$TEST_DIR/prd.json" --dry-run 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -ne 0 ] && echo "$output" | grep -q "branchName"; then
        pass "rejects non-string branchName"
    else
        fail "should reject non-string branchName. Exit: $exit_code, Output: $output"
    fi
}

# Main test execution
main() {
    echo "========================================"
    echo "PRD Validation Test Suite"
    echo "========================================"

    setup

    test_required_top_level_fields
    test_required_task_fields
    test_unique_priorities
    test_empty_acceptance_criteria
    test_error_messages
    test_exit_code
    test_valid_prd
    test_priority_type
    test_githubproject_requires_all_fields
    test_projectitem_id_must_be_string
    test_accepts_ralph_git_meta
    test_rejects_bad_branch_name_type

    cleanup

    echo ""
    echo "========================================"
    echo "Test Results"
    echo "========================================"
    echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
    echo -e "${RED}Failed: $TESTS_FAILED${NC}"
    echo "========================================"

    if [ $TESTS_FAILED -eq 0 ]; then
        echo -e "${GREEN}All tests passed!${NC}"
        exit 0
    else
        echo -e "${RED}Some tests failed.${NC}"
        exit 1
    fi
}

main "$@"
