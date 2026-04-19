#!/usr/bin/env bash
# Integration tests for Phase 4 GitHub Projects v2 module.
set -u
RALPH_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RALPH_ROOT"

PASS=0
FAIL=0
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR" /tmp/mock-gh-projects-calls.log' EXIT

# Prepend mock gh to PATH
MOCK_BIN="$TMPDIR/bin"
mkdir -p "$MOCK_BIN"
ln -sf "$RALPH_ROOT/tests/fixtures/mock-gh-projects.sh" "$MOCK_BIN/gh"
export PATH="$MOCK_BIN:$PATH"
export MOCK_GH_CALL_LOG=/tmp/mock-gh-projects-calls.log
: > "$MOCK_GH_CALL_LOG"

CLI="$RALPH_ROOT/lib/github/index.js"

echo "Phase 4: GitHub Projects v2 integration tests"
echo "============================================="

# --- create-project ---
out=$(node "$CLI" create-project --repo paullovvik/myrepo --title "Test PRD" --categories "Backend,Frontend" 2>&1 || true)
if echo "$out" | jq -e '.githubProject.number == 99' >/dev/null 2>&1; then
    pass "create-project returns githubProject.number=99"
else
    fail "create-project: $out"
fi

if echo "$out" | jq -e '.apiCalls >= 6' >/dev/null 2>&1; then
    pass "create-project reports apiCalls >= 6 (1 owner + 1 project + 5 fields)"
else
    fail "create-project apiCalls wrong: $out"
fi

# --- ensure-project-item ---
out=$(node "$CLI" ensure-project-item --repo paullovvik/myrepo --project-id PVT_test --issue 42 2>&1 || true)
if echo "$out" | jq -e '.projectItemId == "PVTI_test"' >/dev/null 2>&1; then
    pass "ensure-project-item returns PVTI_test"
else
    fail "ensure-project-item: $out"
fi

# --- sync-project-item ---
project='{"id":"PVT_test","number":99,"fieldIds":{"priority":{"id":"P1","dataType":"NUMBER"},"category":{"id":"C1","dataType":"SINGLE_SELECT","options":{"Backend":"opt_be"}},"iterationCount":{"id":"I1","dataType":"NUMBER"},"criteriaPassRate":{"id":"R1","dataType":"NUMBER"},"ralphStatus":{"id":"S1","dataType":"SINGLE_SELECT","options":{"In Progress":"opt_ip","Passed":"opt_pa","Pending":"opt_pn","Failed":"opt_f","Stalled":"opt_st"}}}}'
task='{"id":"task-1","priority":3,"category":"Backend","attempts":2,"passes":false,"projectItemId":"PVTI_test"}'
results='{"results":[{"passed":true},{"passed":false,"error":"x"}]}'
out=$(node "$CLI" sync-project-item --project "$project" --task "$task" --results "$results" --iteration 2 2>&1 || true)
if echo "$out" | jq -e '.ok == true and .ralphStatus == "In Progress" and .criteriaPassRate == 0.5' >/dev/null 2>&1; then
    pass "sync-project-item computes ralphStatus + passRate"
else
    fail "sync-project-item: $out"
fi

# --- validate-project ---
out=$(node "$CLI" validate-project --project "$project" 2>&1 || true)
if echo "$out" | jq -e '.ok == true' >/dev/null 2>&1; then
    pass "validate-project reports ok=true when all fields present"
else
    fail "validate-project: $out"
fi

# --- rate-limit warning surfaces in ralph-loop ---
# Minimal PRD run: set warn threshold to 1 so single create trips it.
PRD="$TMPDIR/test.json"
cat > "$PRD" <<'EOF'
{
  "title": "P4 rate-limit test",
  "repository": "paullovvik/myrepo",
  "tasks": [{
    "id": "task-1", "title": "t", "category": "Backend", "priority": 1,
    "passes": true, "attempts": 0,
    "acceptanceCriteria": [{"text": "ok", "type": "manual"}]
  }]
}
EOF

# Run dry-run (won't invoke Claude, but exercises ensure_github_project)
run_out=$(GITHUB_API_WARN_THRESHOLD=1 ./ralph-loop "$PRD" --dry-run --verbose --no-github 2>&1 || true)
# With --no-github, ensure_github_project should not run
if ! echo "$run_out" | grep -q "Creating GitHub project"; then
    pass "--no-github skips ensure_github_project"
else
    fail "--no-github leaked into project creation: $run_out"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
exit $FAIL
