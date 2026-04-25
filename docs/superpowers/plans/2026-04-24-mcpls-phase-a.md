# mcpls Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `mcpls` (universal MCP↔LSP bridge) as an opt-in MCP server available to Claude during each `ralph-loop` iteration, gated behind a `--mcp` flag, with graceful degradation and visible MCP status in progress and GitHub comments.

**Architecture:** Add a thin `lib/mcp/index.js` Node CLI (matches existing `lib/prompt`, `lib/github` pattern) that emits the MCP config JSON. The Bash orchestrator gains a `--mcp` flag, a startup preflight that checks for `mcpls` on `PATH`, and threads `--mcp-config <path>` into the three existing `claude --print` invocations. Per-iteration MCP health is captured by stderr-substring heuristic, written to a sidecar log, surfaced as `MCP: ok|degraded|off` in `progress.txt`, and added as a column to the GitHub iteration comment table.

**Tech Stack:** Bash 4+, Node.js (CommonJS), Jest, `jq`, `gh` CLI, Claude CLI. Tests use shell stubs on `PATH` to fake `mcpls` and `claude`.

**Spec:** `docs/superpowers/specs/2026-04-24-mcpls-phase-a-design.md`

---

## File Structure

| Path | Status | Responsibility |
|------|--------|----------------|
| `lib/mcp/index.js` | **Create** | Thin CLI: `write-config --output <path>` writes the static MCP server config JSON. |
| `lib/mcp/config.js` | **Create** | Pure function `buildMcpConfig()` returning the config object. Kept separate so it's unit-testable without spawning Node CLI. |
| `lib/mcp/config.test.js` | **Create** | Jest unit test for `buildMcpConfig` (flat layout next to source — project convention). |
| `ralph-loop` | **Modify** | (1) `parse_arguments`: add `--mcp` flag. (2) `show_help`: document the flag. (3) Loop startup: preflight when `MCP_ENABLED`. (4) Generate `mcp-config.json` once per run. (5) Three Claude invocations append `--mcp-config "$MCP_CONFIG_FILE"` when enabled. (6) Classify each iteration's MCP status from `claude_output`. (7) `log_iteration` writes the `MCP:` indicator. (8) `post_iteration_comment` forwards the status. |
| `lib/github/index.js` | **Modify** | `update-issue` command accepts an optional `--mcp-status` arg and forwards it to `updateIssue`. |
| `lib/github/issues.js` | **Modify** | `formatIterationComment` accepts optional `mcpStatus` and renders an extra `**MCP:**` line under the table when present. |
| `lib/github/__tests__/issues.test.js` (or new file) | **Create or extend** | Unit test for the new `mcpStatus` rendering branch. |
| `tests/test-mcp.sh` | **Create** | End-to-end Bash test suite for the feature. |
| `tests/test-all.sh` | **Modify** | Register `test-mcp.sh`. |
| `tests/test-help.sh` | **Modify** | Add an assertion that `--mcp` appears in `--help` output. |
| `README.md` | **Modify** | Document the `--mcp` flag and link to spec. |
| `CLAUDE.md` | **Modify** | Document `MCP_ENABLED` global, `lib/mcp/`, and the per-iteration MCP status surface. |

---

## Task 1: `lib/mcp` module — config generator

**Files:**
- Create: `lib/mcp/config.js`
- Create: `lib/mcp/index.js`
- Create: `lib/mcp/__tests__/config.test.js`

- [ ] **Step 1: Write the failing unit test**

Create `lib/mcp/__tests__/config.test.js`:

```javascript
'use strict';

const { buildMcpConfig } = require('../config');

describe('buildMcpConfig', () => {
  test('returns mcpServers config with mcpls entry', () => {
    expect(buildMcpConfig()).toEqual({
      mcpServers: {
        mcpls: { command: 'mcpls' },
      },
    });
  });

  test('result is JSON-serializable and stable', () => {
    const a = JSON.stringify(buildMcpConfig());
    const b = JSON.stringify(buildMcpConfig());
    expect(a).toBe(b);
    expect(JSON.parse(a)).toHaveProperty('mcpServers.mcpls.command', 'mcpls');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --no-coverage lib/mcp/__tests__/config.test.js`
Expected: FAIL with "Cannot find module '../config'".

- [ ] **Step 3: Implement `buildMcpConfig`**

Create `lib/mcp/config.js`:

```javascript
'use strict';

function buildMcpConfig() {
  return {
    mcpServers: {
      mcpls: { command: 'mcpls' },
    },
  };
}

module.exports = { buildMcpConfig };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --no-coverage lib/mcp/__tests__/config.test.js`
Expected: PASS, 2/2.

- [ ] **Step 5: Implement the CLI wrapper**

Create `lib/mcp/index.js`:

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { buildMcpConfig } = require('./config');

const command = process.argv[2];

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx === process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

function main() {
  switch (command) {
    case 'write-config': {
      const output = getArg('--output');
      if (!output) {
        console.error('Usage: node lib/mcp/index.js write-config --output <path>');
        process.exit(1);
      }
      const dir = path.dirname(path.resolve(output));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(output, JSON.stringify(buildMcpConfig(), null, 2) + '\n');
      console.log(output);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Available: write-config');
      process.exit(1);
  }
}

main();
```

- [ ] **Step 6: Smoke-test the CLI**

Run:
```bash
TMP=$(mktemp -d)
node lib/mcp/index.js write-config --output "$TMP/mcp-config.json"
cat "$TMP/mcp-config.json"
rm -rf "$TMP"
```
Expected output ends with:
```json
{
  "mcpServers": {
    "mcpls": {
      "command": "mcpls"
    }
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add lib/mcp/
git commit -m "feat(mcp): add lib/mcp module with write-config CLI

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `--mcp` flag parsing + help text

**Files:**
- Modify: `ralph-loop` (globals near line 18, `show_help` near line 60–110, `parse_arguments` lines 237–311)
- Modify: `tests/test-help.sh`

- [ ] **Step 1: Write the failing help-output test**

Append to `tests/test-help.sh` (before the trailing summary block — find the existing `pass`/`fail` pattern and add a new check):

```bash
info "Test: --help mentions --mcp flag"
help_output=$("$RALPH_LOOP" --help 2>&1 || true)
if echo "$help_output" | grep -q -- "--mcp"; then
    pass "--help documents --mcp flag"
else
    fail "--help does not mention --mcp flag"
fi
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./tests/test-help.sh`
Expected: One FAIL line for "--help does not mention --mcp flag".

- [ ] **Step 3: Add the global default**

In `ralph-loop`, near the existing `GITHUB_ENABLED=true` (line 18 area), add:

```bash
MCP_ENABLED=false
MCP_CONFIG_FILE=""
```

- [ ] **Step 4: Document the flag in `show_help`**

In `ralph-loop` `show_help`, in the OPTIONS section (around line 80–105), insert after the `--no-branch` block:

```
  --mcp                   Enable mcpls MCP server for Claude (opt-in).
                          Requires 'mcpls' on PATH. See:
                          https://github.com/bug-ops/mcpls
```

- [ ] **Step 5: Add the case to `parse_arguments`**

In `ralph-loop` `parse_arguments`, insert this case before the `-*` catch-all (around line 299):

```bash
            --mcp)
                MCP_ENABLED=true
                shift
                ;;
```

- [ ] **Step 6: Run help test to verify it passes**

Run: `./tests/test-help.sh`
Expected: All checks PASS, including the new `--mcp` check.

- [ ] **Step 7: Commit**

```bash
git add ralph-loop tests/test-help.sh
git commit -m "feat(mcp): add --mcp opt-in flag and help text

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Preflight check for `mcpls` binary

**Files:**
- Modify: `ralph-loop` (locate the early validation block in `run_ralph_loop` — search for the existing `command -v claude` check around line 2284–2290)
- Create: `tests/test-mcp.sh`

- [ ] **Step 1: Create `tests/test-mcp.sh` skeleton with preflight failing test**

Create `tests/test-mcp.sh`:

```bash
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

# Each test runs in an isolated temp dir with a sandboxed PATH so we can
# control whether 'mcpls' and 'claude' are present. We always keep core
# tools (jq, node, git, gh) by prepending the stub dir to the real PATH.
make_sandbox() {
    local sandbox
    sandbox=$(mktemp -d)
    mkdir -p "$sandbox/bin"
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

# Sandbox PATH has NO mcpls. Keep core tools available.
output=$(PATH="$sandbox/bin:$PATH" "$RALPH_LOOP" "$prd" --mcp --max-iterations 1 --no-github 2>&1 || true)

if echo "$output" | grep -qi "mcpls.*not.*found\|mcpls.*PATH\|install.*mcpls"; then
    pass "preflight aborts with mcpls-not-found message"
else
    fail "preflight did not produce expected mcpls-missing error. Got: $output"
fi
rm -rf "$sandbox"

# ---------------------------------------------------------------
echo ""
echo "─────────────────────────────────────────────"
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
echo "─────────────────────────────────────────────"
[ $TESTS_FAILED -eq 0 ]
```

Make it executable:
```bash
chmod +x tests/test-mcp.sh
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./tests/test-mcp.sh`
Expected: FAIL — preflight is not yet implemented, so ralph-loop will not produce the expected error message.

- [ ] **Step 3: Implement preflight in `run_ralph_loop`**

In `ralph-loop`, find `run_ralph_loop` and locate the existing claude-binary check (search for `command -v claude` around line 2284). Insert the mcpls preflight immediately after it:

```bash
    # Preflight: --mcp requires mcpls on PATH
    if [ "$MCP_ENABLED" = true ]; then
        if ! command -v mcpls &> /dev/null; then
            error_exit "mcpls binary not found on PATH but --mcp was passed." \
"Install mcpls (https://github.com/bug-ops/mcpls) or rerun without --mcp."
        fi
    fi
```

(`error_exit` is the existing helper in `ralph-loop`. The two-line message is consistent with how `error_exit` is called elsewhere.)

- [ ] **Step 4: Run test to verify it passes**

Run: `./tests/test-mcp.sh`
Expected: PASS for "preflight aborts with mcpls-not-found message".

- [ ] **Step 5: Commit**

```bash
git add ralph-loop tests/test-mcp.sh
git commit -m "feat(mcp): preflight check requires mcpls on PATH when --mcp is set

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Generate `mcp-config.json` and pass `--mcp-config` to Claude

**Files:**
- Modify: `ralph-loop` (immediately after the preflight block from Task 3, and the three `claude --dangerously-skip-permissions --print` invocations around lines 2452, 2475, 2482)
- Modify: `tests/test-mcp.sh`

- [ ] **Step 1: Add the failing test for `--mcp-config` plumbing**

Append to `tests/test-mcp.sh` before the results summary:

```bash
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

PATH="$sandbox/bin:$PATH" "$RALPH_LOOP" "$prd" --mcp --max-iterations 1 --no-github > "$sandbox/run.log" 2>&1 || true

if [ -f "$record" ] && grep -q -- "--mcp-config" "$record"; then
    pass "claude was invoked with --mcp-config"
else
    fail "claude argv did not contain --mcp-config. Recorded: $(cat "$record" 2>/dev/null || echo MISSING)"
fi

# Validate the generated config file is well-formed JSON with the mcpls entry
config_path=$(grep -- "--mcp-config" "$record" | head -1)
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

PATH="$sandbox/bin:$PATH" "$RALPH_LOOP" "$prd" --max-iterations 1 --no-github > "$sandbox/run.log" 2>&1 || true

if [ -f "$record" ] && ! grep -q -- "--mcp-config" "$record"; then
    pass "claude was invoked WITHOUT --mcp-config when --mcp is off"
else
    fail "claude unexpectedly received --mcp-config when --mcp was not set"
fi
rm -rf "$sandbox"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./tests/test-mcp.sh`
Expected: The two new tests FAIL — `--mcp-config` is not yet wired up.

- [ ] **Step 3: Generate the MCP config once at run start**

In `ralph-loop`, immediately after the preflight block from Task 3 (still inside `run_ralph_loop`, before the iteration `while` loop), add:

```bash
    # Generate MCP config once per run, alongside progress.txt.
    if [ "$MCP_ENABLED" = true ]; then
        local prd_dir
        prd_dir="$(dirname "$JSON_FILE")"
        MCP_CONFIG_FILE="${prd_dir}/mcp-config.json"
        if ! node "$SCRIPT_DIR/lib/mcp/index.js" write-config --output "$MCP_CONFIG_FILE" > /dev/null; then
            error_exit "Failed to write MCP config to $MCP_CONFIG_FILE" "Check filesystem permissions and rerun."
        fi
        if [ "$VERBOSE" = true ]; then
            echo -e "${BLUE}[VERBOSE] MCP enabled; config at $MCP_CONFIG_FILE${NC}"
        fi
    fi
```

(`$JSON_FILE` and `$SCRIPT_DIR` are existing globals in `ralph-loop`. Confirm they are in scope at this point — `JSON_FILE` is set during PRD validation earlier in `run_ralph_loop`.)

- [ ] **Step 4: Wire `--mcp-config` into the three Claude invocations**

In `ralph-loop`, locate the three `claude --dangerously-skip-permissions --print` invocations (around lines 2452, 2475, 2482 — debug, verbose, and normal branches). Just before the `while [ $retry_count ... ]` loop in that block, add:

```bash
        local mcp_args=()
        if [ "$MCP_ENABLED" = true ] && [ -n "$MCP_CONFIG_FILE" ]; then
            mcp_args+=(--mcp-config "$MCP_CONFIG_FILE")
        fi
```

Then change each of the three invocations from:

```bash
                if claude_output=$(claude --dangerously-skip-permissions --print < "$prompt_file" 2>&1); then
```

to:

```bash
                if claude_output=$(claude --dangerously-skip-permissions --print "${mcp_args[@]}" < "$prompt_file" 2>&1); then
```

All three branches (debug / verbose / normal) get the same change.

- [ ] **Step 5: Run test to verify it passes**

Run: `./tests/test-mcp.sh`
Expected: All four tests so far PASS (preflight + with-flag + without-flag + config shape).

- [ ] **Step 6: Verify nothing else regressed**

Run: `./tests/test-all.sh`
Expected: All existing suites still pass. (`test-mcp.sh` is not yet wired into `test-all.sh` — that happens in Task 7.)

- [ ] **Step 7: Commit**

```bash
git add ralph-loop tests/test-mcp.sh
git commit -m "feat(mcp): generate mcp-config.json and pass --mcp-config to Claude

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Per-iteration MCP status classification + `progress.txt` indicator

**Files:**
- Modify: `ralph-loop` (`log_iteration` / `log_iteration_result` near line 1775–1803, and the iteration block that consumes `claude_output` near the three claude invocations)
- Modify: `tests/test-mcp.sh`

- [ ] **Step 1: Add the failing progress.txt test**

Append to `tests/test-mcp.sh`:

```bash
# ---------------------------------------------------------------
info "Test: progress.txt records MCP: ok|degraded|off per iteration"

# Case A: --mcp on, claude exits cleanly → MCP: ok
sandbox=$(make_sandbox)
prd="$sandbox/prd.json"
minimal_prd "$prd"
write_stub "$sandbox" mcpls 'exit 0'
write_stub "$sandbox" claude 'echo DONE; exit 0'

PATH="$sandbox/bin:$PATH" "$RALPH_LOOP" "$prd" --mcp --max-iterations 1 --no-github > "$sandbox/run.log" 2>&1 || true

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

PATH="$sandbox/bin:$PATH" "$RALPH_LOOP" "$prd" --mcp --max-iterations 1 --no-github > "$sandbox/run.log" 2>&1 || true

if grep -q "MCP: degraded" "$sandbox/progress.txt" 2>/dev/null; then
    pass "progress.txt shows 'MCP: degraded' when claude stderr mentions mcpls"
else
    fail "progress.txt missing 'MCP: degraded'. Contents: $(cat "$sandbox/progress.txt" 2>/dev/null || echo MISSING)"
fi
rm -rf "$sandbox"

# Case C: --mcp off → MCP: off
sandbox=$(make_sandbox)
prd="$sandbox/prd.json"
minimal_prd "$prd"
write_stub "$sandbox" claude 'echo DONE; exit 0'

PATH="$sandbox/bin:$PATH" "$RALPH_LOOP" "$prd" --max-iterations 1 --no-github > "$sandbox/run.log" 2>&1 || true

if grep -q "MCP: off" "$sandbox/progress.txt" 2>/dev/null; then
    pass "progress.txt shows 'MCP: off' when --mcp is not set"
else
    fail "progress.txt missing 'MCP: off'. Contents: $(cat "$sandbox/progress.txt" 2>/dev/null || echo MISSING)"
fi
rm -rf "$sandbox"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./tests/test-mcp.sh`
Expected: All three new "MCP: ..." cases FAIL.

- [ ] **Step 3: Classify MCP status from `claude_output`**

In `ralph-loop`, immediately after the existing `while [ $retry_count ... ]` retry loop ends (and `claude_output` holds the captured combined stdout+stderr — same place where the script today logs the API result), add:

```bash
        # Classify per-iteration MCP status. Heuristic: case-insensitive
        # substring match on 'mcpls' or whole-word 'mcp' in claude_output.
        # 'off' means MCP is disabled for this run.
        local mcp_status
        if [ "$MCP_ENABLED" = false ]; then
            mcp_status="off"
        elif echo "$claude_output" | grep -Eiq 'mcpls|(^|[^a-z])mcp([^a-z]|$)'; then
            mcp_status="degraded"
            echo -e "${YELLOW}[WARN] MCP-related signal in Claude output this iteration; continuing.${NC}"
            # Sidecar log for debuggability
            local prd_dir
            prd_dir="$(dirname "$JSON_FILE")"
            echo "$claude_output" | grep -Ei 'mcpls|(^|[^a-z])mcp([^a-z]|$)' \
                > "${prd_dir}/mcp-iteration-${iteration}.log" 2>/dev/null || true
        else
            mcp_status="ok"
        fi
```

Then expose it to the logger:

```bash
        log_iteration_mcp "$iteration" "$mcp_status"
```

- [ ] **Step 4: Add `log_iteration_mcp` helper**

In `ralph-loop`, immediately after the existing `log_iteration_result` function (around line 1803), add:

```bash
log_iteration_mcp() {
    local iteration="$1"
    local mcp_status="$2"

    cat >> "$PROGRESS_FILE" << EOF
MCP: $mcp_status
EOF
}
```

(Keeping it as a separate helper rather than parameterizing `log_iteration` avoids touching all the existing log_iteration call sites.)

- [ ] **Step 5: Run test to verify it passes**

Run: `./tests/test-mcp.sh`
Expected: All seven tests so far PASS.

- [ ] **Step 6: Verify the sidecar log is written for the degraded case**

Add this assertion to `tests/test-mcp.sh` (right after the Case B block, before Case C):

```bash
# Sidecar log should exist for degraded case
sandbox=$(make_sandbox)
prd="$sandbox/prd.json"
minimal_prd "$prd"
write_stub "$sandbox" mcpls 'exit 0'
write_stub "$sandbox" claude 'echo "mcpls server crashed" >&2; echo DONE; exit 0'

PATH="$sandbox/bin:$PATH" "$RALPH_LOOP" "$prd" --mcp --max-iterations 1 --no-github > "$sandbox/run.log" 2>&1 || true

if [ -s "$sandbox/mcp-iteration-1.log" ]; then
    pass "mcp-iteration-1.log written for degraded iteration"
else
    fail "mcp-iteration-1.log missing or empty"
fi
rm -rf "$sandbox"
```

Run: `./tests/test-mcp.sh`
Expected: All eight tests PASS.

- [ ] **Step 7: Commit**

```bash
git add ralph-loop tests/test-mcp.sh
git commit -m "feat(mcp): classify per-iteration MCP status and log to progress.txt

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Surface MCP status in GitHub iteration comment

**Files:**
- Modify: `lib/github/issues.js` (`formatIterationComment`, `updateIssue`, exports)
- Modify: `lib/github/index.js` (`update-issue` CLI handler)
- Modify: `ralph-loop` (`post_iteration_comment` plumbing)
- Extend: `lib/github/issues.test.js` (already exists, flat next to source — project convention)

- [ ] **Step 1: Write the failing unit test for `formatIterationComment`**

Append to `lib/github/issues.test.js` (it already exists alongside `issues.js`):

```javascript
'use strict';

const { formatIterationComment } = require('../issues');

describe('formatIterationComment with mcpStatus', () => {
  const baseArgs = {
    iteration: 2,
    maxIterations: 10,
    results: [{ criterion: 1, passed: true }],
    criteria: [{ text: 'Tests pass' }],
  };

  test('omits MCP line when mcpStatus is undefined', () => {
    const out = formatIterationComment(baseArgs);
    expect(out).not.toMatch(/MCP:/);
  });

  test('includes MCP line when mcpStatus is provided', () => {
    const out = formatIterationComment({ ...baseArgs, mcpStatus: 'ok' });
    expect(out).toMatch(/\*\*MCP:\*\* ok/);
  });

  test('renders degraded status verbatim', () => {
    const out = formatIterationComment({ ...baseArgs, mcpStatus: 'degraded' });
    expect(out).toMatch(/\*\*MCP:\*\* degraded/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --no-coverage lib/github/__tests__/issues.test.js`
Expected: FAIL on the two cases that expect `MCP:` in the output.

- [ ] **Step 3: Update `formatIterationComment` to accept `mcpStatus`**

In `lib/github/issues.js`, change `formatIterationComment` (lines 55–81) to:

```javascript
function formatIterationComment({ iteration, maxIterations, results, criteria, mcpStatus }) {
  const rows = results.map((r, i) => {
    const text = criteria[i]?.text || `Criterion ${r.criterion}`;
    let status;
    if (r.skipped || r.passed === null) {
      status = ':large_blue_circle: skipped';
    } else if (r.passed) {
      status = ':white_check_mark: pass';
    } else {
      status = `:x: fail${r.error ? ' — ' + r.error : ''}`;
    }
    return `| ${i + 1} | ${text} | ${status} |`;
  });

  const passCount = results.filter(r => r.passed === true).length;
  const total = results.length;

  const lines = [
    `### Iteration ${iteration}/${maxIterations}`,
    '',
    '| # | Criterion | Result |',
    '|---|-----------|--------|',
    ...rows,
    '',
    `**Status:** ${passCount}/${total} criteria passing.${passCount === total ? ' All done!' : ' Continuing.'}`,
  ];

  if (mcpStatus) {
    lines.push(`**MCP:** ${mcpStatus}`);
  }

  return lines.join('\n');
}
```

Update `updateIssue` to forward the field:

```javascript
function updateIssue({ repo, issueNumber, iteration, maxIterations, results, criteria, mcpStatus }) {
  const comment = formatIterationComment({ iteration, maxIterations, results, criteria, mcpStatus });
  // ...rest unchanged
```

(Leave the body of `updateIssue` from `const tmpFile = ...` onward exactly as it was.)

- [ ] **Step 4: Run unit test to verify it passes**

Run: `npx jest --no-coverage lib/github/__tests__/issues.test.js`
Expected: PASS, 3/3.

- [ ] **Step 5: Add `--mcp-status` to the `update-issue` CLI handler**

In `lib/github/index.js`, find the `update-issue` case in the command switch. Add `--mcp-status` parsing alongside the existing args, and pass it through. The exact patch depends on the current shape — read the file first. The pattern is:

```javascript
const mcpStatus = getArg('--mcp-status') || undefined;
// then
updateIssue({ repo, issueNumber, iteration, maxIterations, results, criteria, mcpStatus });
```

- [ ] **Step 6: Forward `mcp_status` from Bash to the CLI**

In `ralph-loop`, modify `post_iteration_comment` (around line 2152). Change its signature to accept the status and forward it:

```bash
post_iteration_comment() {
    local task_id="$1"
    local task_index="$2"
    local current_iteration="$3"
    local verify_result="$4"
    local mcp_status="${5:-}"

    if [ "$GITHUB_ENABLED" = false ]; then
        return 0
    fi

    local issue_number=$(jq -r ".tasks[$task_index].issueNumber // empty" "$JSON_FILE")
    if [ -z "$issue_number" ]; then
        return 0
    fi

    local criteria_json=$(jq -c ".tasks[$task_index].acceptanceCriteria" "$JSON_FILE")
    local results_json=$(echo "$verify_result" | jq -c '.results')

    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[INFO] Posting iteration comment to issue #$issue_number...${NC}"
    fi

    local mcp_args=()
    if [ -n "$mcp_status" ]; then
        mcp_args+=(--mcp-status "$mcp_status")
    fi

    node "$SCRIPT_DIR/lib/github/index.js" update-issue \
        --repo "$TARGET_REPO" \
        --issue "$issue_number" \
        --iteration "$current_iteration" \
        --max-iterations "$MAX_ITERATIONS" \
        --results "$results_json" \
        --criteria "$criteria_json" \
        "${mcp_args[@]}" 2>&1 || {
        echo -e "${YELLOW}[WARN] Failed to post comment to issue #$issue_number${NC}"
    }
}
```

Then update the two existing call sites of `post_iteration_comment` (around lines 2627 and 2692 — find both with `grep -n post_iteration_comment ralph-loop`). Add `"$mcp_status"` as the fifth argument. `$mcp_status` is in scope because Task 5 set it earlier in the same iteration block.

- [ ] **Step 7: Run all unit tests to confirm nothing else broke**

Run: `npx jest --no-coverage --testPathIgnorePatterns='user-model'`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/github/ ralph-loop
git commit -m "feat(mcp): surface MCP status in GitHub iteration comment

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire-up, docs, and final verification

**Files:**
- Modify: `tests/test-all.sh`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Register `test-mcp.sh` in the test runner**

Read `tests/test-all.sh` to find the existing pattern (it invokes each suite in sequence). Add `tests/test-mcp.sh` to the list, in the same shape as the existing entries.

- [ ] **Step 2: Run the full test suite**

Run: `./tests/test-all.sh`
Expected: All suites PASS, including the new `test-mcp.sh`.

- [ ] **Step 3: Run all JS tests**

Run: `npx jest --no-coverage --testPathIgnorePatterns='user-model'`
Expected: All PASS.

- [ ] **Step 4: Update `README.md`**

In `README.md`, locate the existing flag documentation section (or the usage example near the top). Add a short subsection:

```markdown
### `--mcp` (opt-in, experimental)

Enables [`mcpls`](https://github.com/bug-ops/mcpls) as an MCP server for
Claude during each iteration, giving Claude LSP-backed tools (go-to-def,
references, diagnostics, hover, completion) in any language whose
project markers `mcpls` recognizes.

Requirements:
- `mcpls` binary on `PATH`
- One or more LSP servers installed and on `PATH` (rust-analyzer,
  pyright, gopls, typescript-language-server, etc.)

Failure modes:
- If `mcpls` is missing at startup, `ralph-loop` aborts with a clear
  error.
- If MCP misbehaves mid-loop, the iteration continues with status
  `MCP: degraded` recorded in `progress.txt` and (when GitHub is
  enabled) on the issue comment.

See `docs/superpowers/specs/2026-04-24-mcpls-phase-a-design.md` for
details. SymDex integration and Ralph-side LSP usage are deferred to
phases B and C.
```

Also add `--mcp` to the flag list near the top-of-README usage line.

- [ ] **Step 5: Update `CLAUDE.md`**

In `CLAUDE.md`:

1. In the **Argument parsing** bullet (under "Architecture → 1. Main CLI"), add `MCP_ENABLED` and `MCP_CONFIG_FILE` to the listed globals, and `--mcp` to the listed flags.
2. In the **Main loop** numbered list, add a step describing the per-iteration MCP status classification and `progress.txt` indicator.
3. In the **Node.js modules** tree, add:
   ```
     mcp/
       index.js            # CLI: write-config --output <path>
       config.js           # Pure buildMcpConfig() factory
   ```
4. In the **Key conventions** section, add a bullet: "MCP integration is opt-in via `--mcp`. When enabled, Ralph generates `mcp-config.json` once per run and passes `--mcp-config` to every Claude invocation. Per-iteration MCP health is captured in `progress.txt` and (when GitHub is enabled) on the issue comment."

- [ ] **Step 6: Final verification**

Run:
```bash
./tests/test-all.sh
npx jest --no-coverage --testPathIgnorePatterns='user-model'
./ralph-loop --help | grep -- "--mcp"
```
Expected: All tests PASS, help output includes `--mcp`.

- [ ] **Step 7: Commit**

```bash
git add tests/test-all.sh README.md CLAUDE.md
git commit -m "docs(mcp): document --mcp flag in README and CLAUDE.md; wire test-mcp.sh

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Done

At this point:

- `--mcp` is a working opt-in flag.
- mcpls is wired to Claude via `--mcp-config` on every iteration when enabled.
- Missing `mcpls` aborts the run with a clear, actionable error.
- Mid-loop MCP errors are non-fatal; they degrade the status and write a sidecar log.
- `MCP: ok|degraded|off` is visible in `progress.txt` and on the GitHub issue comment.
- The new `tests/test-mcp.sh` and Jest tests guard the behavior and run in `tests/test-all.sh` and `npx jest`.
- `README.md` and `CLAUDE.md` document the feature.
- All non-goals from the spec (SymDex, Ralph-side analysis, new criteria types, auto-detection) remain untouched, ready for phase B/C.
