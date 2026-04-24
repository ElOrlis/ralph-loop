# Phase 5 — Git Branching & PRs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every task gets its own git branch (`ralph/<prd-slug>/task-<id>-<slug>`) forked off the caller's current branch, each iteration becomes its own commit with structured trailers, and a draft pull request is opened after the first commit and marked ready when all criteria pass — with a `--no-branch` escape hatch.

**Architecture:** A new top-level module `lib/git/` owns all git-plumbing logic (slug, branches, stash, commits, CLI dispatcher). A new `lib/github/pullrequests.js` owns PR creation and status transitions and plugs into the existing `lib/github/index.js` dispatcher. Bash gains `snapshot_working_tree`, `ensure_task_branch`, `commit_iteration`, `restore_working_tree`, `ensure_task_pr`, `mark_pr_ready`, and wires them into `run_ralph_loop` around the Claude call. Branching is gated by a new `BRANCH_ENABLED` global that defaults to `true` when GitHub is enabled; `--no-branch` or `--no-github` flips it off. Each task's `branchName`, `prNumber`, `prUrl` live in the task JSON; the PRD root gains `ralphGitMeta.originalBranch` and `ralphGitMeta.prdSlug`. Phase 3 (structured logging) is a soft prerequisite: new events (`branch_created`, `iteration_committed`, `pr_created`, `pr_marked_ready`) are emitted only when `lib/logging/index.js` exists.

**Tech Stack:** Node.js (CommonJS), plain `git` CLI and `gh pr create|ready|view` subprocess calls (no new npm deps), Jest for unit tests, Bash for CLI integration tests, `jq` 1.6+ for JSON edits, `gh` CLI already authenticated.

---

## Prerequisites

- Phase 2 (GitHub Issues) shipped — `lib/github/{index.js,repo.js,issues.js}` exist, `ensure_task_issue` writes `issueNumber` to task JSON. PR bodies use `Closes #<issueNumber>`, so this prerequisite is hard.
- Phase 4 (GitHub Projects) shipped — the `GITHUB_API_CALLS` counter, `bump_github_api_calls`, and `emit_logging_event` helpers already exist in `ralph-loop` and are reused here.
- Phase 3 (Structured Logging) **strongly recommended** but not strictly required. If `lib/logging/index.js` is missing, branching still works; the new event types are silently skipped (Task 16 is a no-op in that case).
- Working `git` CLI (>= 2.23 — relies on `git switch`/`git checkout` semantics) on `PATH`.
- `gh` CLI authenticated with `repo` scope — already required by Phase 2.
- Working directory `/Users/orlandogarcia/numeron/ralph-loop/`.

---

## File Structure

```
lib/git/
  slug.js                 — Pure function: task title/id → branch-safe slug
  slug.test.js            — Jest tests
  branches.js             — Branch ops: computeBranchName, ensureBranch, switchTo, currentBranch, branchExists
  branches.test.js        — Jest tests (mocks child_process)
  stash.js                — Stash ops: hasUncommittedChanges, stashPush, stashPop
  stash.test.js           — Jest tests
  commits.js              — formatCommitMessage, commitIteration (runs git add + git commit)
  commits.test.js         — Jest tests
  index.js                — CLI dispatcher: slugify | branch-name | ensure-branch | switch-to | stash-push | stash-pop | commit-iteration | current-branch | push
  index.test.js           — Jest tests for dispatcher

lib/github/
  pullrequests.js         — ensureDraftPR, markPRReady, prExistsForBranch
  pullrequests.test.js    — Jest tests
  index.js  (modified)    — Adds ensure-pr, mark-pr-ready, pr-status subcommands

tests/
  fixtures/
    mock-git.sh           — Fake `git` on PATH for integration tests; logs calls, returns canned state
    mock-gh-pr.sh         — Fake `gh` for PR tests (builds on existing mock-gh-projects.sh pattern)
  test-git-branching.sh   — Bash integration tests covering the end-to-end Phase 5 path
  test-all.sh  (modified) — Registers the new suite

ralph-loop   (modified)   — New globals, functions, and wiring into run_ralph_loop
README.md    (modified)   — Short Phase 5 section
```

**Modified files:**

- `ralph-loop`
  - New globals (next to existing `GITHUB_API_CALLS` block, ~line 21): `BRANCH_ENABLED=true`, `ORIGINAL_BRANCH=""`, `CURRENT_TASK_BRANCH=""`, `STASH_APPLIED=false`.
  - New flag `--no-branch` in `parse_arguments`.
  - `--no-github` handler sets `BRANCH_ENABLED=false` too.
  - `validate_prd_json` accepts optional PRD-root `ralphGitMeta` object + task-level `branchName`, `prNumber`, `prUrl`.
  - New Bash functions (all gated by `BRANCH_ENABLED`): `capture_original_branch`, `snapshot_working_tree`, `ensure_task_branch`, `commit_iteration`, `push_task_branch`, `restore_working_tree`, `ensure_task_pr`, `mark_pr_ready`, `git_branching_preflight`.
  - `run_ralph_loop` wiring (details in Task 13):
    - Before the iteration loop: `capture_original_branch` + `git_branching_preflight`.
    - Per iteration, after `ensure_project_item` and before the Claude call: `snapshot_working_tree` → `ensure_task_branch`.
    - After criteria verification (both passed and failed branches): `commit_iteration` (with computed status trailer) → `push_task_branch` → `ensure_task_pr`.
    - On task completion (the `if [ "$verify_exit" -eq 0 ]` branch): `mark_pr_ready`.
    - At end of iteration (and once more after the while loop exits): `restore_working_tree`.
    - On JSON corruption (error-recovery branch, ~line 1831): still call `commit_iteration` with status `failed` before `continue`.
  - `show_help` documents `--no-branch` and a new Phase 5 section (Task 15).
- `lib/github/index.js` — dispatcher adds `ensure-pr`, `mark-pr-ready`, `pr-status` subcommands.
- `lib/logging/events.js` (if Phase 3 shipped) — add `branch_created`, `iteration_committed`, `pr_created`, `pr_marked_ready` event types (Task 16).
- `lib/logging/renderer.js` (if Phase 3 shipped) — render new events (Task 16).
- `tests/test-all.sh` — register `test-git-branching.sh`.
- `README.md` — short Phase 5 section.

**Out of scope (deferred):** dependency branch merging (needs Phase 6), parallel task execution in worktrees, git notes, checkpoint tags, per-repo branch-name customization, custom commit templates, PR review automation, rerere/conflict resolution helpers.

---

## PRD JSON Schema Additions

At the PRD root:

```json
{
  "title": "Auth Feature",
  "repository": "paullovvik/myrepo",
  "githubProject": { "...": "..." },
  "ralphGitMeta": {
    "originalBranch": "main",
    "prdSlug": "auth-feature"
  },
  "tasks": [
    {
      "id": "task-1",
      "issueNumber": 42,
      "branchName": "ralph/auth-feature/task-1-add-jwt-validation",
      "prNumber": 17,
      "prUrl": "https://github.com/paullovvik/myrepo/pull/17",
      "...": "..."
    }
  ]
}
```

All three task fields are optional until the task reaches iteration 1 with branching enabled. `ralphGitMeta` is written once per PRD (during `capture_original_branch`) and re-used on `--resume`.

---

## Event Catalogue Additions (Phase 3 dependency)

Added to `lib/logging/events.js` REQUIRED map (Task 16):

| `event` | Required fields | Optional fields |
|---------|-----------------|-----------------|
| `branch_created` | `taskId` (string), `branchName` (string), `baseBranch` (string) | `sha` (string) |
| `iteration_committed` | `iteration` (int), `taskId` (string), `branchName` (string), `sha` (string), `ralphStatus` (string, one of `in-progress` / `passed` / `failed`) | `criteriaPassCount` (int), `criteriaTotal` (int) |
| `pr_created` | `taskId` (string), `prNumber` (int), `prUrl` (string), `branchName` (string) | — |
| `pr_marked_ready` | `taskId` (string), `prNumber` (int) | — |

---

## Commit Message Format

Fixed format, produced by `lib/git/commits.js::formatCommitMessage`:

```
<task-id>: <lowercased-first-word-of-title> <rest-of-title>

Iteration <N>/<MAX>. Criteria: <pass>/<total> passing.

Ralph-Task-Id: <task-id>
Ralph-Issue: #<issueNumber>
Ralph-Status: <in-progress|passed|failed>
```

If `issueNumber` is missing, the `Ralph-Issue` trailer is omitted.

---

## Branch Name Format

Produced by `lib/git/slug.js::slugify` + `lib/git/branches.js::computeBranchName`:

```
ralph/<prd-slug>/<task-id>-<title-slug>
```

Slug rules (Task 2):
- Lowercase.
- Replace any run of non-`[a-z0-9]` with a single `-`.
- Trim leading / trailing `-`.
- Collapse repeats.
- Truncate to 40 chars (without cutting mid-word — walk back to the last `-` if truncation lands inside a token, else hard-cut).

`<prd-slug>` is `ralphGitMeta.prdSlug`; on first write it is derived from `basename(PRD_FILE, .md|.json)` run through the same slugify.

---

### Task 1: Extend `validate_prd_json` + schema additions

**Files:**
- Modify: `ralph-loop:582-607` (existing `validate_prd_json` — extend the optional-fields block)
- Test: `tests/test-validation.sh` (append new cases)

- [ ] **Step 1: Write the failing bash test**

Append to `tests/test-validation.sh` (end of the script, before the summary):

```bash
test_accepts_ralph_git_meta() {
    echo ""
    echo "Test: accepts optional ralphGitMeta + task-level branchName/prNumber/prUrl"

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
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -eq 0 ]; then pass "accepts ralphGitMeta + branch fields"
    else fail "rejected valid PRD with Phase 5 fields. Output: $output"; fi
}

test_rejects_bad_branch_name_type() {
    echo ""
    echo "Test: rejects non-string branchName"

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
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --dry-run 2>&1) && exit_code=0 || exit_code=$?
    if [ "$exit_code" -ne 0 ] && echo "$output" | grep -q "branchName"; then
        pass "rejects non-string branchName"
    else
        fail "should reject non-string branchName. Exit: $exit_code, Output: $output"
    fi
}

test_accepts_ralph_git_meta
test_rejects_bad_branch_name_type
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `./tests/test-validation.sh`
Expected: the two new tests fail. Every existing test still passes.

- [ ] **Step 3: Extend `validate_prd_json` in `ralph-loop`**

Insert this block immediately after the existing `projectItem_bad` block (`ralph-loop:602-605`), before the final `return 0`:

```bash
    # Optional: ralphGitMeta must be object with originalBranch (string) + prdSlug (string)
    if jq -e '.ralphGitMeta' "$json_file" >/dev/null 2>&1; then
        local gm_fields
        for gm_fields in originalBranch prdSlug; do
            if ! jq -e ".ralphGitMeta.$gm_fields | type == \"string\"" "$json_file" >/dev/null 2>&1; then
                echo -e "${RED}[ERROR] ralphGitMeta.$gm_fields must be a string${NC}"
                return 1
            fi
        done
    fi

    # Optional: each task.branchName (if present) must be non-empty string
    local branch_bad
    branch_bad=$(jq -r '.tasks[] | select(.branchName != null) | select((.branchName | type) != "string" or (.branchName | length) == 0) | .id' "$json_file")
    if [ -n "$branch_bad" ]; then
        echo -e "${RED}[ERROR] Tasks with invalid branchName: $branch_bad${NC}"
        return 1
    fi

    # Optional: each task.prNumber (if present) must be a positive integer
    local pr_bad
    pr_bad=$(jq -r '.tasks[] | select(.prNumber != null) | select((.prNumber | type) != "number" or .prNumber <= 0 or (.prNumber | floor) != .prNumber) | .id' "$json_file")
    if [ -n "$pr_bad" ]; then
        echo -e "${RED}[ERROR] Tasks with invalid prNumber: $pr_bad${NC}"
        return 1
    fi

    # Optional: each task.prUrl (if present) must be string
    local prurl_bad
    prurl_bad=$(jq -r '.tasks[] | select(.prUrl != null) | select((.prUrl | type) != "string") | .id' "$json_file")
    if [ -n "$prurl_bad" ]; then
        echo -e "${RED}[ERROR] Tasks with non-string prUrl: $prurl_bad${NC}"
        return 1
    fi
```

- [ ] **Step 4: Re-run the tests to verify they pass**

Run: `./tests/test-validation.sh`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add ralph-loop tests/test-validation.sh
git commit -m "feat(phase5): accept ralphGitMeta + task-level branchName/prNumber/prUrl in validate_prd_json"
```

---

### Task 2: `lib/git/slug.js` — slugify function

**Files:**
- Create: `lib/git/slug.js`
- Create: `lib/git/slug.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/git/slug.test.js
'use strict';

const { slugify } = require('./slug');

describe('slugify', () => {
  test('lowercases and replaces spaces', () => {
    expect(slugify('Add JWT Validation')).toBe('add-jwt-validation');
  });

  test('collapses non-alphanumeric runs to single dash', () => {
    expect(slugify('Fix!!!  the:::bug')).toBe('fix-the-bug');
  });

  test('trims leading and trailing dashes', () => {
    expect(slugify('---hi---')).toBe('hi');
  });

  test('returns empty string for empty or non-string input', () => {
    expect(slugify('')).toBe('');
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
    expect(slugify(42)).toBe('');
  });

  test('strips unicode and symbols', () => {
    expect(slugify('Café ☕ — tea')).toBe('caf-tea');
  });

  test('truncates to 40 chars by default, breaking at last dash', () => {
    const input = 'one two three four five six seven eight nine';
    const out = slugify(input);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('-')).toBe(false);
    // Should break at a word boundary — last dash within 40 chars
    expect(input.toLowerCase()).toContain(out.replace(/-/g, ' ').slice(0, 20));
  });

  test('truncates mid-token with hard cut when no dash exists in range', () => {
    const longWord = 'a'.repeat(80);
    const out = slugify(longWord);
    expect(out.length).toBe(40);
    expect(out).toBe('a'.repeat(40));
  });

  test('accepts a custom maxLength', () => {
    expect(slugify('hello world one two three', 10)).toBe('hello');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/git/slug.test.js --no-coverage`
Expected: FAIL with "Cannot find module './slug'"

- [ ] **Step 3: Write `lib/git/slug.js`**

```js
// lib/git/slug.js
'use strict';

function slugify(input, maxLength = 40) {
  if (typeof input !== 'string' || !input) return '';

  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (cleaned.length <= maxLength) return cleaned;

  const windowed = cleaned.slice(0, maxLength);
  const lastDash = windowed.lastIndexOf('-');
  if (lastDash > 0) return windowed.slice(0, lastDash);
  return windowed;
}

module.exports = { slugify };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/git/slug.test.js --no-coverage`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/git/slug.js lib/git/slug.test.js
git commit -m "feat(phase5): add slug.js for branch-safe task slugs"
```

---

### Task 3: `lib/git/branches.js` — branch operations

**Files:**
- Create: `lib/git/branches.js`
- Create: `lib/git/branches.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/git/branches.test.js
'use strict';

jest.mock('child_process');
const { execSync } = require('child_process');
const {
  computeBranchName,
  currentBranch,
  branchExists,
  ensureBranch,
  switchTo,
} = require('./branches');

beforeEach(() => {
  execSync.mockReset();
});

describe('computeBranchName', () => {
  test('combines prd slug, task id, and title slug', () => {
    expect(
      computeBranchName({ prdSlug: 'auth-feature', taskId: 'task-3', title: 'Add JWT Validation' })
    ).toBe('ralph/auth-feature/task-3-add-jwt-validation');
  });

  test('truncates overly long titles', () => {
    const title = 'An extremely verbose task title that should be abbreviated to fit';
    const name = computeBranchName({ prdSlug: 'x', taskId: 'task-1', title });
    const tail = name.split('/').pop();
    expect(tail.length).toBeLessThanOrEqual(8 /* "task-1-" length cap */ + 40);
  });

  test('throws if prdSlug or taskId missing', () => {
    expect(() => computeBranchName({ prdSlug: '', taskId: 't', title: 'x' }))
      .toThrow(/prdSlug/);
    expect(() => computeBranchName({ prdSlug: 'p', taskId: '', title: 'x' }))
      .toThrow(/taskId/);
  });
});

describe('currentBranch', () => {
  test('returns the output of git rev-parse --abbrev-ref HEAD', () => {
    execSync.mockReturnValueOnce(Buffer.from('main\n'));
    expect(currentBranch()).toBe('main');
    expect(execSync.mock.calls[0][0]).toMatch(/git rev-parse --abbrev-ref HEAD/);
  });

  test('throws if git fails', () => {
    execSync.mockImplementationOnce(() => { throw new Error('not a repo'); });
    expect(() => currentBranch()).toThrow(/not a repo|current branch/i);
  });
});

describe('branchExists', () => {
  test('returns true when git show-ref exits 0', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));
    expect(branchExists('feature/x')).toBe(true);
  });

  test('returns false when git show-ref exits non-zero', () => {
    execSync.mockImplementationOnce(() => {
      const err = new Error('missing');
      err.status = 1;
      throw err;
    });
    expect(branchExists('feature/x')).toBe(false);
  });
});

describe('ensureBranch', () => {
  test('creates branch off base when missing', () => {
    execSync
      .mockImplementationOnce(() => { const e = new Error('x'); e.status = 1; throw e; }) // show-ref: missing
      .mockReturnValueOnce(Buffer.from('abc123\n'))                                       // rev-parse base
      .mockReturnValueOnce(Buffer.from(''));                                              // branch create
    const result = ensureBranch({ name: 'ralph/x/task-1-y', baseBranch: 'main' });
    expect(result).toEqual({ created: true, baseSha: 'abc123' });
    expect(execSync.mock.calls[2][0]).toMatch(/git branch "ralph\/x\/task-1-y" "main"/);
  });

  test('returns created=false when branch already exists', () => {
    execSync.mockReturnValueOnce(Buffer.from('')); // show-ref: exists
    const result = ensureBranch({ name: 'ralph/x/task-1-y', baseBranch: 'main' });
    expect(result).toEqual({ created: false });
    expect(execSync).toHaveBeenCalledTimes(1);
  });
});

describe('switchTo', () => {
  test('runs git checkout <branch>', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));
    switchTo('ralph/x/task-1-y');
    expect(execSync.mock.calls[0][0]).toMatch(/git checkout "ralph\/x\/task-1-y"/);
  });

  test('wraps git checkout failures with a clear message', () => {
    execSync.mockImplementationOnce(() => { throw new Error('conflict'); });
    expect(() => switchTo('b')).toThrow(/switch.*branch.*b.*conflict/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/git/branches.test.js --no-coverage`
Expected: FAIL with "Cannot find module './branches'"

- [ ] **Step 3: Write `lib/git/branches.js`**

```js
// lib/git/branches.js
'use strict';

const { execSync } = require('child_process');
const { slugify } = require('./slug');

function quote(v) {
  return `"${String(v).replace(/"/g, '\\"')}"`;
}

function computeBranchName({ prdSlug, taskId, title }) {
  if (!prdSlug) throw new Error('computeBranchName: prdSlug is required');
  if (!taskId)  throw new Error('computeBranchName: taskId is required');
  const titleSlug = slugify(title);
  const tail = titleSlug ? `${taskId}-${titleSlug}` : taskId;
  return `ralph/${prdSlug}/${tail}`;
}

function currentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch (err) {
    throw new Error(`could not read current branch: ${err.message}`);
  }
}

function branchExists(name) {
  try {
    execSync(`git show-ref --verify --quiet "refs/heads/${name}"`, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

function ensureBranch({ name, baseBranch }) {
  if (branchExists(name)) return { created: false };
  let baseSha;
  try {
    baseSha = execSync(`git rev-parse ${quote(baseBranch)}`, { encoding: 'utf-8' }).trim();
  } catch (err) {
    throw new Error(`base branch "${baseBranch}" not resolvable: ${err.message}`);
  }
  try {
    execSync(`git branch ${quote(name)} ${quote(baseBranch)}`, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(`could not create branch "${name}" from "${baseBranch}": ${err.message}`);
  }
  return { created: true, baseSha };
}

function switchTo(name) {
  try {
    execSync(`git checkout ${quote(name)}`, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(`could not switch to branch "${name}": ${err.message}`);
  }
}

module.exports = {
  computeBranchName,
  currentBranch,
  branchExists,
  ensureBranch,
  switchTo,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/git/branches.test.js --no-coverage`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/git/branches.js lib/git/branches.test.js
git commit -m "feat(phase5): add branches.js for branch lifecycle ops"
```

---

### Task 4: `lib/git/stash.js` — working-tree snapshot

**Files:**
- Create: `lib/git/stash.js`
- Create: `lib/git/stash.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/git/stash.test.js
'use strict';

jest.mock('child_process');
const { execSync } = require('child_process');
const { hasUncommittedChanges, stashPush, stashPop } = require('./stash');

beforeEach(() => { execSync.mockReset(); });

describe('hasUncommittedChanges', () => {
  test('returns false when all three checks are quiet', () => {
    execSync
      .mockReturnValueOnce(Buffer.from(''))   // git diff --quiet (exit 0)
      .mockReturnValueOnce(Buffer.from(''))   // git diff --cached --quiet (exit 0)
      .mockReturnValueOnce(Buffer.from(''));  // ls-files --others
    expect(hasUncommittedChanges()).toBe(false);
  });

  test('returns true when tracked diff is non-empty', () => {
    const err = new Error('diff'); err.status = 1;
    execSync
      .mockImplementationOnce(() => { throw err; }) // diff not quiet
      .mockReturnValueOnce(Buffer.from(''))
      .mockReturnValueOnce(Buffer.from(''));
    expect(hasUncommittedChanges()).toBe(true);
  });

  test('returns true when untracked files exist', () => {
    execSync
      .mockReturnValueOnce(Buffer.from(''))
      .mockReturnValueOnce(Buffer.from(''))
      .mockReturnValueOnce(Buffer.from('new-file.txt\n'));
    expect(hasUncommittedChanges()).toBe(true);
  });
});

describe('stashPush', () => {
  test('runs git stash push -u with a message and returns true on success', () => {
    execSync.mockReturnValueOnce(Buffer.from('Saved working directory\n'));
    expect(stashPush('ralph-loop-temp-1')).toBe(true);
    expect(execSync.mock.calls[0][0]).toMatch(/git stash push -u -m "ralph-loop-temp-1"/);
  });

  test('returns false when git stash says "No local changes to save"', () => {
    execSync.mockReturnValueOnce(Buffer.from('No local changes to save\n'));
    expect(stashPush('msg')).toBe(false);
  });
});

describe('stashPop', () => {
  test('runs git stash pop on success', () => {
    execSync.mockReturnValueOnce(Buffer.from('Dropped refs/stash@{0}\n'));
    expect(() => stashPop()).not.toThrow();
    expect(execSync.mock.calls[0][0]).toMatch(/git stash pop/);
  });

  test('throws wrapped error with stderr when pop fails', () => {
    const err = new Error('conflict');
    err.stderr = Buffer.from('pop failed');
    execSync.mockImplementationOnce(() => { throw err; });
    expect(() => stashPop()).toThrow(/stash pop.*pop failed|stash pop.*conflict/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/git/stash.test.js --no-coverage`
Expected: FAIL with "Cannot find module './stash'"

- [ ] **Step 3: Write `lib/git/stash.js`**

```js
// lib/git/stash.js
'use strict';

const { execSync } = require('child_process');

function quote(v) { return `"${String(v).replace(/"/g, '\\"')}"`; }

function hasUncommittedChanges() {
  try { execSync('git diff --quiet', { encoding: 'utf-8' }); }
  catch { return true; }
  try { execSync('git diff --cached --quiet', { encoding: 'utf-8' }); }
  catch { return true; }
  const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf-8' }).trim();
  return untracked.length > 0;
}

function stashPush(message) {
  let out;
  try {
    out = execSync(`git stash push -u -m ${quote(message)}`, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(`git stash push failed: ${err.message}`);
  }
  return !/no local changes to save/i.test(out);
}

function stashPop() {
  try {
    execSync('git stash pop', { encoding: 'utf-8' });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    throw new Error(`git stash pop failed: ${stderr || err.message}`);
  }
}

module.exports = { hasUncommittedChanges, stashPush, stashPop };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/git/stash.test.js --no-coverage`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/git/stash.js lib/git/stash.test.js
git commit -m "feat(phase5): add stash.js helpers for pre-checkout working-tree capture"
```

---

### Task 5: `lib/git/commits.js` — iteration commits with trailers

**Files:**
- Create: `lib/git/commits.js`
- Create: `lib/git/commits.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/git/commits.test.js
'use strict';

jest.mock('child_process');
const { execSync } = require('child_process');
const { formatCommitMessage, commitIteration } = require('./commits');

beforeEach(() => { execSync.mockReset(); });

describe('formatCommitMessage', () => {
  test('uses the spec-prescribed layout with all trailers', () => {
    const msg = formatCommitMessage({
      taskId: 'task-3',
      taskTitle: 'Add JWT validation middleware',
      iteration: 2,
      maxIterations: 15,
      passCount: 2,
      totalCount: 3,
      issueNumber: 42,
      ralphStatus: 'in-progress',
    });
    expect(msg).toBe(
      'task-3: add JWT validation middleware\n' +
      '\n' +
      'Iteration 2/15. Criteria: 2/3 passing.\n' +
      '\n' +
      'Ralph-Task-Id: task-3\n' +
      'Ralph-Issue: #42\n' +
      'Ralph-Status: in-progress'
    );
  });

  test('omits Ralph-Issue trailer when issueNumber is absent', () => {
    const msg = formatCommitMessage({
      taskId: 'task-1', taskTitle: 'Do Stuff', iteration: 1, maxIterations: 10,
      passCount: 0, totalCount: 1, issueNumber: null, ralphStatus: 'failed',
    });
    expect(msg).not.toMatch(/Ralph-Issue/);
    expect(msg).toMatch(/Ralph-Status: failed/);
    expect(msg.split('\n')[0]).toBe('task-1: do Stuff');
  });

  test('lowercases only the first character of the subject', () => {
    const msg = formatCommitMessage({
      taskId: 'task-2', taskTitle: 'ALL CAPS Title', iteration: 1, maxIterations: 5,
      passCount: 1, totalCount: 1, issueNumber: 1, ralphStatus: 'passed',
    });
    expect(msg.split('\n')[0]).toBe('task-2: aLL CAPS Title');
  });
});

describe('commitIteration', () => {
  test('runs git add -A then git commit -F <file>', () => {
    execSync.mockReturnValueOnce(Buffer.from(''))                    // add
            .mockReturnValueOnce(Buffer.from(''))                    // commit
            .mockReturnValueOnce(Buffer.from('abc1234\n'));          // rev-parse HEAD
    const sha = commitIteration({
      taskId: 'task-3', taskTitle: 'X', iteration: 1, maxIterations: 5,
      passCount: 1, totalCount: 2, issueNumber: 7, ralphStatus: 'in-progress',
    });
    expect(execSync.mock.calls[0][0]).toMatch(/git add -A/);
    expect(execSync.mock.calls[1][0]).toMatch(/git commit -F /);
    expect(sha).toBe('abc1234');
  });

  test('skips commit and returns null when working tree is clean after add', () => {
    // Simulate: git diff --cached --quiet succeeds -> nothing to commit.
    execSync.mockReturnValueOnce(Buffer.from(''));               // add
    execSync.mockReturnValueOnce(Buffer.from(''));               // diff --cached --quiet (exit 0)
    const sha = commitIteration({
      taskId: 'task-3', taskTitle: 'X', iteration: 1, maxIterations: 5,
      passCount: 0, totalCount: 1, issueNumber: null, ralphStatus: 'in-progress',
      skipIfEmpty: true,
    });
    expect(sha).toBeNull();
  });

  test('throws on commit failure', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));                                    // add
    execSync.mockImplementationOnce(() => { throw new Error('no commits allowed'); }); // commit
    expect(() => commitIteration({
      taskId: 'task-3', taskTitle: 'X', iteration: 1, maxIterations: 5,
      passCount: 0, totalCount: 1, issueNumber: 1, ralphStatus: 'failed',
    })).toThrow(/commit.*no commits allowed/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/git/commits.test.js --no-coverage`
Expected: FAIL with "Cannot find module './commits'"

- [ ] **Step 3: Write `lib/git/commits.js`**

```js
// lib/git/commits.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

function formatCommitMessage({
  taskId, taskTitle, iteration, maxIterations,
  passCount, totalCount, issueNumber, ralphStatus,
}) {
  const firstChar = taskTitle.charAt(0).toLowerCase();
  const subject = `${taskId}: ${firstChar}${taskTitle.slice(1)}`;
  const body = `Iteration ${iteration}/${maxIterations}. Criteria: ${passCount}/${totalCount} passing.`;
  const trailers = [`Ralph-Task-Id: ${taskId}`];
  if (issueNumber) trailers.push(`Ralph-Issue: #${issueNumber}`);
  trailers.push(`Ralph-Status: ${ralphStatus}`);
  return [subject, '', body, '', trailers.join('\n')].join('\n');
}

function commitIteration(opts) {
  execSync('git add -A', { encoding: 'utf-8' });

  if (opts.skipIfEmpty) {
    try {
      execSync('git diff --cached --quiet', { encoding: 'utf-8' });
      return null; // nothing staged; nothing to commit
    } catch {
      // staged changes exist — fall through to commit
    }
  }

  const message = formatCommitMessage(opts);
  const msgFile = path.join(os.tmpdir(), `ralph-commit-${Date.now()}-${process.pid}.txt`);
  fs.writeFileSync(msgFile, message);
  try {
    execSync(`git commit -F "${msgFile}"`, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(`git commit failed: ${err.message}`);
  } finally {
    try { fs.unlinkSync(msgFile); } catch {}
  }

  return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
}

module.exports = { formatCommitMessage, commitIteration };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/git/commits.test.js --no-coverage`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/git/commits.js lib/git/commits.test.js
git commit -m "feat(phase5): add commits.js — formatCommitMessage + commitIteration"
```

---

### Task 6: `lib/git/index.js` — CLI dispatcher

**Files:**
- Create: `lib/git/index.js`
- Create: `lib/git/index.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/git/index.test.js
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, 'index.js');

function run(args, opts = {}) {
  try {
    const out = execFileSync('node', [CLI, ...args], { encoding: 'utf-8', ...opts });
    return { exit: 0, stdout: out.trim(), stderr: '' };
  } catch (err) {
    return {
      exit: err.status || 1,
      stdout: (err.stdout || '').toString().trim(),
      stderr: (err.stderr || '').toString().trim(),
    };
  }
}

describe('lib/git/index.js dispatcher', () => {
  test('slugify echoes slugified input as JSON', () => {
    const r = run(['slugify', '--input', 'Hello World 123']);
    expect(r.exit).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ slug: 'hello-world-123' });
  });

  test('branch-name combines prdSlug + taskId + title', () => {
    const r = run(['branch-name', '--prd-slug', 'myprd', '--task-id', 'task-3', '--title', 'Add X']);
    expect(r.exit).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ branchName: 'ralph/myprd/task-3-add-x' });
  });

  test('unknown command exits 1', () => {
    const r = run(['nonsense']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/unknown command/i);
  });

  test('slugify without --input exits 1 with usage', () => {
    const r = run(['slugify']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/--input/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/git/index.test.js --no-coverage`
Expected: FAIL with "Cannot find module" or dispatcher missing.

- [ ] **Step 3: Write `lib/git/index.js`**

```js
#!/usr/bin/env node
'use strict';

const { slugify } = require('./slug');
const {
  computeBranchName, currentBranch, ensureBranch, switchTo,
} = require('./branches');
const { hasUncommittedChanges, stashPush, stashPop } = require('./stash');
const { commitIteration } = require('./commits');
const { execSync } = require('child_process');

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function getFlag(name) {
  return process.argv.includes(name);
}

function usage(msg) {
  console.error(msg);
  process.exit(1);
}

const command = process.argv[2];

try {
  switch (command) {
    case 'slugify': {
      const input = getArg('--input');
      if (input === null) usage('Usage: slugify --input "<text>"');
      console.log(JSON.stringify({ slug: slugify(input) }));
      break;
    }

    case 'branch-name': {
      const prdSlug = getArg('--prd-slug');
      const taskId  = getArg('--task-id');
      const title   = getArg('--title') || '';
      if (!prdSlug || !taskId) usage('Usage: branch-name --prd-slug <s> --task-id <id> --title "<t>"');
      console.log(JSON.stringify({ branchName: computeBranchName({ prdSlug, taskId, title }) }));
      break;
    }

    case 'current-branch': {
      console.log(JSON.stringify({ branch: currentBranch() }));
      break;
    }

    case 'ensure-branch': {
      const name = getArg('--name');
      const base = getArg('--base');
      if (!name || !base) usage('Usage: ensure-branch --name <b> --base <b>');
      const result = ensureBranch({ name, baseBranch: base });
      console.log(JSON.stringify(result));
      break;
    }

    case 'switch-to': {
      const name = getArg('--name');
      if (!name) usage('Usage: switch-to --name <b>');
      switchTo(name);
      console.log(JSON.stringify({ ok: true, branch: name }));
      break;
    }

    case 'has-uncommitted': {
      console.log(JSON.stringify({ dirty: hasUncommittedChanges() }));
      break;
    }

    case 'stash-push': {
      const message = getArg('--message') || `ralph-loop-${Date.now()}`;
      const stashed = stashPush(message);
      console.log(JSON.stringify({ stashed }));
      break;
    }

    case 'stash-pop': {
      stashPop();
      console.log(JSON.stringify({ ok: true }));
      break;
    }

    case 'commit-iteration': {
      const taskId       = getArg('--task-id');
      const taskTitle    = getArg('--task-title') || taskId;
      const iteration    = parseInt(getArg('--iteration'), 10);
      const maxIterations = parseInt(getArg('--max-iterations'), 10);
      const passCount    = parseInt(getArg('--pass-count'), 10);
      const totalCount   = parseInt(getArg('--total-count'), 10);
      const rawIssue     = getArg('--issue');
      const issueNumber  = rawIssue ? parseInt(rawIssue, 10) : null;
      const ralphStatus  = getArg('--status');
      const skipIfEmpty  = getFlag('--skip-if-empty');
      if (!taskId || !ralphStatus || !iteration || !maxIterations) {
        usage('Usage: commit-iteration --task-id --task-title --iteration --max-iterations --pass-count --total-count --status [--issue N] [--skip-if-empty]');
      }
      const sha = commitIteration({
        taskId, taskTitle, iteration, maxIterations,
        passCount: passCount || 0, totalCount: totalCount || 0,
        issueNumber, ralphStatus, skipIfEmpty,
      });
      console.log(JSON.stringify({ sha, skipped: sha === null }));
      break;
    }

    case 'push': {
      const branch = getArg('--branch');
      const remote = getArg('--remote') || 'origin';
      if (!branch) usage('Usage: push --branch <b> [--remote <r>]');
      try {
        execSync(`git push -u "${remote}" "${branch}"`, { encoding: 'utf-8' });
        console.log(JSON.stringify({ ok: true }));
      } catch (err) {
        console.log(JSON.stringify({ ok: false, error: err.message }));
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: slugify, branch-name, current-branch, ensure-branch, switch-to, has-uncommitted, stash-push, stash-pop, commit-iteration, push');
      process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/git/index.test.js --no-coverage`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/git/index.js lib/git/index.test.js
git commit -m "feat(phase5): add lib/git CLI dispatcher wiring all git-plumbing subcommands"
```

---

### Task 7: `lib/github/pullrequests.js` — draft PR + mark-ready

**Files:**
- Create: `lib/github/pullrequests.js`
- Create: `lib/github/pullrequests.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/github/pullrequests.test.js
'use strict';

jest.mock('child_process');
const { execSync } = require('child_process');
const {
  ensureDraftPR, markPRReady, prExistsForBranch, buildPRBody,
} = require('./pullrequests');

beforeEach(() => { execSync.mockReset(); });

describe('buildPRBody', () => {
  test('includes Closes trailer when issueNumber provided', () => {
    const body = buildPRBody({ taskId: 'task-3', taskTitle: 'Add X', issueNumber: 42 });
    expect(body).toMatch(/Closes #42/);
    expect(body).toMatch(/task-3/);
  });

  test('omits Closes trailer when issueNumber absent', () => {
    const body = buildPRBody({ taskId: 'task-3', taskTitle: 'Add X', issueNumber: null });
    expect(body).not.toMatch(/Closes/);
  });
});

describe('prExistsForBranch', () => {
  test('returns number when gh pr view succeeds', () => {
    execSync.mockReturnValueOnce(Buffer.from(JSON.stringify({ number: 7 })));
    expect(prExistsForBranch({ repo: 'o/r', branchName: 'ralph/x/task-1-y' })).toBe(7);
  });

  test('returns null when gh pr view fails (no PR for branch)', () => {
    execSync.mockImplementationOnce(() => { const e = new Error('no pr'); e.status = 1; throw e; });
    expect(prExistsForBranch({ repo: 'o/r', branchName: 'b' })).toBeNull();
  });
});

describe('ensureDraftPR', () => {
  test('returns existing prNumber when branch already has a PR', () => {
    execSync.mockReturnValueOnce(Buffer.from(JSON.stringify({ number: 9, url: 'https://x/pr/9' })));
    const r = ensureDraftPR({
      repo: 'o/r', branchName: 'b', baseBranch: 'main',
      taskId: 't-1', taskTitle: 'X', issueNumber: 1,
    });
    expect(r).toEqual({ prNumber: 9, prUrl: 'https://x/pr/9', created: false });
  });

  test('creates a draft PR when none exists; returns parsed URL + number', () => {
    // First call: prExistsForBranch -> no PR (status 1).
    execSync.mockImplementationOnce(() => { const e = new Error('no pr'); e.status = 1; throw e; });
    // Second call: gh pr create prints the URL.
    execSync.mockReturnValueOnce(Buffer.from('https://github.com/o/r/pull/17\n'));
    const r = ensureDraftPR({
      repo: 'o/r', branchName: 'b', baseBranch: 'main',
      taskId: 't-1', taskTitle: 'X', issueNumber: 42,
    });
    expect(r).toEqual({ prNumber: 17, prUrl: 'https://github.com/o/r/pull/17', created: true });
    const createCmd = execSync.mock.calls[1][0];
    expect(createCmd).toMatch(/gh pr create/);
    expect(createCmd).toMatch(/--draft/);
    expect(createCmd).toMatch(/--head "b"/);
    expect(createCmd).toMatch(/--base "main"/);
  });

  test('wraps gh pr create errors', () => {
    execSync.mockImplementationOnce(() => { const e = new Error('no pr'); e.status = 1; throw e; });
    execSync.mockImplementationOnce(() => { throw new Error('push first'); });
    expect(() => ensureDraftPR({
      repo: 'o/r', branchName: 'b', baseBranch: 'main',
      taskId: 't', taskTitle: 'T', issueNumber: null,
    })).toThrow(/Failed to create draft PR.*push first/i);
  });
});

describe('markPRReady', () => {
  test('runs gh pr ready <n>', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));
    markPRReady({ repo: 'o/r', prNumber: 17 });
    expect(execSync.mock.calls[0][0]).toMatch(/gh pr ready 17 --repo "o\/r"/);
  });

  test('wraps gh pr ready failures', () => {
    execSync.mockImplementationOnce(() => { throw new Error('not draft'); });
    expect(() => markPRReady({ repo: 'o/r', prNumber: 17 })).toThrow(/mark PR.*17.*not draft/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/github/pullrequests.test.js --no-coverage`
Expected: FAIL with "Cannot find module './pullrequests'"

- [ ] **Step 3: Write `lib/github/pullrequests.js`**

```js
// lib/github/pullrequests.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

function buildPRBody({ taskId, taskTitle, issueNumber }) {
  const lines = [
    `**Task:** ${taskId} — ${taskTitle}`,
    '',
    '_This pull request is managed by [ralph-loop](https://github.com/numeron/ralph-loop)._',
    '_Each iteration is a separate commit with `Ralph-Status` trailers._',
  ];
  if (issueNumber) {
    lines.push('');
    lines.push(`Closes #${issueNumber}`);
  }
  return lines.join('\n');
}

function prExistsForBranch({ repo, branchName }) {
  try {
    const out = execSync(
      `gh pr view "${branchName}" --repo "${repo}" --json number,url`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(out);
    return parsed.number || null;
  } catch {
    return null;
  }
}

function ensureDraftPR({ repo, branchName, baseBranch, taskId, taskTitle, issueNumber }) {
  // Attempt to find an existing PR first; re-fetch URL so caller gets both fields.
  try {
    const out = execSync(
      `gh pr view "${branchName}" --repo "${repo}" --json number,url`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(out);
    if (parsed && parsed.number) {
      return { prNumber: parsed.number, prUrl: parsed.url, created: false };
    }
  } catch {
    // No existing PR for this branch — proceed to create.
  }

  const body = buildPRBody({ taskId, taskTitle, issueNumber });
  const title = `${taskId}: ${taskTitle}`;

  const bodyFile = path.join(os.tmpdir(), `ralph-pr-body-${Date.now()}-${process.pid}.md`);
  fs.writeFileSync(bodyFile, body);

  const escapedTitle = title.replace(/"/g, '\\"');
  const cmd = [
    'gh pr create',
    `--repo "${repo}"`,
    '--draft',
    `--base "${baseBranch}"`,
    `--head "${branchName}"`,
    `--title "${escapedTitle}"`,
    `--body-file "${bodyFile}"`,
  ].join(' ');

  let output;
  try {
    const raw = execSync(cmd, { encoding: 'utf-8' });
    output = String(raw).trim();
  } catch (err) {
    throw new Error(`Failed to create draft PR for ${branchName}: ${err.message}`);
  } finally {
    try { fs.unlinkSync(bodyFile); } catch {}
  }

  const match = output.match(/\/pull\/(\d+)/);
  if (!match) {
    throw new Error(`Could not parse PR number from gh output: ${output}`);
  }
  return { prNumber: parseInt(match[1], 10), prUrl: output, created: true };
}

function markPRReady({ repo, prNumber }) {
  try {
    execSync(`gh pr ready ${prNumber} --repo "${repo}"`, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(`Failed to mark PR #${prNumber} ready: ${err.message}`);
  }
}

module.exports = { buildPRBody, prExistsForBranch, ensureDraftPR, markPRReady };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/github/pullrequests.test.js --no-coverage`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/github/pullrequests.js lib/github/pullrequests.test.js
git commit -m "feat(phase5): add pullrequests.js — draft PR + mark-ready ops"
```

---

### Task 8: Wire PR subcommands into `lib/github/index.js`

**Files:**
- Modify: `lib/github/index.js` (add `require` and three new case branches; extend the usage/error message)
- Create: `lib/github/index-pr.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/github/index-pr.test.js
'use strict';

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

describe('lib/github/index.js PR subcommands (usage output)', () => {
  test('ensure-pr without required flags exits 1 with usage', () => {
    const r = run(['ensure-pr']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/ensure-pr.*--repo.*--branch.*--base/);
  });

  test('mark-pr-ready without required flags exits 1 with usage', () => {
    const r = run(['mark-pr-ready']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/mark-pr-ready.*--repo.*--pr/);
  });

  test('unknown command lists all commands including PR ones', () => {
    const r = run(['nonsense']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/ensure-pr/);
    expect(r.stderr).toMatch(/mark-pr-ready/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/github/index-pr.test.js --no-coverage`
Expected: FAIL — `ensure-pr` is currently unknown.

- [ ] **Step 3: Modify `lib/github/index.js`**

Add to the top-of-file requires (after the existing `projects` import, ~line 11):

```js
const { ensureDraftPR, markPRReady } = require('./pullrequests');
```

Insert these case branches immediately before the `default:` branch (~line 245):

```js
    case 'ensure-pr': {
      const repo = getArg('--repo');
      const branchName = getArg('--branch');
      const baseBranch = getArg('--base');
      const taskId = getArg('--task-id');
      const taskTitle = getArg('--task-title') || taskId;
      const issueRaw = getArg('--issue');
      const issueNumber = issueRaw ? parseInt(issueRaw, 10) : null;
      if (!repo || !branchName || !baseBranch || !taskId) {
        console.error('Usage: node lib/github/index.js ensure-pr --repo owner/name --branch <b> --base <b> --task-id <id> [--task-title "..."] [--issue N]');
        process.exit(1);
      }
      const result = ensureDraftPR({ repo, branchName, baseBranch, taskId, taskTitle, issueNumber });
      console.log(JSON.stringify(result));
      break;
    }

    case 'mark-pr-ready': {
      const repo = getArg('--repo');
      const prNumber = parseInt(getArg('--pr'), 10);
      if (!repo || !prNumber) {
        console.error('Usage: node lib/github/index.js mark-pr-ready --repo owner/name --pr N');
        process.exit(1);
      }
      markPRReady({ repo, prNumber });
      console.log(JSON.stringify({ ok: true }));
      break;
    }
```

Update the error string in the `default:` case (~line 247) to append `, ensure-pr, mark-pr-ready`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/github/index-pr.test.js --no-coverage`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/github/index.js lib/github/index-pr.test.js
git commit -m "feat(phase5): wire ensure-pr + mark-pr-ready subcommands into github dispatcher"
```

---

### Task 9: `--no-branch` flag + `BRANCH_ENABLED` global in Bash

**Files:**
- Modify: `ralph-loop` (globals block near line 21; `parse_arguments` near lines 222–269)
- Create: `tests/test-branching-flags.sh`

- [ ] **Step 1: Write the failing bash test**

```bash
#!/usr/bin/env bash
# tests/test-branching-flags.sh — --no-branch flag parsing
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
TESTS_PASSED=0; TESTS_FAILED=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RALPH_LOOP="$PROJECT_ROOT/ralph-loop"

pass() { echo -e "${GREEN}✓ PASS:${NC} $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo -e "${RED}✗ FAIL:${NC} $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
info() { echo -e "${YELLOW}INFO:${NC} $1"; }

setup() { TEST_DIR=$(mktemp -d); }
cleanup() { rm -rf "$TEST_DIR"; }

make_minimal_prd() {
    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "x", "tasks": [{
    "id": "task-1", "title": "T", "category": "C", "priority": 1,
    "acceptanceCriteria": ["x"], "passes": false, "attempts": 0
  }]
}
EOF
}

test_no_branch_flag_parses() {
    echo ""; echo "Test: --no-branch flag is accepted"
    make_minimal_prd
    local output exit_code
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --no-branch --dry-run 2>&1) && exit_code=0 || exit_code=$?
    if [ $exit_code -eq 0 ]; then pass "--no-branch accepted"; else fail "rejected --no-branch. Output: $output"; fi
}

test_help_documents_no_branch() {
    echo ""; echo "Test: --help documents --no-branch"
    local output
    output=$("$RALPH_LOOP" --help 2>&1)
    if echo "$output" | grep -q -- "--no-branch"; then pass "help documents --no-branch"
    else fail "--help does not mention --no-branch"; fi
}

test_no_github_implies_no_branch() {
    echo ""; echo "Test: --no-github implies BRANCH_ENABLED=false (debug-surface)"
    make_minimal_prd
    local output
    output=$("$RALPH_LOOP" "$TEST_DIR/prd.json" --no-github --debug --dry-run 2>&1)
    if echo "$output" | grep -q "BRANCH_ENABLED: false"; then pass "--no-github implies --no-branch"
    else fail "--no-github did not disable branching. Output: $output"; fi
}

setup
trap cleanup EXIT
test_no_branch_flag_parses
test_help_documents_no_branch
test_no_github_implies_no_branch

echo ""
echo "────────────────────────────────────────────────"
echo "Branching flags: $TESTS_PASSED passed, $TESTS_FAILED failed"
[ $TESTS_FAILED -eq 0 ] || exit 1
```

Mark executable:

```bash
chmod +x tests/test-branching-flags.sh
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./tests/test-branching-flags.sh`
Expected: at least the `--no-branch` flag test fails with "Unknown option: --no-branch".

- [ ] **Step 3: Add globals and flag handling in `ralph-loop`**

Insert after the existing `GITHUB_API_WARNED=false` line (~line 23):

```bash
BRANCH_ENABLED=true
ORIGINAL_BRANCH=""
CURRENT_TASK_BRANCH=""
STASH_APPLIED=false
```

Insert after the existing `--no-github` case in `parse_arguments` (~line 259):

```bash
            --no-branch)
                BRANCH_ENABLED=false
                shift
                ;;
```

Modify the `--no-github` case to also set `BRANCH_ENABLED=false`:

```bash
            --no-github)
                GITHUB_ENABLED=false
                BRANCH_ENABLED=false
                shift
                ;;
```

Update `show_help` OPTIONS section (between `--repo` docs and the GitHub Projects section, ~line 85):

```bash
  --no-branch             Disable per-task git branching and PR creation
                          (automatically set by --no-github)
```

In `main()` (after existing DEBUG output in parse_arguments, ~line 2131), add:

```bash
        echo -e "${BLUE}[DEBUG] BRANCH_ENABLED: $BRANCH_ENABLED${NC}"
```

- [ ] **Step 4: Re-run the test to verify it passes**

Run: `./tests/test-branching-flags.sh`
Expected: all three tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ralph-loop tests/test-branching-flags.sh
git commit -m "feat(phase5): add --no-branch flag + BRANCH_ENABLED global"
```

---

### Task 10: Bash helpers `snapshot_working_tree`, `ensure_task_branch`, `restore_working_tree`

**Files:**
- Modify: `ralph-loop` (add new functions near the existing `ensure_project_item` at ~line 1409)

- [ ] **Step 1: Write the failing bash test**

Append to `tests/test-branching-flags.sh`:

```bash
test_snapshot_and_branch_functions_exist() {
    echo ""; echo "Test: ralph-loop defines snapshot_working_tree + ensure_task_branch + restore_working_tree"
    for fn in snapshot_working_tree ensure_task_branch restore_working_tree capture_original_branch git_branching_preflight; do
        if grep -q "^${fn}()" "$RALPH_LOOP"; then
            pass "defines ${fn}"
        else
            fail "missing function ${fn}"
        fi
    done
}

test_snapshot_and_branch_functions_exist
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./tests/test-branching-flags.sh`
Expected: the five new subtests FAIL with "missing function ...".

- [ ] **Step 3: Add the Bash helpers to `ralph-loop`**

Insert these functions immediately after `validate_project_fields` (~line 786):

```bash
# Capture and persist the caller's branch + PRD slug on PRD root
capture_original_branch() {
    if [ "$BRANCH_ENABLED" = false ]; then return 0; fi
    if [ "$DRY_RUN" = true ]; then return 0; fi

    local existing
    existing=$(jq -r '.ralphGitMeta.originalBranch // empty' "$JSON_FILE")
    if [ -n "$existing" ]; then
        ORIGINAL_BRANCH="$existing"
        if [ "$VERBOSE" = true ]; then
            echo -e "${BLUE}[INFO] Using stored originalBranch: $ORIGINAL_BRANCH${NC}"
        fi
        return 0
    fi

    local current
    local current_exit=0
    current=$(node "$SCRIPT_DIR/lib/git/index.js" current-branch 2>&1) || current_exit=$?
    if [ $current_exit -ne 0 ]; then
        echo -e "${YELLOW}[WARN] Could not determine current git branch: $current${NC}"
        echo -e "${YELLOW}[WARN] Disabling branching for this run.${NC}"
        BRANCH_ENABLED=false
        return 0
    fi
    ORIGINAL_BRANCH=$(echo "$current" | jq -r '.branch')

    local prd_base
    prd_base=$(basename "$PRD_FILE")
    prd_base="${prd_base%.*}"
    local slug_reply
    slug_reply=$(node "$SCRIPT_DIR/lib/git/index.js" slugify --input "$prd_base" 2>&1) || {
        echo -e "${YELLOW}[WARN] slugify failed: $slug_reply${NC}"; BRANCH_ENABLED=false; return 0;
    }
    local prd_slug
    prd_slug=$(echo "$slug_reply" | jq -r '.slug')
    if [ -z "$prd_slug" ] || [ "$prd_slug" = "null" ]; then
        echo -e "${YELLOW}[WARN] Could not derive prdSlug from $prd_base. Disabling branching.${NC}"
        BRANCH_ENABLED=false
        return 0
    fi

    local updated
    updated=$(jq --arg b "$ORIGINAL_BRANCH" --arg s "$prd_slug" \
        '.ralphGitMeta = {originalBranch: $b, prdSlug: $s}' "$JSON_FILE")
    echo "$updated" | jq '.' > "$JSON_FILE"

    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[INFO] Captured originalBranch=$ORIGINAL_BRANCH, prdSlug=$prd_slug${NC}"
    fi
}

# One-shot preflight: abort branching if prerequisites (git CLI, clean-enough state) aren't met
git_branching_preflight() {
    if [ "$BRANCH_ENABLED" = false ]; then return 0; fi
    if ! command -v git >/dev/null 2>&1; then
        echo -e "${YELLOW}[WARN] git CLI not found. Disabling branching.${NC}"
        BRANCH_ENABLED=false
        return 0
    fi
    if [ -z "$ORIGINAL_BRANCH" ]; then
        echo -e "${YELLOW}[WARN] ORIGINAL_BRANCH is empty. Disabling branching.${NC}"
        BRANCH_ENABLED=false
        return 0
    fi
}

# Snapshot working tree before switching to a task branch
snapshot_working_tree() {
    if [ "$BRANCH_ENABLED" = false ]; then return 0; fi

    local dirty_reply
    dirty_reply=$(node "$SCRIPT_DIR/lib/git/index.js" has-uncommitted 2>&1) || return 0
    local dirty
    dirty=$(echo "$dirty_reply" | jq -r '.dirty')

    if [ "$dirty" = "true" ]; then
        local ts=$(date +%s)
        local push_reply
        push_reply=$(node "$SCRIPT_DIR/lib/git/index.js" stash-push --message "ralph-loop-iter-$ts" 2>&1) || {
            echo -e "${YELLOW}[WARN] stash-push failed: $push_reply. Continuing without stash.${NC}"
            STASH_APPLIED=false
            return 0
        }
        local stashed
        stashed=$(echo "$push_reply" | jq -r '.stashed')
        STASH_APPLIED="$stashed"
        if [ "$VERBOSE" = true ] && [ "$stashed" = "true" ]; then
            echo -e "${BLUE}[INFO] Stashed uncommitted changes before branch switch${NC}"
        fi
    else
        STASH_APPLIED=false
    fi
}

# Ensure a task branch exists and switch to it. Persists task.branchName.
ensure_task_branch() {
    local task_id="$1"
    local task_index="$2"

    if [ "$BRANCH_ENABLED" = false ]; then return 0; fi

    local prd_slug
    prd_slug=$(jq -r '.ralphGitMeta.prdSlug // empty' "$JSON_FILE")
    if [ -z "$prd_slug" ]; then
        echo -e "${YELLOW}[WARN] prdSlug missing; skipping branch for $task_id.${NC}"
        return 0
    fi

    local task_title
    task_title=$(jq -r ".tasks[$task_index].title" "$JSON_FILE")

    local existing_branch
    existing_branch=$(jq -r ".tasks[$task_index].branchName // empty" "$JSON_FILE")

    local branch_name
    if [ -n "$existing_branch" ]; then
        branch_name="$existing_branch"
    else
        local name_reply
        name_reply=$(node "$SCRIPT_DIR/lib/git/index.js" branch-name \
            --prd-slug "$prd_slug" --task-id "$task_id" --title "$task_title" 2>&1) || {
            echo -e "${YELLOW}[WARN] branch-name failed: $name_reply${NC}"
            return 0
        }
        branch_name=$(echo "$name_reply" | jq -r '.branchName')
        local updated
        updated=$(jq --argjson idx "$task_index" --arg n "$branch_name" \
            '.tasks[$idx].branchName = $n' "$JSON_FILE")
        echo "$updated" | jq '.' > "$JSON_FILE"
    fi

    local ensure_reply
    ensure_reply=$(node "$SCRIPT_DIR/lib/git/index.js" ensure-branch \
        --name "$branch_name" --base "$ORIGINAL_BRANCH" 2>&1) || {
        echo -e "${YELLOW}[WARN] ensure-branch failed: $ensure_reply${NC}"
        return 0
    }
    local created
    created=$(echo "$ensure_reply" | jq -r '.created')

    node "$SCRIPT_DIR/lib/git/index.js" switch-to --name "$branch_name" >/dev/null 2>&1 || {
        echo -e "${YELLOW}[WARN] Could not switch to $branch_name; branching disabled this iter.${NC}"
        CURRENT_TASK_BRANCH=""
        return 0
    }
    CURRENT_TASK_BRANCH="$branch_name"

    if [ "$created" = "true" ]; then
        emit_logging_event branch_created \
            "{\"taskId\":\"$task_id\",\"branchName\":\"$branch_name\",\"baseBranch\":\"$ORIGINAL_BRANCH\"}"
        if [ "$VERBOSE" = true ]; then
            echo -e "${GREEN}[INFO] Created branch $branch_name off $ORIGINAL_BRANCH${NC}"
        fi
    elif [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[INFO] Switched to existing task branch: $branch_name${NC}"
    fi
}

# Switch back to ORIGINAL_BRANCH and restore any stash pushed earlier
restore_working_tree() {
    if [ "$BRANCH_ENABLED" = false ]; then return 0; fi
    if [ -z "$ORIGINAL_BRANCH" ]; then return 0; fi
    if [ -z "$CURRENT_TASK_BRANCH" ]; then return 0; fi

    node "$SCRIPT_DIR/lib/git/index.js" switch-to --name "$ORIGINAL_BRANCH" >/dev/null 2>&1 || {
        echo -e "${YELLOW}[WARN] Could not switch back to $ORIGINAL_BRANCH.${NC}"
        return 0
    }
    CURRENT_TASK_BRANCH=""

    if [ "$STASH_APPLIED" = "true" ]; then
        node "$SCRIPT_DIR/lib/git/index.js" stash-pop >/dev/null 2>&1 || {
            echo -e "${YELLOW}[WARN] Could not pop ralph-loop stash. Run 'git stash list' to recover.${NC}"
        }
        STASH_APPLIED=false
    fi
}
```

- [ ] **Step 4: Re-run the test to verify it passes**

Run: `./tests/test-branching-flags.sh`
Expected: all tests PASS (including the five subtests for function presence).

- [ ] **Step 5: Commit**

```bash
git add ralph-loop tests/test-branching-flags.sh
git commit -m "feat(phase5): add Bash helpers for branch lifecycle (snapshot/ensure/restore)"
```

---

### Task 11: Bash `commit_iteration` helper

**Files:**
- Modify: `ralph-loop` (add function after `restore_working_tree`)

- [ ] **Step 1: Write the failing bash test**

Append to `tests/test-branching-flags.sh`:

```bash
test_commit_iteration_defined() {
    echo ""; echo "Test: ralph-loop defines commit_iteration"
    if grep -q "^commit_iteration()" "$RALPH_LOOP"; then pass "defines commit_iteration"
    else fail "missing function commit_iteration"; fi
}

test_commit_iteration_defined
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./tests/test-branching-flags.sh`
Expected: new subtest FAILs with "missing function commit_iteration".

- [ ] **Step 3: Add `commit_iteration` to `ralph-loop`**

Insert after `restore_working_tree` (which you just added in Task 10):

```bash
# Commit the current working tree for this iteration with Ralph trailers.
# Args: $1=task_id $2=task_index $3=iteration $4=verify_result_json $5=ralph_status
# ralph_status must be one of: in-progress | passed | failed
commit_iteration() {
    local task_id="$1"
    local task_index="$2"
    local iteration="$3"
    local verify_result="$4"
    local ralph_status="$5"

    if [ "$BRANCH_ENABLED" = false ]; then return 0; fi
    if [ -z "$CURRENT_TASK_BRANCH" ]; then return 0; fi

    local task_title
    task_title=$(jq -r ".tasks[$task_index].title" "$JSON_FILE")
    local issue_number
    issue_number=$(jq -r ".tasks[$task_index].issueNumber // empty" "$JSON_FILE")

    local pass_count=0
    local total_count=0
    if [ -n "$verify_result" ]; then
        pass_count=$(echo "$verify_result" | jq '[.results[] | select(.passed == true)] | length' 2>/dev/null || echo 0)
        total_count=$(echo "$verify_result" | jq '.results | length' 2>/dev/null || echo 0)
    fi

    local args=(
        commit-iteration
        --task-id "$task_id"
        --task-title "$task_title"
        --iteration "$iteration"
        --max-iterations "$MAX_ITERATIONS"
        --pass-count "$pass_count"
        --total-count "$total_count"
        --status "$ralph_status"
        --skip-if-empty
    )
    if [ -n "$issue_number" ]; then
        args+=(--issue "$issue_number")
    fi

    local reply
    local reply_exit=0
    reply=$(node "$SCRIPT_DIR/lib/git/index.js" "${args[@]}" 2>&1) || reply_exit=$?
    if [ $reply_exit -ne 0 ]; then
        echo -e "${YELLOW}[WARN] commit-iteration failed for $task_id: $reply${NC}"
        return 0
    fi

    local sha skipped
    sha=$(echo "$reply" | jq -r '.sha')
    skipped=$(echo "$reply" | jq -r '.skipped')
    if [ "$skipped" = "true" ]; then
        if [ "$VERBOSE" = true ]; then
            echo -e "${BLUE}[INFO] Nothing to commit for iter $iteration on $task_id${NC}"
        fi
        return 0
    fi

    if [ "$VERBOSE" = true ]; then
        echo -e "${GREEN}[INFO] Committed ${sha:0:7} on $CURRENT_TASK_BRANCH (status: $ralph_status)${NC}"
    fi

    emit_logging_event iteration_committed \
        "{\"iteration\":$iteration,\"taskId\":\"$task_id\",\"branchName\":\"$CURRENT_TASK_BRANCH\",\"sha\":\"$sha\",\"ralphStatus\":\"$ralph_status\",\"criteriaPassCount\":$pass_count,\"criteriaTotal\":$total_count}"
}
```

- [ ] **Step 4: Re-run the test to verify it passes**

Run: `./tests/test-branching-flags.sh`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ralph-loop tests/test-branching-flags.sh
git commit -m "feat(phase5): add commit_iteration Bash helper with structured trailers"
```

---

### Task 12: Bash `ensure_task_pr` and `mark_pr_ready` helpers

**Files:**
- Modify: `ralph-loop` (add functions after `commit_iteration`)

- [ ] **Step 1: Write the failing bash test**

Append to `tests/test-branching-flags.sh`:

```bash
test_pr_helpers_defined() {
    echo ""; echo "Test: ralph-loop defines ensure_task_pr + mark_pr_ready + push_task_branch"
    for fn in ensure_task_pr mark_pr_ready push_task_branch; do
        if grep -q "^${fn}()" "$RALPH_LOOP"; then pass "defines ${fn}"
        else fail "missing function ${fn}"; fi
    done
}

test_pr_helpers_defined
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./tests/test-branching-flags.sh`
Expected: three new subtests FAIL.

- [ ] **Step 3: Add helpers to `ralph-loop`**

Insert after `commit_iteration`:

```bash
# Push the current task branch to origin. Non-fatal on failure.
push_task_branch() {
    if [ "$BRANCH_ENABLED" = false ]; then return 0; fi
    if [ -z "$CURRENT_TASK_BRANCH" ]; then return 0; fi
    if [ "$GITHUB_ENABLED" = false ]; then return 0; fi

    local reply
    reply=$(node "$SCRIPT_DIR/lib/git/index.js" push --branch "$CURRENT_TASK_BRANCH" 2>&1) || true
    local ok
    ok=$(echo "$reply" | jq -r '.ok' 2>/dev/null || echo "false")
    if [ "$ok" != "true" ]; then
        if [ "$VERBOSE" = true ]; then
            echo -e "${YELLOW}[WARN] Could not push $CURRENT_TASK_BRANCH: $(echo "$reply" | jq -r '.error // empty')${NC}"
        fi
    fi
}

# Create a draft PR for a task if one doesn't yet exist. Persists prNumber + prUrl.
ensure_task_pr() {
    local task_id="$1"
    local task_index="$2"

    if [ "$BRANCH_ENABLED" = false ]; then return 0; fi
    if [ "$GITHUB_ENABLED" = false ]; then return 0; fi
    if [ -z "$TARGET_REPO" ]; then return 0; fi
    if [ -z "$CURRENT_TASK_BRANCH" ]; then return 0; fi

    local existing_pr
    existing_pr=$(jq -r ".tasks[$task_index].prNumber // empty" "$JSON_FILE")
    if [ -n "$existing_pr" ]; then return 0; fi

    local task_title
    task_title=$(jq -r ".tasks[$task_index].title" "$JSON_FILE")
    local issue_number
    issue_number=$(jq -r ".tasks[$task_index].issueNumber // empty" "$JSON_FILE")

    local args=(
        ensure-pr
        --repo "$TARGET_REPO"
        --branch "$CURRENT_TASK_BRANCH"
        --base "$ORIGINAL_BRANCH"
        --task-id "$task_id"
        --task-title "$task_title"
    )
    if [ -n "$issue_number" ]; then
        args+=(--issue "$issue_number")
    fi

    local reply reply_exit=0
    reply=$(node "$SCRIPT_DIR/lib/github/index.js" "${args[@]}" 2>&1) || reply_exit=$?
    if [ $reply_exit -ne 0 ]; then
        echo -e "${YELLOW}[WARN] ensure-pr failed for $task_id: $reply${NC}"
        return 0
    fi

    local pr_number pr_url created
    pr_number=$(echo "$reply" | jq -r '.prNumber')
    pr_url=$(echo "$reply" | jq -r '.prUrl')
    created=$(echo "$reply" | jq -r '.created')

    local updated
    updated=$(jq --argjson idx "$task_index" --argjson n "$pr_number" --arg u "$pr_url" \
        '.tasks[$idx].prNumber = $n | .tasks[$idx].prUrl = $u' "$JSON_FILE")
    echo "$updated" | jq '.' > "$JSON_FILE"

    if [ "$created" = "true" ]; then
        emit_logging_event pr_created \
            "{\"taskId\":\"$task_id\",\"prNumber\":$pr_number,\"prUrl\":\"$pr_url\",\"branchName\":\"$CURRENT_TASK_BRANCH\"}"
        if [ "$VERBOSE" = true ]; then
            echo -e "${GREEN}[INFO] Created draft PR #$pr_number: $pr_url${NC}"
        fi
    elif [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[INFO] Reusing existing PR #$pr_number for $task_id${NC}"
    fi
}

# Flip a task's draft PR to ready-for-review
mark_pr_ready() {
    local task_id="$1"
    local task_index="$2"

    if [ "$BRANCH_ENABLED" = false ]; then return 0; fi
    if [ "$GITHUB_ENABLED" = false ]; then return 0; fi
    if [ -z "$TARGET_REPO" ]; then return 0; fi

    local pr_number
    pr_number=$(jq -r ".tasks[$task_index].prNumber // empty" "$JSON_FILE")
    if [ -z "$pr_number" ]; then return 0; fi

    local reply reply_exit=0
    reply=$(node "$SCRIPT_DIR/lib/github/index.js" mark-pr-ready \
        --repo "$TARGET_REPO" --pr "$pr_number" 2>&1) || reply_exit=$?
    if [ $reply_exit -ne 0 ]; then
        echo -e "${YELLOW}[WARN] mark-pr-ready failed for $task_id: $reply${NC}"
        return 0
    fi

    emit_logging_event pr_marked_ready \
        "{\"taskId\":\"$task_id\",\"prNumber\":$pr_number}"
    if [ "$VERBOSE" = true ]; then
        echo -e "${GREEN}[INFO] Marked PR #$pr_number ready for review${NC}"
    fi
}
```

- [ ] **Step 4: Re-run the test to verify it passes**

Run: `./tests/test-branching-flags.sh`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ralph-loop tests/test-branching-flags.sh
git commit -m "feat(phase5): add ensure_task_pr, mark_pr_ready, push_task_branch Bash helpers"
```

---

### Task 13: Wire branching + commits + PR into `run_ralph_loop`

**Files:**
- Modify: `ralph-loop:1585-2020` (inside `run_ralph_loop`)

- [ ] **Step 1: Write the failing bash assertion**

Append to `tests/test-branching-flags.sh`:

```bash
test_run_loop_calls_branching_helpers() {
    echo ""; echo "Test: run_ralph_loop invokes branching helpers in the expected order"
    # Static grep on ralph-loop for presence in the right section.
    local src="$RALPH_LOOP"
    if grep -q "capture_original_branch" "$src" && \
       grep -q "ensure_task_branch" "$src" && \
       grep -q "commit_iteration" "$src" && \
       grep -q "ensure_task_pr" "$src" && \
       grep -q "mark_pr_ready" "$src" && \
       grep -q "restore_working_tree" "$src" && \
       grep -q "snapshot_working_tree" "$src"; then
        pass "run_ralph_loop wires all branching helpers"
    else
        fail "run_ralph_loop does not reference all required helpers"
    fi
}

test_run_loop_calls_branching_helpers
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `./tests/test-branching-flags.sh`
Expected: new subtest FAILS.

- [ ] **Step 3: Wire helpers into `run_ralph_loop`**

**(a)** Right after the `start_time=$(date +%s)` line (~line 1597), add:

```bash
    capture_original_branch
    git_branching_preflight
```

**(b)** In the per-iteration block: after `ensure_project_item "$next_task_id" "$task_index"` (~line 1686) and before `log_iteration ...`, insert:

```bash
        # Phase 5: snapshot working tree + switch to task branch
        snapshot_working_tree
        ensure_task_branch "$next_task_id" "$task_index"
```

**(c)** In the `if [ "$verify_exit" -eq 0 ]` (all criteria passed) branch (currently ~line 1896), after `sync_project_item ...` and before `close_task_issue ...`, insert:

```bash
            # Phase 5: commit + push + flip PR to ready
            commit_iteration "$next_task_id" "$task_index" "$iteration" "$verify_result" "passed"
            push_task_branch
            ensure_task_pr "$next_task_id" "$task_index"
            mark_pr_ready "$next_task_id" "$task_index"
```

**(d)** In the `else` (some criteria failed) branch (currently ~line 1921), after the second `sync_project_item ...` call (~line 1969), insert:

```bash
            # Phase 5: commit in-progress state + push + open draft PR
            commit_iteration "$next_task_id" "$task_index" "$iteration" "$verify_result" "in-progress"
            push_task_branch
            ensure_task_pr "$next_task_id" "$task_index"
```

**(e)** Immediately before the `rm -f "${JSON_FILE}.pre-iteration"` line at the end of the iteration loop body (~line 2008), insert:

```bash
        # Phase 5: return to the caller's branch between iterations
        restore_working_tree
```

**(f)** Also insert a final `restore_working_tree` call immediately *after* the `while` loop ends (between the closing `done` at ~line 2020 and the "Final check" comment at ~line 2022), so early breaks (completion, thrash-stop) still return the user to their original branch:

```bash
    # Phase 5: ensure we're back on the caller's branch regardless of how the loop exited
    restore_working_tree
```

**(g)** In the JSON-corruption error-recovery branch (currently ~line 1830–1835), after `cp "${JSON_FILE}.pre-iteration" "$JSON_FILE"` and before `log_iteration_result`, insert:

```bash
            # Phase 5: commit the failed iteration with Ralph-Status: failed
            commit_iteration "$next_task_id" "$task_index" "$iteration" "" "failed"
            push_task_branch
            ensure_task_pr "$next_task_id" "$task_index"
            restore_working_tree
```

- [ ] **Step 4: Re-run the test to verify it passes**

Run: `./tests/test-branching-flags.sh`
Expected: all tests PASS.

- [ ] **Step 5: Run the existing suites to confirm no regressions**

Run: `./tests/test-all.sh`
Expected: all existing suites PASS.

- [ ] **Step 6: Commit**

```bash
git add ralph-loop tests/test-branching-flags.sh
git commit -m "feat(phase5): wire branching helpers into run_ralph_loop (happy + failure paths)"
```

---

### Task 14: Harden the error-recovery path

**Files:**
- Modify: `ralph-loop` (the JSON-corruption block around line 1826–1836)
- Create/modify tests that exercise the failed-iteration commit

- [ ] **Step 1: Write the failing test**

Create `tests/test-phase5-failed-iteration.sh`:

```bash
#!/usr/bin/env bash
# tests/test-phase5-failed-iteration.sh — a corrupted JSON writes a Ralph-Status: failed commit
set -e
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
TESTS_PASSED=0; TESTS_FAILED=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
RALPH_LOOP="$PROJECT_ROOT/ralph-loop"
pass() { echo -e "${GREEN}✓ PASS:${NC} $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo -e "${RED}✗ FAIL:${NC} $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

test_failed_iteration_trailer_present_in_code() {
    echo ""; echo "Test: the JSON-corruption branch invokes commit_iteration with status=failed"
    if grep -A6 'JSON file corrupted during iteration' "$RALPH_LOOP" | grep -q 'commit_iteration.*"failed"'; then
        pass "failed-iteration commit is wired in the corruption branch"
    else
        fail "corruption branch does not commit with Ralph-Status: failed"
    fi
}

test_failed_iteration_trailer_present_in_code

echo ""
echo "Phase 5 failed-iteration recovery: $TESTS_PASSED passed, $TESTS_FAILED failed"
[ $TESTS_FAILED -eq 0 ] || exit 1
```

```bash
chmod +x tests/test-phase5-failed-iteration.sh
```

- [ ] **Step 2: Run to verify it fails (or passes if Task 13 (g) was applied cleanly)**

Run: `./tests/test-phase5-failed-iteration.sh`
Expected: PASS if Task 13(g) is in place. If it FAILS, return to Task 13(g) and fix the wiring.

- [ ] **Step 3: Additional hardening — replace the silent `cat "$JSON_FILE"` fallback in the criteria-failure path**

In `ralph-loop` at the `else` branch where criteria fail (~line 1923–1929), replace:

```bash
            local updated_prd=$(jq \
                --argjson idx "$task_index" \
                --arg now "$now" \
                --argjson results "$verify_result" \
                '.tasks[$idx].criteriaResults = $results.results' \
                "$JSON_FILE" 2>/dev/null || cat "$JSON_FILE")
            echo "$updated_prd" | jq '.' > "$JSON_FILE" 2>/dev/null || true
```

with:

```bash
            local updated_prd
            if ! updated_prd=$(jq \
                --argjson idx "$task_index" \
                --arg now "$now" \
                --argjson results "$verify_result" \
                '.tasks[$idx].criteriaResults = $results.results' \
                "$JSON_FILE" 2>&1); then
                echo -e "${YELLOW}[WARN] Could not merge criteria results into PRD JSON: $updated_prd${NC}"
            else
                echo "$updated_prd" | jq '.' > "$JSON_FILE"
            fi
```

- [ ] **Step 4: Re-run all tests**

Run: `./tests/test-all.sh && ./tests/test-phase5-failed-iteration.sh`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add ralph-loop tests/test-phase5-failed-iteration.sh
git commit -m "feat(phase5): harden failed-iteration path to always commit Ralph-Status: failed"
```

---

### Task 15: Help text + README section

**Files:**
- Modify: `ralph-loop` (`show_help`)
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

Append to `tests/test-help.sh` (or create a new section if the file doesn't exist; if the file is tabled read-only in this repo, skip this substep and rely on visual inspection):

```bash
test_help_documents_phase5() {
    echo ""; echo "Test: --help includes Phase 5 section"
    local output
    output=$("$RALPH_LOOP" --help 2>&1)
    if echo "$output" | grep -q "Git Branching & PRs"; then
        pass "help documents Phase 5"
    else
        fail "help does not mention Git Branching & PRs"
    fi
}

test_help_documents_phase5
```

- [ ] **Step 2: Run to verify it fails**

Run: `./tests/test-help.sh`
Expected: FAIL on the new subtest.

- [ ] **Step 3: Extend `show_help` in `ralph-loop`**

Insert the following block in `show_help` right after the existing GitHub Projects v2 section (~line 91):

```bash
  Git Branching & PRs (Phase 5):
    Each task gets its own branch (ralph/<prd>/<task>-<slug>) off the caller's
    current branch. Each iteration is a separate commit with Ralph-Task-Id,
    Ralph-Issue, and Ralph-Status trailers. A draft PR opens after the first
    commit and flips to ready-for-review when all criteria pass. Use
    --no-branch to disable; --no-github also implies --no-branch.
```

- [ ] **Step 4: Add a Phase 5 section to `README.md`**

Append to `README.md` a new section (preserve existing heading style; typical phase docs appear between the existing Phase 3/4 sections):

```markdown
## Phase 5 — Git Branching & PRs

Every task gets its own branch:

```
ralph/<prd-slug>/<task-id>-<title-slug>
```

...forked off the branch you ran Ralph from. Each iteration is a separate
commit with structured trailers:

```
task-3: add JWT validation middleware

Iteration 2/15. Criteria: 2/3 passing.

Ralph-Task-Id: task-3
Ralph-Issue: #42
Ralph-Status: in-progress
```

`Ralph-Status` is one of `in-progress`, `passed`, or `failed`. A draft pull
request opens after the first commit and links back to the task issue via a
`Closes #<issueNumber>` trailer. When all acceptance criteria pass, Ralph
flips the PR to ready-for-review via `gh pr ready`. Failed iterations (JSON
corruption, etc.) still produce a commit with `Ralph-Status: failed` so the
history is complete.

Disable entirely with `--no-branch`. `--no-github` also implies `--no-branch`.
```

- [ ] **Step 5: Re-run help tests**

Run: `./tests/test-help.sh`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add ralph-loop README.md tests/test-help.sh
git commit -m "docs(phase5): document branching + PR behavior in --help and README"
```

---

### Task 16: Event catalogue additions (Phase 3 soft dependency)

**Files (only if `lib/logging/events.js` exists — if not, skip to the commit step with no changes):**
- Modify: `lib/logging/events.js`
- Modify: `lib/logging/renderer.js` (if present)
- Modify/create: `lib/logging/events.test.js`

- [ ] **Step 1: Detect presence**

```bash
ls lib/logging/events.js 2>/dev/null && echo PRESENT || echo ABSENT
```

If `ABSENT`, this task is a no-op. Proceed to step 5 (commit a comment in `docs/superpowers/plans/...-phase5-git-branching.md` if absolutely needed, or just skip).

If `PRESENT`, continue.

- [ ] **Step 2: Write failing tests for new event types**

Append to `lib/logging/events.test.js`:

```js
describe('phase5 events', () => {
  test('validates branch_created', () => {
    expect(() => validateEvent({
      event: 'branch_created',
      ts: '2026-04-19T00:00:00Z',
      taskId: 'task-1', branchName: 'ralph/x/task-1-y', baseBranch: 'main',
    })).not.toThrow();
  });

  test('rejects branch_created missing baseBranch', () => {
    expect(() => validateEvent({
      event: 'branch_created', ts: '2026-04-19T00:00:00Z',
      taskId: 'task-1', branchName: 'b',
    })).toThrow(/baseBranch/);
  });

  test('validates iteration_committed', () => {
    expect(() => validateEvent({
      event: 'iteration_committed', ts: '2026-04-19T00:00:00Z',
      iteration: 1, taskId: 'task-1', branchName: 'b', sha: 'abc', ralphStatus: 'passed',
    })).not.toThrow();
  });

  test('validates pr_created', () => {
    expect(() => validateEvent({
      event: 'pr_created', ts: '2026-04-19T00:00:00Z',
      taskId: 'task-1', prNumber: 7, prUrl: 'https://x/7', branchName: 'b',
    })).not.toThrow();
  });

  test('validates pr_marked_ready', () => {
    expect(() => validateEvent({
      event: 'pr_marked_ready', ts: '2026-04-19T00:00:00Z',
      taskId: 'task-1', prNumber: 7,
    })).not.toThrow();
  });
});
```

- [ ] **Step 3: Add the entries to the `REQUIRED` map in `lib/logging/events.js`**

Example additions (adapt to the module's existing shape — match how `project_created` etc. are registered):

```js
REQUIRED.branch_created     = { taskId: 'string', branchName: 'string', baseBranch: 'string' };
REQUIRED.iteration_committed = { iteration: 'number', taskId: 'string', branchName: 'string', sha: 'string', ralphStatus: 'string' };
REQUIRED.pr_created          = { taskId: 'string', prNumber: 'number', prUrl: 'string', branchName: 'string' };
REQUIRED.pr_marked_ready     = { taskId: 'string', prNumber: 'number' };
```

And (if the module has an `OPTIONAL` companion map):

```js
OPTIONAL.branch_created      = { sha: 'string' };
OPTIONAL.iteration_committed = { criteriaPassCount: 'number', criteriaTotal: 'number' };
```

- [ ] **Step 4: Update `lib/logging/renderer.js` (if present) to render the new events**

Add case branches that produce one-line output:

```js
case 'branch_created':
  return `├─ Branch created: ${ev.branchName} ← ${ev.baseBranch} (${ev.taskId})`;
case 'iteration_committed':
  return `├─ Committed ${ev.sha.slice(0,7)} on ${ev.branchName} (iter ${ev.iteration}, ${ev.ralphStatus})`;
case 'pr_created':
  return `├─ PR #${ev.prNumber} opened: ${ev.prUrl} (${ev.taskId})`;
case 'pr_marked_ready':
  return `├─ PR #${ev.prNumber} marked ready (${ev.taskId})`;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest lib/logging --no-coverage`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/logging/
git commit -m "feat(phase5): register branch_created, iteration_committed, pr_created, pr_marked_ready events"
```

If Phase 3 is absent, record a no-op:

```bash
git commit --allow-empty -m "chore(phase5): event catalogue additions deferred (no lib/logging/ present)"
```

---

### Task 17: `tests/fixtures/mock-git.sh` — fake `git` for integration tests

**Files:**
- Create: `tests/fixtures/mock-git.sh`

- [ ] **Step 1: Write the fixture**

```bash
#!/usr/bin/env bash
# tests/fixtures/mock-git.sh — minimal fake `git` for Phase 5 integration tests.
# Logs every invocation to MOCK_GIT_CALL_LOG and returns canned state.
set -euo pipefail

: "${MOCK_GIT_CALL_LOG:=/tmp/mock-git-calls.log}"
echo "$*" >> "$MOCK_GIT_CALL_LOG"

case "${1:-}" in
    rev-parse)
        case "${2:-}" in
            --abbrev-ref) echo "main" ;;
            HEAD)         echo "abc1234567890abcdef0000000000000000000" ;;
            *)            echo "abc1234567890abcdef0000000000000000000" ;;
        esac
        exit 0
        ;;
    show-ref)
        # Always report branch missing so ensure-branch proceeds to create it.
        # Tests that need richer behavior can override this fixture per-test.
        exit 1
        ;;
    branch)
        exit 0
        ;;
    checkout|switch)
        exit 0
        ;;
    diff)
        exit 0
        ;;
    ls-files)
        echo ""
        exit 0
        ;;
    stash)
        case "${2:-}" in
            push) echo "Saved working directory and index state" ;;
            pop)  echo "Dropped refs/stash@{0}" ;;
            *)    echo "" ;;
        esac
        exit 0
        ;;
    add)
        exit 0
        ;;
    commit)
        exit 0
        ;;
    push)
        exit 0
        ;;
    *)
        # Fall back to silent success for unknown subcommands
        exit 0
        ;;
esac
```

- [ ] **Step 2: Mark it executable**

```bash
chmod +x tests/fixtures/mock-git.sh
```

- [ ] **Step 3: Verify by running via PATH override**

```bash
MOCK_GIT_CALL_LOG=/tmp/test-mock-git.log PATH="$(pwd)/tests/fixtures:$PATH" git rev-parse --abbrev-ref HEAD
```

Expected output: `main`. And `/tmp/test-mock-git.log` contains `rev-parse --abbrev-ref HEAD`.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/mock-git.sh
git commit -m "test(phase5): add mock-git fixture for branching integration tests"
```

---

### Task 18: `tests/test-git-branching.sh` — end-to-end integration tests + register in `test-all.sh`

**Files:**
- Create: `tests/test-git-branching.sh`
- Modify: `tests/test-all.sh`

- [ ] **Step 1: Write the integration test script**

```bash
#!/usr/bin/env bash
# tests/test-git-branching.sh — integration tests for Phase 5 branching + PR lifecycle
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
TESTS_PASSED=0; TESTS_FAILED=0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
GIT_CLI="$PROJECT_ROOT/lib/git/index.js"
GH_CLI="$PROJECT_ROOT/lib/github/index.js"
MOCK_GIT="$SCRIPT_DIR/fixtures/mock-git.sh"

pass() { echo -e "${GREEN}✓ PASS:${NC} $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo -e "${RED}✗ FAIL:${NC} $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
info() { echo -e "${YELLOW}INFO:${NC} $1"; }

setup() {
    TEST_DIR=$(mktemp -d)
    MOCK_GIT_DIR=$(mktemp -d)
    cp "$MOCK_GIT" "$MOCK_GIT_DIR/git"
    chmod +x "$MOCK_GIT_DIR/git"
    export MOCK_GIT_CALL_LOG="$TEST_DIR/git-calls.log"
    : > "$MOCK_GIT_CALL_LOG"
    export PATH="$MOCK_GIT_DIR:$PATH"
    info "Test dir: $TEST_DIR; mock git: $MOCK_GIT_DIR/git"
}

cleanup() {
    rm -rf "$TEST_DIR" "$MOCK_GIT_DIR" 2>/dev/null || true
}
trap cleanup EXIT

test_cli_slugify() {
    echo ""; echo "Test 1: lib/git/index.js slugify"
    local output exit_code
    output=$(node "$GIT_CLI" slugify --input "Add JWT Validation!" 2>&1) && exit_code=0 || exit_code=$?
    if [ $exit_code -eq 0 ] && echo "$output" | jq -e '.slug == "add-jwt-validation"' >/dev/null; then
        pass "slugify returns correct slug"
    else
        fail "slugify. exit=$exit_code output=$output"
    fi
}

test_cli_branch_name() {
    echo ""; echo "Test 2: lib/git/index.js branch-name"
    local output
    output=$(node "$GIT_CLI" branch-name --prd-slug foo --task-id task-3 --title "Add X")
    if echo "$output" | jq -e '.branchName == "ralph/foo/task-3-add-x"' >/dev/null; then
        pass "branch-name composes correctly"
    else
        fail "branch-name. output=$output"
    fi
}

test_cli_current_branch_via_mock() {
    echo ""; echo "Test 3: current-branch reads mock git"
    local output
    output=$(node "$GIT_CLI" current-branch 2>&1)
    if echo "$output" | jq -e '.branch == "main"' >/dev/null; then
        pass "current-branch returns main"
    else
        fail "current-branch. output=$output"
    fi
    if grep -q "rev-parse --abbrev-ref HEAD" "$MOCK_GIT_CALL_LOG"; then
        pass "mock git logged the rev-parse call"
    else
        fail "mock git did not log rev-parse"
    fi
}

test_cli_ensure_branch_via_mock() {
    echo ""; echo "Test 4: ensure-branch creates branch when show-ref fails"
    local output
    output=$(node "$GIT_CLI" ensure-branch --name ralph/x/task-1-y --base main 2>&1)
    if echo "$output" | jq -e '.created == true' >/dev/null; then
        pass "ensure-branch reports created=true"
    else
        fail "ensure-branch. output=$output"
    fi
    if grep -q 'branch "ralph/x/task-1-y" "main"' "$MOCK_GIT_CALL_LOG"; then
        pass "mock git saw branch creation call"
    else
        fail "mock git never saw branch create"
    fi
}

test_cli_commit_iteration_via_mock() {
    echo ""; echo "Test 5: commit-iteration runs git add + git commit via mock"
    : > "$MOCK_GIT_CALL_LOG"
    local output
    output=$(node "$GIT_CLI" commit-iteration \
        --task-id task-3 --task-title "Add X" \
        --iteration 1 --max-iterations 10 \
        --pass-count 1 --total-count 2 \
        --issue 42 --status in-progress 2>&1)
    if echo "$output" | jq -e '.sha == "abc1234567890abcdef0000000000000000000"' >/dev/null; then
        pass "commit-iteration returns sha"
    else
        fail "commit-iteration. output=$output"
    fi
    if grep -q "^add -A" "$MOCK_GIT_CALL_LOG" && grep -q "^commit -F" "$MOCK_GIT_CALL_LOG"; then
        pass "commit-iteration issued add -A and commit -F"
    else
        fail "commit-iteration did not call add + commit. log=$(cat "$MOCK_GIT_CALL_LOG")"
    fi
}

test_no_branch_end_to_end() {
    echo ""; echo "Test 6: --no-branch skips all branching side effects"
    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "No branch test", "tasks": [{
    "id": "task-1", "title": "T", "category": "C", "priority": 1,
    "acceptanceCriteria": ["x"], "passes": false, "attempts": 0
  }]
}
EOF
    : > "$MOCK_GIT_CALL_LOG"
    local output exit_code
    output=$("$PROJECT_ROOT/ralph-loop" "$TEST_DIR/prd.json" --no-branch --dry-run 2>&1) && exit_code=0 || exit_code=$?
    if [ $exit_code -eq 0 ]; then
        pass "--no-branch + --dry-run exits 0"
    else
        fail "--no-branch + --dry-run failed. exit=$exit_code output=$output"
    fi
    # No commit/branch/push calls expected
    if grep -Eq "^(commit|push|branch|checkout)" "$MOCK_GIT_CALL_LOG"; then
        fail "branching side effects leaked under --no-branch. log=$(cat "$MOCK_GIT_CALL_LOG")"
    else
        pass "no git side effects under --no-branch"
    fi
}

setup
test_cli_slugify
test_cli_branch_name
test_cli_current_branch_via_mock
test_cli_ensure_branch_via_mock
test_cli_commit_iteration_via_mock
test_no_branch_end_to_end

echo ""
echo "────────────────────────────────────────────────"
echo "Phase 5 integration: $TESTS_PASSED passed, $TESTS_FAILED failed"
[ $TESTS_FAILED -eq 0 ] || exit 1
```

```bash
chmod +x tests/test-git-branching.sh
```

- [ ] **Step 2: Register in `tests/test-all.sh`**

Edit `tests/test-all.sh` — add two entries to the `TEST_SCRIPTS` array (after `"test-github-projects.sh"`):

```bash
    "test-branching-flags.sh"
    "test-git-branching.sh"
    "test-phase5-failed-iteration.sh"
```

- [ ] **Step 3: Run the full suite**

Run: `./tests/test-all.sh`
Expected: every suite PASSES, including the three new ones.

- [ ] **Step 4: Run Jest unit suites**

Run: `npx jest --no-coverage --testPathIgnorePatterns='user-model'`
Expected: all Jest suites PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/test-git-branching.sh tests/test-all.sh
git commit -m "test(phase5): integration tests for git branching + PR lifecycle"
```

---

## Final Verification

- [ ] **Step 1: Run the complete bash suite**

```bash
./tests/test-all.sh
```

Expected: all 12+ suites PASS.

- [ ] **Step 2: Run the complete Jest suite**

```bash
npx jest --no-coverage --testPathIgnorePatterns='user-model'
```

Expected: all Jest unit suites PASS.

- [ ] **Step 3: Dry-run on a sample PRD with branching enabled (no side effects)**

```bash
./ralph-loop examples/good-prd-example.md --dry-run
```

Expected: prints the prompt and exits 0, no branch/commit/PR side effects, no `Ralph-Status:` commits on current branch (check `git log -n1 --format=%s`).

- [ ] **Step 4: Final commit with phase summary**

```bash
git add -A
git commit --allow-empty -m "feat: complete Phase 5 — git branching & PR lifecycle

- Per-task branch ralph/<prd>/<task>-<slug> forked off the caller's branch
- Each iteration commits with Ralph-Task-Id/Ralph-Issue/Ralph-Status trailers
- Draft PR opens after the first commit; flips ready when all criteria pass
- Failed iterations still commit with Ralph-Status: failed
- --no-branch (and --no-github) cleanly opt out
- Phase 3 events: branch_created, iteration_committed, pr_created, pr_marked_ready"
```

---

## Notes for the Executing Engineer

- **Don't check in the dependency-merging code.** The spec explicitly defers it to Phase 6 ("Activated only after Phase 6 (dependency graph) ships"). Leave it out.
- **Fallbacks are non-fatal.** Every GitHub and git call in the Bash helpers must warn on failure and continue — never `exit_error` out of `run_ralph_loop`. The existing Phase 2/4 helpers set the precedent.
- **Don't commit `Ralph-Status: failed` without JSON recovery.** The failure path in Task 13(f) only fires *after* the JSON has been restored from the snapshot — so the tree is in a known-good state.
- **`gh pr create` requires a remote commit.** That's why `push_task_branch` runs before `ensure_task_pr`. If the push fails, the PR will also fail; both must be non-fatal.
- **The mock `git` fixture returns `main` unconditionally.** Tests that need other branch names should override `MOCK_GIT_CALL_LOG` + patch the fixture, not mutate repo state.
- **`git stash create` vs `git stash push`.** The spec mentions `git stash create`, but that doesn't modify the working tree — so a `git checkout` afterwards would fail on a dirty tree. This plan uses `git stash push -u` (which moves changes off the tree) and pops them on `restore_working_tree`. If the spec author prefers `stash create`, swap `stashPush` for a ref-storing variant — the CLI surface stays the same.
- **Preserve legacy behavior.** If a PRD JSON lacks `ralphGitMeta`, Ralph writes it on first run. If `branchName` is already present on a task (e.g., from a past run on a renamed title), Ralph reuses it rather than computing a new one — this guarantees the same branch across resumes even if the task title is edited.
