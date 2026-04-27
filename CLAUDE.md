# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ralph Loop is a Bash CLI tool that iteratively calls Claude Code to complete PRD (Product Requirements Document) tasks. It reads a PRD (markdown or JSON), finds the highest-priority incomplete task, builds a prompt with verification commands, sends it to `claude --dangerously-skip-permissions --print`, verifies acceptance criteria, and loops until all tasks pass or max iterations are reached.

## Commands

### Run tests
```bash
# All bash test suites
./tests/test-all.sh

# Individual test suites
./tests/test-conversion.sh
./tests/test-validation.sh
./tests/test-resume.sh
./tests/test-help.sh
./tests/test-analysis.sh
./tests/test-completion-detection.sh
./tests/test-criteria.sh
./tests/test-dry-run.sh
./tests/test-github.sh
./tests/test-github-projects.sh
./tests/test-git-branching.sh
./tests/test-branching-flags.sh
./tests/test-phase5-failed-iteration.sh
./tests/test-dependency-graph.sh
./tests/test-error-handling.sh
./tests/test-progress.sh
./tests/test-progress-visualization.sh
./tests/test-mcp.sh

# JavaScript unit tests (lib modules)
npx jest --no-coverage --testPathIgnorePatterns='user-model'

# All JavaScript tests (requires sqlite3)
npm test
```

### Run the tool
```bash
./ralph-loop <prd-file.md> [--max-iterations N] [--verbose] [--debug] [--resume] \
  [--analyze-prd] [--dry-run] [--no-github] [--no-branch] [--repo owner/name] [--mcp]
```

## Architecture

The project has three distinct parts:

### 1. Main CLI (`ralph-loop` — single Bash script)

The entire orchestrator is one Bash script with these key flows:

- **Argument parsing** (`parse_arguments`) — handles flags and sets globals (`MAX_ITERATIONS`, `VERBOSE`, `DEBUG`, `RESUME`, `ANALYZE_PRD`, `DRY_RUN`, `GITHUB_ENABLED`, `BRANCH_ENABLED`, `REPO_OVERRIDE`, `MCP_ENABLED`, `MCP_CONFIG_FILE`). `--no-github` implies `--no-branch`. `--mcp` enables MCP/LSP integration via `mcpls`.
- **Markdown-to-JSON conversion** (`convert_prd_to_json`) — parses `## Task:` headers, `**Category**:`, `**Priority**:`, optional `**Depends On**:` (comma-separated task IDs), and `### Acceptance Criteria` sections. Uses `jq` for formatting.
- **PRD validation** (`validate_prd_json`) — checks required fields (`id`, `title`, `category`, `priority`, `acceptanceCriteria`, `passes`), unique priorities, non-empty criteria arrays, and accepts optional `dependsOn`, `status`, `blockedBy` fields. Delegates dependency-graph validation (cycles, self-deps, dangling refs) to `lib/deps/index.js validate`.
- **GitHub repo resolution** (`resolve_target_repo`) — resolves target repo via `--repo` flag > PRD `repository` field > `git remote`
- **PRD analysis** (`analyze_prd`) — sends PRD content to Claude for quality feedback (with retry/backoff) and appends a **Dependency Analysis** section from `lib/deps`.
- **Main loop** (`run_ralph_loop`) — iterates up to `MAX_ITERATIONS`:
  1. `find_next_task` — calls `node lib/deps/index.js next-task` for dep-graph-aware picking; syncs `status` (`ready`/`blocked`) and `blockedBy` back to the PRD JSON each iteration
  2. `ensure_task_issue` — creates GitHub issue if `GITHUB_ENABLED` and no `issueNumber` exists; applies/removes `blocked` label as needed
  3. `ensure_task_branch` / `ensure_task_pr` — when `BRANCH_ENABLED`, forks `ralph/<prd-slug>/<task-id>-<title-slug>` and opens a draft PR (`Closes #<issueNumber>`)
  4. `merge_dependency_branches` — `git merge --no-edit`'s every completed dep branch into the task branch; on conflict aborts, marks task blocked, comments on issue, skips iteration
  5. Builds prompt via `node lib/prompt/index.js build`
  6. Sends prompt to Claude CLI (`claude --dangerously-skip-permissions --print`); when `MCP_ENABLED`, appends `--mcp-config <MCP_CONFIG_FILE>`. After Claude returns, classifies per-iteration MCP status (`ok`/`degraded`/`off`) via a case-insensitive heuristic on `claude_output` and records `MCP: <status>` in `progress.txt` (and on the GitHub issue comment when enabled). Degraded iterations also write a sidecar `mcp-iteration-N.log`.
  7. Verifies criteria via `node lib/criteria/index.js verify` — Ralph decides pass/fail, not Claude
  8. `commit_iteration` — commits with structured trailers (`Ralph-Task-Id`, `Ralph-Issue`, `Ralph-Status: in-progress|passed|failed`); failed iterations still commit
  9. `post_iteration_comment` — posts iteration results table to GitHub issue; `sync_project_item` updates Projects v2 fields
  10. `close_task_issue` + `mark_pr_ready` — closes issue and flips PR to ready when all criteria pass
  11. `check_thrash` — detects stalled criteria (4+ consecutive failures)
  12. Updates JSON file and logs to `progress.txt`
- **Resume support** — reads last iteration number from `progress.txt`, archives old progress files, `crosscheck_issues` warns about JSON/GitHub state mismatches

### 2. Node.js modules (`lib/`)

Each module follows the same pattern: `index.js` is a thin CLI wrapper (parses args, calls module, writes JSON to stdout, exits 0/1). Bash calls them via `node lib/<module>/index.js <command> <args>`.

```
lib/
  prompt/
    index.js            # CLI: build --task-file <path> --task-id <id>
    builder.js          # Builds Claude prompts with verification commands
  criteria/
    index.js            # CLI: verify | normalize | validate-json
    schema.js           # Parse inline type hints, normalize string->object, validate
    runner.js           # Execute criteria (shell, http, file-exists, grep, manual)
  github/
    index.js            # CLI: resolve-repo | create-issue | update-issue | close-issue | add-label | remove-label | create-project | ensure-project-item | sync-project-item | validate-project | repair-project-fields | create-pr | mark-pr-ready
    repo.js             # Resolve target repo (CLI flag > PRD field > git remote)
    issues.js           # Create/update/close issues, format iteration comment tables, add/remove labels
    pullrequests.js     # Draft PR creation, mark-ready (gh pr ready), Closes-trailer wiring
    graphql.js          # gh api graphql wrapper + call counting
    projects.js         # Projects v2: project/field/item lifecycle + conflict detection (incl. Blocked status)
  git/
    index.js            # CLI: branch-name | ensure-branch | commit | push | merge-branch | merge-abort | stash-*
    slug.js             # PRD/title slug helpers for ralph/<prd>/<task-id>-<slug> branch names
    branches.js         # Create/checkout per-task branches off the launch branch
    commits.js          # Build commit messages with Ralph-* trailers
    merge.js            # git merge --no-edit dependency branches; abort + report conflicts
    stash.js            # Save/restore working state across iterations
  deps/
    index.js            # CLI: validate | next-task
    graph.js            # Kahn topo sort, cycle detection, pickNextTask (highest-priority unblocked)
  mcp/
    index.js            # CLI: write-config --output <path>
    config.js           # Pure buildMcpConfig() factory
```

**Criteria types:** `shell` (exit code), `http` (status code), `file-exists`, `grep` (regex in file), `manual` (skipped)

**Inline type hint syntax in markdown PRDs:**
```markdown
- Unit tests pass `[shell: npm test -- auth.test.js]`
- Login returns 200 `[http: POST http://localhost:3000/auth/login -> 200]`
- Config file exists `[file-exists: ./config/auth.json]`
- Route is registered `[grep: "app\.use.*auth" in ./src/routes/index.js]`
```

### 3. Legacy demo layer (`models/`, `database/`)

A small Node.js component with SQLite (demo artifacts, not part of the main tool):
- `models/User.js` — User class with validation
- `database/schema.sql`, `database/migrate.js` — SQLite migration
- Tests require `sqlite3` package: `npm test`

## Key conventions

- PRD JSON tasks track state with `passes`, `attempts`, `completedAt`, `criteriaResults`, `issueNumber`, `issueUrl`, `projectItemId`, `dependsOn`, `status` (`ready`/`blocked`), `blockedBy`, `branchName`, and `prNumber` fields
- Ralph verifies criteria independently after Claude's turn — Claude says "DONE" as informational signal only
- All GitHub calls are gated behind `GITHUB_ENABLED` flag and are non-fatal (warn on failure, don't exit). `BRANCH_ENABLED` similarly gates per-task branching/PRs and is forced off when GitHub is disabled.
- Per-task branches follow `ralph/<prd-slug>/<task-id>-<title-slug>`. Every iteration commits with `Ralph-Task-Id`, `Ralph-Issue`, and `Ralph-Status: in-progress|passed|failed` trailers — failed iterations still commit so history stays complete.
- Dependency graph: `dependsOn` may appear in markdown as `**Depends On**: task-1, task-2`. Cycles, self-deps, and dangling refs fail validation and surface in `--analyze-prd`. Completed dep branches are merged into the task branch before each Claude call; conflicts mark the task blocked and skip the iteration.
- Progress files use box-drawing characters for formatting; iteration markers follow the pattern `ITERATION N/MAX`
- All Bash test scripts must be executable (`chmod +x`)
- Node.js modules use CommonJS (`require`/`module.exports`) and Jest for testing
- Dependencies: Bash 4.0+, `jq` 1.6+, `gh` CLI (for GitHub integration), `git` (for branching), Claude CLI, Node.js, standard Unix utilities
- Ralph tracks GitHub API calls per run (GITHUB_API_CALLS global) and warns at 100 calls.
- PRD JSON root may contain `githubProject` (project metadata + field IDs); each task may contain `projectItemId`. Both optional and populated automatically.
- MCP integration is opt-in via `--mcp`. When enabled, Ralph generates `mcp-config.json` once per run and passes `--mcp-config` to every Claude invocation. Per-iteration MCP health is captured in `progress.txt` and (when GitHub is enabled) on the issue comment.
