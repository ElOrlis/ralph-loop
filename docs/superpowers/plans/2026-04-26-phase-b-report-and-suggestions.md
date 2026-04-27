# Phase B: `--report` Flag + Criteria-Typing Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two phase B enhancements to `ralph-loop`: a `--report` flag that aggregates a PRD's iteration data into a project-status report, and a deterministic criteria-typing assistant that augments `--analyze-prd` with type-hint suggestions for untyped criteria.

**Architecture:** Both features are pure-data and offline. New `lib/report/` module follows the existing thin-Node-CLI-behind-Bash pattern (`aggregator.js` + `formatter.js` + `index.js`). The criteria-typing assistant lives in a new `lib/criteria/suggestions.js` plus a `suggest` subcommand on `lib/criteria/index.js`. Bash adds a `--report` flag with its own dispatch path (`run_report`), and extends `analyze_prd` to render suggestions. No PRD JSON state changes, no LLM calls, no external tooling.

**Tech Stack:** Bash 4+, Node.js (CommonJS), Jest, `jq`. Tests use shell stubs for any deterministic checks.

**Spec:** `docs/superpowers/specs/2026-04-26-phase-b-design.md`

---

## File Structure

| Path | Status | Responsibility |
|------|--------|----------------|
| `lib/report/aggregator.js` | **Create** | Pure: `aggregate(prdJson, progressText) → { summary, tasks, hotspots, mcp }`. |
| `lib/report/aggregator.test.js` | **Create** | Jest unit tests for aggregator. |
| `lib/report/formatter.js` | **Create** | Pure: `format(aggregatorOutput) → string`. ANSI-color text matching analyze-prd aesthetic. |
| `lib/report/formatter.test.js` | **Create** | Jest unit tests for formatter (assert section presence and shape). |
| `lib/report/index.js` | **Create** | CLI: `report --task-file <path> --progress-file <path>`. Reads files, calls aggregate+format, prints. |
| `lib/criteria/suggestions.js` | **Create** | Pure: `suggestForCriterion(text) → [{ type, value, rationale }]`. Regex-based pattern matchers. |
| `lib/criteria/suggestions.test.js` | **Create** | Jest unit tests covering each pattern + non-matching cases. |
| `lib/criteria/index.js` | **Modify** | Add `suggest --task-file <path>` command that walks tasks/criteria and returns suggestions JSON. |
| `ralph-loop` | **Modify** | (1) `parse_arguments`: add `--report` flag (mutually exclusive with `--analyze-prd`). (2) `show_help`: document `--report`. (3) New `run_report` dispatcher (mirrors `analyze_prd`'s shape). (4) `main` dispatch: when `--report` is set, run report and exit. (5) `analyze_prd`: call `criteria suggest` after the existing breakdown, render the section. |
| `tests/test-report.sh` | **Create** | End-to-end Bash test: build fixture PRD JSON + progress.txt in a sandbox, invoke `ralph-loop ... --report`, assert sections appear. |
| `tests/test-analysis.sh` | **Modify** | Add assertion that `--analyze-prd` output includes a "Suggested Type Hints" section when fixture has matchable criteria. |
| `tests/test-help.sh` | **Modify** | Add assertion that `--help` documents `--report`. |
| `tests/test-all.sh` | **Modify** | Register `tests/test-report.sh`. |
| `README.md` | **Modify** | Document `--report` and the typing-assistant section. |
| `CLAUDE.md` | **Modify** | Add `lib/report/` to the module tree, mention `--report` and `suggest` subcommand. |

---

## Task 1: `lib/report/aggregator.js` — pure data shape

**Files:**
- Create: `lib/report/aggregator.js`
- Create: `lib/report/aggregator.test.js`

- [ ] **Step 1: Write the failing test**

Create `lib/report/aggregator.test.js`:

```javascript
// lib/report/aggregator.test.js
'use strict';

const { aggregate } = require('./aggregator');

const samplePrd = {
  tasks: [
    {
      id: 'task-1',
      title: 'Backend',
      priority: 1,
      passes: true,
      attempts: 3,
      completedAt: '2026-04-25T10:00:00Z',
      acceptanceCriteria: [
        { text: 'A passing one' },
        { text: 'Another' },
      ],
      criteriaResults: [
        [{ passed: false, error: 'oops' }, { passed: false, error: 'oops' }, { passed: true }],
        [{ passed: true }],
      ],
      status: 'ready',
      dependsOn: [],
    },
    {
      id: 'task-2',
      title: 'Frontend',
      priority: 2,
      passes: false,
      attempts: 1,
      acceptanceCriteria: [{ text: 'Something' }],
      criteriaResults: [[{ passed: false, error: 'still failing' }]],
      status: 'blocked',
      blockedBy: ['task-1'],
      dependsOn: ['task-1'],
    },
  ],
};

const sampleProgress = `┌────┐
│ ITERATION 1/15
│ Timestamp: 2026-04-25 09:00:00
│ Working on: task-1 - Backend
└────┘
MCP: ok
┌────┐
│ ITERATION 2/15
│ Timestamp: 2026-04-25 09:30:00
│ Working on: task-1 - Backend
└────┘
MCP: degraded
┌────┐
│ ITERATION 3/15
│ Timestamp: 2026-04-25 10:00:00
│ Working on: task-1 - Backend
└────┘
MCP: ok
`;

describe('aggregate', () => {
  test('summary counts tasks by status', () => {
    const out = aggregate(samplePrd, sampleProgress);
    expect(out.summary.totalTasks).toBe(2);
    expect(out.summary.passed).toBe(1);
    expect(out.summary.blocked).toBe(1);
    expect(out.summary.iterationsUsed).toBe(3);
  });

  test('per-task breakdown reports criteria pass/total', () => {
    const out = aggregate(samplePrd, sampleProgress);
    const t1 = out.tasks.find((t) => t.id === 'task-1');
    expect(t1).toMatchObject({
      title: 'Backend',
      status: 'passed',
      attempts: 3,
      criteriaPassed: 2,
      criteriaTotal: 2,
    });
    const t2 = out.tasks.find((t) => t.id === 'task-2');
    expect(t2).toMatchObject({
      status: 'blocked',
      criteriaPassed: 0,
      criteriaTotal: 1,
      blockedBy: ['task-1'],
    });
  });

  test('hotspots include criteria with 2+ failures, sorted desc', () => {
    const out = aggregate(samplePrd, sampleProgress);
    expect(out.hotspots).toHaveLength(1);
    expect(out.hotspots[0]).toMatchObject({
      taskId: 'task-1',
      criterionIndex: 0,
      failCount: 2,
    });
    expect(out.hotspots[0].lastError).toContain('oops');
  });

  test('mcp section reports counts and rate', () => {
    const out = aggregate(samplePrd, sampleProgress);
    expect(out.mcp).toMatchObject({
      ok: 2,
      degraded: 1,
      off: 0,
      total: 3,
    });
  });

  test('mcp section is null when no MCP lines present', () => {
    const out = aggregate(samplePrd, '┌────┐\n│ ITERATION 1/15\n└────┘\n');
    expect(out.mcp).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --no-coverage lib/report/aggregator.test.js`
Expected: FAIL with "Cannot find module './aggregator'".

- [ ] **Step 3: Implement `aggregate`**

Create `lib/report/aggregator.js`:

```javascript
// lib/report/aggregator.js
'use strict';

function aggregate(prdJson, progressText) {
  const tasksRaw = Array.isArray(prdJson.tasks) ? prdJson.tasks : [];

  const tasks = tasksRaw.map((t) => {
    const criteria = Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria : [];
    const results = Array.isArray(t.criteriaResults) ? t.criteriaResults : [];
    const lastResults = results.length ? results[results.length - 1] : [];
    let criteriaPassed = 0;
    for (let i = 0; i < criteria.length; i++) {
      const r = lastResults[i];
      if (r && r.passed === true) criteriaPassed += 1;
    }
    let status;
    if (t.passes === true) status = 'passed';
    else if (t.status === 'blocked') status = 'blocked';
    else if ((t.attempts || 0) > 0) status = 'in-progress';
    else status = 'pending';

    return {
      id: t.id,
      title: t.title,
      priority: t.priority,
      status,
      attempts: t.attempts || 0,
      criteriaPassed,
      criteriaTotal: criteria.length,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
      blockedBy: Array.isArray(t.blockedBy) ? t.blockedBy : [],
      completedAt: t.completedAt || null,
    };
  });

  const summary = {
    totalTasks: tasks.length,
    passed: tasks.filter((t) => t.status === 'passed').length,
    blocked: tasks.filter((t) => t.status === 'blocked').length,
    inProgress: tasks.filter((t) => t.status === 'in-progress').length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    iterationsUsed: countIterations(progressText),
  };

  const hotspots = computeHotspots(tasksRaw);
  const mcp = computeMcp(progressText);

  return { summary, tasks, hotspots, mcp };
}

function countIterations(progressText) {
  const matches = progressText.match(/ITERATION\s+\d+\/\d+/g);
  return matches ? matches.length : 0;
}

function computeHotspots(tasksRaw) {
  const out = [];
  for (const t of tasksRaw) {
    const criteria = Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria : [];
    const results = Array.isArray(t.criteriaResults) ? t.criteriaResults : [];
    for (let i = 0; i < criteria.length; i++) {
      let failCount = 0;
      let lastError = '';
      for (const iterResults of results) {
        const r = iterResults[i];
        if (r && r.passed === false) {
          failCount += 1;
          if (r.error) lastError = r.error;
        }
      }
      if (failCount >= 2) {
        out.push({
          taskId: t.id,
          criterionIndex: i,
          criterionText: typeof criteria[i] === 'string' ? criteria[i] : criteria[i].text,
          failCount,
          lastError,
        });
      }
    }
  }
  out.sort((a, b) => b.failCount - a.failCount);
  return out;
}

function computeMcp(progressText) {
  const lines = progressText.split(/\r?\n/);
  let ok = 0; let degraded = 0; let off = 0;
  for (const line of lines) {
    const m = line.match(/^MCP:\s*(ok|degraded|off)\s*$/);
    if (!m) continue;
    if (m[1] === 'ok') ok += 1;
    else if (m[1] === 'degraded') degraded += 1;
    else if (m[1] === 'off') off += 1;
  }
  const total = ok + degraded + off;
  if (total === 0) return null;
  return { ok, degraded, off, total };
}

module.exports = { aggregate };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --no-coverage lib/report/aggregator.test.js`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit**

```bash
git add lib/report/aggregator.js lib/report/aggregator.test.js
git commit -m "feat(report): add aggregator that summarizes PRD iteration data

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `lib/report/formatter.js` — text rendering

**Files:**
- Create: `lib/report/formatter.js`
- Create: `lib/report/formatter.test.js`

- [ ] **Step 1: Write the failing test**

Create `lib/report/formatter.test.js`:

```javascript
// lib/report/formatter.test.js
'use strict';

const { format } = require('./formatter');

const sample = {
  summary: {
    totalTasks: 2,
    passed: 1,
    blocked: 1,
    inProgress: 0,
    pending: 0,
    iterationsUsed: 3,
  },
  tasks: [
    {
      id: 'task-1',
      title: 'Backend',
      priority: 1,
      status: 'passed',
      attempts: 3,
      criteriaPassed: 2,
      criteriaTotal: 2,
      dependsOn: [],
      blockedBy: [],
      completedAt: '2026-04-25T10:00:00Z',
    },
    {
      id: 'task-2',
      title: 'Frontend',
      priority: 2,
      status: 'blocked',
      attempts: 1,
      criteriaPassed: 0,
      criteriaTotal: 1,
      dependsOn: ['task-1'],
      blockedBy: ['task-1'],
      completedAt: null,
    },
  ],
  hotspots: [
    {
      taskId: 'task-1',
      criterionIndex: 0,
      criterionText: 'A passing one that flapped',
      failCount: 2,
      lastError: 'connection refused',
    },
  ],
  mcp: { ok: 2, degraded: 1, off: 0, total: 3 },
};

describe('format', () => {
  test('output contains all four section headers', () => {
    const out = format(sample);
    expect(out).toContain('Run Summary');
    expect(out).toContain('Per-Task Breakdown');
    expect(out).toContain('Criteria Hotspots');
    expect(out).toContain('MCP Health');
  });

  test('summary numbers appear in output', () => {
    const out = format(sample);
    expect(out).toMatch(/Total Tasks:\s*2/);
    expect(out).toMatch(/Passed:\s*1/);
    expect(out).toMatch(/Blocked:\s*1/);
    expect(out).toMatch(/Iterations Used:\s*3/);
  });

  test('per-task rows include id and status', () => {
    const out = format(sample);
    expect(out).toContain('task-1');
    expect(out).toContain('task-2');
    expect(out).toMatch(/passed/);
    expect(out).toMatch(/blocked/);
  });

  test('hotspots show task id and fail count', () => {
    const out = format(sample);
    expect(out).toContain('task-1');
    expect(out).toMatch(/2 failures/);
    expect(out).toContain('connection refused');
  });

  test('MCP health section shown only when mcp present', () => {
    const out = format(sample);
    expect(out).toMatch(/ok:\s*2/);
    expect(out).toMatch(/degraded:\s*1/);

    const noMcp = format({ ...sample, mcp: null });
    expect(noMcp).not.toContain('MCP Health');
  });

  test('hotspots section omitted when no hotspots', () => {
    const noHot = format({ ...sample, hotspots: [] });
    expect(noHot).not.toContain('Criteria Hotspots');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --no-coverage lib/report/formatter.test.js`
Expected: FAIL with "Cannot find module './formatter'".

- [ ] **Step 3: Implement `format`**

Create `lib/report/formatter.js`:

```javascript
// lib/report/formatter.js
'use strict';

const BLUE = '\x1b[34m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const NC = '\x1b[0m';

function format(report) {
  const lines = [];
  lines.push(`${BLUE}╔════════════════════════════════════════════════════════════════════════════╗${NC}`);
  lines.push(`${BLUE}║                            PRD STATUS REPORT                               ║${NC}`);
  lines.push(`${BLUE}╚════════════════════════════════════════════════════════════════════════════╝${NC}`);
  lines.push('');

  // Section 1: Run Summary
  lines.push(`${BLUE}Run Summary:${NC}`);
  lines.push(`  Total Tasks:      ${report.summary.totalTasks}`);
  lines.push(`  Passed:           ${report.summary.passed}`);
  lines.push(`  In Progress:      ${report.summary.inProgress}`);
  lines.push(`  Blocked:          ${report.summary.blocked}`);
  lines.push(`  Pending:          ${report.summary.pending}`);
  lines.push(`  Iterations Used:  ${report.summary.iterationsUsed}`);
  lines.push('');

  // Section 2: Per-Task Breakdown
  lines.push(`${BLUE}Per-Task Breakdown:${NC}`);
  for (const t of report.tasks) {
    const statusColor = t.status === 'passed' ? GREEN
      : t.status === 'blocked' ? RED
      : t.status === 'in-progress' ? YELLOW
      : NC;
    const deps = t.dependsOn.length ? ` deps:[${t.dependsOn.join(',')}]` : '';
    const blocked = t.status === 'blocked' && t.blockedBy.length
      ? ` blocked by:[${t.blockedBy.join(',')}]`
      : '';
    lines.push(
      `  ${t.id} (P${t.priority}) ${statusColor}${t.status}${NC}  ` +
      `attempts=${t.attempts}  criteria=${t.criteriaPassed}/${t.criteriaTotal}` +
      deps + blocked
    );
    lines.push(`    "${t.title}"`);
  }
  lines.push('');

  // Section 3: Criteria Hotspots (omitted when empty)
  if (report.hotspots && report.hotspots.length > 0) {
    lines.push(`${BLUE}Criteria Hotspots:${NC}`);
    for (const h of report.hotspots) {
      const text = truncate(h.criterionText || '', 70);
      const err = truncate(h.lastError || '', 80);
      lines.push(`  ${h.taskId}#${h.criterionIndex + 1}  ${YELLOW}${h.failCount} failures${NC}`);
      lines.push(`    "${text}"`);
      if (err) lines.push(`    last error: ${err}`);
    }
    lines.push('');
  }

  // Section 4: MCP Health (omitted when null)
  if (report.mcp) {
    lines.push(`${BLUE}MCP Health:${NC}`);
    lines.push(`  ok:        ${report.mcp.ok}`);
    lines.push(`  degraded:  ${report.mcp.degraded}`);
    lines.push(`  off:       ${report.mcp.off}`);
    lines.push(`  total:     ${report.mcp.total}`);
    if (report.mcp.degraded > 0) {
      lines.push(`  ${YELLOW}see mcp-iteration-N.log files for degraded iterations${NC}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

module.exports = { format };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --no-coverage lib/report/formatter.test.js`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add lib/report/formatter.js lib/report/formatter.test.js
git commit -m "feat(report): add formatter that renders aggregator output as text

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `lib/report/index.js` — CLI wrapper

**Files:**
- Create: `lib/report/index.js`

- [ ] **Step 1: Implement the CLI**

Create `lib/report/index.js`:

```javascript
#!/usr/bin/env node
// lib/report/index.js
'use strict';

const fs = require('fs');
const { aggregate } = require('./aggregator');
const { format } = require('./formatter');

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx === process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

function main() {
  const command = process.argv[2];
  if (command !== 'report') {
    console.error(`Unknown command: ${command}`);
    console.error('Available: report');
    process.exit(1);
  }

  const taskFile = getArg('--task-file');
  const progressFile = getArg('--progress-file');
  if (!taskFile) {
    console.error('Usage: node lib/report/index.js report --task-file <path> [--progress-file <path>]');
    process.exit(1);
  }

  let prdJson;
  try {
    prdJson = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
  } catch (err) {
    console.error(`Failed to read PRD JSON from ${taskFile}: ${err.message}`);
    process.exit(1);
  }

  let progressText = '';
  if (progressFile) {
    try {
      progressText = fs.readFileSync(progressFile, 'utf-8');
    } catch (err) {
      // missing progress file is fine — fresh PRD with no run yet
      progressText = '';
    }
  }

  const report = aggregate(prdJson, progressText);
  process.stdout.write(format(report) + '\n');
}

main();
```

- [ ] **Step 2: Smoke-test the CLI**

Run:
```bash
TMP=$(mktemp -d)
cat > "$TMP/prd.json" <<'JSON'
{"tasks":[{"id":"t1","title":"Demo","priority":1,"passes":true,"attempts":1,"acceptanceCriteria":[{"text":"x"}],"criteriaResults":[[{"passed":true}]]}]}
JSON
node lib/report/index.js report --task-file "$TMP/prd.json"
rm -rf "$TMP"
```
Expected output: includes `PRD STATUS REPORT`, `Run Summary:`, `Total Tasks: 1`, `Passed: 1`, and a `Per-Task Breakdown` section listing `t1`.

- [ ] **Step 3: Commit**

```bash
git add lib/report/index.js
git commit -m "feat(report): add CLI wrapper for report subcommand

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `--report` flag in ralph-loop + bash test

**Files:**
- Modify: `ralph-loop` (globals near line 18, `parse_arguments` lines 237–311, `show_help` near line 80–110, `main` dispatch near line 2856)
- Create: `tests/test-report.sh`

- [ ] **Step 1: Add the failing bash test**

Create `tests/test-report.sh`:

```bash
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
    cat > "$1/prd.json" <<'EOF'
{
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
        [{"passed": false, "error": "boom"}],
        [{"passed": true}]
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

output=$("$RALPH_LOOP" "$sandbox/prd.json" --report --no-github 2>&1)
exit_code=$?

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
err=$("$RALPH_LOOP" "$sandbox/prd.json" --report --analyze-prd --no-github 2>&1 || true)
if echo "$err" | grep -qi "mutually exclusive\|cannot be used together\|conflict"; then
    pass "--report + --analyze-prd produces conflict error"
else
    fail "no error for --report + --analyze-prd combo. Got: $err"
fi

# ---------------------------------------------------------------
echo ""
echo "─────────────────────────────────────────────"
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
echo "─────────────────────────────────────────────"
[ $TESTS_FAILED -eq 0 ] || exit 1
```

Make it executable:
```bash
chmod +x tests/test-report.sh
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./tests/test-report.sh`
Expected: FAILs across the board — `--report` is unimplemented.

- [ ] **Step 3: Add the global default**

In `ralph-loop`, near other top-level flag globals (e.g. line 16 area, alongside `ANALYZE_PRD=false`), add:

```bash
REPORT_MODE=false
```

- [ ] **Step 4: Document the flag in `show_help`**

In `ralph-loop` `show_help`, in the OPTIONS section near `--analyze-prd`, insert:

```
  --report                Print a project-status report for the PRD
                          (iteration counts, per-task breakdown,
                          criteria hotspots, MCP health). Read-only,
                          offline. Mutually exclusive with --analyze-prd.
```

- [ ] **Step 5: Add the `--report` case to `parse_arguments`**

In `ralph-loop` `parse_arguments`, insert before the `-*` catch-all:

```bash
            --report)
                REPORT_MODE=true
                shift
                ;;
```

- [ ] **Step 6: Add mutual-exclusion check**

After the `while [ $# -gt 0 ]` parsing loop closes (still inside `parse_arguments`), add:

```bash
    if [ "$REPORT_MODE" = true ] && [ "$ANALYZE_PRD" = true ]; then
        error_exit "--report and --analyze-prd are mutually exclusive." \
            "Pick one — --report is offline status, --analyze-prd calls Claude for narrative feedback."
    fi
```

- [ ] **Step 7: Add the `run_report` function**

In `ralph-loop`, add near the existing `analyze_prd` function (line 1460 area) a new function:

```bash
run_report() {
    local json_file="$1"
    local progress_file="$2"

    # Validate the JSON parses
    if ! jq empty "$json_file" 2>/dev/null; then
        error_exit "PRD JSON at $json_file is invalid." "Run --analyze-prd to diagnose, or fix the file manually."
    fi

    if ! node "$SCRIPT_DIR/lib/report/index.js" report \
            --task-file "$json_file" \
            --progress-file "$progress_file"; then
        error_exit "Report generation failed." "See output above for details."
    fi
}
```

- [ ] **Step 8: Wire `--report` into `main`**

In `ralph-loop`, in the `main` flow (find the block around line 2856 after `parse_arguments "$@"`), after the existing `--analyze-prd` dispatch (search for `if [ "$ANALYZE_PRD" = true ]`), add a parallel block:

```bash
    if [ "$REPORT_MODE" = true ]; then
        local prd_dir
        prd_dir="$(dirname "$JSON_FILE")"
        run_report "$JSON_FILE" "${prd_dir}/progress.txt"
        exit 0
    fi
```

This must come AFTER the JSON is materialized (i.e. after markdown→JSON conversion if needed) and AFTER any structural validation, but BEFORE the iteration loop starts. The simplest correct place is immediately before the `if [ "$ANALYZE_PRD" = true ]` block — read the file to confirm.

- [ ] **Step 9: Run the test to verify it passes**

Run: `./tests/test-report.sh`
Expected: All assertions PASS.

- [ ] **Step 10: Run the full bash + jest suites**

Run: `./tests/test-all.sh && npx jest --no-coverage --testPathIgnorePatterns='user-model'`
Expected: all PASS. (`test-report.sh` is not yet wired into `test-all.sh` — that's Task 8.)

- [ ] **Step 11: Commit**

```bash
git add ralph-loop tests/test-report.sh
git commit -m "feat(report): add --report flag dispatching to lib/report

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `lib/criteria/suggestions.js` — pattern-based type-hint matcher

**Files:**
- Create: `lib/criteria/suggestions.js`
- Create: `lib/criteria/suggestions.test.js`

- [ ] **Step 1: Write the failing test**

Create `lib/criteria/suggestions.test.js`:

```javascript
// lib/criteria/suggestions.test.js
'use strict';

const { suggestForCriterion } = require('./suggestions');

describe('suggestForCriterion', () => {
  test('Test: Run `cmd` → shell suggestion', () => {
    const out = suggestForCriterion('Test: Run `npm test -- email.test.js` and verify all pass');
    expect(out).toEqual([
      expect.objectContaining({ type: 'shell', value: 'npm test -- email.test.js' }),
    ]);
  });

  test('Run `cmd` and verify → shell suggestion', () => {
    const out = suggestForCriterion('Run `curl -f http://localhost/health` and verify 200');
    expect(out[0]).toMatchObject({ type: 'shell', value: 'curl -f http://localhost/health' });
  });

  test('POST <url> returns <NNN> → http suggestion', () => {
    const out = suggestForCriterion('POST http://localhost/api/login returns 200');
    expect(out[0]).toMatchObject({ type: 'http', value: 'POST http://localhost/api/login -> 200' });
  });

  test('GET <url> returns <NNN> → http suggestion', () => {
    const out = suggestForCriterion('GET /healthz returns 204');
    expect(out[0]).toMatchObject({ type: 'http', value: 'GET /healthz -> 204' });
  });

  test('file `path` exists → file-exists suggestion', () => {
    const out = suggestForCriterion('Config file `./config/auth.json` exists after install');
    expect(out[0]).toMatchObject({ type: 'file-exists', value: './config/auth.json' });
  });

  test('Created `<path>` → file-exists suggestion', () => {
    const out = suggestForCriterion('Created `src/lib/auth.ts` with the new helper');
    expect(out[0]).toMatchObject({ type: 'file-exists', value: 'src/lib/auth.ts' });
  });

  test('grep `<pattern>` in `<file>` → grep suggestion', () => {
    const out = suggestForCriterion('grep `app\\.use.*auth` in `src/routes/index.js` returns a match');
    expect(out[0]).toMatchObject({
      type: 'grep',
      value: 'app\\.use.*auth in src/routes/index.js',
    });
  });

  test('vague text → no suggestion', () => {
    expect(suggestForCriterion('Validation rejects empty strings')).toEqual([]);
    expect(suggestForCriterion('Add documentation for the feature')).toEqual([]);
  });

  test('already-typed criterion → no suggestion', () => {
    expect(suggestForCriterion('Tests pass `[shell: npm test]`')).toEqual([]);
  });

  test('returns at most one suggestion per criterion', () => {
    const out = suggestForCriterion('Test: Run `npm test` and POST /api returns 200');
    expect(out.length).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --no-coverage lib/criteria/suggestions.test.js`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `suggestForCriterion`**

Create `lib/criteria/suggestions.js`:

```javascript
// lib/criteria/suggestions.js
'use strict';

const ALREADY_TYPED = /`\[(shell|http|file-exists|grep|manual):/;

function suggestForCriterion(text) {
  if (typeof text !== 'string') return [];
  if (ALREADY_TYPED.test(text)) return [];

  // Pattern: Test: Run `cmd` ... OR Run `cmd` and verify ...
  let m = text.match(/(?:Test:\s*Run|Run)\s+`([^`]+)`/i);
  if (m) {
    return [{
      type: 'shell',
      value: m[1].trim(),
      rationale: 'matched "Run `<cmd>`" pattern',
    }];
  }

  // Pattern: METHOD <url> returns <NNN>
  m = text.match(/\b(GET|POST|PUT|DELETE|PATCH)\s+(\S+)\s+returns\s+(\d{3})\b/i);
  if (m) {
    return [{
      type: 'http',
      value: `${m[1].toUpperCase()} ${m[2]} -> ${m[3]}`,
      rationale: 'matched "METHOD URL returns NNN" pattern',
    }];
  }

  // Pattern: grep `pattern` in `file`
  m = text.match(/grep\s+`([^`]+)`\s+in\s+`([^`]+)`/i);
  if (m) {
    return [{
      type: 'grep',
      value: `${m[1]} in ${m[2]}`,
      rationale: 'matched "grep `<pattern>` in `<file>`" pattern',
    }];
  }

  // Pattern: file `<path>` exists OR Created `<path>` (path-shaped backtick)
  // Reject .com / .org / no-dot-or-slash strings.
  m = text.match(/(?:^|\b)(?:Created|file|File)\s+`([^`]+)`(?:\s+(?:exists|with|is created)\b|$)/);
  if (m && /[\/.]/.test(m[1])) {
    return [{
      type: 'file-exists',
      value: m[1].trim(),
      rationale: 'matched "<file> `<path>` exists" / "Created `<path>`" pattern',
    }];
  }

  return [];
}

module.exports = { suggestForCriterion };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest --no-coverage lib/criteria/suggestions.test.js`
Expected: PASS, 10/10.

- [ ] **Step 5: Commit**

```bash
git add lib/criteria/suggestions.js lib/criteria/suggestions.test.js
git commit -m "feat(criteria): add regex-based type-hint suggestion engine

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `suggest` subcommand on `lib/criteria/index.js`

**Files:**
- Modify: `lib/criteria/index.js`

- [ ] **Step 1: Write a smoke test (no jest needed — exercise via the CLI itself)**

Create a temp PRD JSON and confirm the CLI's suggest output is well-formed JSON with the expected shape. We'll use a one-shot bash invocation (not committed):

```bash
TMP=$(mktemp -d)
cat > "$TMP/prd.json" <<'JSON'
{
  "tasks": [
    {
      "id": "t1",
      "title": "Backend",
      "category": "backend",
      "priority": 1,
      "passes": false,
      "acceptanceCriteria": [
        "Test: Run `npm test` and verify",
        "Validation rejects empty strings"
      ]
    }
  ]
}
JSON
node lib/criteria/index.js suggest --task-file "$TMP/prd.json"
rm -rf "$TMP"
```

Until Step 2 lands, this prints `Unknown command: suggest`.

- [ ] **Step 2: Add the `suggest` case to the switch in `lib/criteria/index.js`**

Read the existing file (see `case 'verify'`, `case 'normalize'`, `case 'validate-json'`). Add a new case alongside them:

```javascript
    case 'suggest': {
      const taskFile = getArg('--task-file');
      if (!taskFile) {
        console.error('Usage: node lib/criteria/index.js suggest --task-file <path>');
        process.exit(1);
      }
      const prdJson = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
      const { suggestForCriterion } = require('./suggestions');

      let totalSuggestions = 0;
      const tasks = (prdJson.tasks || []).map((t) => {
        const criteria = Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria : [];
        const taskSuggestions = [];
        criteria.forEach((c, idx) => {
          const text = typeof c === 'string' ? c : (c && c.text) || '';
          // Only suggest for untyped criteria (string or {type: 'manual'} or no type)
          const ctype = typeof c === 'object' && c ? c.type : null;
          if (ctype && ctype !== 'manual') return;
          const matches = suggestForCriterion(text);
          if (matches.length === 0) return;
          taskSuggestions.push({
            index: idx,
            original: text,
            suggestion: matches[0],
          });
          totalSuggestions += 1;
        });
        return { id: t.id, title: t.title, suggestions: taskSuggestions };
      });

      console.log(JSON.stringify({ tasks, totalSuggestions }, null, 2));
      break;
    }
```

Also confirm `fs` is required at the top of `index.js` (if not, add `const fs = require('fs');` near the existing imports — most likely it's already there).

- [ ] **Step 3: Re-run the smoke test from Step 1**

Run the same temp-dir invocation again. Expected output:

```json
{
  "tasks": [
    {
      "id": "t1",
      "title": "Backend",
      "suggestions": [
        {
          "index": 0,
          "original": "Test: Run `npm test` and verify",
          "suggestion": {
            "type": "shell",
            "value": "npm test",
            "rationale": "matched \"Run `<cmd>`\" pattern"
          }
        }
      ]
    }
  ],
  "totalSuggestions": 1
}
```

- [ ] **Step 4: Run all jest tests as a regression check**

Run: `npx jest --no-coverage --testPathIgnorePatterns='user-model'`
Expected: all PASS — `criteria/index.js` is exercised indirectly by existing tests; the new case is additive.

- [ ] **Step 5: Commit**

```bash
git add lib/criteria/index.js
git commit -m "feat(criteria): add 'suggest' subcommand for type-hint suggestions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Render suggestions in `analyze_prd`

**Files:**
- Modify: `ralph-loop` (`analyze_prd` near line 1460–1580)
- Modify: `tests/test-analysis.sh`

- [ ] **Step 1: Add the failing assertion to `tests/test-analysis.sh`**

Read the existing `tests/test-analysis.sh` first to identify a fixture-construction or assertion pattern. Append a new test function near the end (before the `main` test runner that calls each `test_*` function):

```bash
test_analyze_prd_includes_suggested_type_hints() {
    echo ""
    echo "Test N: --analyze-prd appends Suggested Type Hints section"
    local sandbox
    sandbox=$(mktemp -d)
    cat > "$sandbox/prd.json" <<'EOF'
{
  "tasks": [
    {
      "id": "task-1",
      "title": "Backend",
      "category": "backend",
      "priority": 1,
      "passes": false,
      "acceptanceCriteria": [
        {"text": "Test: Run `npm test` and verify all pass", "type": "manual"},
        {"text": "Validation rejects empty strings", "type": "manual"}
      ]
    }
  ]
}
EOF

    # Stub claude so the analyze-prd narrative call doesn't hit the real network
    local stub_dir="$sandbox/bin"
    mkdir -p "$stub_dir"
    cat > "$stub_dir/claude" <<'STUB'
#!/usr/bin/env bash
echo "Mocked Claude analysis."
STUB
    chmod +x "$stub_dir/claude"

    local output
    output=$(PATH="$stub_dir:$PATH" "$RALPH_LOOP" "$sandbox/prd.json" --analyze-prd --no-github 2>&1 || true)

    if echo "$output" | grep -q "Suggested Type Hints"; then
        pass "analyze-prd includes Suggested Type Hints section"
    else
        fail "analyze-prd did not include Suggested Type Hints. Got: $output"
    fi

    if echo "$output" | grep -q "shell: npm test"; then
        pass "suggested rewrite mentions [shell: npm test]"
    else
        fail "suggested rewrite missing [shell: npm test]"
    fi

    rm -rf "$sandbox"
}
```

Then add `test_analyze_prd_includes_suggested_type_hints` to the registry of called test functions in `main()` (or wherever the file invokes its tests — match the existing pattern).

Replace `Test N` in the echo line with the next sequential number used by the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `./tests/test-analysis.sh`
Expected: the new test FAILs ("Suggested Type Hints not present").

- [ ] **Step 3: Render the suggestions section in `analyze_prd`**

In `ralph-loop`, inside `analyze_prd`, just before the line `# Create analysis prompt for Claude` (around line 1551), insert:

```bash
    # Suggested Type Hints (Phase B): scan untyped criteria for known patterns
    local suggest_json
    suggest_json=$(node "$SCRIPT_DIR/lib/criteria/index.js" suggest --task-file "$json_file" 2>/dev/null || echo '{"totalSuggestions":0,"tasks":[]}')
    local suggest_count
    suggest_count=$(echo "$suggest_json" | jq -r '.totalSuggestions // 0')
    if [ "$suggest_count" -gt 0 ]; then
        echo -e "${BLUE}Suggested Type Hints:${NC}"
        echo "$suggest_json" | jq -r '
            .tasks[]
            | select((.suggestions | length) > 0)
            | "  Task: \(.id) (\(.title))",
              (.suggestions[] |
                "    Criterion \(.index + 1): \"\(.original)\"",
                "      Suggested:  [\(.suggestion.type): \(.suggestion.value)]"
              )
        '
        echo ""
        echo "  $suggest_count suggestion(s). Apply manually to raise Executable Coverage."
        echo ""
    fi
```

The `jq -r` script formats the JSON into the printed structure described in the spec.

- [ ] **Step 4: Run the test to verify it passes**

Run: `./tests/test-analysis.sh`
Expected: all pre-existing tests still pass; the new suggestion-section test passes.

- [ ] **Step 5: Run all jest + bash suites**

Run: `./tests/test-all.sh && npx jest --no-coverage --testPathIgnorePatterns='user-model'`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add ralph-loop tests/test-analysis.sh
git commit -m "feat(criteria): render Suggested Type Hints in --analyze-prd output

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire-up, docs, final verification

**Files:**
- Modify: `tests/test-all.sh`
- Modify: `tests/test-help.sh`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Register `test-report.sh` in `tests/test-all.sh`**

Read `tests/test-all.sh` and locate the `TEST_SCRIPTS=( ... )` array (or equivalent). Add `"test-report.sh"` to the list, in a position consistent with the surrounding entries.

- [ ] **Step 2: Add a `--help` assertion in `tests/test-help.sh`**

Append a new test function modeled on the existing `test_help_documents_mcp` pattern (around the bottom of the file). Use the next sequential test number:

```bash
test_help_documents_report() {
    echo ""
    echo "Test N: --help mentions --report flag"
    local help_output
    help_output=$("$RALPH_LOOP" --help 2>&1 || true)
    if echo "$help_output" | grep -q -- "--report"; then
        pass "--help documents --report flag"
    else
        fail "--help does not mention --report flag"
    fi
}
```

Register it in the file's `main()` runner.

- [ ] **Step 3: Run all bash suites**

Run: `./tests/test-all.sh`
Expected: all PASS, including new `test-report.sh`.

- [ ] **Step 4: Run all jest tests**

Run: `npx jest --no-coverage --testPathIgnorePatterns='user-model'`
Expected: all PASS.

- [ ] **Step 5: Update `README.md`**

Add two short sections (placement: after the existing flag table, and after the `--analyze-prd` description if there is one — read README first to find the right anchor).

For the flag table:

```markdown
| `--report` | Print a project-status report for the PRD (offline; no API calls) | Off |
```

For a new "Reporting" subsection:

```markdown
### `--report` (Phase B)

Aggregates an in-progress or completed PRD's iteration data into a
status report. Offline; no API calls. Reads the PRD JSON and the
companion `progress.txt` produced by previous runs.

```bash
./ralph-loop my-prd.md --report
```

Output sections:
- **Run Summary** — total iterations used, task counts by status.
- **Per-Task Breakdown** — one row per task: status, attempts,
  criteria pass rate, dependencies.
- **Criteria Hotspots** — criteria that have failed in 2+ iterations,
  with last error.
- **MCP Health** — counts of `ok` / `degraded` / `off` iterations
  (only shown when MCP was used).

`--report` is mutually exclusive with `--analyze-prd`.
```

For an additional bullet under `--analyze-prd`:

```markdown
- The output now includes a **Suggested Type Hints** section that
  scans untyped acceptance criteria for known patterns (e.g.
  ``Test: Run `cmd` `` → `[shell: cmd]`) and proposes inline rewrites
  to raise Executable Coverage. The suggestions are advisory; apply
  them manually.
```

- [ ] **Step 6: Update `CLAUDE.md`**

In `CLAUDE.md`:

1. Under the **Argument parsing** bullet, add `REPORT_MODE` to the listed globals and `--report` to the listed flags. Note that `--report` is mutually exclusive with `--analyze-prd`.
2. Under **PRD analysis**, mention that `--analyze-prd` now renders a "Suggested Type Hints" section produced by `lib/criteria/index.js suggest`.
3. In the `lib/` module tree, add:
   ```
     report/
       index.js            # CLI: report --task-file <path> --progress-file <path>
       aggregator.js       # Pure aggregator over PRD JSON + progress.txt
       formatter.js        # Pure text formatter for the aggregator output
   ```
   And update the `criteria/` entry to mention `suggest` alongside `verify | normalize | validate-json`.
4. In **Key conventions**, add: "Phase B: `--report` produces an offline status report; `--analyze-prd` includes deterministic type-hint suggestions for untyped criteria. Both features are read-only and make no API calls."

- [ ] **Step 7: Final verification**

Run:
```bash
./tests/test-all.sh
npx jest --no-coverage --testPathIgnorePatterns='user-model'
./ralph-loop --help | grep -- '--report'
```
Expected: all PASS, help output includes `--report`.

- [ ] **Step 8: Commit**

```bash
git add tests/test-all.sh tests/test-help.sh README.md CLAUDE.md
git commit -m "docs(report): document --report flag and Suggested Type Hints

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Done

At this point:

- `ralph-loop <prd> --report` prints a structured status report from PRD JSON + `progress.txt` with no API calls.
- `ralph-loop <prd> --analyze-prd` continues to do everything it did, plus renders a deterministic Suggested Type Hints section from regex pattern matchers.
- Both features are pure-data and offline; no LSP, no SymDex, no LLM in either's new code paths.
- New tests guard the behavior: jest unit tests for the aggregator, formatter, and suggestion engine; bash end-to-end tests in `tests/test-report.sh`; updated assertions in `tests/test-analysis.sh` and `tests/test-help.sh`.
- Wire-up is complete: `test-all.sh` runs the new suite; README and CLAUDE.md document the new flags and module.
- Phase C (SymDex / new criteria types / auto-detection) remains untouched.
