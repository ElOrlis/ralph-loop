#!/usr/bin/env bash

# Test suite for --mcp flag, preflight, config generation, and status surfacing

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

# Each test runs in an isolated temp dir with a sandboxed PATH so we can
# control whether 'mcpls' and 'claude' are present. We always keep core
# tools (jq, node, git, gh) by prepending the stub dir to the real PATH.
make_sandbox() {
    local sandbox
    sandbox=$(mktemp -d)
    mkdir -p "$sandbox/bin"
    SANDBOXES+=("$sandbox")
    echo "$sandbox"
}

write_stub() {
    # write_stub <sandbox> <name> <body>
    local path="$1/bin/$2"
    cat > "$path" <<EOF
#!/usr/bin/env bash
$3
EOF
    chmod +x "$path"
}

minimal_prd() {
    # Emits a minimal PRD JSON file with one always-passing manual criterion
    cat > "$1" <<'EOF'
{
  "title": "MCP Test PRD",
  "tasks": [
    {
      "id": "task-1",
      "title": "Demo",
      "category": "demo",
      "priority": 1,
      "acceptanceCriteria": [{"text": "Manual check", "type": "manual"}],
      "passes": false
    }
  ]
}
EOF
}

# ---------------------------------------------------------------
info "Test: --mcp without mcpls on PATH aborts with clear error"

sandbox=$(make_sandbox)
prd="$sandbox/prd.json"
minimal_prd "$prd"

# Build a PATH that keeps core tools but excludes any directory that
# contains mcpls, ensuring the preflight truly cannot find it.
_filtered_path="$sandbox/bin"
IFS=: read -ra _path_parts <<< "$PATH"
for _dir in "${_path_parts[@]}"; do
    [ -x "$_dir/mcpls" ] && continue
    _filtered_path="$_filtered_path:$_dir"
done

output=$(PATH="$_filtered_path" "$RALPH_LOOP" "$prd" --state-dir "$sandbox" --mcp --max-iterations 1 --no-github 2>&1 || true)

if echo "$output" | grep -qi "mcpls.*not.*found\|mcpls.*PATH\|install.*mcpls"; then
    pass "preflight aborts with mcpls-not-found message"
else
    fail "preflight did not produce expected mcpls-missing error. Got: $output"
fi
rm -rf "$sandbox"

# Helper: build a PATH that keeps core tools but strips any dir containing
# the given binary names (so sandbox stubs are the only ones found).
# Usage: make_isolated_path <sandbox> <bin1> [bin2 ...]
make_isolated_path() {
    local sandbox="$1"; shift
    local exclude_bins=("$@")
    local result="$sandbox/bin"
    local dir bin skip _dirs
    IFS=: read -ra _dirs <<< "$PATH"
    for dir in "${_dirs[@]}"; do
        skip=false
        for bin in "${exclude_bins[@]}"; do
            if [ -x "$dir/$bin" ]; then
                skip=true
                break
            fi
        done
        "$skip" && continue
        result="$result:$dir"
    done
    echo "$result"
}

# ---------------------------------------------------------------
info "Test: --mcp passes --mcp-config to claude invocation"

sandbox=$(make_sandbox)
prd="$sandbox/prd.json"
minimal_prd "$prd"
record="$sandbox/claude-argv.txt"

# Stub mcpls (just needs to exist on PATH).
write_stub "$sandbox" mcpls 'exit 0'

# Stub claude that records its argv and emits a "DONE" stdout so the loop
# proceeds through one iteration cleanly.
write_stub "$sandbox" claude "printf '%s\n' \"\$@\" > \"$record\"; echo DONE; exit 0"

_isolated=$(make_isolated_path "$sandbox" mcpls claude)
PATH="$_isolated" "$RALPH_LOOP" "$prd" --state-dir "$sandbox" --mcp --max-iterations 1 --no-github > "$sandbox/run.log" 2>&1 || true

if [ -f "$record" ] && grep -q -- "--mcp-config" "$record"; then
    pass "claude was invoked with --mcp-config"
else
    fail "claude argv did not contain --mcp-config. Recorded: $(cat "$record" 2>/dev/null || echo MISSING)"
fi

# Validate the generated config file is well-formed JSON with the mcpls entry
config_path=$(grep -A1 -- "--mcp-config" "$record" | tail -1)
if [ -f "$config_path" ] && jq -e '.mcpServers.mcpls.command == "mcpls"' "$config_path" > /dev/null 2>&1; then
    pass "generated mcp-config.json has expected shape"
else
    fail "mcp-config.json missing or malformed at: $config_path"
fi

rm -rf "$sandbox"

# ---------------------------------------------------------------
info "Test: without --mcp, claude is NOT invoked with --mcp-config"

sandbox=$(make_sandbox)
prd="$sandbox/prd.json"
minimal_prd "$prd"
record="$sandbox/claude-argv.txt"

write_stub "$sandbox" claude "printf '%s\n' \"\$@\" > \"$record\"; echo DONE; exit 0"

_isolated=$(make_isolated_path "$sandbox" claude)
PATH="$_isolated" "$RALPH_LOOP" "$prd" --state-dir "$sandbox" --max-iterations 1 --no-github > "$sandbox/run.log" 2>&1 || true

if [ -f "$record" ] && ! grep -q -- "--mcp-config" "$record"; then
    pass "claude was invoked WITHOUT --mcp-config when --mcp is off"
else
    fail "claude unexpectedly received --mcp-config when --mcp was not set"
fi
rm -rf "$sandbox"

# ---------------------------------------------------------------
info "Test: progress.txt records MCP: ok|degraded|off per iteration"

# Case A: --mcp on, claude exits cleanly → MCP: ok
sandbox=$(make_sandbox)
prd="$sandbox/prd.json"
minimal_prd "$prd"
write_stub "$sandbox" mcpls 'exit 0'
write_stub "$sandbox" claude 'echo DONE; exit 0'

isolated=$(make_isolated_path "$sandbox" mcpls claude)
PATH="$isolated" "$RALPH_LOOP" "$prd" --state-dir "$sandbox" --mcp --max-iterations 1 --no-github > "$sandbox/run.log" 2>&1 || true

if grep -q "MCP: ok" "$sandbox/progress.txt" 2>/dev/null; then
    pass "progress.txt shows 'MCP: ok' on healthy --mcp run"
else
    fail "progress.txt missing 'MCP: ok'. Contents: $(cat "$sandbox/progress.txt" 2>/dev/null || echo MISSING)"
fi
rm -rf "$sandbox"

# Case B: --mcp on, claude stderr mentions mcpls error → MCP: degraded
sandbox=$(make_sandbox)
prd="$sandbox/prd.json"
minimal_prd "$prd"
write_stub "$sandbox" mcpls 'exit 0'
write_stub "$sandbox" claude 'echo "mcpls server crashed" >&2; echo DONE; exit 0'

isolated=$(make_isolated_path "$sandbox" mcpls claude)
PATH="$isolated" "$RALPH_LOOP" "$prd" --state-dir "$sandbox" --mcp --max-iterations 1 --no-github > "$sandbox/run.log" 2>&1 || true

if grep -q "MCP: degraded" "$sandbox/progress.txt" 2>/dev/null; then
    pass "progress.txt shows 'MCP: degraded' when claude stderr mentions mcpls"
else
    fail "progress.txt missing 'MCP: degraded'. Contents: $(cat "$sandbox/progress.txt" 2>/dev/null || echo MISSING)"
fi
# Verify sidecar log was written
if [ -s "$sandbox/mcp-iteration-1.log" ]; then
    pass "mcp-iteration-1.log written for degraded iteration"
else
    fail "mcp-iteration-1.log missing or empty"
fi
rm -rf "$sandbox"

# Case C: --mcp off → MCP: off
sandbox=$(make_sandbox)
prd="$sandbox/prd.json"
minimal_prd "$prd"
write_stub "$sandbox" claude 'echo DONE; exit 0'

isolated=$(make_isolated_path "$sandbox" mcpls claude)
PATH="$isolated" "$RALPH_LOOP" "$prd" --state-dir "$sandbox" --max-iterations 1 --no-github > "$sandbox/run.log" 2>&1 || true

if grep -q "MCP: off" "$sandbox/progress.txt" 2>/dev/null; then
    pass "progress.txt shows 'MCP: off' when --mcp is not set"
else
    fail "progress.txt missing 'MCP: off'. Contents: $(cat "$sandbox/progress.txt" 2>/dev/null || echo MISSING)"
fi
rm -rf "$sandbox"

# ---------------------------------------------------------------
echo ""
echo "─────────────────────────────────────────────"
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
echo "─────────────────────────────────────────────"
[ $TESTS_FAILED -eq 0 ]
