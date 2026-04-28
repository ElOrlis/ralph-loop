#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0
FAIL=0

assert() {
    local name="$1"; shift
    if "$@"; then echo "  ✓ $name"; PASS=$((PASS+1)); else echo "  ✗ $name"; FAIL=$((FAIL+1)); fi
}

setup_workdir() {
    WORKDIR=$(mktemp -d)
    SHIM_DIR="$WORKDIR/bin"
    mkdir -p "$SHIM_DIR"
    cat > "$SHIM_DIR/claude" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo "DONE"
EOF
    cat > "$SHIM_DIR/copilot" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo "DONE"
EOF
    chmod +x "$SHIM_DIR/claude" "$SHIM_DIR/copilot"
    cat > "$WORKDIR/prd.md" <<'EOF'
## Task: Demo task
**Category**: feat
**Priority**: 1
### Acceptance Criteria
- always pass `[shell: true]`
EOF
}

teardown_workdir() {
    rm -rf "$WORKDIR"
}

test_default_agent_is_claude() {
    setup_workdir
    PATH="$SHIM_DIR:$PATH" \
        "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" \
        --no-github --max-iterations 1 --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1
    grep -q '^Agent: claude$' "$WORKDIR/.state/progress.txt"
    local rc=$?
    teardown_workdir
    return $rc
}

test_explicit_copilot_agent() {
    setup_workdir
    PATH="$SHIM_DIR:$PATH" \
        "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" --agent copilot \
        --no-github --max-iterations 1 --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1
    grep -q '^Agent: copilot$' "$WORKDIR/.state/progress.txt"
    local rc=$?
    teardown_workdir
    return $rc
}

test_missing_agent_binary_fails_preflight() {
    setup_workdir
    rm "$SHIM_DIR/copilot"  # only claude available
    PATH="$SHIM_DIR:$PATH" \
        "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" --agent copilot \
        --no-github --max-iterations 1 --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1
    local rc=$?
    teardown_workdir
    [ "$rc" -ne 0 ]
}

test_mcp_log_uses_agent_suffix() {
    setup_workdir
    # Need mcpls shim for --mcp preflight to pass.
    cat > "$SHIM_DIR/mcpls" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
    chmod +x "$SHIM_DIR/mcpls"
    # Make the copilot shim mention "mcpls" so classifier marks degraded.
    cat > "$SHIM_DIR/copilot" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo "mcpls error"
EOF
    chmod +x "$SHIM_DIR/copilot"
    PATH="$SHIM_DIR:$PATH" \
        "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" --agent copilot --mcp \
        --no-github --max-iterations 1 --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1
    ls "$WORKDIR/.state/mcp-iteration-1.copilot.log" >/dev/null 2>&1
    local rc=$?
    teardown_workdir
    return $rc
}

echo "=== test-agent-selection.sh ==="
assert "default agent is claude" test_default_agent_is_claude
assert "explicit --agent copilot" test_explicit_copilot_agent
assert "missing binary fails preflight" test_missing_agent_binary_fails_preflight
assert "MCP log uses agent suffix" test_mcp_log_uses_agent_suffix

echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
