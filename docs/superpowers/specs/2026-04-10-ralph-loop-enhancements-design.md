# Ralph Loop Enhancements — Design Spec

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Implementation language | Bash orchestrator + Node.js modules in `lib/` | Incremental migration; preserves CLI feel, adds real language for complex logic |
| Existing Node.js layer (`models/`, `database/`) | Demo artifacts, untouched | New modules built separately in `lib/` |
| Criteria + prompt interaction | Ralph verifies after Claude, prompt includes verification commands | Claude knows the bar; Ralph independently confirms |
| Target repo resolution | PRD JSON field > `git remote` fallback > `--repo` CLI override | Works out of the box, handles edge cases |

---

## Project Structure

```
ralph-loop              # Bash orchestrator (existing, modified)
lib/
  github/
    index.js            # CLI entry point for Bash to call
    issues.js           # Create/update/close issues, post comments
    projects.js         # Create projects, manage fields, sync items
    repo.js             # Resolve target repo (PRD field -> git remote -> CLI flag)
  criteria/
    index.js            # CLI entry point
    runner.js           # Execute typed criteria (shell, http, file-exists, grep)
    schema.js           # Validate and normalize criteria (string -> object migration)
  deps/
    index.js            # CLI entry point
    graph.js            # Topological sort, blocked-task detection
  logging/
    index.js            # CLI entry point
    jsonl.js            # Write structured events
    renderer.js         # JSONL -> human-readable output
  prompt/
    index.js            # CLI entry point
    builder.js          # Build Claude prompts with criteria commands and dependency context
```

Each `index.js` is a thin CLI wrapper: parses args, calls the module, writes JSON to stdout, exits with 0/1. Bash calls them via `node lib/<module>/index.js <command> <args>`. Each module is independently testable with Jest.

---

## Phase 0 — Quick Wins

### `--dry-run`

New flag. Runs the full pipeline (parse args, validate PRD, convert markdown, find next task, build prompt) then prints the prompt and exits. Implemented entirely in Bash — check the flag after prompt construction, print, `exit 0`.

### `--no-github` flag skeleton

New flag. Sets `GITHUB_ENABLED=false` (default `true`). All GitHub calls added in later phases are gated behind `if [ "$GITHUB_ENABLED" = true ]`. Ships as a no-op initially.

### Prompt improvement

Replace the hardcoded 5-line prompt (current line 1068) with output from `lib/prompt/builder.js`. The builder receives the task details and produces a prompt that:

- Describes the task (title, description, full criteria text)
- Lists the exact commands Ralph will run to verify each criterion
- Tells Claude to work in the directory without modifying the PRD JSON or progress files
- Uses "DONE" as the completion signal (informational only — Ralph decides pass/fail from criteria results)

Example output:

```
You are working on task "Add JWT validation" (task-3, priority 3).

Description: Add JWT validation middleware to the auth route.

After your turn, I will verify your work by running these commands:
  1. npm test -- auth.test.js (expecting exit code 0)
  2. curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/auth/login -> expecting 200

Work in this directory. Do not modify auth-feature.json or progress files.
When you believe the task is complete, just say "DONE".
```

The `<promise>COMPLETE</promise>` protocol is retired once Phase 1 (executable criteria) ships. During Phase 0 only, the existing completion detection remains as a bridge: Claude still says "DONE" and Ralph still checks `passes` fields in the JSON (written by Claude). Phase 1 replaces this entirely — Ralph writes `passes` based on criteria verification results, and Claude's "DONE" becomes purely informational.

---

## Phase 1 — Executable Criteria

### Criteria schema

Each criterion can be a string (legacy) or a typed object. `lib/criteria/schema.js` normalizes all criteria to objects.

**Typed criterion formats:**

```json
{"text": "Unit tests pass", "type": "shell", "command": "npm test -- auth.test.js", "expectExitCode": 0}
{"text": "Login returns 200", "type": "http", "url": "http://localhost:3000/auth/login", "method": "POST", "body": {"email": "test@test.com"}, "expectStatus": 200, "timeout": 10000, "retries": 2, "retryDelay": 3000}
{"text": "Config exists", "type": "file-exists", "path": "./config/auth.json"}
{"text": "Route registered", "type": "grep", "pattern": "app\\.use.*auth", "path": "./src/routes/index.js"}
```

**Legacy string normalization:**

```json
"Users can log in" -> {"text": "Users can log in", "type": "manual", "confidence": "low"}
```

### Markdown syntax for typed criteria

Inline type hints in acceptance criteria bullets:

```markdown
### Acceptance Criteria
- Unit tests pass `[shell: npm test -- auth.test.js]`
- Login returns 200 `[http: POST http://localhost:3000/auth/login -> 200]`
- Config file exists `[file-exists: ./config/auth.json]`
- Route is registered `[grep: "app\.use.*auth" in ./src/routes/index.js]`
- Users report the UI feels responsive
```

No type hint = `manual` type with `low` confidence.

### Verification flow

After Claude's turn, Bash calls:

```bash
node lib/criteria/index.js verify --task-file <json> --task-id task-3
```

The runner:

1. Iterates through the task's criteria
2. Executes each typed criterion (shell subprocess, HTTP via `fetch`, `fs.existsSync`, regex on file)
3. Skips `manual` type (result: `"skipped"`)
4. Returns JSON to stdout:

```json
{"passed": false, "results": [{"criterion": 0, "passed": true}, {"criterion": 1, "passed": false, "error": "exit code 1"}]}
```

Bash reads the result, updates the PRD JSON (`passes`, `attempts`, per-criterion results). No more parsing Claude output for completion signals.

### Per-criterion tracking

New `criteriaResults` array in task JSON, persisted across iterations:

```json
{
  "acceptanceCriteria": [...],
  "criteriaResults": [
    {"passed": true, "lastChecked": "2026-04-10T14:30:00Z"},
    {"passed": false, "attempts": 4, "lastError": "exit code 1", "lastChecked": "2026-04-10T14:31:00Z"}
  ]
}
```

### Thrash detection

After each iteration, check: has any criterion failed 4+ consecutive times with no new criteria passing since last check? If so, pause and warn:

```
Warning: Task task-3 has stalled: criterion 2 has failed 4 consecutive times
  with no progress on other criteria.
  Consider: revising the criterion, splitting the task, or running --analyze-prd.
  Continue? [Y/n]
```

### `--analyze-prd` improvements

New output includes: criteria type breakdown (executable vs manual count), low-confidence criteria flagged with suggestions, executable coverage percentage.

---

## Phase 2 — GitHub Issues Integration

### Repo resolution

`lib/github/repo.js` resolves target repo in order:

1. `--repo owner/name` CLI flag (highest priority)
2. `repository` field in PRD JSON
3. Parse `git remote get-url origin` (fallback)

Error if none resolve and `GITHUB_ENABLED` is true.

### Issue lifecycle

**Create:** On first run for a task with no `issueNumber`, call `node lib/github/index.js create-issue --repo owner/name --task '<task-json>'`. Creates issue via `gh issue create` with title, description, criteria checklist, and labels (`ralph-loop`, task category). Returns `{"issueNumber": 42, "issueUrl": "https://..."}`. Bash writes these back to task JSON.

**Update:** After each iteration, call `node lib/github/index.js update-issue`. Posts one structured comment per iteration:

```markdown
### Iteration 3/15

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Unit tests pass | :white_check_mark: pass |
| 2 | Login returns 200 | :x: fail -- exit code 1 |
| 3 | Config exists | :white_check_mark: pass |

**Status:** 2/3 criteria passing. Continuing.
```

**Close:** When all criteria pass, call `node lib/github/index.js close-issue --issue 42 --repo owner/name`. Closes with a summary comment.

### Resume cross-check

On `--resume`, if tasks have `issueNumber` fields, optionally cross-check against issue state (open/closed) for consistency warnings. Local JSON remains source of truth.

### PRD JSON additions

```json
{
  "repository": "paullovvik/myrepo",
  "tasks": [{
    "issueNumber": 42,
    "issueUrl": "https://github.com/paullovvik/myrepo/issues/42",
    ...
  }]
}
```

---

## Phase 3 — Structured Logging

### JSONL progress log

Replace `progress.txt` with `progress.jsonl`. Each line is a self-contained event:

```json
{"ts":"2026-04-10T14:30:00Z","event":"run_start","prdFile":"auth.md","maxIterations":15}
{"ts":"2026-04-10T14:30:01Z","event":"iteration_start","iteration":1,"taskId":"task-3","taskTitle":"Add JWT validation"}
{"ts":"2026-04-10T14:31:12Z","event":"criterion_result","iteration":1,"taskId":"task-3","criterionIndex":0,"passed":true}
{"ts":"2026-04-10T14:31:13Z","event":"criterion_result","iteration":1,"taskId":"task-3","criterionIndex":1,"passed":false,"error":"exit code 1"}
{"ts":"2026-04-10T14:31:13Z","event":"iteration_end","iteration":1,"taskId":"task-3","criteriaPassCount":1,"criteriaTotalCount":2}
{"ts":"2026-04-10T14:35:00Z","event":"task_complete","taskId":"task-3","iterationsUsed":3}
{"ts":"2026-04-10T14:40:00Z","event":"run_complete","success":true,"totalIterations":8,"elapsed":600}
```

Event types: `run_start`, `run_resume`, `iteration_start`, `criterion_result`, `iteration_end`, `task_complete`, `thrash_warning`, `api_call`, `run_complete`.

### Writing events

Bash calls `node lib/logging/index.js append --file progress.jsonl --event '<json>'`. Module validates event shape and appends.

### Human-readable rendering

`node lib/logging/index.js render --file progress.jsonl` produces box-drawing output similar to current `progress.txt`.

Accessed via:
- Automatic summary at end of run
- `ralph-loop log <prd-file>` command (`--format pretty` default, `--format json` for raw JSONL)

### Resume from JSONL

`get_last_iteration` calls `node lib/logging/index.js last-iteration --file progress.jsonl` which reads the last `iteration_end` event. Replaces regex grep on formatted text.

### Migration

If `progress.txt` exists and `progress.jsonl` doesn't, warn on `--resume`: "Found legacy progress.txt but no progress.jsonl. Starting fresh logging. Old progress archived." No format conversion attempted.

---

## Phase 4 — GitHub Projects Board

### Project lifecycle

On first run for a PRD with no `githubProject` field, call `node lib/github/index.js create-project --repo owner/name --title '<prd-title>'`. The module:

- Creates project via `gh api graphql` (Projects v2 requires GraphQL)
- Creates custom fields: Priority (number), Category (single-select), Iteration Count (number), Criteria Pass Rate (number), Ralph Status (single-select: Pending, In Progress, Passed, Failed, Stalled)
- Caches field IDs in PRD JSON under `githubProject.fieldIds`
- Returns full `githubProject` object

```json
{
  "githubProject": {
    "number": 12,
    "id": "PVT_xxx",
    "owner": "paullovvik",
    "url": "https://github.com/users/paullovvik/projects/12",
    "fieldIds": {
      "priority": "PVTF_aaa",
      "category": "PVTF_bbb",
      "iterationCount": "PVTF_ccc",
      "criteriaPassRate": "PVTF_ddd",
      "ralphStatus": "PVTF_eee"
    }
  }
}
```

### Item sync

Each task becomes a project item linked to its issue. After every iteration, call `node lib/github/index.js sync-project-item` to update custom fields for the worked-on task. One GraphQL mutation per iteration.

### Field validation on resume

On resume with existing `githubProject`, verify field IDs still exist. Recreate missing fields and update cached IDs.

### Conflict policy

Ralph overwrites Ralph-managed fields based on criteria results. Logs a warning if the board value differs from what Ralph is setting. Human edits to non-Ralph fields are untouched.

### Rate limit awareness

Module tracks API calls per run. Warns if approaching 100 calls.

### Multi-PRD projects deferred

Each PRD gets its own project. Cross-PRD views and `ralph-loop project` subcommands are future work.

---

## Phase 5 — Git Branching & PRs

### Branch per task

Before working on a task, Bash creates branch `ralph/<prd-name>/task-<id>-<slugified-title>` off the current branch. Each iteration is a separate commit with structured trailers:

```
task-3: add JWT validation middleware

Iteration 2/15. Criteria: 2/3 passing.

Ralph-Task-Id: task-3
Ralph-Issue: #42
Ralph-Status: in-progress
```

### Dependency branch merging

Activated only after Phase 6 (dependency graph) ships. When a task has `dependsOn`, Ralph merges completed dependency branches into the task branch before Claude's turn:

```bash
git checkout ralph/<prd>/task-3-jwt-validation
git merge ralph/<prd>/task-1-user-model --no-edit
git merge ralph/<prd>/task-2-auth-routes --no-edit
```

On merge conflict: log it, mark task `Blocked`, comment on the issue, move to next non-blocked task.

### Auto-PR

First iteration of a task opens a draft PR with `Closes #<issueNumber>`. On task completion, mark PR ready for review via `gh pr ready`. Store `prNumber` in task JSON.

### Working directory management

Before branch switch: `git stash create` to snapshot state. Switch to task branch. Let Claude work. After verification, commit and switch back. Claude is unaware of branches.

### `--no-branch` flag

Disables branch-per-task. All work stays on current branch. Default: branching enabled when GitHub is enabled, disabled when `--no-github`. `--no-github` implies `--no-branch`.

### Dropped from original proposal

- **Git notes:** Invisible on GitHub's web UI. Issue comments serve the same purpose.
- **Checkpoint tags:** Tag namespace pollution. Branch refs and PR history are sufficient.

---

## Phase 6 — Dependency Graph

### `dependsOn` field

Tasks declare dependencies as an array of task IDs:

```json
{"id": "task-3", "title": "Add auth middleware", "dependsOn": ["task-1", "task-2"]}
```

Empty array or absent field = no dependencies (backward compatible).

### Markdown syntax

```markdown
## Task: Add auth middleware
**Category**: Backend
**Priority**: 3
**Depends On**: task-1, task-2
```

Parser learns `**Depends On**:` alongside `**Category**:` and `**Priority**:`.

### Topological sort

`lib/deps/graph.js` replaces `find_next_task`. Uses Kahn's algorithm:

1. Build adjacency list from `dependsOn`
2. Topological sort with cycle detection
3. Within same dependency tier, sort by priority
4. Filter out completed tasks and tasks with unmet dependencies

Returns:

```json
{"nextTask": "task-3", "blocked": ["task-5"], "ready": ["task-3", "task-4"], "cycle": null}
```

Cycle detected at validation time — `--analyze-prd` also checks.

### Blocked status

Tasks with unmet dependencies get `"status": "blocked"`. Reflected in progress visualization, GitHub Issue labels, and Project board. Blocked tasks don't consume iterations.

### Future parallelism hook

The `ready` array contains all currently executable tasks. Orchestrator stays sequential for now. Parallel execution in git worktrees is a noted extension point.

### Validation additions

`validate_prd_json` gains: `dependsOn` references valid task IDs, no self-dependencies, no cycles.

---

## Cross-Cutting: Error Recovery

### Iteration snapshots

Before each Claude invocation:

1. `cp "$JSON_FILE" "$JSON_FILE.pre-iteration"` — snapshot PRD state
2. `git stash create` — snapshot working tree (creates ref without modifying tree)

After Claude returns:

1. Validate JSON is still parseable via `node lib/criteria/index.js validate-json --file "$JSON_FILE"`
2. If corrupted: restore from snapshot, log failure as failed iteration
3. If valid: proceed to criteria verification

Built in Phase 1 alongside executable criteria.

### When branching is enabled

Failed iterations are still committed (work isn't lost) but get a `Ralph-Status: failed` trailer.

---

## Cross-Cutting: Cost Tracking

### API call events

`api_call` event in JSONL:

```json
{"event": "api_call", "iteration": 3, "taskId": "task-3", "durationSeconds": 72, "tokensIn": 1200, "tokensOut": 4500}
```

Token counts are best-effort (depends on Claude CLI output). Duration is always accurate.

### GitHub API call counting

GitHub module tracks calls per run. Count included in `run_complete` event and log summary.

### Run summary

End-of-run output includes: total API time, estimated token usage, iteration count, GitHub API calls used.

Built incrementally: duration in Phase 0, tokens in Phase 1, GitHub calls in Phase 2.

---

## CLI Surface

### Main command

```bash
ralph-loop <prd-file> [OPTIONS]

# Existing (unchanged)
  --max-iterations N     # Max loop iterations (default: 15)
  --verbose              # Detailed progress output
  --debug                # Full Claude output and internal state
  --resume               # Continue from last checkpoint
  --analyze-prd          # Analyze PRD quality and exit
  --help                 # Show help

# Phase 0
  --dry-run              # Show next prompt, don't call Claude
  --no-github            # Disable all GitHub integration

# Phase 2
  --repo owner/name      # Override target repository

# Phase 5
  --no-branch            # Disable branch-per-task
```

### New subcommand

```bash
ralph-loop log <prd-file> [--format pretty|json]
```

### Flag interactions

- `--no-github` implies `--no-branch`
- `--debug` implies `--verbose`
- `--dry-run` compatible with everything — runs full pipeline up to API call, then stops
- `--analyze-prd` gains: criteria type breakdown, dependency cycle check, executable vs manual ratio

---

## Implementation Order

| Order | Phase | What ships | Depends on |
|-------|-------|-----------|------------|
| 0 | Quick Wins | `--dry-run`, `--no-github` skeleton, `lib/prompt/builder.js` | Nothing |
| 1 | Executable Criteria | `lib/criteria/`, typed schema, verification flow, thrash detection, error recovery snapshots | Phase 0 (prompt builder) |
| 2 | GitHub Issues | `lib/github/issues.js`, `lib/github/repo.js`, issue lifecycle, `--repo` flag | Phase 1 (criteria results for comments) |
| 3 | Structured Logging | `lib/logging/`, JSONL events, `ralph-loop log` command, cost tracking | Phase 1 (criterion events) |
| 4 | GitHub Projects | `lib/github/projects.js`, project lifecycle, field sync | Phase 2 (issues exist), Phase 3 (logging) |
| 5 | Git Branching & PRs | Branch-per-task, auto-PR, `--no-branch`, working directory management | Phase 2 (issue linking for PRs) |
| 6 | Dependency Graph | `lib/deps/`, `dependsOn`, topological sort, blocked status, dependency branch merging | Phase 5 (branch merging needs branches) |

---

## Deferred (Not In Scope)

- Multi-PRD umbrella projects (`ralph-loop project create/status/run`)
- Parallel task execution in git worktrees
- Analytics and prediction models (Phase 6 of original proposal)
- Git notes and checkpoint tags
- Cross-PRD dashboards
