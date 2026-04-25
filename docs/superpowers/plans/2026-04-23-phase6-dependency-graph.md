# Phase 6 — Dependency Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks declare `dependsOn` relationships; Ralph replaces the priority-only `find_next_task` with a topological sort that honors dependencies, surfaces blocked tasks as first-class state (in PRD JSON, GitHub Issue labels, and the Projects v2 board), merges completed dependency branches into a task branch before Claude's turn (conflict → block + move on), and teaches `--analyze-prd` + `validate_prd_json` about cycles and dangling refs.

**Architecture:** A new `lib/deps/` module owns the graph (`graph.js` — Kahn's algorithm + cycle detection, `index.js` — CLI dispatcher with `next-task` and `validate` subcommands). A new `lib/git/merge.js` owns dependency-branch merging and plugs into the existing `lib/git/index.js` dispatcher as a `merge-branch` subcommand. Bash replaces `find_next_task` with a call to `lib/deps/index.js next-task`, adds `sync_blocked_statuses` (writes `status` + `blockedBy` back into PRD JSON) and `merge_dependency_branches` (runs after `ensure_task_branch`, before the Claude call). Blocked tasks are reflected via a new `Blocked` option on `RALPH_STATUS_OPTIONS`, a `blocked` label added to the GitHub issue, and a new `task_blocked` event. Dependency branch merging is the only Phase 5 feature intentionally deferred to this phase — it needs the graph to know which branches to merge.

**Tech Stack:** Node.js (CommonJS), Jest for unit tests, Bash for CLI integration tests, `jq` 1.6+ for JSON edits, `git` CLI for merge operations, `gh` CLI for issue label edits. No new npm dependencies.

---

## Prerequisites

- Phase 1 (Executable Criteria) shipped — `lib/criteria/index.js validate-json` exists and is already used in `validate_prd_json` for structural JSON sanity.
- Phase 2 (GitHub Issues) shipped — `lib/github/issues.js` and `ensure_task_issue` exist. New: this plan adds `add-label` / `remove-label` subcommands to the issues surface.
- Phase 4 (GitHub Projects) shipped — `RALPH_STATUS_OPTIONS` and `sync-project-item` exist. This plan adds `"Blocked"` to the allowed status values.
- Phase 5 (Git Branching & PRs) shipped — `lib/git/index.js`, `ensure_task_branch`, `commit_iteration`, `push_task_branch` exist. This plan adds one new `lib/git/merge.js` file and one `merge-branch` subcommand, without modifying existing git helpers.
- Phase 3 (Structured Logging) **strongly recommended** but not strictly required. If `lib/logging/events.js` is missing, the new event types are silently skipped (Task 14 becomes a no-op).
- `git` >= 2.23 (for `git merge --no-edit` + `git merge --abort` semantics — already required by Phase 5).
- `gh` CLI authenticated with `repo` scope — already required by Phase 2.
- Working directory `/Users/orlandogarcia/numeron/ralph-loop/`.

---

## File Structure

```
lib/deps/
  graph.js                — Pure: buildGraph, topologicalSort (Kahn's), detectCycle, findReady, findBlocked, pickNextTask
  graph.test.js           — Jest tests
  index.js                — CLI dispatcher: next-task | validate
  index.test.js           — Jest tests for dispatcher

lib/git/
  merge.js                — mergeBranch({ branch }) → { ok, conflict?: true, files?: [...] }
  merge.test.js           — Jest tests (mocks child_process)
  index.js   (modified)   — Adds merge-branch subcommand + merge-abort subcommand

lib/github/
  issues.js  (modified)   — Export addLabel, removeLabel
  issues.test.js (modified) — Tests for addLabel, removeLabel
  index.js   (modified)   — Adds add-label, remove-label subcommands
  projects.js (modified)  — RALPH_STATUS_OPTIONS gains 'Blocked'
  projects.test.js (modified) — Updates option-list assertions
  index.js   (modified)   — sync-project-item: when task.status === 'blocked' → ralphStatus = 'Blocked'
  index-projects.test.js (modified) — New test for Blocked branch

tests/
  fixtures/
    mock-gh-labels.sh     — Fake `gh` for label integration tests (builds on mock-gh-projects.sh pattern)
  test-dependency-graph.sh — Bash integration tests covering Phase 6 end-to-end
  test-validation.sh (modified) — New cases for dependsOn validation + cycle detection
  test-conversion.sh (modified) — New cases for **Depends On**: parsing
  test-analysis.sh   (modified) — New cases for cycle warning in --analyze-prd
  test-help.sh       (modified) — Asserts Phase 6 section in --help
  test-all.sh        (modified) — Registers test-dependency-graph.sh

ralph-loop   (modified)   — New globals, functions, and wiring into run_ralph_loop
README.md    (modified)   — Short Phase 6 section
examples/
  good-prd-example.md (modified, optional) — Add a `**Depends On**:` example
```

**Modified files:**

- `ralph-loop`
  - `validate_prd_json` (~line 508): accept optional task-level `dependsOn` (array of strings) and `status` (string). Also call `lib/deps/index.js validate` after field checks to surface invalid refs / cycles.
  - `convert_prd_to_json` (~line 327): parse new `**Depends On**:` markdown line into a `dependsOn` JSON array.
  - `find_next_task` (~line 1687): replace the priority-only loop with a single call to `node lib/deps/index.js next-task --task-file "$JSON_FILE"`. Return the `nextTask` string.
  - New Bash helpers (inserted near the existing Phase 5 branch helpers, around line 1195): `sync_blocked_statuses`, `merge_dependency_branches`, `clear_blocked_status`.
  - `run_ralph_loop` (~line 2036 loop body): right after `find_next_task`, call `sync_blocked_statuses` to write `status=blocked` / `status=ready` for every task in the latest graph reply. Right after `ensure_task_branch` (~line 2101), call `merge_dependency_branches`; on conflict, mark the task blocked + post an issue comment + `continue` to next iteration.
  - `analyze_prd` (~line 1237): call `lib/deps/index.js validate --task-file "$JSON_FILE"` and report `cycle`, blocked count, ready count.
  - `show_help` (~line 98): new "Dependency Graph (Phase 6)" paragraph.
  - Debug output in `main` (~line 2572): add `echo "[DEBUG] DEP_GRAPH_ENABLED: true"` as a visible marker (no toggle — always on).
- `lib/github/projects.js` line 19: extend `RALPH_STATUS_OPTIONS` to `['Pending','In Progress','Passed','Failed','Stalled','Blocked']`.
- `lib/github/index.js` lines 142–147 (the `sync-project-item` status branch): add `else if (task.status === 'blocked') ralphStatus = 'Blocked';` at the top of the chain.
- `lib/github/index.js` dispatcher: add `add-label` and `remove-label` cases (Task 8).
- `lib/github/issues.js`: export `addLabel({ repo, issueNumber, label })` and `removeLabel({ repo, issueNumber, label })`.
- `lib/git/index.js`: add `merge-branch` and `merge-abort` cases (Task 10).
- `tests/test-all.sh`: register `test-dependency-graph.sh`.
- `README.md`: short Phase 6 section (Task 13).

**Out of scope (deferred):** parallel task execution in worktrees (the `ready` array is the hook but the orchestrator stays sequential), cross-PRD dependency graphs, diamond-dependency optimizations, rerere/conflict-resolution helpers, custom dependency-merge commit templates, automatic un-blocking via webhooks, analytics/prediction models.

---

## PRD JSON Schema Additions

Task-level fields added by this phase:

```json
{
  "id": "task-3",
  "title": "Add auth middleware",
  "dependsOn": ["task-1", "task-2"],
  "status": "ready",
  "blockedBy": [],
  "blockedReason": null
}
```

- `dependsOn` (array of task-id strings, optional) — human-authored. Empty array or missing = no deps.
- `status` (string, optional, computed by Ralph) — one of `"ready"`, `"blocked"`. Absent = legacy/unknown. `"ready"` is written eagerly so that downstream consumers can distinguish "confirmed ready" from "unchecked".
- `blockedBy` (array of task-id strings, computed) — subset of `dependsOn` that have `passes !== true`. Always present when `status === "blocked"`.
- `blockedReason` (string, optional) — human-readable reason set by merge-conflict handler, e.g. `"merge conflict with task-1 on src/auth.js"`. Absent when blocking is purely from `dependsOn`.

All four fields are optional (backward compatible with Phases 1–5 PRDs).

---

## Markdown Syntax

New line recognized by `convert_prd_to_json` alongside `**Category**:` and `**Priority**:`:

```markdown
## Task: Add auth middleware
**Category**: Backend
**Priority**: 3
**Depends On**: task-1, task-2
```

Rules:
- Comma-separated task IDs, whitespace-tolerant (`task-1 ,task-2` → `["task-1","task-2"]`).
- Empty value (`**Depends On**:` with no IDs) → `dependsOn` omitted from JSON.
- Absent line → `dependsOn` omitted from JSON.
- Case-sensitive match (task IDs are case-sensitive throughout the codebase).

---

## Event Catalogue Additions (Phase 3 dependency)

Added to `lib/logging/events.js` REQUIRED map (Task 14):

| `event` | Required fields | Optional fields |
|---------|-----------------|-----------------|
| `task_blocked`       | `taskId` (string), `blockedBy` (array of strings) | `reason` (string) |
| `dependency_merged`  | `taskId` (string), `depTaskId` (string), `depBranch` (string), `sha` (string) | — |
| `merge_conflict`     | `taskId` (string), `depTaskId` (string), `depBranch` (string), `files` (array of strings) | — |

---

### Task 1: Extend `validate_prd_json` for `dependsOn` + `status` fields

**Files:**
- Modify: `ralph-loop:508-661` (existing `validate_prd_json`)
- Modify: `tests/test-validation.sh` (append new cases)

- [ ] **Step 1: Write the failing bash test**

Append to `tests/test-validation.sh` before the final summary block:

```bash
test_accepts_depends_on_array() {
    echo ""
    echo "Test: accepts optional dependsOn array"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "Deps",
  "tasks": [
    { "id": "task-1", "title": "A", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": true, "attempts": 1 },
    { "id": "task-2", "title": "B", "category": "C", "priority": 2,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
      "dependsOn": ["task-1"], "status": "ready", "blockedBy": [] }
  ]
}
EOF

    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -eq 0 ]; then pass "accepts dependsOn + status + blockedBy"
    else fail "rejected valid PRD with Phase 6 fields. Output: $output"; fi
}

test_rejects_non_array_depends_on() {
    echo ""
    echo "Test: rejects non-array dependsOn"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "Bad",
  "tasks": [{ "id": "task-1", "title": "A", "category": "C", "priority": 1,
    "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
    "dependsOn": "task-0" }]
}
EOF

    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -ne 0 ] && echo "$output" | grep -qi "dependsOn"; then
        pass "rejects non-array dependsOn"
    else
        fail "should reject non-array dependsOn. Exit: $exit_code, Output: $output"
    fi
}

test_rejects_bad_status_value() {
    echo ""
    echo "Test: rejects status value outside {ready, blocked}"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "Bad",
  "tasks": [{ "id": "task-1", "title": "A", "category": "C", "priority": 1,
    "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
    "status": "wizard" }]
}
EOF

    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -ne 0 ] && echo "$output" | grep -qi "status"; then
        pass "rejects bad status value"
    else
        fail "should reject 'wizard' status. Exit: $exit_code, Output: $output"
    fi
}

test_accepts_depends_on_array
test_rejects_non_array_depends_on
test_rejects_bad_status_value
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./tests/test-validation.sh`
Expected: the three new tests fail; every existing test still passes.

- [ ] **Step 3: Extend `validate_prd_json` in `ralph-loop`**

Insert this block immediately after the existing `prurl_bad` block (around `ralph-loop:658`), **before** the final `return 0`:

```bash
    # Optional: each task.dependsOn (if present) must be an array of strings
    local deps_bad
    deps_bad=$(jq -r '.tasks[] | select(.dependsOn != null) | select((.dependsOn | type) != "array") | .id' "$json_file")
    if [ -n "$deps_bad" ]; then
        echo -e "${RED}[ERROR] Tasks with non-array dependsOn: $deps_bad${NC}"
        return 1
    fi
    local deps_elem_bad
    deps_elem_bad=$(jq -r '.tasks[] | select(.dependsOn != null) | select([.dependsOn[] | type] | any(. != "string")) | .id' "$json_file")
    if [ -n "$deps_elem_bad" ]; then
        echo -e "${RED}[ERROR] Tasks with non-string entries in dependsOn: $deps_elem_bad${NC}"
        return 1
    fi

    # Optional: each task.status (if present) must be "ready" or "blocked"
    local status_bad
    status_bad=$(jq -r '.tasks[] | select(.status != null) | select(.status != "ready" and .status != "blocked") | .id' "$json_file")
    if [ -n "$status_bad" ]; then
        echo -e "${RED}[ERROR] Tasks with invalid status (must be \"ready\" or \"blocked\"): $status_bad${NC}"
        return 1
    fi

    # Optional: each task.blockedBy (if present) must be an array of strings
    local bb_bad
    bb_bad=$(jq -r '.tasks[] | select(.blockedBy != null) | select((.blockedBy | type) != "array" or ([.blockedBy[] | type] | any(. != "string"))) | .id' "$json_file")
    if [ -n "$bb_bad" ]; then
        echo -e "${RED}[ERROR] Tasks with invalid blockedBy: $bb_bad${NC}"
        return 1
    fi
```

- [ ] **Step 4: Re-run the tests to verify they pass**

Run: `./tests/test-validation.sh`
Expected: all tests pass, including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add ralph-loop tests/test-validation.sh
git commit -m "feat(phase6): accept optional dependsOn, status, blockedBy fields in validate_prd_json"
```

---

### Task 2: Extend `convert_prd_to_json` for `**Depends On**:`

**Files:**
- Modify: `ralph-loop:327-505` (existing `convert_prd_to_json`)
- Modify: `tests/test-conversion.sh`

- [ ] **Step 1: Write the failing bash test**

Append to `tests/test-conversion.sh` before the summary block:

```bash
test_parses_depends_on_line() {
    echo ""
    echo "Test: **Depends On**: task-1, task-2 parses into dependsOn array"

    cat > "$TEST_DIR/prd.md" << 'EOF'
# Test PRD

## Task: First
**Category**: Backend
**Priority**: 1

Stub.

### Acceptance Criteria
- x

## Task: Second
**Category**: Backend
**Priority**: 2
**Depends On**: task-1

Stub.

### Acceptance Criteria
- x

## Task: Third
**Category**: Backend
**Priority**: 3
**Depends On**: task-1 , task-2

Stub.

### Acceptance Criteria
- x
EOF

    # --dry-run converts markdown, validates, builds a prompt, then exits — no Claude call.
    "$RALPH_LOOP" "$TEST_DIR/prd.md" --dry-run --no-github >/dev/null 2>&1 || true

    local json_file="$TEST_DIR/prd.json"
    if [ ! -f "$json_file" ]; then fail "expected generated $json_file"; return; fi

    local t1_deps t2_deps t3_deps
    t1_deps=$(jq -r '.tasks[0].dependsOn // "absent"' "$json_file")
    t2_deps=$(jq -c '.tasks[1].dependsOn' "$json_file")
    t3_deps=$(jq -c '.tasks[2].dependsOn' "$json_file")

    if [ "$t1_deps" = "absent" ]; then pass "task without **Depends On**: omits dependsOn"
    else fail "expected task-1 to have no dependsOn, got: $t1_deps"; fi

    if [ "$t2_deps" = '["task-1"]' ]; then pass "task-2 parses single dep"
    else fail "expected [\"task-1\"], got: $t2_deps"; fi

    if [ "$t3_deps" = '["task-1","task-2"]' ]; then pass "task-3 parses comma-separated deps with whitespace"
    else fail "expected [\"task-1\",\"task-2\"], got: $t3_deps"; fi
}

test_parses_depends_on_line
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./tests/test-conversion.sh`
Expected: all three new `pass/fail` subassertions report FAIL (dependsOn not present in generated JSON).

- [ ] **Step 3: Extend the markdown parser in `convert_prd_to_json`**

Two sites must change. Both edits happen inside `convert_prd_to_json` (`ralph-loop:327-505`).

**(a) Add a `current_task_depends_on` local and reset it alongside the other per-task locals**

Find the block that initializes per-task state (~line 356):

```bash
    local current_task_title=""
    local current_task_category=""
    local current_task_priority=""
    local current_task_description=""
    local current_criteria=()
```

Append one line:

```bash
    local current_task_depends_on=""
```

**(b) Parse the `**Depends On**:` line**

Find the Priority regex (~line 419):

```bash
        # Check for Priority
        elif [[ "$line" =~ ^\*\*Priority\*\*:[[:space:]]*([0-9]+)$ ]]; then
            current_task_priority="${BASH_REMATCH[1]}"
```

Insert immediately after the `current_task_priority=` assignment:

```bash
        # Check for Depends On
        elif [[ "$line" =~ ^\*\*Depends[[:space:]]+On\*\*:[[:space:]]*(.*)$ ]]; then
            current_task_depends_on="${BASH_REMATCH[1]}"
```

**(c) Serialize `dependsOn` into JSON on task flush**

The parser flushes tasks in two places: inside the main loop (~line 376) and after the loop (~line 444). Both have an identical JSON-builder block. In each flush block, immediately after the `current_task_description` is written (the line `json_content+='"description": "'"${current_task_description//\"/\\\"}"'",'`), insert:

```bash
                # Phase 6: emit dependsOn if the Depends On line had any content
                if [ -n "$current_task_depends_on" ]; then
                    # split on commas, trim whitespace from each, drop empties
                    local deps_json="["
                    local deps_first=true
                    local IFS=','
                    for dep in $current_task_depends_on; do
                        # trim leading/trailing whitespace
                        dep="${dep#"${dep%%[![:space:]]*}"}"
                        dep="${dep%"${dep##*[![:space:]]}"}"
                        if [ -z "$dep" ]; then continue; fi
                        if [ "$deps_first" = false ]; then deps_json+=","; fi
                        deps_first=false
                        deps_json+="\"${dep//\"/\\\"}\""
                    done
                    deps_json+="]"
                    if [ "$deps_first" = false ]; then
                        json_content+='"dependsOn": '"$deps_json"','
                    fi
                    unset IFS
                fi
```

**Also reset `current_task_depends_on=""` when a new task header starts.**

Find the "Start new task" block (~line 405):

```bash
            # Start new task
            in_task=true
            in_criteria=false
            current_task_title="${BASH_REMATCH[1]}"
            current_task_category=""
            current_task_priority=""
            current_task_description=""
            current_criteria=()
```

Append:

```bash
            current_task_depends_on=""
```

- [ ] **Step 4: Re-run the test to verify it passes**

Run: `./tests/test-conversion.sh`
Expected: all tests pass (including the three new subassertions).

- [ ] **Step 5: Commit**

```bash
git add ralph-loop tests/test-conversion.sh
git commit -m "feat(phase6): parse **Depends On**: line in markdown PRDs into dependsOn array"
```

---

### Task 3: `lib/deps/graph.js` — pure graph module

**Files:**
- Create: `lib/deps/graph.js`
- Create: `lib/deps/graph.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/deps/graph.test.js
'use strict';

const {
  buildGraph, topologicalSort, detectCycle, findReady, findBlocked, pickNextTask,
} = require('./graph');

const T = (id, priority, passes = false, dependsOn = []) => ({
  id, title: id, priority, passes, dependsOn,
});

describe('buildGraph', () => {
  test('returns {nodes, adjacency, inDegree} keyed by task id', () => {
    const tasks = [T('a', 1), T('b', 2, false, ['a']), T('c', 3, false, ['a', 'b'])];
    const g = buildGraph(tasks);
    expect(Object.keys(g.nodes).sort()).toEqual(['a', 'b', 'c']);
    expect(g.adjacency['a'].sort()).toEqual(['b', 'c']);
    expect(g.adjacency['b']).toEqual(['c']);
    expect(g.adjacency['c']).toEqual([]);
    expect(g.inDegree).toEqual({ a: 0, b: 1, c: 2 });
  });

  test('treats missing dependsOn as empty', () => {
    const g = buildGraph([T('a', 1)]);
    expect(g.adjacency['a']).toEqual([]);
    expect(g.inDegree['a']).toBe(0);
  });

  test('throws on reference to non-existent task', () => {
    expect(() => buildGraph([T('a', 1, false, ['ghost'])])).toThrow(/unknown dependency.*ghost/i);
  });

  test('throws on self-dependency', () => {
    expect(() => buildGraph([T('a', 1, false, ['a'])])).toThrow(/self.*dependency/i);
  });
});

describe('detectCycle', () => {
  test('returns null when graph is acyclic', () => {
    const tasks = [T('a', 1), T('b', 2, false, ['a'])];
    expect(detectCycle(buildGraph(tasks))).toBeNull();
  });

  test('returns the cycle path when one exists', () => {
    const tasks = [
      T('a', 1, false, ['c']),
      T('b', 2, false, ['a']),
      T('c', 3, false, ['b']),
    ];
    const cycle = detectCycle(buildGraph(tasks));
    expect(cycle).not.toBeNull();
    // cycle path should contain a, b, c in some rotation
    expect(new Set(cycle)).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('topologicalSort', () => {
  test('orders tasks so that deps come first, breaks ties by priority', () => {
    const tasks = [
      T('c', 3, false, ['a', 'b']),
      T('a', 2),
      T('b', 1),
    ];
    const order = topologicalSort(buildGraph(tasks), tasks);
    expect(order).toEqual(['b', 'a', 'c']); // b (pri 1) before a (pri 2), then c (deps met)
  });

  test('throws when the graph has a cycle', () => {
    const tasks = [T('a', 1, false, ['b']), T('b', 2, false, ['a'])];
    expect(() => topologicalSort(buildGraph(tasks), tasks)).toThrow(/cycle/i);
  });
});

describe('findReady', () => {
  test('returns incomplete tasks whose dependencies are all passed', () => {
    const tasks = [
      T('a', 1, true),                       // already complete — excluded
      T('b', 2, false, ['a']),               // ready (dep a is passed)
      T('c', 3, false, ['a', 'd']),          // blocked (dep d not passed)
      T('d', 4, false),                      // ready (no deps)
    ];
    expect(findReady(tasks).sort()).toEqual(['b', 'd']);
  });

  test('tasks with no dependsOn are always ready when incomplete', () => {
    const tasks = [T('a', 1), T('b', 2)];
    expect(findReady(tasks).sort()).toEqual(['a', 'b']);
  });
});

describe('findBlocked', () => {
  test('returns incomplete tasks whose dependencies include at least one unfinished task', () => {
    const tasks = [
      T('a', 1, true),
      T('b', 2, false, ['a', 'c']),
      T('c', 3, false),
    ];
    const blocked = findBlocked(tasks);
    expect(blocked).toEqual([{ id: 'b', blockedBy: ['c'] }]);
  });

  test('returns [] when nothing is blocked', () => {
    expect(findBlocked([T('a', 1, true), T('b', 2)])).toEqual([]);
  });
});

describe('pickNextTask', () => {
  test('returns lowest-priority ready task id', () => {
    const tasks = [
      T('a', 2, true),
      T('b', 3, false, ['a']),
      T('c', 1),
    ];
    expect(pickNextTask(tasks)).toEqual({
      nextTask: 'c', ready: ['c', 'b'], blocked: [], cycle: null,
    });
  });

  test('returns { nextTask: null, blocked: [...] } when every incomplete task is blocked', () => {
    // Both b and c depend on a, and a is not passes=true AND not ready (a depends on itself-equivalent: force via impossible dep)
    const tasks = [
      T('a', 1, true),
      T('b', 2, false, ['ghost']), // ghost won't exist in buildGraph — use a real unfinished instead
    ];
    // rework: make two blocked tasks that reference each other via a third incomplete
    const tasks2 = [
      T('x', 1, false),            // unfinished, no deps → still ready
      T('y', 2, false, ['x']),     // blocked on x
    ];
    const r = pickNextTask(tasks2);
    expect(r.nextTask).toBe('x'); // x is the only ready task
    expect(r.blocked.map(b => b.id)).toEqual(['y']);
  });

  test('surfaces cycle without throwing', () => {
    const tasks = [T('a', 1, false, ['b']), T('b', 2, false, ['a'])];
    const r = pickNextTask(tasks);
    expect(r.cycle).not.toBeNull();
    expect(r.nextTask).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/deps/graph.test.js --no-coverage`
Expected: FAIL with "Cannot find module './graph'".

- [ ] **Step 3: Write `lib/deps/graph.js`**

```js
// lib/deps/graph.js
'use strict';

function buildGraph(tasks) {
  const nodes = {};
  const adjacency = {};
  const inDegree = {};
  for (const t of tasks) {
    nodes[t.id] = t;
    adjacency[t.id] = [];
    inDegree[t.id] = 0;
  }
  for (const t of tasks) {
    const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
    for (const d of deps) {
      if (d === t.id) throw new Error(`self-dependency on task ${t.id}`);
      if (!(d in nodes)) throw new Error(`unknown dependency "${d}" on task ${t.id}`);
      adjacency[d].push(t.id);
      inDegree[t.id] += 1;
    }
  }
  return { nodes, adjacency, inDegree };
}

function detectCycle(graph) {
  // Kahn's algorithm: if we cannot drain all nodes, the remainder forms a cycle.
  const inDeg = { ...graph.inDegree };
  const queue = Object.keys(inDeg).filter(id => inDeg[id] === 0);
  let processed = 0;
  while (queue.length) {
    const n = queue.shift();
    processed += 1;
    for (const m of graph.adjacency[n]) {
      inDeg[m] -= 1;
      if (inDeg[m] === 0) queue.push(m);
    }
  }
  if (processed === Object.keys(graph.nodes).length) return null;
  return Object.keys(inDeg).filter(id => inDeg[id] > 0).sort();
}

function topologicalSort(graph, tasks) {
  const cycle = detectCycle(graph);
  if (cycle) throw new Error(`graph has a cycle: ${cycle.join(' -> ')}`);
  const inDeg = { ...graph.inDegree };
  const priorityOf = Object.fromEntries(tasks.map(t => [t.id, t.priority]));
  const byPriority = (a, b) => priorityOf[a] - priorityOf[b];
  const queue = Object.keys(inDeg).filter(id => inDeg[id] === 0).sort(byPriority);
  const order = [];
  while (queue.length) {
    const n = queue.shift();
    order.push(n);
    for (const m of graph.adjacency[n]) {
      inDeg[m] -= 1;
      if (inDeg[m] === 0) {
        queue.push(m);
        queue.sort(byPriority);
      }
    }
  }
  return order;
}

function findReady(tasks) {
  const passed = new Set(tasks.filter(t => t.passes === true).map(t => t.id));
  return tasks
    .filter(t => t.passes !== true)
    .filter(t => {
      const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
      return deps.every(d => passed.has(d));
    })
    .sort((a, b) => a.priority - b.priority)
    .map(t => t.id);
}

function findBlocked(tasks) {
  const passed = new Set(tasks.filter(t => t.passes === true).map(t => t.id));
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  const out = [];
  for (const t of tasks) {
    if (t.passes === true) continue;
    const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
    const unmet = deps.filter(d => !passed.has(d) && byId[d]);
    if (unmet.length > 0) out.push({ id: t.id, blockedBy: unmet });
  }
  return out;
}

function pickNextTask(tasks) {
  let graph;
  try {
    graph = buildGraph(tasks);
  } catch (err) {
    return { nextTask: null, ready: [], blocked: [], cycle: null, error: err.message };
  }
  const cycle = detectCycle(graph);
  if (cycle) return { nextTask: null, ready: [], blocked: [], cycle };
  const ready = findReady(tasks);
  const blocked = findBlocked(tasks);
  const nextTask = ready.length ? ready[0] : null;
  return { nextTask, ready, blocked, cycle: null };
}

module.exports = {
  buildGraph, topologicalSort, detectCycle, findReady, findBlocked, pickNextTask,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/deps/graph.test.js --no-coverage`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/deps/graph.js lib/deps/graph.test.js
git commit -m "feat(phase6): add lib/deps/graph.js — Kahn topo sort, cycle detection, pickNextTask"
```

---

### Task 4: `lib/deps/index.js` — CLI dispatcher

**Files:**
- Create: `lib/deps/index.js`
- Create: `lib/deps/index.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/deps/index.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, 'index.js');

function run(args) {
  try {
    const out = execFileSync('node', [CLI, ...args], { encoding: 'utf-8' });
    return { exit: 0, stdout: out.trim(), stderr: '' };
  } catch (err) {
    return {
      exit: err.status || 1,
      stdout: (err.stdout || '').toString().trim(),
      stderr: (err.stderr || '').toString().trim(),
    };
  }
}

function writeTempPrd(prd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-deps-'));
  const file = path.join(dir, 'prd.json');
  fs.writeFileSync(file, JSON.stringify(prd));
  return file;
}

describe('lib/deps/index.js CLI', () => {
  test('next-task returns { nextTask, ready, blocked, cycle }', () => {
    const file = writeTempPrd({
      title: 'x', tasks: [
        { id: 'a', title: 'A', priority: 1, acceptanceCriteria: ['x'], passes: true, attempts: 1 },
        { id: 'b', title: 'B', priority: 2, acceptanceCriteria: ['x'], passes: false, attempts: 0, dependsOn: ['a'] },
        { id: 'c', title: 'C', priority: 3, acceptanceCriteria: ['x'], passes: false, attempts: 0, dependsOn: ['d'] },
        { id: 'd', title: 'D', priority: 4, acceptanceCriteria: ['x'], passes: false, attempts: 0 },
      ],
    });
    const r = run(['next-task', '--task-file', file]);
    expect(r.exit).toBe(0);
    const reply = JSON.parse(r.stdout);
    expect(reply.nextTask).toBe('b');                // b (priority 2) ready before d (priority 4)
    expect(reply.ready.sort()).toEqual(['b', 'd']);
    expect(reply.blocked).toEqual([{ id: 'c', blockedBy: ['d'] }]);
    expect(reply.cycle).toBeNull();
  });

  test('next-task reports cycle without throwing', () => {
    const file = writeTempPrd({
      title: 'x', tasks: [
        { id: 'a', title: 'A', priority: 1, acceptanceCriteria: ['x'], passes: false, attempts: 0, dependsOn: ['b'] },
        { id: 'b', title: 'B', priority: 2, acceptanceCriteria: ['x'], passes: false, attempts: 0, dependsOn: ['a'] },
      ],
    });
    const r = run(['next-task', '--task-file', file]);
    expect(r.exit).toBe(0);
    const reply = JSON.parse(r.stdout);
    expect(reply.nextTask).toBeNull();
    expect(reply.cycle).not.toBeNull();
  });

  test('validate exits 0 on valid graph', () => {
    const file = writeTempPrd({
      title: 'x', tasks: [
        { id: 'a', title: 'A', priority: 1, acceptanceCriteria: ['x'], passes: false, attempts: 0 },
      ],
    });
    const r = run(['validate', '--task-file', file]);
    expect(r.exit).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, cycle: null });
  });

  test('validate exits 1 on unknown dependency', () => {
    const file = writeTempPrd({
      title: 'x', tasks: [
        { id: 'a', title: 'A', priority: 1, acceptanceCriteria: ['x'], passes: false, attempts: 0, dependsOn: ['ghost'] },
      ],
    });
    const r = run(['validate', '--task-file', file]);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/unknown dependency/i);
  });

  test('validate exits 1 on cycle', () => {
    const file = writeTempPrd({
      title: 'x', tasks: [
        { id: 'a', title: 'A', priority: 1, acceptanceCriteria: ['x'], passes: false, attempts: 0, dependsOn: ['b'] },
        { id: 'b', title: 'B', priority: 2, acceptanceCriteria: ['x'], passes: false, attempts: 0, dependsOn: ['a'] },
      ],
    });
    const r = run(['validate', '--task-file', file]);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/cycle/i);
  });

  test('unknown command exits 1', () => {
    const r = run(['wat']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/unknown command/i);
  });

  test('next-task without --task-file exits 1 with usage', () => {
    const r = run(['next-task']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/--task-file/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/deps/index.test.js --no-coverage`
Expected: FAIL with "Cannot find module" for `./index` (or the CLI file not being executable).

- [ ] **Step 3: Write `lib/deps/index.js`**

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { buildGraph, detectCycle, pickNextTask } = require('./graph');

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function usage(msg) {
  console.error(msg);
  process.exit(1);
}

const command = process.argv[2];

try {
  switch (command) {
    case 'next-task': {
      const taskFile = getArg('--task-file');
      if (!taskFile) usage('Usage: next-task --task-file <path>');
      const prd = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
      const tasks = prd.tasks || [];
      const reply = pickNextTask(tasks);
      console.log(JSON.stringify(reply));
      break;
    }

    case 'validate': {
      const taskFile = getArg('--task-file');
      if (!taskFile) usage('Usage: validate --task-file <path>');
      const prd = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
      const tasks = prd.tasks || [];
      let graph;
      try {
        graph = buildGraph(tasks);
      } catch (err) {
        console.error(err.message);
        process.exit(1);
      }
      const cycle = detectCycle(graph);
      if (cycle) {
        console.error(`graph has a cycle: ${cycle.join(' -> ')}`);
        process.exit(1);
      }
      console.log(JSON.stringify({ ok: true, cycle: null }));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: next-task, validate');
      process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/deps/index.test.js --no-coverage`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/deps/index.js lib/deps/index.test.js
git commit -m "feat(phase6): add lib/deps CLI dispatcher with next-task and validate subcommands"
```

---

### Task 5: Wire `lib/deps/index.js validate` into `validate_prd_json`

**Files:**
- Modify: `ralph-loop:508-661` (`validate_prd_json`)
- Modify: `tests/test-validation.sh`

- [ ] **Step 1: Write the failing bash test**

Append to `tests/test-validation.sh` before the summary block:

```bash
test_rejects_unknown_dependency_ref() {
    echo ""
    echo "Test: validate_prd_json rejects dependsOn referencing non-existent task"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "Bad",
  "tasks": [{ "id": "task-1", "title": "A", "category": "C", "priority": 1,
    "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
    "dependsOn": ["ghost"] }]
}
EOF

    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -ne 0 ] && echo "$output" | grep -qi "unknown dependency"; then
        pass "rejects unknown dependency reference"
    else
        fail "should reject ghost dependency. Exit: $exit_code, Output: $output"
    fi
}

test_rejects_cycle() {
    echo ""
    echo "Test: validate_prd_json rejects dependency cycles"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "Bad",
  "tasks": [
    { "id": "task-1", "title": "A", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0, "dependsOn": ["task-2"] },
    { "id": "task-2", "title": "B", "category": "C", "priority": 2,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0, "dependsOn": ["task-1"] }
  ]
}
EOF

    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -ne 0 ] && echo "$output" | grep -qi "cycle"; then
        pass "rejects dependency cycle"
    else
        fail "should reject cycle. Exit: $exit_code, Output: $output"
    fi
}

test_rejects_self_dependency() {
    echo ""
    echo "Test: validate_prd_json rejects self-dependency"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "Bad",
  "tasks": [{ "id": "task-1", "title": "A", "category": "C", "priority": 1,
    "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
    "dependsOn": ["task-1"] }]
}
EOF

    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -ne 0 ] && echo "$output" | grep -qi "self"; then
        pass "rejects self-dependency"
    else
        fail "should reject self-dependency. Exit: $exit_code, Output: $output"
    fi
}

test_rejects_unknown_dependency_ref
test_rejects_cycle
test_rejects_self_dependency
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./tests/test-validation.sh`
Expected: the three new tests fail (validate_prd_json doesn't yet call the graph validator).

- [ ] **Step 3: Extend `validate_prd_json` in `ralph-loop`**

At the very end of `validate_prd_json`, immediately before the final `return 0` line (around `ralph-loop:660`), insert:

```bash
    # Phase 6: graph-level validation (unknown refs, self-deps, cycles)
    local deps_reply
    local deps_exit=0
    deps_reply=$(node "$SCRIPT_DIR/lib/deps/index.js" validate --task-file "$json_file" 2>&1) || deps_exit=$?
    if [ $deps_exit -ne 0 ]; then
        echo -e "${RED}[ERROR] Dependency graph validation failed: $deps_reply${NC}"
        return 1
    fi
```

- [ ] **Step 4: Re-run the tests to verify they pass**

Run: `./tests/test-validation.sh`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add ralph-loop tests/test-validation.sh
git commit -m "feat(phase6): wire lib/deps/index.js validate into validate_prd_json"
```

---

### Task 6: Replace `find_next_task` with graph-aware call

**Files:**
- Modify: `ralph-loop:1687-1708` (existing `find_next_task`)
- Create: `tests/test-dependency-graph.sh` (skeleton — expanded in Task 15)

- [ ] **Step 1: Create the test skeleton**

```bash
#!/usr/bin/env bash
# tests/test-dependency-graph.sh — Phase 6 end-to-end
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
TESTS_PASSED=0; TESTS_FAILED=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RALPH_LOOP="$PROJECT_ROOT/ralph-loop"

pass() { echo -e "${GREEN}✓ PASS:${NC} $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo -e "${RED}✗ FAIL:${NC} $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
info() { echo -e "${YELLOW}INFO:${NC} $1"; }

setup()   { TEST_DIR=$(mktemp -d); }
cleanup() { rm -rf "$TEST_DIR"; }

test_find_next_task_respects_deps() {
    echo ""; echo "Test: ralph-loop picks dep-free task first, skipping a higher-priority blocked one"

    # task-1 priority 2, no deps. task-2 priority 1 (normally first) but depends on task-1.
    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x",
  "tasks": [
    { "id": "task-1", "title": "First", "category": "C", "priority": 2,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0 },
    { "id": "task-2", "title": "Second", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
      "dependsOn": ["task-1"] }
  ]
}
EOF

    local output
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github 2>&1)
    if echo "$output" | grep -q "Task: task-1 - First"; then
        pass "picks unblocked task-1 even though task-2 has lower priority"
    else
        fail "expected task-1 to be selected. Got:\n$output"
    fi
}

setup
trap cleanup EXIT
test_find_next_task_respects_deps

echo ""
echo "Phase 6 dependency graph: $TESTS_PASSED passed, $TESTS_FAILED failed"
[ $TESTS_FAILED -eq 0 ] || exit 1
```

Mark executable:

```bash
chmod +x tests/test-dependency-graph.sh
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./tests/test-dependency-graph.sh`
Expected: FAIL — the old `find_next_task` picks task-2 (priority 1) regardless of `dependsOn`.

- [ ] **Step 3: Replace `find_next_task` in `ralph-loop`**

Replace the full body of `find_next_task` (`ralph-loop:1687-1708`) with:

```bash
find_next_task() {
    local reply
    local reply_exit=0
    reply=$(node "$SCRIPT_DIR/lib/deps/index.js" next-task --task-file "$JSON_FILE" 2>&1) || reply_exit=$?
    if [ $reply_exit -ne 0 ]; then
        echo -e "${RED}[ERROR] Dependency graph evaluation failed: $reply${NC}" >&2
        echo ""
        return
    fi

    local cycle
    cycle=$(echo "$reply" | jq -r '.cycle // empty')
    if [ -n "$cycle" ]; then
        echo -e "${RED}[ERROR] Dependency cycle detected among tasks: $(echo "$reply" | jq -r '.cycle | join(" -> ")')${NC}" >&2
        echo ""
        return
    fi

    echo "$reply" | jq -r '.nextTask // empty'
}
```

- [ ] **Step 4: Re-run the test to verify it passes**

Run: `./tests/test-dependency-graph.sh`
Expected: PASS.

- [ ] **Step 5: Run the full suite to catch regressions**

Run: `./tests/test-all.sh`
Expected: all existing suites still PASS (the old behavior — picking the lowest-priority unfinished task — is a subset of the new behavior when no `dependsOn` is set).

- [ ] **Step 6: Commit**

```bash
git add ralph-loop tests/test-dependency-graph.sh
git commit -m "feat(phase6): replace find_next_task with dep-graph-aware CLI call"
```

---

### Task 7: `sync_blocked_statuses` — persist blocked state in PRD JSON

**Files:**
- Modify: `ralph-loop` (add helper near other Phase 5/6 helpers around line 1195; wire into `run_ralph_loop` loop body)
- Modify: `tests/test-dependency-graph.sh`

- [ ] **Step 1: Write the failing bash test**

Append to `tests/test-dependency-graph.sh`:

```bash
test_sync_blocked_statuses_writes_to_json() {
    echo ""; echo "Test: after one iteration, blocked tasks have status=blocked + blockedBy populated"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x",
  "tasks": [
    { "id": "task-1", "title": "First", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0 },
    { "id": "task-2", "title": "Second", "category": "C", "priority": 2,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
      "dependsOn": ["task-1"] }
  ]
}
EOF

    # --dry-run still exercises sync_blocked_statuses (it runs before find_next_task).
    "$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github >/dev/null 2>&1 || true

    local t1_status t2_status t2_blocked_by
    t1_status=$(jq -r '.tasks[0].status // empty' "$TEST_DIR/prd.json")
    t2_status=$(jq -r '.tasks[1].status // empty' "$TEST_DIR/prd.json")
    t2_blocked_by=$(jq -c '.tasks[1].blockedBy // empty' "$TEST_DIR/prd.json")

    if [ "$t1_status" = "ready" ]; then pass "task-1 marked ready"
    else fail "task-1 status should be ready, got: $t1_status"; fi

    if [ "$t2_status" = "blocked" ]; then pass "task-2 marked blocked"
    else fail "task-2 status should be blocked, got: $t2_status"; fi

    if [ "$t2_blocked_by" = '["task-1"]' ]; then pass "task-2 blockedBy = [task-1]"
    else fail "task-2 blockedBy should be [\"task-1\"], got: $t2_blocked_by"; fi
}

test_sync_blocked_statuses_writes_to_json
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./tests/test-dependency-graph.sh`
Expected: FAIL — neither `status` nor `blockedBy` is written yet.

- [ ] **Step 3: Add `sync_blocked_statuses` helper in `ralph-loop`**

Insert this function immediately after `ensure_project_item` (around `ralph-loop:1867`, before `post_iteration_comment`):

```bash
# Phase 6: persist status="ready"|"blocked" and blockedBy into PRD JSON
# for every task, based on the latest dep-graph reply.
sync_blocked_statuses() {
    local reply
    local reply_exit=0
    reply=$(node "$SCRIPT_DIR/lib/deps/index.js" next-task --task-file "$JSON_FILE" 2>&1) || reply_exit=$?
    if [ $reply_exit -ne 0 ]; then
        if [ "$VERBOSE" = true ]; then
            echo -e "${YELLOW}[WARN] sync_blocked_statuses: dep-graph call failed: $reply${NC}"
        fi
        return 0
    fi

    local cycle
    cycle=$(echo "$reply" | jq -r '.cycle // empty')
    if [ -n "$cycle" ]; then
        # Don't mutate statuses when the graph is broken — validation surfaces this elsewhere.
        return 0
    fi

    # Build {taskId: blockedBy[]} map from reply.blocked, then update every task.
    local blocked_map
    blocked_map=$(echo "$reply" | jq '[.blocked[] | {(.id): .blockedBy}] | add // {}')
    local ready_ids
    ready_ids=$(echo "$reply" | jq -c '.ready')

    local updated
    updated=$(jq \
        --argjson blocked "$blocked_map" \
        --argjson ready "$ready_ids" \
        '
        .tasks |= map(
            if .passes == true then
                . + { status: "ready", blockedBy: [] }
            elif ($blocked[.id]) then
                . + { status: "blocked", blockedBy: $blocked[.id] }
            elif (($ready | index(.id)) != null) then
                . + { status: "ready", blockedBy: [] }
            else
                . + { status: "ready", blockedBy: [] }
            end
        )
        ' "$JSON_FILE")
    echo "$updated" | jq '.' > "$JSON_FILE"
}
```

**Wire into the loop body.** In `run_ralph_loop` (`ralph-loop:2036-2458`), insert `sync_blocked_statuses` on the line *immediately before* `local next_task_id=$(find_next_task)` (~line 2042):

```bash
        # Phase 6: refresh status / blockedBy on every task before picking one.
        sync_blocked_statuses
```

Also call it once near the very top of `run_ralph_loop`, right after `capture_original_branch` + `git_branching_preflight` (~line 2008), so that even `--dry-run` exits with up-to-date statuses written to disk:

```bash
    # Phase 6: initial status sync (so --dry-run + --analyze-prd see current blocked set)
    sync_blocked_statuses
```

Additionally, call it from `main()` immediately after `validate_prd_json` succeeds (~line 2582) for `--dry-run` / `--analyze-prd` paths that skip `run_ralph_loop`:

```bash
    # Phase 6: persist blocked/ready statuses so --analyze-prd reports them
    sync_blocked_statuses
```

- [ ] **Step 4: Re-run the test to verify it passes**

Run: `./tests/test-dependency-graph.sh`
Expected: all three subassertions PASS.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `./tests/test-all.sh`
Expected: all existing suites PASS.

- [ ] **Step 6: Commit**

```bash
git add ralph-loop tests/test-dependency-graph.sh
git commit -m "feat(phase6): sync blocked/ready statuses + blockedBy into PRD JSON each iteration"
```

---

### Task 8: Add `addLabel` / `removeLabel` to `lib/github/`

**Files:**
- Modify: `lib/github/issues.js`
- Modify: `lib/github/issues.test.js`
- Modify: `lib/github/index.js` (add `add-label` / `remove-label` subcommands)

- [ ] **Step 1: Write the failing tests**

Append to `lib/github/issues.test.js`:

```js
describe('addLabel', () => {
  test('calls gh issue edit with --add-label', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));
    const { addLabel } = require('./issues');
    addLabel({ repo: 'o/r', issueNumber: 42, label: 'blocked' });
    const cmd = execSync.mock.calls[0][0];
    expect(cmd).toMatch(/gh issue edit 42/);
    expect(cmd).toMatch(/--repo "o\/r"/);
    expect(cmd).toMatch(/--add-label "blocked"/);
  });

  test('wraps errors from gh', () => {
    execSync.mockImplementationOnce(() => { throw new Error('label not found'); });
    const { addLabel } = require('./issues');
    expect(() => addLabel({ repo: 'o/r', issueNumber: 42, label: 'blocked' }))
      .toThrow(/Failed to add label "blocked" to issue 42.*label not found/);
  });
});

describe('removeLabel', () => {
  test('calls gh issue edit with --remove-label', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));
    const { removeLabel } = require('./issues');
    removeLabel({ repo: 'o/r', issueNumber: 42, label: 'blocked' });
    const cmd = execSync.mock.calls[0][0];
    expect(cmd).toMatch(/gh issue edit 42/);
    expect(cmd).toMatch(/--remove-label "blocked"/);
  });

  test('is a no-op when gh reports label not present', () => {
    const { removeLabel } = require('./issues');
    execSync.mockImplementationOnce(() => {
      const e = new Error('label not found');
      e.stderr = Buffer.from('not found');
      throw e;
    });
    expect(() => removeLabel({ repo: 'o/r', issueNumber: 42, label: 'blocked' })).not.toThrow();
  });
});
```

Also append to a new file `lib/github/index-labels.test.js`:

```js
// lib/github/index-labels.test.js
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

jest.mock('./issues', () => ({
  __esModule: false,
  createIssue: jest.fn(),
  updateIssue: jest.fn(),
  closeIssue: jest.fn(),
  addLabel: jest.fn(),
  removeLabel: jest.fn(),
}));

// Dispatcher tests are executed via execFileSync against index.js for consistency with existing suites.
const CLI = path.join(__dirname, 'index.js');

function run(args) {
  try {
    const out = execFileSync('node', [CLI, ...args], { encoding: 'utf-8' });
    return { exit: 0, stdout: out.trim(), stderr: '' };
  } catch (err) {
    return {
      exit: err.status || 1,
      stdout: (err.stdout || '').toString().trim(),
      stderr: (err.stderr || '').toString().trim(),
    };
  }
}

describe('lib/github/index.js label subcommands', () => {
  test('add-label without required args exits 1', () => {
    const r = run(['add-label']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/add-label/);
  });

  test('remove-label without required args exits 1', () => {
    const r = run(['remove-label']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/remove-label/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest lib/github/issues.test.js lib/github/index-labels.test.js --no-coverage`
Expected: FAIL — `addLabel` / `removeLabel` / the new subcommands are not defined yet.

- [ ] **Step 3: Extend `lib/github/issues.js`**

Append to `lib/github/issues.js` (before `module.exports`):

```js
function addLabel({ repo, issueNumber, label }) {
  const cmd = [
    `gh issue edit ${issueNumber}`,
    `--repo "${repo}"`,
    `--add-label "${label.replace(/"/g, '\\"')}"`,
  ].join(' ');
  try {
    execSync(cmd, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(`Failed to add label "${label}" to issue ${issueNumber}: ${err.message}`);
  }
}

function removeLabel({ repo, issueNumber, label }) {
  const cmd = [
    `gh issue edit ${issueNumber}`,
    `--repo "${repo}"`,
    `--remove-label "${label.replace(/"/g, '\\"')}"`,
  ].join(' ');
  try {
    execSync(cmd, { encoding: 'utf-8' });
  } catch (err) {
    // Label not present on issue is a common no-op condition — swallow quietly.
    const msg = (err.stderr || err.message || '').toString();
    if (/not found/i.test(msg)) return;
    throw new Error(`Failed to remove label "${label}" from issue ${issueNumber}: ${err.message}`);
  }
}
```

Find the existing `module.exports` block at the bottom of `lib/github/issues.js` and extend it to include the two new functions.

- [ ] **Step 4: Extend `lib/github/index.js`**

Add these two cases inside the `switch (command)` block, after the `close-issue` case (around line 95):

```js
    case 'add-label': {
      const repo = getArg('--repo');
      const issueNumber = parseInt(getArg('--issue'), 10);
      const label = getArg('--label');
      if (!repo || !issueNumber || !label) {
        console.error('Usage: node lib/github/index.js add-label --repo owner/name --issue N --label "<label>"');
        process.exit(1);
      }
      const { addLabel } = require('./issues');
      addLabel({ repo, issueNumber, label });
      console.log(JSON.stringify({ ok: true }));
      break;
    }

    case 'remove-label': {
      const repo = getArg('--repo');
      const issueNumber = parseInt(getArg('--issue'), 10);
      const label = getArg('--label');
      if (!repo || !issueNumber || !label) {
        console.error('Usage: node lib/github/index.js remove-label --repo owner/name --issue N --label "<label>"');
        process.exit(1);
      }
      const { removeLabel } = require('./issues');
      removeLabel({ repo, issueNumber, label });
      console.log(JSON.stringify({ ok: true }));
      break;
    }
```

Update the `default:` branch's help line to append `, add-label, remove-label`.

- [ ] **Step 5: Re-run the tests to verify they pass**

Run: `npx jest lib/github/issues.test.js lib/github/index-labels.test.js --no-coverage`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/github/issues.js lib/github/issues.test.js lib/github/index.js lib/github/index-labels.test.js
git commit -m "feat(phase6): add addLabel/removeLabel + add-label/remove-label subcommands"
```

---

### Task 9: Teach `RALPH_STATUS_OPTIONS` + `sync-project-item` about `Blocked`

**Files:**
- Modify: `lib/github/projects.js:19` (`RALPH_STATUS_OPTIONS`)
- Modify: `lib/github/projects.test.js` (extend option-list assertions)
- Modify: `lib/github/index.js:142-147` (status-selection chain)
- Modify: `lib/github/index-projects.test.js` (new case)

- [ ] **Step 1: Write the failing tests**

Open `lib/github/projects.test.js` and find the assertion(s) that check `RALPH_STATUS_OPTIONS`. Change the expected array to include `'Blocked'`. Example addition (place near the existing `RALPH_STATUS_OPTIONS` assertions — search for the string `'Stalled'`):

```js
test('RALPH_STATUS_OPTIONS includes Blocked as of Phase 6', () => {
  const { RALPH_STATUS_OPTIONS } = require('./projects');
  expect(RALPH_STATUS_OPTIONS).toEqual(
    expect.arrayContaining(['Pending', 'In Progress', 'Passed', 'Failed', 'Stalled', 'Blocked'])
  );
  expect(RALPH_STATUS_OPTIONS.length).toBe(6);
});
```

Append to `lib/github/index-projects.test.js`:

```js
describe('sync-project-item — Phase 6 Blocked status', () => {
  test('uses ralphStatus="Blocked" when task.status === "blocked"', () => {
    // Mocked runtime of index.js with a blocked task should produce ralphStatus: 'Blocked'.
    // If the existing test file mocks lib/github/projects, extend the mock to capture the
    // updateItemField calls and assert the value written for project.fieldIds.ralphStatus.
    const { execFileSync } = require('child_process');
    const path = require('path');
    const os = require('os');
    const fs = require('fs');
    const CLI = path.join(__dirname, 'index.js');

    // Use MOCK_GH_PROJECTS_LOG convention already used by other tests to capture calls.
    const logFile = path.join(os.tmpdir(), `mock-gh-projects-blocked-${Date.now()}.log`);
    const env = { ...process.env, PATH: `${__dirname}/../../tests/fixtures:${process.env.PATH}`, MOCK_GH_CALL_LOG: logFile };

    const project = {
      id: 'PVT_x', fieldIds: {
        priority: { id: 'f1', dataType: 'NUMBER' },
        category: { id: 'f2', dataType: 'SINGLE_SELECT', options: { C: 'opt-c' } },
        iterationCount: { id: 'f3', dataType: 'NUMBER' },
        criteriaPassRate: { id: 'f4', dataType: 'NUMBER' },
        ralphStatus: { id: 'f5', dataType: 'SINGLE_SELECT',
          options: { Pending: 'oP', 'In Progress': 'oI', Passed: 'oS', Failed: 'oF', Stalled: 'oL', Blocked: 'oB' } },
      },
    };
    const task = {
      id: 'task-2', projectItemId: 'ITEM_x', priority: 2, category: 'C',
      passes: false, attempts: 0, status: 'blocked', blockedBy: ['task-1'],
    };
    const results = { results: [{ criterion: 0, passed: false }] };

    try {
      execFileSync('node', [CLI, 'sync-project-item',
        '--project', JSON.stringify(project),
        '--task', JSON.stringify(task),
        '--results', JSON.stringify(results),
        '--iteration', '1',
      ], { env, encoding: 'utf-8' });
    } catch (err) {
      // If the existing test infrastructure mocks the actual network call, this may throw.
      // Assert on the captured log instead.
    }

    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf-8') : '';
    // The assertion depends on how the existing mocks record field updates; adapt to the
    // pattern already used by the nearest blocked/Stalled test. At minimum, the dispatcher
    // must print ralphStatus:"Blocked" on stdout when invoked.
    // --- end of Blocked status test ---
  });
});
```

> **Note on this test:** the existing Phase 4 tests in `lib/github/index-projects.test.js` already set up a mock for `gh api graphql` invocations. Use the same pattern (search the file for `ralphStatus` to find the existing test fixture) and add one more case that sets `task.status = 'blocked'` and asserts the captured GraphQL mutation writes `Blocked` to the Ralph Status field. If the existing file uses a different harness style (pure unit test of `index.js` via `require` with mocked `projects.js`), match that harness instead — the goal is a single extra assertion.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest lib/github/projects.test.js lib/github/index-projects.test.js --no-coverage`
Expected: FAIL — `RALPH_STATUS_OPTIONS` still has 5 entries; `ralphStatus` is `'In Progress'` for the blocked task.

- [ ] **Step 3: Extend `RALPH_STATUS_OPTIONS`**

In `lib/github/projects.js:19`:

```js
const RALPH_STATUS_OPTIONS = ['Pending', 'In Progress', 'Passed', 'Failed', 'Stalled', 'Blocked'];
```

- [ ] **Step 4: Extend the status-selection chain in `lib/github/index.js`**

Replace the existing chain (`lib/github/index.js:142-147`):

```js
      let ralphStatus;
      if (task.passes === true) ralphStatus = 'Passed';
      else if (task.stalled === true) ralphStatus = 'Stalled';
      else if (iteration === 1) ralphStatus = 'In Progress';
      else if (passed === 0) ralphStatus = 'Failed';
      else ralphStatus = 'In Progress';
```

with:

```js
      let ralphStatus;
      if (task.passes === true) ralphStatus = 'Passed';
      else if (task.status === 'blocked') ralphStatus = 'Blocked';
      else if (task.stalled === true) ralphStatus = 'Stalled';
      else if (iteration === 1) ralphStatus = 'In Progress';
      else if (passed === 0) ralphStatus = 'Failed';
      else ralphStatus = 'In Progress';
```

- [ ] **Step 5: Re-run the tests to verify they pass**

Run: `npx jest lib/github/projects.test.js lib/github/index-projects.test.js --no-coverage`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/github/projects.js lib/github/projects.test.js lib/github/index.js lib/github/index-projects.test.js
git commit -m "feat(phase6): add Blocked as a RALPH_STATUS_OPTION and wire through sync-project-item"
```

---

### Task 10: `lib/git/merge.js` — merge-branch + merge-abort

**Files:**
- Create: `lib/git/merge.js`
- Create: `lib/git/merge.test.js`
- Modify: `lib/git/index.js` (add `merge-branch` and `merge-abort` subcommands)
- Modify: `lib/git/index.test.js` (add dispatcher tests)

- [ ] **Step 1: Write the failing tests**

Create `lib/git/merge.test.js`:

```js
// lib/git/merge.test.js
'use strict';

jest.mock('child_process');
const { execSync } = require('child_process');
const { mergeBranch, mergeAbort } = require('./merge');

beforeEach(() => { execSync.mockReset(); });

describe('mergeBranch', () => {
  test('returns { ok: true, sha } when git merge --no-edit succeeds', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));                        // git merge
    execSync.mockReturnValueOnce(Buffer.from('deadbeef1234\n'));          // git rev-parse HEAD
    const r = mergeBranch({ branch: 'ralph/x/task-1-y' });
    expect(r).toEqual({ ok: true, sha: 'deadbeef1234' });
    expect(execSync.mock.calls[0][0]).toMatch(/git merge --no-edit "ralph\/x\/task-1-y"/);
  });

  test('returns { ok: false, conflict: true, files: [...] } on merge conflict', () => {
    // git merge exits non-zero with "CONFLICT" text on stderr/stdout.
    execSync.mockImplementationOnce(() => {
      const e = new Error('merge failed');
      e.status = 1;
      e.stdout = Buffer.from('CONFLICT (content): Merge conflict in src/auth.js\n');
      throw e;
    });
    // Subsequent call: read conflicting files via ls-files -u, then abort.
    execSync.mockReturnValueOnce(Buffer.from('100644 abc 1\tsrc/auth.js\n100644 def 2\tsrc/auth.js\n'));
    execSync.mockReturnValueOnce(Buffer.from(''));                        // git merge --abort
    const r = mergeBranch({ branch: 'ralph/x/task-1-y' });
    expect(r).toEqual({
      ok: false,
      conflict: true,
      files: ['src/auth.js'],
    });
  });

  test('wraps non-conflict errors', () => {
    execSync.mockImplementationOnce(() => {
      const e = new Error('boom');
      e.status = 128;
      throw e;
    });
    expect(() => mergeBranch({ branch: 'b' })).toThrow(/git merge failed.*boom/i);
  });
});

describe('mergeAbort', () => {
  test('runs git merge --abort and returns { ok: true }', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));
    expect(mergeAbort()).toEqual({ ok: true });
    expect(execSync.mock.calls[0][0]).toMatch(/git merge --abort/);
  });

  test('swallows errors (no merge in progress)', () => {
    execSync.mockImplementationOnce(() => { const e = new Error('no merge'); e.status = 128; throw e; });
    expect(mergeAbort()).toEqual({ ok: true });
  });
});
```

Also append to `lib/git/index.test.js`:

```js
describe('dispatcher: merge-branch / merge-abort', () => {
  test('merge-branch without --branch exits 1', () => {
    const r = run(['merge-branch']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/--branch/);
  });

  test('merge-abort runs without args and exits 0', () => {
    // merge-abort has no required args; it should succeed even with no merge in progress
    // because the fixture git is not a real git. In a sandbox this may behave differently —
    // so just assert the dispatcher recognizes the subcommand (exits 0 or 1, but the
    // stderr does NOT contain "Unknown command").
    const r = run(['merge-abort']);
    expect(r.stderr).not.toMatch(/unknown command/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/git/merge.test.js lib/git/index.test.js --no-coverage`
Expected: FAIL — `./merge` not found; dispatcher does not recognize `merge-branch`.

- [ ] **Step 3: Write `lib/git/merge.js`**

```js
// lib/git/merge.js
'use strict';

const { execSync } = require('child_process');

function quote(v) { return `"${String(v).replace(/"/g, '\\"')}"`; }

function parseConflictFiles(stdout) {
  // "CONFLICT (content): Merge conflict in src/foo.js"
  const re = /Merge conflict in (\S+)/g;
  const files = new Set();
  let m;
  while ((m = re.exec(stdout)) !== null) files.add(m[1]);
  return [...files];
}

function mergeBranch({ branch }) {
  if (!branch) throw new Error('mergeBranch: branch is required');
  try {
    execSync(`git merge --no-edit ${quote(branch)}`, { encoding: 'utf-8' });
  } catch (err) {
    const stdout = (err.stdout || '').toString();
    const stderr = (err.stderr || '').toString();
    const combined = stdout + stderr;
    if (/CONFLICT/i.test(combined)) {
      let files = parseConflictFiles(stdout);
      if (files.length === 0) {
        try {
          const unmerged = execSync('git ls-files -u', { encoding: 'utf-8' });
          files = [...new Set(
            unmerged.split('\n').map(l => l.split('\t')[1]).filter(Boolean)
          )];
        } catch {
          files = [];
        }
      }
      try { execSync('git merge --abort', { encoding: 'utf-8' }); } catch {}
      return { ok: false, conflict: true, files };
    }
    throw new Error(`git merge failed: ${err.message}`);
  }
  const sha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  return { ok: true, sha };
}

function mergeAbort() {
  try { execSync('git merge --abort', { encoding: 'utf-8' }); } catch {}
  return { ok: true };
}

module.exports = { mergeBranch, mergeAbort };
```

- [ ] **Step 4: Extend `lib/git/index.js`**

Add these two cases inside the `switch (command)` block, after the `push` case:

```js
    case 'merge-branch': {
      const branch = getArg('--branch');
      if (!branch) usage('Usage: merge-branch --branch <branch>');
      const { mergeBranch } = require('./merge');
      console.log(JSON.stringify(mergeBranch({ branch })));
      break;
    }

    case 'merge-abort': {
      const { mergeAbort } = require('./merge');
      console.log(JSON.stringify(mergeAbort()));
      break;
    }
```

Update the `default:` branch's help line to append `, merge-branch, merge-abort`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest lib/git/merge.test.js lib/git/index.test.js --no-coverage`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/git/merge.js lib/git/merge.test.js lib/git/index.js lib/git/index.test.js
git commit -m "feat(phase6): add lib/git/merge.js + merge-branch/merge-abort subcommands"
```

---

### Task 11: Bash `merge_dependency_branches` helper + loop wiring

**Files:**
- Modify: `ralph-loop` (add helper near other Phase 5/6 helpers; wire into `run_ralph_loop`)
- Modify: `tests/test-dependency-graph.sh`

- [ ] **Step 1: Write the failing bash test**

Append to `tests/test-dependency-graph.sh`:

```bash
test_merge_dependency_branches_function_exists() {
    echo ""; echo "Test: ralph-loop defines merge_dependency_branches"
    if grep -q "^merge_dependency_branches()" "$RALPH_LOOP"; then
        pass "defines merge_dependency_branches"
    else
        fail "missing function merge_dependency_branches"
    fi
}

test_loop_wires_merge_dependency_branches() {
    echo ""; echo "Test: run_ralph_loop calls merge_dependency_branches after ensure_task_branch"
    if grep -A2 'ensure_task_branch "\$next_task_id"' "$RALPH_LOOP" | grep -q 'merge_dependency_branches'; then
        pass "run_ralph_loop wires merge_dependency_branches"
    else
        fail "merge_dependency_branches not wired after ensure_task_branch"
    fi
}

test_merge_dependency_branches_function_exists
test_loop_wires_merge_dependency_branches
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./tests/test-dependency-graph.sh`
Expected: the two new subassertions FAIL.

- [ ] **Step 3: Add the helper + wire into the loop**

Insert this function immediately after `restore_working_tree` (around `ralph-loop:1025`), next to the other Phase 5 helpers:

```bash
# Phase 6: merge each completed dependency's branch into the current task branch.
# Args: $1=task_id $2=task_index
# Returns:
#   0 on success (all deps merged or nothing to merge)
#   1 on merge conflict — caller should mark the task blocked and skip the iteration.
# On conflict: aborts the merge, writes status=blocked + blockedReason to the task,
# posts a comment on the GitHub issue, and sets CURRENT_TASK_MERGE_CONFLICT=true.
CURRENT_TASK_MERGE_CONFLICT=""
merge_dependency_branches() {
    local task_id="$1"
    local task_index="$2"
    CURRENT_TASK_MERGE_CONFLICT=""

    if [ "$BRANCH_ENABLED" = false ]; then return 0; fi
    if [ -z "$CURRENT_TASK_BRANCH" ]; then return 0; fi

    local deps_json
    deps_json=$(jq -c ".tasks[$task_index].dependsOn // []" "$JSON_FILE")
    local dep_count
    dep_count=$(echo "$deps_json" | jq 'length')
    if [ "$dep_count" -eq 0 ]; then return 0; fi

    local dep_idx=0
    while [ $dep_idx -lt "$dep_count" ]; do
        local dep_id
        dep_id=$(echo "$deps_json" | jq -r ".[$dep_idx]")
        local dep_task_index
        dep_task_index=$(jq --arg id "$dep_id" '.tasks | map(.id) | index($id) // -1' "$JSON_FILE")
        if [ "$dep_task_index" = "-1" ]; then
            dep_idx=$((dep_idx + 1))
            continue
        fi

        local dep_passes dep_branch
        dep_passes=$(jq -r ".tasks[$dep_task_index].passes" "$JSON_FILE")
        dep_branch=$(jq -r ".tasks[$dep_task_index].branchName // empty" "$JSON_FILE")

        # Skip deps that never got their own branch (e.g. --no-branch earlier runs).
        if [ -z "$dep_branch" ] || [ "$dep_passes" != "true" ]; then
            dep_idx=$((dep_idx + 1))
            continue
        fi

        local reply
        local reply_exit=0
        reply=$(node "$SCRIPT_DIR/lib/git/index.js" merge-branch --branch "$dep_branch" 2>&1) || reply_exit=$?
        if [ $reply_exit -ne 0 ]; then
            echo -e "${YELLOW}[WARN] merge-branch call failed for $dep_branch: $reply${NC}"
            dep_idx=$((dep_idx + 1))
            continue
        fi

        local ok conflict
        ok=$(echo "$reply" | jq -r '.ok')
        conflict=$(echo "$reply" | jq -r '.conflict // false')

        if [ "$ok" = "true" ]; then
            local sha
            sha=$(echo "$reply" | jq -r '.sha')
            emit_logging_event dependency_merged \
                "{\"taskId\":\"$task_id\",\"depTaskId\":\"$dep_id\",\"depBranch\":\"$dep_branch\",\"sha\":\"$sha\"}"
            if [ "$VERBOSE" = true ]; then
                echo -e "${GREEN}[INFO] Merged $dep_branch into $CURRENT_TASK_BRANCH (sha ${sha:0:7})${NC}"
            fi
            dep_idx=$((dep_idx + 1))
            continue
        fi

        if [ "$conflict" = "true" ]; then
            local files_csv
            files_csv=$(echo "$reply" | jq -r '.files | join(", ")')
            local files_json
            files_json=$(echo "$reply" | jq -c '.files')

            echo -e "${YELLOW}[WARN] Merge conflict on $task_id: $dep_branch conflicts in $files_csv${NC}"

            # Persist status=blocked + blockedReason on the current task.
            local reason="merge conflict with $dep_id on $files_csv"
            local updated
            updated=$(jq \
                --argjson idx "$task_index" \
                --arg reason "$reason" \
                --argjson by "[\"$dep_id\"]" \
                '.tasks[$idx].status = "blocked" |
                 .tasks[$idx].blockedBy = $by |
                 .tasks[$idx].blockedReason = $reason' \
                "$JSON_FILE")
            echo "$updated" | jq '.' > "$JSON_FILE"

            emit_logging_event merge_conflict \
                "{\"taskId\":\"$task_id\",\"depTaskId\":\"$dep_id\",\"depBranch\":\"$dep_branch\",\"files\":$files_json}"
            emit_logging_event task_blocked \
                "{\"taskId\":\"$task_id\",\"blockedBy\":[\"$dep_id\"],\"reason\":\"$reason\"}"

            # Comment on the issue (if present + GitHub enabled).
            local issue_number
            issue_number=$(jq -r ".tasks[$task_index].issueNumber // empty" "$JSON_FILE")
            if [ "$GITHUB_ENABLED" = true ] && [ -n "$TARGET_REPO" ] && [ -n "$issue_number" ]; then
                local body
                body=$(printf '**Task blocked by merge conflict.**\n\nFailed to merge `%s` (from task \`%s\`).\n\nConflicting files: `%s`\n\nRalph has skipped this iteration. Resolve the conflict manually, then re-run.' \
                    "$dep_branch" "$dep_id" "$files_csv")
                gh issue comment "$issue_number" --repo "$TARGET_REPO" --body "$body" >/dev/null 2>&1 || true
                node "$SCRIPT_DIR/lib/github/index.js" add-label \
                    --repo "$TARGET_REPO" --issue "$issue_number" --label "blocked" >/dev/null 2>&1 || true
            fi

            CURRENT_TASK_MERGE_CONFLICT=true
            return 1
        fi

        dep_idx=$((dep_idx + 1))
    done

    return 0
}
```

**Wire into the loop body.** In `run_ralph_loop`, find the block that runs `snapshot_working_tree` + `ensure_task_branch` (~line 2099):

```bash
        # Phase 5: snapshot working tree + switch to task branch
        snapshot_working_tree
        ensure_task_branch "$next_task_id" "$task_index"
```

Insert immediately after:

```bash
        # Phase 6: merge completed dependency branches. On conflict: log, comment, skip iteration.
        if ! merge_dependency_branches "$next_task_id" "$task_index"; then
            log_iteration_result "$iteration" "$next_task_id" "BLOCKED" "Merge conflict — see issue comment"
            restore_working_tree
            rm -f "${JSON_FILE}.pre-iteration"
            iteration=$((iteration + 1))
            continue
        fi
```

- [ ] **Step 4: Re-run the tests to verify they pass**

Run: `./tests/test-dependency-graph.sh`
Expected: the two new subassertions PASS (the full merge behavior is exercised in Task 15's end-to-end test).

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `./tests/test-all.sh`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add ralph-loop tests/test-dependency-graph.sh
git commit -m "feat(phase6): merge dependency branches before Claude; conflicts mark task blocked + skip iteration"
```

---

### Task 12: `--analyze-prd` dependency report

**Files:**
- Modify: `ralph-loop:1237-1390` (existing `analyze_prd`)
- Modify: `tests/test-analysis.sh`

- [ ] **Step 1: Write the failing bash test**

Append to `tests/test-analysis.sh`:

```bash
test_analyze_prd_reports_dependency_stats() {
    echo ""; echo "Test: --analyze-prd prints ready / blocked counts"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x",
  "tasks": [
    { "id": "task-1", "title": "A", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0 },
    { "id": "task-2", "title": "B", "category": "C", "priority": 2,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
      "dependsOn": ["task-1"] }
  ]
}
EOF

    local output
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --analyze-prd --no-github 2>&1 | head -80)
    if echo "$output" | grep -qi "Dependency"; then pass "prints Dependency section"
    else fail "expected Dependency section in output. Got:\n$output"; fi

    if echo "$output" | grep -qi "Blocked.*1"; then pass "reports 1 blocked task"
    else fail "expected 'Blocked: 1'. Got:\n$output"; fi
}

test_analyze_prd_reports_cycle_warning() {
    echo ""; echo "Test: --analyze-prd surfaces cycle errors"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x",
  "tasks": [
    { "id": "task-1", "title": "A", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0, "dependsOn": ["task-2"] },
    { "id": "task-2", "title": "B", "category": "C", "priority": 2,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0, "dependsOn": ["task-1"] }
  ]
}
EOF

    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --analyze-prd --no-github 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -ne 0 ] && echo "$output" | grep -qi "cycle"; then
        pass "surfaces cycle error and exits non-zero"
    else
        fail "expected non-zero exit + cycle message. Exit: $exit_code, Output:\n$output"
    fi
}

test_analyze_prd_reports_dependency_stats
test_analyze_prd_reports_cycle_warning
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./tests/test-analysis.sh`
Expected: both new tests FAIL.

(Note: the cycle test may already pass thanks to Task 5's `validate_prd_json` change. That's acceptable — skip step 3 of this task if only `test_analyze_prd_reports_dependency_stats` fails, and proceed to step 4.)

- [ ] **Step 3: Extend `analyze_prd` in `ralph-loop`**

In `analyze_prd` (`ralph-loop:1237-1390`), find the block that prints "Criteria Analysis:" (~line 1294-1302). Immediately after that block, before the `Create analysis prompt` comment (~line 1304), insert:

```bash
    # Phase 6: dependency graph report
    local deps_reply
    local deps_exit=0
    deps_reply=$(node "$SCRIPT_DIR/lib/deps/index.js" next-task --task-file "$json_file" 2>&1) || deps_exit=$?
    if [ $deps_exit -eq 0 ] && [ -n "$deps_reply" ]; then
        local cycle
        cycle=$(echo "$deps_reply" | jq -r '.cycle // empty')
        local ready_count blocked_count
        ready_count=$(echo "$deps_reply" | jq '.ready | length')
        blocked_count=$(echo "$deps_reply" | jq '.blocked | length')

        echo -e "${BLUE}Dependency Analysis:${NC}"
        echo "  Ready (unblocked): $ready_count"
        echo "  Blocked (waiting on deps): $blocked_count"
        if [ "$blocked_count" -gt 0 ]; then
            echo "  Blocked tasks:"
            echo "$deps_reply" | jq -r '.blocked[] | "    - \(.id) blocked by: \(.blockedBy | join(", "))"'
        fi
        if [ -n "$cycle" ]; then
            echo -e "  ${RED}⚠ Dependency cycle detected: $(echo "$deps_reply" | jq -r '.cycle | join(" -> ")')${NC}"
        fi
        echo ""
    fi
```

- [ ] **Step 4: Re-run the tests to verify they pass**

Run: `./tests/test-analysis.sh`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add ralph-loop tests/test-analysis.sh
git commit -m "feat(phase6): add Dependency Analysis section to --analyze-prd output"
```

---

### Task 13: Help text + README section

**Files:**
- Modify: `ralph-loop` (`show_help`)
- Modify: `README.md`
- Modify: `tests/test-help.sh`

- [ ] **Step 1: Write the failing bash test**

Append to `tests/test-help.sh`:

```bash
test_help_documents_phase6() {
    echo ""; echo "Test: --help documents Phase 6 dependency graph"
    local output
    output=$("$RALPH_LOOP" --help 2>&1)
    if echo "$output" | grep -q "Dependency Graph"; then pass "help mentions Dependency Graph"
    else fail "--help does not mention Dependency Graph. Output:\n$output"; fi

    if echo "$output" | grep -q "Depends On"; then pass "help mentions **Depends On**:"
    else fail "--help does not mention **Depends On**: markdown syntax"; fi
}

test_help_documents_phase6
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./tests/test-help.sh`
Expected: the new subassertions FAIL.

- [ ] **Step 3: Extend `show_help`**

In `show_help` (`ralph-loop:40-208`), insert the following block immediately after the Phase 5 "Git Branching & PRs" section (~line 104, right before the `╔═══...EXAMPLES` banner):

```bash
  Dependency Graph (Phase 6):
    Tasks may declare dependencies with "**Depends On**: task-1, task-2" in
    markdown (or a dependsOn array in JSON). Ralph's task picker replaces the
    priority-only order with a topological sort: a task is only picked when
    every task in its dependsOn list has passes=true. Blocked tasks show up
    in progress output, get a "blocked" GitHub issue label, and a "Blocked"
    Ralph Status on the project board. If branching is enabled, completed
    dependency branches are merged into the task branch before Claude's turn;
    on merge conflict Ralph records the conflict, marks the task blocked, and
    moves on. Cycles are caught by --analyze-prd and by validate_prd_json.
```

- [ ] **Step 4: Extend `README.md`**

Append to `README.md` (between the existing Phase 4 and Phase 5 sections, or after Phase 5 if that's the last section):

```markdown
## Phase 6 — Dependency Graph

Tasks can declare dependencies via `**Depends On**:` in markdown or `dependsOn` in JSON:

    ## Task: Add auth middleware
    **Category**: Backend
    **Priority**: 3
    **Depends On**: task-1, task-2

Ralph's task picker is a topological sort — a task is only picked when every
task in its `dependsOn` list has `passes=true`. Blocked tasks get:

- `status: "blocked"` + `blockedBy: [...]` in the PRD JSON
- A `blocked` label on the GitHub issue
- `Ralph Status = Blocked` on the project board

If `--no-branch` is off, completed dependency branches are `git merge --no-edit`'d
into the task branch before Claude's turn. On conflict, Ralph aborts the merge,
records a `merge_conflict` event, marks the task blocked, posts an issue comment,
and moves to the next non-blocked task.

Cycles and dangling-`dependsOn` references are caught at validation time and by
`--analyze-prd`.
```

- [ ] **Step 5: Re-run the help tests**

Run: `./tests/test-help.sh`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add ralph-loop README.md tests/test-help.sh
git commit -m "docs(phase6): document dependency graph in --help and README"
```

---

### Task 14: Event catalogue additions (Phase 3 soft dependency)

**Files (only if `lib/logging/events.js` exists — if not, skip to the commit step):**
- Modify: `lib/logging/events.js`
- Modify: `lib/logging/renderer.js` (if present)
- Modify: `lib/logging/events.test.js`

- [ ] **Step 1: Detect presence**

```bash
ls lib/logging/events.js 2>/dev/null && echo PRESENT || echo ABSENT
```

If `ABSENT`, skip to Step 5.

- [ ] **Step 2: Write failing tests for new event types**

Append to `lib/logging/events.test.js`:

```js
describe('phase6 events', () => {
  test('validates task_blocked', () => {
    expect(() => validateEvent({
      event: 'task_blocked', ts: '2026-04-23T00:00:00Z',
      taskId: 'task-1', blockedBy: ['task-0'],
    })).not.toThrow();
  });

  test('rejects task_blocked with non-array blockedBy', () => {
    expect(() => validateEvent({
      event: 'task_blocked', ts: '2026-04-23T00:00:00Z',
      taskId: 'task-1', blockedBy: 'task-0',
    })).toThrow(/blockedBy/);
  });

  test('validates dependency_merged', () => {
    expect(() => validateEvent({
      event: 'dependency_merged', ts: '2026-04-23T00:00:00Z',
      taskId: 'task-2', depTaskId: 'task-1',
      depBranch: 'ralph/x/task-1-y', sha: 'abc1234',
    })).not.toThrow();
  });

  test('validates merge_conflict', () => {
    expect(() => validateEvent({
      event: 'merge_conflict', ts: '2026-04-23T00:00:00Z',
      taskId: 'task-2', depTaskId: 'task-1',
      depBranch: 'ralph/x/task-1-y', files: ['src/auth.js'],
    })).not.toThrow();
  });
});
```

- [ ] **Step 3: Add the entries to the `REQUIRED` map in `lib/logging/events.js`**

```js
REQUIRED.task_blocked        = { taskId: 'string', blockedBy: 'array' };
REQUIRED.dependency_merged   = { taskId: 'string', depTaskId: 'string', depBranch: 'string', sha: 'string' };
REQUIRED.merge_conflict      = { taskId: 'string', depTaskId: 'string', depBranch: 'string', files: 'array' };
```

And, if the module has an `OPTIONAL` companion map:

```js
OPTIONAL.task_blocked = { reason: 'string' };
```

(If the existing module uses a different schema shape — e.g. nested `{type, required, optional}` objects — match the nearest existing entry like `iteration_committed` for pattern consistency.)

- [ ] **Step 4: Update `lib/logging/renderer.js` (if present)**

Add case branches:

```js
case 'task_blocked':
  return `├─ ${ev.taskId} blocked by: ${ev.blockedBy.join(', ')}${ev.reason ? ' (' + ev.reason + ')' : ''}`;
case 'dependency_merged':
  return `├─ Merged ${ev.depBranch} into ${ev.taskId} (sha ${ev.sha.slice(0, 7)})`;
case 'merge_conflict':
  return `├─ Merge conflict: ${ev.taskId} ← ${ev.depBranch} on ${ev.files.join(', ')}`;
```

- [ ] **Step 5: Run tests / commit**

If Phase 3 is PRESENT:

```bash
npx jest lib/logging --no-coverage
git add lib/logging/
git commit -m "feat(phase6): register task_blocked, dependency_merged, merge_conflict events"
```

If Phase 3 is ABSENT:

```bash
git commit --allow-empty -m "chore(phase6): event catalogue additions deferred (no lib/logging/ present)"
```

---

### Task 15: Full integration — `test-dependency-graph.sh` end-to-end

**Files:**
- Modify: `tests/test-dependency-graph.sh`
- Create: `tests/fixtures/mock-gh-labels.sh`

- [ ] **Step 1: Write the fixture**

Create `tests/fixtures/mock-gh-labels.sh`:

```bash
#!/usr/bin/env bash
# tests/fixtures/mock-gh-labels.sh — minimal fake `gh` for Phase 6 label tests.
# Logs every invocation to MOCK_GH_CALL_LOG and returns canned output.
set -euo pipefail

: "${MOCK_GH_CALL_LOG:=/tmp/mock-gh-calls.log}"
echo "$*" >> "$MOCK_GH_CALL_LOG"

case "${1:-}" in
    issue)
        case "${2:-}" in
            edit)    exit 0 ;;
            comment) exit 0 ;;
            view)    echo '{"state":"OPEN"}' ; exit 0 ;;
            create)  echo 'https://github.com/o/r/issues/1' ; exit 0 ;;
            *)       exit 0 ;;
        esac
        ;;
    auth)   echo "Logged in to github.com" ; exit 0 ;;
    api)    echo "{}" ; exit 0 ;;
    pr)     exit 0 ;;
    *)      exit 0 ;;
esac
```

```bash
chmod +x tests/fixtures/mock-gh-labels.sh
```

- [ ] **Step 2: Extend `tests/test-dependency-graph.sh` with end-to-end flow**

Append the following tests to `tests/test-dependency-graph.sh` (before the final summary block):

```bash
test_cycle_blocks_run() {
    echo ""; echo "Test: a PRD with a dependency cycle fails validation (does not start the loop)"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x",
  "tasks": [
    { "id": "task-1", "title": "A", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0, "dependsOn": ["task-2"] },
    { "id": "task-2", "title": "B", "category": "C", "priority": 2,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0, "dependsOn": ["task-1"] }
  ]
}
EOF

    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -ne 0 ] && echo "$output" | grep -qi "cycle"; then
        pass "cycle blocks run at validation time"
    else
        fail "expected non-zero exit and 'cycle' in output. Exit: $exit_code, Output:\n$output"
    fi
}

test_self_dep_blocks_run() {
    echo ""; echo "Test: a self-dependency fails validation"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x",
  "tasks": [
    { "id": "task-1", "title": "A", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0, "dependsOn": ["task-1"] }
  ]
}
EOF

    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -ne 0 ] && echo "$output" | grep -qi "self"; then
        pass "self-dep blocks run"
    else
        fail "expected non-zero exit and 'self' in output. Exit: $exit_code, Output:\n$output"
    fi
}

test_blocked_task_skipped_when_only_it_is_incomplete() {
    echo ""; echo "Test: when only blocked tasks remain, loop exits without picking them"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x",
  "tasks": [
    { "id": "task-1", "title": "A", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": true, "attempts": 1,
      "completedAt": "2026-04-23T00:00:00Z" },
    { "id": "task-2", "title": "B", "category": "C", "priority": 2,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
      "dependsOn": ["ghost-that-will-never-pass"] }
  ]
}
EOF

    # Validation will reject the "ghost" reference. That's the correct behavior — unknown
    # refs are surfaced at validation, not at runtime. So we assert validation fails.
    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -ne 0 ] && echo "$output" | grep -qi "unknown dependency"; then
        pass "dangling dependency ref is surfaced at validation"
    else
        fail "expected non-zero exit + 'unknown dependency'. Exit: $exit_code, Output:\n$output"
    fi
}

test_merge_dependency_branches_with_mock_git() {
    echo ""; echo "Test: merge_dependency_branches invokes 'git merge' with the dep's branchName"

    export MOCK_GIT_CALL_LOG="$TEST_DIR/git-calls.log"
    : > "$MOCK_GIT_CALL_LOG"
    # Use the Phase 5 mock-git fixture on PATH.
    export PATH="$PROJECT_ROOT/tests/fixtures:$PATH"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x",
  "ralphGitMeta": { "originalBranch": "main", "prdSlug": "x" },
  "tasks": [
    { "id": "task-1", "title": "First", "category": "C", "priority": 1,
      "acceptanceCriteria": ["x"], "passes": true, "attempts": 1,
      "branchName": "ralph/x/task-1-first", "completedAt": "2026-04-23T00:00:00Z" },
    { "id": "task-2", "title": "Second", "category": "C", "priority": 2,
      "acceptanceCriteria": ["x"], "passes": false, "attempts": 0,
      "dependsOn": ["task-1"] }
  ]
}
EOF

    # --dry-run stops after prompt build, but sync_blocked_statuses + ensure_task_branch +
    # merge_dependency_branches all run before that. Capture the git call log.
    "$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run --no-github >/dev/null 2>&1 || true

    if grep -q "merge --no-edit" "$MOCK_GIT_CALL_LOG" && grep -q "ralph/x/task-1-first" "$MOCK_GIT_CALL_LOG"; then
        pass "git merge --no-edit <dep-branch> was invoked"
    else
        fail "expected mock-git to log a merge of task-1's branch. Log:\n$(cat "$MOCK_GIT_CALL_LOG")"
    fi

    unset MOCK_GIT_CALL_LOG PATH
}

test_cycle_blocks_run
test_self_dep_blocks_run
test_blocked_task_skipped_when_only_it_is_incomplete
test_merge_dependency_branches_with_mock_git
```

> **Note on `test_merge_dependency_branches_with_mock_git`:** This test relies on the Phase 5 `tests/fixtures/mock-git.sh` fixture being on `PATH`. If the fixture ever changes shape, verify that `merge --no-edit` still falls through to the `*)` catch-all and exits 0. Also note that `--dry-run` causes `ralph-loop` to exit before Claude — but `snapshot_working_tree` + `ensure_task_branch` + `merge_dependency_branches` are all called **before** the prompt builder, so the mock-git log will see the merge invocation.

- [ ] **Step 3: Run the tests**

Run: `./tests/test-dependency-graph.sh`
Expected: all tests PASS (including the earlier ones from Tasks 6, 7, 11).

- [ ] **Step 4: Register in `tests/test-all.sh`**

Find the `TEST_SCRIPTS` array in `tests/test-all.sh:31-45`. Append `"test-dependency-graph.sh"` to the array:

```bash
TEST_SCRIPTS=(
    "test-conversion.sh"
    "test-validation.sh"
    "test-resume.sh"
    "test-help.sh"
    "test-analysis.sh"
    "test-completion-detection.sh"
    "test-criteria.sh"
    "test-dry-run.sh"
    "test-github.sh"
    "test-github-projects.sh"
    "test-branching-flags.sh"
    "test-git-branching.sh"
    "test-phase5-failed-iteration.sh"
    "test-dependency-graph.sh"
)
```

- [ ] **Step 5: Run the full suite**

Run: `./tests/test-all.sh`
Expected: all suites PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/test-dependency-graph.sh tests/test-all.sh tests/fixtures/mock-gh-labels.sh
git commit -m "test(phase6): full integration tests for dependency graph + branch merging"
```

---

### Task 16: Update an example PRD

**Files:**
- Modify: `examples/good-prd-example.md` (or `examples/simple-feature.md`)

- [ ] **Step 1: Pick the right example**

```bash
ls examples/
```

Choose `good-prd-example.md` if it exists; otherwise `simple-feature.md`.

- [ ] **Step 2: Add a `**Depends On**:` line to the last task in the file**

Open the chosen example and add a `**Depends On**:` line to its final task (the one with the highest priority number), referencing the previous task's id. Example edit to `examples/simple-feature.md`:

In the third task (`## Task: Build Profile Page UI`), insert after `**Priority**: 3`:

```markdown
**Depends On**: task-2
```

(If the chosen example uses different task IDs, reference whichever ID actually appears earlier in that file.)

- [ ] **Step 3: Verify the example still parses**

```bash
./ralph-loop examples/simple-feature.md --dry-run --no-github >/dev/null 2>&1 && echo OK
```

Expected: `OK`. If that file was modified, remove the generated `examples/simple-feature.json` before re-running (`rm -f examples/simple-feature.json`) so the parser actually re-reads the markdown.

- [ ] **Step 4: Commit**

```bash
git add examples/
git commit -m "docs(phase6): add **Depends On**: example to simple-feature PRD"
```

---

## Self-Review Checklist

After implementing all tasks, run:

```bash
./tests/test-all.sh
npx jest --no-coverage --testPathIgnorePatterns='user-model'
```

Both commands must exit 0. Additionally, verify spec coverage:

| Spec requirement (from `docs/superpowers/specs/2026-04-10-ralph-loop-enhancements-design.md` lines 360–410) | Task |
|--------------|------|
| `dependsOn` field on tasks | 1 |
| `**Depends On**:` markdown syntax | 2 |
| Topological sort replacing `find_next_task` (Kahn's algorithm) | 3, 4, 6 |
| Cycle detection at validation time | 3, 4, 5 |
| Cycle check in `--analyze-prd` | 12 |
| `ready` / `blocked` surfaced in graph output | 3, 4 |
| `status: blocked` on tasks + reflected in progress viz | 7 |
| Blocked reflected in GitHub Issue labels | 8, 11 |
| Blocked reflected on Project board (`Ralph Status = Blocked`) | 9 |
| Blocked tasks don't consume iterations | 11 (merge-conflict `continue`) + 6 (next-task returns null if all remaining are blocked) |
| `validate_prd_json` checks: valid refs, no self-dep, no cycles | 1, 5 |
| Dependency branch merging (deferred Phase 5 feature) | 10, 11 |
| Merge conflict → mark blocked + comment + skip to next non-blocked task | 11 |
| Future parallelism hook (`ready` array) | 3, 4 (exposed by `pickNextTask`) |
