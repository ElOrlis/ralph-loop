#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0; FAIL=0

assert() { local n="$1"; shift; if "$@"; then echo "  ✓ $n"; PASS=$((PASS+1)); else echo "  ✗ $n"; FAIL=$((FAIL+1)); fi }

setup() {
    WORKDIR=$(mktemp -d)
    SHIM_DIR="$WORKDIR/bin"; mkdir -p "$SHIM_DIR"
    for a in claude copilot; do
        cat > "$SHIM_DIR/$a" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null; echo DONE
EOF
        chmod +x "$SHIM_DIR/$a"
    done
    cat > "$WORKDIR/prd.md" <<'EOF'
## Task: Demo
**Category**: feat
**Priority**: 1
### Acceptance Criteria
- always pass `[shell: true]`
EOF
}
teardown() { rm -rf "$WORKDIR"; }

test_resume_with_different_agent_warns() {
    setup
    # First run with claude.
    PATH="$SHIM_DIR:$PATH" "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" \
        --no-github --max-iterations 1 --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out1.log" 2>&1
    # Resume with copilot. Use --max-iterations 2 so the resume check runs
    # (max-iterations 1 would error before crosscheck_issues fires the warning).
    PATH="$SHIM_DIR:$PATH" "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" \
        --no-github --resume --max-iterations 2 --agent copilot --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out2.log" 2>&1 || true
    grep -q "Previous run used agent 'claude'" "$WORKDIR/out2.log"
    local rc=$?; teardown; return $rc
}

echo "=== test-agent-resume.sh ==="
assert "resume with switched agent emits warning" test_resume_with_different_agent_warns

echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
