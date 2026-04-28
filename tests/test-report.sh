#!/usr/bin/env bash

# Test suite for --report flag

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

pass() { echo -e "${GREEN}✓ PASS:${NC} $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo -e "${RED}✗ FAIL:${NC} $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
info() { echo -e "${YELLOW}→${NC} $1"; }

SANDBOXES=()
cleanup_all() {
    local d
    for d in "${SANDBOXES[@]}"; do
        [ -d "$d" ] && rm -rf "$d"
    done
}
trap cleanup_all EXIT

make_sandbox() {
    local sandbox
    sandbox=$(mktemp -d)
    SANDBOXES+=("$sandbox")
    echo "$sandbox"
}

write_fixture() {
    # write_fixture <sandbox>
    # Puts prd.json and progress.txt in the sandbox dir, which is also used
    # as --state-dir so ralph-loop finds them at the expected paths.
    cat > "$1/prd.json" <<'EOF'
{
  "title": "Test PRD",
  "tasks": [
    {
      "id": "task-1",
      "title": "Backend feature",
      "category": "backend",
      "priority": 1,
      "passes": true,
      "attempts": 2,
      "acceptanceCriteria": [{"text": "Tests pass", "type": "manual"}],
      "criteriaResults": [
        {"criterion": 0, "passed": true, "attempts": 1, "error": "boom"}
      ],
      "completedAt": "2026-04-25T10:00:00Z"
    },
    {
      "id": "task-2",
      "title": "Frontend feature",
      "category": "frontend",
      "priority": 2,
      "passes": false,
      "attempts": 0,
      "acceptanceCriteria": [{"text": "UI loads", "type": "manual"}],
      "status": "blocked",
      "blockedBy": ["task-1"],
      "dependsOn": ["task-1"]
    }
  ]
}
EOF
    cat > "$1/progress.txt" <<'EOF'
┌────────┐
│ ITERATION 1/15
│ Working on: task-1 - Backend feature
└────────┘
MCP: ok
┌────────┐
│ ITERATION 2/15
│ Working on: task-1 - Backend feature
└────────┘
MCP: degraded
EOF
}

# ---------------------------------------------------------------
info "Test: --report prints status report and exits 0"
sandbox=$(make_sandbox)
write_fixture "$sandbox"

set +e
output=$("$RALPH_LOOP" "$sandbox/prd.json" --state-dir "$sandbox" --report --no-github 2>&1)
exit_code=$?
set -e

if [ $exit_code -eq 0 ]; then
    pass "--report exits 0"
else
    fail "--report exited $exit_code"
fi

for needle in "PRD STATUS REPORT" "Run Summary" "Per-Task Breakdown" "task-1" "task-2" "Iterations Used:  2"; do
    if echo "$output" | grep -q "$needle"; then
        pass "report contains '$needle'"
    else
        fail "report missing '$needle'. Output: $output"
    fi
done

# ---------------------------------------------------------------
info "Test: --report shows MCP Health when MCP lines present"
if echo "$output" | grep -q "MCP Health"; then
    pass "report includes MCP Health section"
else
    fail "report missing MCP Health section"
fi

# ---------------------------------------------------------------
info "Test: --report and --analyze-prd are mutually exclusive"
set +e
err=$("$RALPH_LOOP" "$sandbox/prd.json" --state-dir "$sandbox" --report --analyze-prd --no-github 2>&1)
set -e
if echo "$err" | grep -qi "mutually exclusive\|cannot be used together\|conflict"; then
    pass "--report + --analyze-prd produces conflict error"
else
    fail "no error for --report + --analyze-prd combo. Got: $err"
fi

# ---------------------------------------------------------------
info "Test: --report implies --no-github (no need to pass it explicitly)"
sandbox=$(make_sandbox)
write_fixture "$sandbox"

# Stub gh so we can detect any unexpected GitHub call
stub_dir="$sandbox/bin"
mkdir -p "$stub_dir"
cat > "$stub_dir/gh" <<'STUB'
#!/usr/bin/env bash
echo "UNEXPECTED gh INVOCATION: $*" >&2
exit 1
STUB
chmod +x "$stub_dir/gh"

set +e
output=$(PATH="$stub_dir:$PATH" "$RALPH_LOOP" "$sandbox/prd.json" --state-dir "$sandbox" --report 2>&1)
exit_code=$?
set -e

if [ $exit_code -eq 0 ]; then
    pass "--report (without --no-github) exits 0"
else
    fail "--report alone exited $exit_code. Output: $output"
fi

if echo "$output" | grep -q "UNEXPECTED gh INVOCATION"; then
    fail "--report invoked gh unexpectedly. Output: $output"
else
    pass "--report did not call gh"
fi

# ---------------------------------------------------------------
echo ""
echo "─────────────────────────────────────────────"
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
echo "─────────────────────────────────────────────"
[ $TESTS_FAILED -eq 0 ] || exit 1
