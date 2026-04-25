# Ralph Loop - Interactive PRD Completion Tool

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bash](https://img.shields.io/badge/Bash-4.0+-green.svg)](https://www.gnu.org/software/bash/)

Ralph Loop is a production-ready tool that iteratively calls Claude to complete complex Product Requirements Documents (PRDs) by working through tasks one at a time until all acceptance criteria pass. It provides zero-edit usage with comprehensive help, progress tracking, and smart resume capabilities.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Command-Line Flags](#command-line-flags)
- [PRD File Format](#prd-file-format)
- [Example PRD Files](#example-prd-files)
- [How-To Guides](#how-to-guides)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Features

- **Iterative Task Completion**: Automatically works through PRD tasks in priority order
- **Independent Verification**: Ralph (not Claude) verifies acceptance criteria via shell, http, file-exists, grep, or manual checks using inline type hints
- **Dependency Graph**: Tasks declare `Depends On:` relationships; Ralph topo-sorts the queue, marks blocked tasks, and merges completed dependency branches before each iteration
- **GitHub Integration**: Auto-creates issues, posts iteration comments, manages a Projects v2 board with Priority / Category / Iteration Count / Criteria Pass Rate / Ralph Status fields
- **Per-Task Git Branching & PRs**: Every task gets its own branch and draft PR; iterations commit with structured `Ralph-*` trailers and the PR flips to ready when all criteria pass
- **Smart Resume**: Continue from where you left off after interruption, with crosscheck warnings for JSON/GitHub state drift
- **PRD Analysis**: Quality feedback on your PRD (including dependency-graph analysis) before running
- **Markdown or JSON**: Write PRDs in markdown and auto-convert to JSON
- **Dry-Run, Verbose, Debug Modes**: Inspect the planned prompt or surface full Claude output for troubleshooting

## Prerequisites

Before installing Ralph Loop, ensure you have the following dependencies:

### Required Dependencies

1. **Bash 4.0 or higher**
   ```bash
   # Check your bash version
   bash --version
   ```

2. **Claude CLI**
   - Install from: [https://docs.anthropic.com/claude/docs/claude-cli](https://docs.anthropic.com/claude/docs/claude-cli)
   - Verify installation:
   ```bash
   which claude
   ```

3. **jq** (JSON processor)
   - Version 1.6 or higher required
   - Used for JSON parsing and manipulation

4. **Standard Unix utilities**
   - `cat`, `grep`, `sed`, `date`, `mktemp`
   - Usually pre-installed on macOS and Linux

## Installation

### macOS Installation

1. **Install Homebrew** (if not already installed)
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. **Install jq**
   ```bash
   brew install jq
   ```

3. **Install Claude CLI**
   ```bash
   # Follow official installation instructions at:
   # https://docs.anthropic.com/claude/docs/claude-cli
   ```

4. **Download Ralph Loop**
   ```bash
   # Clone or download the repository
   git clone https://github.com/paullovvik/ralph-loop.git
   cd ralph-loop
   ```

5. **Make the script executable**
   ```bash
   chmod +x ralph-loop
   ```

6. **Add to PATH (optional)**
   ```bash
   # Add to your ~/.bashrc or ~/.zshrc
   export PATH="$PATH:/path/to/ralph-loop"

   # Or create a symbolic link
   sudo ln -s /path/to/ralph-loop/ralph-loop /usr/local/bin/ralph-loop
   ```

### Linux Installation

1. **Install jq**
   ```bash
   # Ubuntu/Debian
   sudo apt-get update
   sudo apt-get install jq

   # Fedora/RHEL
   sudo dnf install jq

   # Arch Linux
   sudo pacman -S jq
   ```

2. **Install Claude CLI**
   ```bash
   # Follow official installation instructions at:
   # https://docs.anthropic.com/claude/docs/claude-cli
   ```

3. **Download Ralph Loop**
   ```bash
   git clone https://github.com/paullovvik/ralph-loop.git
   cd ralph-loop
   ```

4. **Make the script executable**
   ```bash
   chmod +x ralph-loop
   ```

5. **Add to PATH (optional)**
   ```bash
   # Add to your ~/.bashrc
   echo 'export PATH="$PATH:'"$(pwd)"'"' >> ~/.bashrc
   source ~/.bashrc

   # Or create a symbolic link
   sudo ln -s $(pwd)/ralph-loop /usr/local/bin/ralph-loop
   ```

### Verify Installation

After installation, verify everything works:

```bash
# Check Ralph Loop is accessible
ralph-loop --help

# Verify all dependencies
which claude    # Should show path to claude CLI
which jq        # Should show path to jq
bash --version  # Should show 4.0 or higher
```

## Quick Start

1. **Create a PRD file** (see [examples/simple-feature.md](examples/simple-feature.md))
   ```markdown
   # My Feature PRD

   ## Task: Implement user authentication
   **Category**: Backend
   **Priority**: 1

   ### Acceptance Criteria
   - API endpoint /auth/login accepts email and password
   - Returns JWT token on successful authentication
   - Test: curl -X POST /auth/login returns 200 with token
   ```

2. **Run Ralph Loop**
   ```bash
   ralph-loop my-feature.md
   ```

3. **Review results**
   - `my-feature.json` - Final task status with completion data
   - `progress.txt` - Detailed log of all iterations and learnings

## Usage

### Basic Usage

```bash
ralph-loop <prd-file> [OPTIONS]
```

### Common Scenarios

**Run with defaults (15 iterations max)**
```bash
ralph-loop my-project.md
```

**Analyze PRD quality before running**
```bash
ralph-loop my-project.md --analyze-prd
```

**Run with custom iteration limit**
```bash
ralph-loop complex-project.md --max-iterations 30
```

**Resume interrupted run**
```bash
ralph-loop my-project.md --resume
```

**Debug mode for troubleshooting**
```bash
ralph-loop my-project.md --debug
```

**Verbose mode with progress details**
```bash
ralph-loop my-project.md --verbose --max-iterations 25
```

## Command-Line Flags

| Flag | Description | Default |
|------|-------------|---------|
| `<prd-file>` | Path to PRD file (.md or .json) | **Required** |
| `--max-iterations N` | Maximum iterations to run | 15 |
| `--verbose` | Show detailed progress and API metadata | Off |
| `--debug` | Show full Claude output and internal state | Off |
| `--resume` | Resume from last checkpoint | Off |
| `--analyze-prd` | Analyze PRD quality (incl. dependency graph) and exit | Off |
| `--dry-run` | Print the prompt that would be sent to Claude and exit | Off |
| `--no-github` | Skip all GitHub issue/Projects v2 activity (implies `--no-branch`) | Off |
| `--no-branch` | Skip per-task branch / PR creation; commit on the current branch | Off |
| `--repo owner/name` | Override target repo (otherwise PRD `repository` field, then `git remote`) | - |
| `--help` | Show comprehensive help message | - |

## PRD File Format

Ralph Loop accepts PRD files in either Markdown or JSON format.

### Markdown Format

```markdown
# Project Title

Brief project overview (optional)

## Task: Task Title
**Category**: Category Name
**Priority**: 1
**Depends On**: task-0

Task description goes here.

### Acceptance Criteria
- Unit tests pass `[shell: npm test -- auth.test.js]`
- Login returns 200 `[http: POST http://localhost:3000/auth/login -> 200]`
- Config file exists `[file-exists: ./config/auth.json]`
- Route is registered `[grep: "app\.use.*auth" in ./src/routes/index.js]`
- Manual verification step (skipped by Ralph)

## Task: Second Task Title
**Category**: Another Category
**Priority**: 2

### Acceptance Criteria
- Criterion one
- Criterion two
```

### JSON Format

```json
{
  "title": "Project Title",
  "overview": "Brief project overview",
  "projectDirectory": "/path/to/project",
  "tasks": [
    {
      "id": "task-1",
      "title": "Task Title",
      "category": "Category Name",
      "priority": 1,
      "description": "Task description",
      "acceptanceCriteria": [
        "First criterion",
        "Second criterion"
      ],
      "passes": false,
      "completedAt": null,
      "attempts": 0
    }
  ]
}
```

### Required Fields

**Markdown:**
- Each task must have: title, Category, Priority, Acceptance Criteria section
- Priorities must be unique integers

**JSON:**
- Top-level: `title`, `tasks` (array)
- Each task: `id`, `title`, `category`, `priority`, `acceptanceCriteria`, `passes`

## Example PRD Files

Ralph Loop includes several example PRD files in the `examples/` directory:

### [simple-feature.md](examples/simple-feature.md)
A basic example with 2-3 well-written tasks. Perfect for first-time users to understand the format.

```bash
ralph-loop examples/simple-feature.md
```

### [complex-project.json](examples/complex-project.json)
A realistic project with 5-7 tasks showing more complex scenarios and dependencies.

```bash
ralph-loop examples/complex-project.json --max-iterations 25
```

### [good-prd-example.md](examples/good-prd-example.md)
Demonstrates best practices:
- Specific, testable acceptance criteria
- Clear test commands
- Proper priority ordering
- Comprehensive task descriptions

```bash
ralph-loop examples/good-prd-example.md --analyze-prd
```

### [bad-prd-example.md](examples/bad-prd-example.md)
Shows common mistakes (use with `--analyze-prd` to see suggestions):
- Vague acceptance criteria
- Missing test commands
- Unclear priorities
- Ambiguous goals

```bash
ralph-loop examples/bad-prd-example.md --analyze-prd
```

## How-To Guides

Step-by-step recipes for the recent enhancements. Each guide is independent — pick the ones you need.

### How to write machine-verifiable acceptance criteria

Ralph (not Claude) decides whether a criterion passes. Add an **inline type hint** at the end of any bullet so Ralph can run an actual check.

| Type | Syntax | What Ralph does |
|------|--------|-----------------|
| `shell` | `` `[shell: <cmd>]` `` | Runs `<cmd>`; pass = exit 0 |
| `http` | `` `[http: <METHOD> <url> -> <status>]` `` | Sends request; pass = matching status code |
| `file-exists` | `` `[file-exists: <path>]` `` | Pass = path exists |
| `grep` | `` `[grep: "<regex>" in <path>]` `` | Pass = regex matches in file |
| `manual` | (no hint, or `` `[manual]` ``) | Skipped — Ralph cannot verify, treat as advisory |

**Example:**
```markdown
### Acceptance Criteria
- Auth unit tests pass `[shell: npm test -- auth.test.js]`
- /auth/login returns 200 `[http: POST http://localhost:3000/auth/login -> 200]`
- Migration file created `[file-exists: ./db/migrations/001_users.sql]`
- Route is wired up `[grep: "app\.use.*auth" in ./src/routes/index.js]`
```

**Tip:** Run `ralph-loop my-prd.md --analyze-prd` first — the analyzer flags vague criteria that lack a hint.

### How to declare task dependencies

Add a `**Depends On**:` line in markdown (or `dependsOn: ["task-1"]` in JSON). Ralph topo-sorts the queue and skips any task whose deps haven't passed yet.

```markdown
## Task: Add JWT middleware
**Category**: Backend
**Priority**: 3
**Depends On**: task-1, task-2
```

What you get:
- Blocked tasks: `status: "blocked"` + `blockedBy: [...]` in PRD JSON, a `blocked` label on the GitHub issue, and `Ralph Status = Blocked` on the project board.
- When `--no-branch` is *not* set, Ralph runs `git merge --no-edit` on each completed dep branch into the current task branch before invoking Claude. On conflict it aborts the merge, marks the task blocked, comments on the issue, and moves on.
- Cycles, self-deps, and dangling references are caught at validation and reported by `--analyze-prd` under a **Dependency Analysis** section.

### How to enable GitHub Projects v2 integration

1. Refresh your `gh` token with project scopes (one-time):
   ```bash
   gh auth refresh -s project,read:project,write:project
   ```
2. Tell Ralph which repo to use (pick one):
   - Pass `--repo owner/name` on the command line, OR
   - Add `"repository": "owner/name"` to your PRD JSON, OR
   - Run from a clone whose `git remote origin` already points there.
3. Run normally — `ralph-loop my-prd.md`. On first run Ralph creates one Projects v2 board titled after your PRD with these fields: **Priority** (number), **Category** (single-select), **Iteration Count** (number), **Criteria Pass Rate** (0.0–1.0), **Ralph Status** (Pending / In Progress / Passed / Failed / Stalled / Blocked).
4. Ralph populates `githubProject` at the PRD root and `projectItemId` on each task. Don't edit those by hand.

To opt out for a single run: `--no-github` (also disables branching).

### How to use per-task branching and pull requests

Enabled by default whenever GitHub is on. For each task Ralph:

1. Forks `ralph/<prd-slug>/<task-id>-<title-slug>` off the branch you launched from.
2. Commits each iteration with structured trailers:
   ```
   task-3: add JWT validation middleware

   Iteration 2/15. Criteria: 2/3 passing.

   Ralph-Task-Id: task-3
   Ralph-Issue: #42
   Ralph-Status: in-progress
   ```
   `Ralph-Status` is one of `in-progress`, `passed`, or `failed`. Failed iterations still commit so history stays complete.
3. Opens a draft PR after the first commit with `Closes #<issueNumber>`.
4. Calls `gh pr ready` once every criterion passes.

Skip branching/PRs for a single run with `--no-branch`. Combine with `--no-github` to run fully offline.

### How to preview a run without invoking Claude

Use `--dry-run` to see exactly what Ralph would send:

```bash
ralph-loop my-prd.md --dry-run
```

Ralph picks the next task, builds the prompt (including verification commands), prints it, and exits — no Claude call, no commit, no GitHub activity. Useful for sanity-checking inline type hints, dependency ordering, and `--analyze-prd` recommendations before burning iterations.

### How to interpret `--analyze-prd` output

Run before your first real loop:

```bash
ralph-loop my-prd.md --analyze-prd
```

You'll get sections for:
- **Quality feedback** on each task (vague criteria, missing test commands, ambiguous priorities).
- **Dependency Analysis** — cycles, self-dependencies, dangling `dependsOn` references, and the resolved execution order.
- Suggested rewrites you can paste back into your PRD.

Re-run `--analyze-prd` after edits until the output is clean, then drop the flag to start the real loop.

## Testing

Ralph Loop includes a comprehensive test suite to verify functionality.

### Running All Tests

Run the complete test suite:

```bash
./tests/test-all.sh
```

This runs all test suites including:
- Markdown to JSON conversion tests
- PRD validation tests
- Resume functionality tests
- Help and documentation tests
- PRD analysis tests

### Running Specific Tests

Run individual test suites:

```bash
# Test markdown to JSON conversion
./tests/test-conversion.sh

# Test PRD validation
./tests/test-validation.sh

# Test resume functionality
./tests/test-resume.sh

# Test help system
./tests/test-help.sh

# Test PRD analysis
./tests/test-analysis.sh
```

### Running JavaScript/Jest Tests

For the JavaScript unit tests (models, database):

```bash
npm test
```

### Test Requirements

- All test scripts are executable (chmod +x is applied automatically)
- Tests create temporary files in a test directory that is cleaned up automatically
- Tests do not require API keys or external services
- Progress visualization tests may be skipped in non-interactive environments

## Troubleshooting

### Common Issues and Solutions

#### "PRD file not found"
```
Error: Could not find PRD file: my-project.md

Solution: Check the file path is correct
  - Use absolute path: /full/path/to/my-project.md
  - Or relative path from current directory: ./my-project.md

Run: ralph-loop --help for more information
```

**Fix:** Verify the file exists and path is correct:
```bash
ls -la my-project.md
ralph-loop $(pwd)/my-project.md
```

#### "Permission denied"
```
Error: Cannot read PRD file (permission denied)

Solution: Fix file permissions
  chmod +r my-project.md
```

**Fix:** Make the file readable:
```bash
chmod +r my-project.md
# Or make ralph-loop executable:
chmod +x ralph-loop
```

#### "Max iterations reached"
```
⚠️  Max iterations (15) reached with incomplete tasks

Remaining tasks:
  - Task 3: Implement API endpoint (0% complete)
  - Task 4: Add test coverage (0% complete)

To continue: ralph-loop my-project.md --resume --max-iterations 30
```

**Fix:** Resume with higher iteration limit:
```bash
ralph-loop my-project.md --resume --max-iterations 30
```

#### "Validation failed: Duplicate priority values"
```
❌ Validation Error: Tasks 2 and 3 both have priority 2

Solution: Each task must have a unique priority value
  - Edit your PRD to assign unique priorities (1, 2, 3, etc.)
  - Run: ralph-loop my-project.md --analyze-prd for more suggestions
```

**Fix:** Edit your PRD file and ensure each task has a unique priority number.

#### "Claude CLI not found"
```
Error: claude command not found

Solution: Install Claude CLI from:
  https://docs.anthropic.com/claude/docs/claude-cli
```

**Fix:** Install Claude CLI following the official documentation.

#### "jq command not found"
```
Error: jq is required but not installed

Solution:
  macOS: brew install jq
  Linux: sudo apt-get install jq  (Ubuntu/Debian)
         sudo dnf install jq      (Fedora/RHEL)
```

**Fix:** Install jq using your package manager (see [Installation](#installation)).

#### Conversion Failures

If markdown to JSON conversion fails:

1. **Check markdown format**
   - Each task must start with `## Task:`
   - Must include `**Category**:` and `**Priority**:` lines
   - Must have `### Acceptance Criteria` section

2. **Validate with analysis**
   ```bash
   ralph-loop my-project.md --analyze-prd
   ```

3. **Review examples**
   ```bash
   cat examples/good-prd-example.md
   ```

### Getting More Help

- **View comprehensive help**: `ralph-loop --help`
- **Enable verbose mode**: `ralph-loop my-project.md --verbose`
- **Enable debug mode**: `ralph-loop my-project.md --debug`
- **Analyze PRD quality**: `ralph-loop my-project.md --analyze-prd`

## Files Created by Ralph Loop

When you run Ralph Loop, it creates the following files:

| File | Description |
|------|-------------|
| `<prd-name>.json` | JSON version of your PRD with task status tracking |
| `progress.txt` | Detailed log of all iterations, actions, and learnings |
| `progress-<timestamp>.txt` | Archived progress file (when starting fresh) |

These files are created in the same directory as your input PRD file.

## GitHub Projects v2 Integration

When `--no-github` is not set, ralph-loop creates one GitHub Project (Projects v2)
per PRD on first run. The project:

- Is owned by the user/organization parsed from `--repo` / PRD `repository`.
- Title = PRD `title` field.
- Gets five custom fields: **Priority** (number), **Category** (single-select,
  one option per unique `category` in tasks), **Iteration Count** (number),
  **Criteria Pass Rate** (number 0.0–1.0), **Ralph Status** (single-select:
  Pending, In Progress, Passed, Failed, Stalled).
- Each task's GitHub issue is added as a project item; Ralph-managed fields
  update after every iteration.

**Required token scope:** `project,read:project,write:project`. Run:

```
gh auth refresh -s project,read:project,write:project
```

**PRD JSON layout:** Ralph populates `githubProject` at the PRD root and
`projectItemId` on each task. See `docs/superpowers/specs/2026-04-10-ralph-loop-enhancements-design.md`
for the full schema.

**Rate limiting:** API call counts print at end of each run. A warning prints
at 100 calls. Use `--no-github` to skip all GitHub/Projects activity.

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

## Contributing

Contributions are welcome! Here's how to contribute:

### Reporting Issues

1. Check existing issues to avoid duplicates
2. Include the following in your report:
   - Ralph Loop version (first line of `ralph-loop --help`)
   - OS and Bash version
   - Complete error message
   - Steps to reproduce
   - Your PRD file (if relevant)

### Submitting Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Test thoroughly:
   ```bash
   ./tests/test-all.sh
   ```
5. Commit with clear messages:
   ```bash
   git commit -m "Add feature: description"
   ```
6. Push to your fork: `git push origin feature/my-feature`
7. Open a Pull Request

### Development Guidelines

- Follow existing code style and conventions
- Add tests for new features in `tests/` directory
- Update documentation for user-facing changes
- Keep commits focused and atomic
- Write clear commit messages

### Testing

Run the test suite before submitting:

```bash
# Run all tests
./tests/test-all.sh

# Run specific test
./tests/test-conversion.sh
./tests/test-validation.sh
./tests/test-resume.sh
```

### Code of Conduct

- Be respectful and inclusive
- Focus on constructive feedback
- Help others learn and grow
- Assume good intentions

## License

This project is licensed under the MIT License. See the LICENSE file for details.

---

## Additional Resources

- **Claude CLI Documentation**: https://docs.anthropic.com/claude/docs/claude-cli
- **jq Documentation**: https://stedolan.github.io/jq/
- **Bash Reference**: https://www.gnu.org/software/bash/manual/

## Tips for Success

1. **Start small**: Test with simple PRDs (2-3 tasks) before complex projects
2. **Use analysis**: Run `--analyze-prd` to get feedback before starting
3. **Review examples**: Study `examples/good-prd-example.md` for best practices
4. **Be specific**: Write clear, testable acceptance criteria
5. **Include tests**: Add actual test commands in your criteria
6. **Monitor progress**: Check `progress.txt` to understand Claude's actions
7. **Use resume**: Don't restart from scratch if interrupted
8. **Iterate limits**: Start with default (15), increase if needed

## Support

If you encounter issues not covered in this README:

1. Check `ralph-loop --help` for detailed usage information
2. Review the [Troubleshooting](#troubleshooting) section
3. Look at example PRD files in `examples/`
4. Enable `--debug` mode to see detailed execution logs
5. Open an issue on GitHub with details

---

**Made with ❤️ using Claude**
