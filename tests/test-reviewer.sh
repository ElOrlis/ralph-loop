#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0; FAIL=0

assert() { local n="$1"; shift; if "$@"; then echo "  ✓ $n"; PASS=$((PASS+1)); else echo "  ✗ $n"; FAIL=$((FAIL+1)); fi }

setup() {
    WORKDIR=$(mktemp -d)
    SHIM_DIR="$WORKDIR/bin"; mkdir -p "$SHIM_DIR"
    cat > "$SHIM_DIR/claude" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo "DONE"
EOF
    cat > "$SHIM_DIR/copilot" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo "REVIEWER_SUGGESTION: try X"
EOF
    chmod +x "$SHIM_DIR"/*
    # Failing PRD criterion so reviewer fires.
    cat > "$WORKDIR/prd.md" <<'EOF'
## Task: Demo
**Category**: feat
**Priority**: 1
### Acceptance Criteria
- never pass `[shell: false]`
EOF
}
teardown() { rm -rf "$WORKDIR"; }

test_no_reviewer_logs_none() {
    setup
    PATH="$SHIM_DIR:$PATH" "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" \
        --no-github --max-iterations 1 --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1 || true
    grep -q '^Reviewer: none ' "$WORKDIR/.state/progress.txt"
    local rc=$?; teardown; return $rc
}

test_auto_reviewer_picks_other_agent() {
    setup
    PATH="$SHIM_DIR:$PATH" "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" \
        --no-github --max-iterations 1 --reviewer auto --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1 || true
    grep -q '^Reviewer: copilot ' "$WORKDIR/.state/progress.txt"
    local rc=$?; teardown; return $rc
}

test_reviewer_writes_feedback_file() {
    setup
    PATH="$SHIM_DIR:$PATH" "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" \
        --no-github --max-iterations 1 --reviewer copilot --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1 || true
    grep -q 'REVIEWER_SUGGESTION: try X' "$WORKDIR/.state/reviewer-feedback.txt"
    local rc=$?; teardown; return $rc
}

test_reviewer_skipped_when_all_pass() {
    setup
    # Replace failing criterion with a passing one.
    cat > "$WORKDIR/prd.md" <<'EOF'
## Task: Demo
**Category**: feat
**Priority**: 1
### Acceptance Criteria
- always pass `[shell: true]`
EOF
    PATH="$SHIM_DIR:$PATH" "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" \
        --no-github --max-iterations 1 --reviewer copilot --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1 || true
    grep -q '^Reviewer: copilot n/a' "$WORKDIR/.state/progress.txt"
    local rc=$?; teardown; return $rc
}

echo "=== test-reviewer.sh ==="
assert "no reviewer logs none" test_no_reviewer_logs_none
assert "auto reviewer picks copilot when claude is primary" test_auto_reviewer_picks_other_agent
assert "reviewer writes feedback file on failure" test_reviewer_writes_feedback_file
assert "reviewer skipped (n/a) when all criteria pass" test_reviewer_skipped_when_all_pass

echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
