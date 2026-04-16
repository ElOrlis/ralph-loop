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

# JavaScript unit tests (lib modules)
npx jest --no-coverage --testPathIgnorePatterns='user-model'

# All JavaScript tests (requires sqlite3)
npm test
```

### Run the tool
```bash
./ralph-loop <prd-file.md> [--max-iterations N] [--verbose] [--debug] [--resume] [--analyze-prd] [--dry-run] [--no-github] [--repo owner/name]
```

## Architecture

The project has three distinct parts:

### 1. Main CLI (`ralph-loop` — single Bash script)

The entire orchestrator is one Bash script with these key flows:

- **Argument parsing** (`parse_arguments`) — handles flags and sets globals (`MAX_ITERATIONS`, `VERBOSE`, `DEBUG`, `RESUME`, `ANALYZE_PRD`, `DRY_RUN`, `GITHUB_ENABLED`, `REPO_OVERRIDE`)
- **Markdown-to-JSON conversion** (`convert_prd_to_json`) — parses `## Task:` headers, `**Category**:`, `**Priority**:`, `### Acceptance Criteria` sections into a JSON structure. Uses `jq` for formatting.
- **PRD validation** (`validate_prd_json`) — checks required fields (`id`, `title`, `category`, `priority`, `acceptanceCriteria`, `passes`), unique priorities, non-empty criteria arrays
- **GitHub repo resolution** (`resolve_target_repo`) — resolves target repo via `--repo` flag > PRD `repository` field > `git remote`
- **PRD analysis** (`analyze_prd`) — sends PRD content to Claude for quality feedback, includes retry logic with exponential backoff
- **Main loop** (`run_ralph_loop`) — iterates up to `MAX_ITERATIONS`:
  1. `find_next_task` — selects highest-priority task where `passes == false`
  2. `ensure_task_issue` — creates GitHub issue if `GITHUB_ENABLED` and no `issueNumber` exists
  3. Builds prompt via `node lib/prompt/index.js build`
  4. Sends prompt to Claude CLI (`claude --dangerously-skip-permissions --print`)
  5. Verifies criteria via `node lib/criteria/index.js verify` — Ralph decides pass/fail, not Claude
  6. `post_iteration_comment` — posts iteration results table to GitHub issue
  7. `close_task_issue` — closes GitHub issue when all criteria pass
  8. `check_thrash` — detects stalled criteria (4+ consecutive failures)
  9. Updates JSON file and logs to `progress.txt`
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
    index.js            # CLI: resolve-repo | create-issue | update-issue | close-issue
    repo.js             # Resolve target repo (CLI flag > PRD field > git remote)
    issues.js           # Create/update/close issues, format iteration comment tables
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

- PRD JSON tasks track state with `passes` (boolean), `attempts` (counter), `completedAt`, `criteriaResults` (per-criterion tracking), `issueNumber`, and `issueUrl` fields
- Ralph verifies criteria independently after Claude's turn — Claude says "DONE" as informational signal only
- All GitHub calls are gated behind `GITHUB_ENABLED` flag and are non-fatal (warn on failure, don't exit)
- Progress files use box-drawing characters for formatting; iteration markers follow the pattern `ITERATION N/MAX`
- All Bash test scripts must be executable (`chmod +x`)
- Node.js modules use CommonJS (`require`/`module.exports`) and Jest for testing
- Dependencies: Bash 4.0+, `jq` 1.6+, `gh` CLI (for GitHub integration), Claude CLI, Node.js, standard Unix utilities
