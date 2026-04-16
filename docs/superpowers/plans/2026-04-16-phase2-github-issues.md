# Phase 2 — GitHub Issues Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub Issues integration so Ralph Loop automatically creates, updates, and closes issues for each PRD task, posting structured iteration comments with criteria results.

**Architecture:** Three new Node.js modules under `lib/github/` — `repo.js` resolves the target repository (CLI flag > PRD field > git remote), `issues.js` manages issue lifecycle via `gh` CLI, and `index.js` provides the CLI entry point for Bash. The main `ralph-loop` script gains a `--repo` flag and GitHub call sites gated behind the existing `GITHUB_ENABLED` flag.

**Tech Stack:** Node.js (CommonJS, matching existing modules), `gh` CLI for GitHub API calls, Jest for unit tests, Bash integration tests.

---

## File Structure

```
lib/github/
  index.js          — CLI entry point (Bash calls: node lib/github/index.js <command> <args>)
  repo.js           — Resolve target repo: --repo flag > PRD "repository" field > git remote
  issues.js         — Create, update (comment), and close GitHub issues via gh CLI
  repo.test.js      — Jest unit tests for repo resolution
  issues.test.js    — Jest unit tests for issue lifecycle
tests/
  test-github.sh    — Bash integration tests for GitHub module CLI
```

**Modified files:**
- `ralph-loop` — Add `--repo` flag, GitHub call sites in main loop
- `package.json` — No new dependencies needed (`gh` CLI is external, `child_process` is built-in)

---

### Task 1: Repo Resolution Module

**Files:**
- Create: `lib/github/repo.js`
- Test: `lib/github/repo.test.js`

- [ ] **Step 1: Write failing tests for repo resolution**

```js
// lib/github/repo.test.js
'use strict';

const { resolveRepo } = require('./repo');
const { execSync } = require('child_process');

jest.mock('child_process');

describe('resolveRepo', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('CLI flag takes highest priority', () => {
    const result = resolveRepo({
      cliRepo: 'cli-owner/cli-repo',
      prdRepository: 'prd-owner/prd-repo',
    });
    expect(result).toBe('cli-owner/cli-repo');
  });

  test('PRD repository field is second priority', () => {
    execSync.mockReturnValue(Buffer.from('https://github.com/git-owner/git-repo.git\n'));
    const result = resolveRepo({
      cliRepo: null,
      prdRepository: 'prd-owner/prd-repo',
    });
    expect(result).toBe('prd-owner/prd-repo');
  });

  test('falls back to git remote origin', () => {
    execSync.mockReturnValue(Buffer.from('https://github.com/git-owner/git-repo.git\n'));
    const result = resolveRepo({ cliRepo: null, prdRepository: null });
    expect(result).toBe('git-owner/git-repo');
  });

  test('parses SSH git remote URL', () => {
    execSync.mockReturnValue(Buffer.from('git@github.com:ssh-owner/ssh-repo.git\n'));
    const result = resolveRepo({ cliRepo: null, prdRepository: null });
    expect(result).toBe('ssh-owner/ssh-repo');
  });

  test('throws when no source resolves', () => {
    execSync.mockImplementation(() => { throw new Error('not a git repo'); });
    expect(() => resolveRepo({ cliRepo: null, prdRepository: null }))
      .toThrow('Could not resolve target repository');
  });

  test('validates owner/name format for CLI flag', () => {
    expect(() => resolveRepo({ cliRepo: 'invalid', prdRepository: null }))
      .toThrow('Invalid repository format');
  });

  test('validates owner/name format for PRD field', () => {
    expect(() => resolveRepo({ cliRepo: null, prdRepository: 'no-slash' }))
      .toThrow('Invalid repository format');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/github/repo.test.js --no-coverage 2>&1 | tail -5`
Expected: FAIL — `Cannot find module './repo'`

- [ ] **Step 3: Implement repo resolution**

```js
// lib/github/repo.js
'use strict';

const { execSync } = require('child_process');

const REPO_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

function validateRepoFormat(repo, source) {
  if (!REPO_PATTERN.test(repo)) {
    throw new Error(`Invalid repository format from ${source}: "${repo}". Expected "owner/name".`);
  }
}

function parseGitRemote() {
  let url;
  try {
    url = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }

  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  return null;
}

function resolveRepo({ cliRepo, prdRepository }) {
  // 1. CLI flag (highest priority)
  if (cliRepo) {
    validateRepoFormat(cliRepo, '--repo flag');
    return cliRepo;
  }

  // 2. PRD JSON field
  if (prdRepository) {
    validateRepoFormat(prdRepository, 'PRD repository field');
    return prdRepository;
  }

  // 3. Git remote fallback
  const gitRepo = parseGitRemote();
  if (gitRepo) return gitRepo;

  throw new Error(
    'Could not resolve target repository. Provide --repo owner/name, ' +
    'add "repository" to the PRD JSON, or run from a git repo with a GitHub remote.'
  );
}

module.exports = { resolveRepo, parseGitRemote };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/github/repo.test.js --no-coverage`
Expected: PASS — all 7 tests

- [ ] **Step 5: Commit**

```bash
git add lib/github/repo.js lib/github/repo.test.js
git commit -m "feat: add repo resolution module (CLI flag > PRD field > git remote)"
```

---

### Task 2: Issues Module — Create Issue

**Files:**
- Create: `lib/github/issues.js`
- Test: `lib/github/issues.test.js`

- [ ] **Step 1: Write failing tests for issue creation**

```js
// lib/github/issues.test.js
'use strict';

const { createIssue, formatCriteriaChecklist } = require('./issues');
const { execSync } = require('child_process');

jest.mock('child_process');

describe('formatCriteriaChecklist', () => {
  test('formats criteria as markdown checklist', () => {
    const criteria = [
      { text: 'Unit tests pass', type: 'shell' },
      { text: 'Config exists', type: 'file-exists' },
      { text: 'UI feels good', type: 'manual' },
    ];
    const result = formatCriteriaChecklist(criteria);
    expect(result).toBe(
      '- [ ] Unit tests pass (`shell`)\n' +
      '- [ ] Config exists (`file-exists`)\n' +
      '- [ ] UI feels good (`manual`)'
    );
  });

  test('handles empty criteria array', () => {
    expect(formatCriteriaChecklist([])).toBe('');
  });
});

describe('createIssue', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('creates issue and returns issueNumber and issueUrl', () => {
    execSync.mockReturnValue(Buffer.from('https://github.com/owner/repo/issues/42\n'));
    const task = {
      id: 'task-3',
      title: 'Add JWT validation',
      description: 'Add JWT validation middleware to the auth route.',
      category: 'Backend',
      acceptanceCriteria: [
        { text: 'Unit tests pass', type: 'shell', command: 'npm test' },
      ],
    };
    const result = createIssue({ repo: 'owner/repo', task });
    expect(result).toEqual({
      issueNumber: 42,
      issueUrl: 'https://github.com/owner/repo/issues/42',
    });
  });

  test('includes ralph-loop and category labels', () => {
    execSync.mockReturnValue(Buffer.from('https://github.com/owner/repo/issues/1\n'));
    const task = {
      id: 'task-1',
      title: 'Test',
      description: '',
      category: 'Frontend',
      acceptanceCriteria: [],
    };
    createIssue({ repo: 'owner/repo', task });
    const call = execSync.mock.calls[0][0];
    expect(call).toContain('--label "ralph-loop"');
    expect(call).toContain('--label "Frontend"');
  });

  test('throws on gh CLI failure', () => {
    execSync.mockImplementation(() => { throw new Error('gh: not logged in'); });
    const task = {
      id: 'task-1',
      title: 'Test',
      description: '',
      category: 'Backend',
      acceptanceCriteria: [],
    };
    expect(() => createIssue({ repo: 'owner/repo', task }))
      .toThrow('Failed to create GitHub issue');
  });

  test('parses issue number from URL', () => {
    execSync.mockReturnValue(Buffer.from('https://github.com/org/project/issues/137\n'));
    const task = {
      id: 'task-5',
      title: 'Parsed',
      description: '',
      category: 'Infra',
      acceptanceCriteria: [],
    };
    const result = createIssue({ repo: 'org/project', task });
    expect(result.issueNumber).toBe(137);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/github/issues.test.js --no-coverage 2>&1 | tail -5`
Expected: FAIL — `Cannot find module './issues'`

- [ ] **Step 3: Implement issue creation**

```js
// lib/github/issues.js
'use strict';

const { execSync } = require('child_process');

function formatCriteriaChecklist(criteria) {
  return criteria
    .map(c => `- [ ] ${c.text} (\`${c.type}\`)`)
    .join('\n');
}

function createIssue({ repo, task }) {
  const checklist = formatCriteriaChecklist(task.acceptanceCriteria);
  const body = [
    `**Task ID:** ${task.id}`,
    '',
    task.description || '_No description._',
    '',
    '## Acceptance Criteria',
    '',
    checklist || '_No criteria defined._',
    '',
    '---',
    '_Managed by [ralph-loop](https://github.com/numeron/ralph-loop)_',
  ].join('\n');

  const escapedTitle = task.title.replace(/"/g, '\\"');
  const escapedBody = body.replace(/"/g, '\\"');

  const cmd = [
    'gh issue create',
    `--repo "${repo}"`,
    `--title "${escapedTitle}"`,
    `--body "${escapedBody}"`,
    '--label "ralph-loop"',
    `--label "${task.category}"`,
  ].join(' ');

  let output;
  try {
    output = execSync(cmd, { encoding: 'utf-8' }).trim();
  } catch (err) {
    throw new Error(`Failed to create GitHub issue for ${task.id}: ${err.message}`);
  }

  // gh issue create outputs the URL: https://github.com/owner/repo/issues/42
  const issueNumber = parseInt(output.match(/\/issues\/(\d+)/)?.[1], 10);
  if (isNaN(issueNumber)) {
    throw new Error(`Failed to parse issue number from gh output: ${output}`);
  }

  return { issueNumber, issueUrl: output };
}

module.exports = { createIssue, formatCriteriaChecklist };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/github/issues.test.js --no-coverage`
Expected: PASS — all 6 tests

- [ ] **Step 5: Commit**

```bash
git add lib/github/issues.js lib/github/issues.test.js
git commit -m "feat: add issue creation with criteria checklist and labels"
```

---

### Task 3: Issues Module — Update and Close

**Files:**
- Modify: `lib/github/issues.js`
- Modify: `lib/github/issues.test.js`

- [ ] **Step 1: Write failing tests for update and close**

Append to `lib/github/issues.test.js`:

```js
const { updateIssue, closeIssue, formatIterationComment } = require('./issues');

describe('formatIterationComment', () => {
  test('formats iteration results as markdown table', () => {
    const results = [
      { criterion: 0, passed: true },
      { criterion: 1, passed: false, error: 'exit code 1' },
      { criterion: 2, passed: true },
    ];
    const criteria = [
      { text: 'Unit tests pass' },
      { text: 'Login returns 200' },
      { text: 'Config exists' },
    ];
    const comment = formatIterationComment({
      iteration: 3,
      maxIterations: 15,
      results,
      criteria,
    });
    expect(comment).toContain('### Iteration 3/15');
    expect(comment).toContain('Unit tests pass');
    expect(comment).toContain(':white_check_mark: pass');
    expect(comment).toContain(':x: fail');
    expect(comment).toContain('exit code 1');
    expect(comment).toContain('2/3 criteria passing');
  });

  test('handles all-pass scenario', () => {
    const results = [{ criterion: 0, passed: true }];
    const criteria = [{ text: 'Tests pass' }];
    const comment = formatIterationComment({
      iteration: 1,
      maxIterations: 10,
      results,
      criteria,
    });
    expect(comment).toContain('1/1 criteria passing');
  });

  test('handles skipped (manual) criteria', () => {
    const results = [{ criterion: 0, passed: null, skipped: true }];
    const criteria = [{ text: 'Looks good' }];
    const comment = formatIterationComment({
      iteration: 1,
      maxIterations: 5,
      results,
      criteria,
    });
    expect(comment).toContain(':large_blue_circle: skipped');
  });
});

describe('updateIssue', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('posts comment to issue', () => {
    execSync.mockReturnValue(Buffer.from(''));
    updateIssue({
      repo: 'owner/repo',
      issueNumber: 42,
      iteration: 3,
      maxIterations: 15,
      results: [{ criterion: 0, passed: true }],
      criteria: [{ text: 'Tests pass' }],
    });
    const call = execSync.mock.calls[0][0];
    expect(call).toContain('gh issue comment 42');
    expect(call).toContain('--repo "owner/repo"');
  });

  test('throws on gh failure', () => {
    execSync.mockImplementation(() => { throw new Error('gh: forbidden'); });
    expect(() => updateIssue({
      repo: 'owner/repo',
      issueNumber: 42,
      iteration: 1,
      maxIterations: 10,
      results: [],
      criteria: [],
    })).toThrow('Failed to update GitHub issue');
  });
});

describe('closeIssue', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('closes issue with summary comment', () => {
    execSync.mockReturnValue(Buffer.from(''));
    closeIssue({ repo: 'owner/repo', issueNumber: 42, taskTitle: 'Add JWT', iterationsUsed: 3 });
    const calls = execSync.mock.calls;
    // First call: comment, second call: close
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toContain('gh issue comment 42');
    expect(calls[0][0]).toContain('completed');
    expect(calls[1][0]).toContain('gh issue close 42');
  });

  test('throws on gh failure', () => {
    execSync.mockImplementation(() => { throw new Error('gh: not found'); });
    expect(() => closeIssue({
      repo: 'owner/repo',
      issueNumber: 42,
      taskTitle: 'Test',
      iterationsUsed: 1,
    })).toThrow('Failed to close GitHub issue');
  });
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `npx jest lib/github/issues.test.js --no-coverage 2>&1 | tail -5`
Expected: FAIL — `formatIterationComment is not a function` (not yet exported)

- [ ] **Step 3: Implement update and close functions**

Add to `lib/github/issues.js`, before the `module.exports` line:

```js
function formatIterationComment({ iteration, maxIterations, results, criteria }) {
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

  return [
    `### Iteration ${iteration}/${maxIterations}`,
    '',
    '| # | Criterion | Result |',
    '|---|-----------|--------|',
    ...rows,
    '',
    `**Status:** ${passCount}/${total} criteria passing.${passCount === total ? ' All done!' : ' Continuing.'}`,
  ].join('\n');
}

function updateIssue({ repo, issueNumber, iteration, maxIterations, results, criteria }) {
  const comment = formatIterationComment({ iteration, maxIterations, results, criteria });

  const tmpFile = require('os').tmpdir() + `/ralph-comment-${Date.now()}.md`;
  require('fs').writeFileSync(tmpFile, comment);

  try {
    execSync(`gh issue comment ${issueNumber} --repo "${repo}" --body-file "${tmpFile}"`, {
      encoding: 'utf-8',
    });
  } catch (err) {
    throw new Error(`Failed to update GitHub issue #${issueNumber}: ${err.message}`);
  } finally {
    try { require('fs').unlinkSync(tmpFile); } catch {}
  }
}

function closeIssue({ repo, issueNumber, taskTitle, iterationsUsed }) {
  const comment = `:white_check_mark: **Task completed**: ${taskTitle}\n\nAll criteria passed after ${iterationsUsed} iteration(s). Closing.`;

  const tmpFile = require('os').tmpdir() + `/ralph-close-${Date.now()}.md`;
  require('fs').writeFileSync(tmpFile, comment);

  try {
    execSync(`gh issue comment ${issueNumber} --repo "${repo}" --body-file "${tmpFile}"`, {
      encoding: 'utf-8',
    });
    execSync(`gh issue close ${issueNumber} --repo "${repo}"`, {
      encoding: 'utf-8',
    });
  } catch (err) {
    throw new Error(`Failed to close GitHub issue #${issueNumber}: ${err.message}`);
  } finally {
    try { require('fs').unlinkSync(tmpFile); } catch {}
  }
}
```

Update `module.exports`:

```js
module.exports = { createIssue, updateIssue, closeIssue, formatCriteriaChecklist, formatIterationComment };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/github/issues.test.js --no-coverage`
Expected: PASS — all 14 tests

- [ ] **Step 5: Commit**

```bash
git add lib/github/issues.js lib/github/issues.test.js
git commit -m "feat: add issue update (iteration comments) and close functions"
```

---

### Task 4: GitHub CLI Entry Point

**Files:**
- Create: `lib/github/index.js`

- [ ] **Step 1: Write the CLI entry point**

```js
// lib/github/index.js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { resolveRepo } = require('./repo');
const { createIssue, updateIssue, closeIssue } = require('./issues');
const { normalizeCriteria } = require('../criteria/schema');

const command = process.argv[2];

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

async function main() {
  switch (command) {
    case 'resolve-repo': {
      const cliRepo = getArg('--repo');
      const taskFile = getArg('--task-file');
      let prdRepository = null;
      if (taskFile) {
        const prd = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
        prdRepository = prd.repository || null;
      }
      const repo = resolveRepo({ cliRepo, prdRepository });
      console.log(JSON.stringify({ repo }));
      break;
    }

    case 'create-issue': {
      const repo = getArg('--repo');
      const taskJson = getArg('--task');
      if (!repo || !taskJson) {
        console.error('Usage: node lib/github/index.js create-issue --repo owner/name --task \'<json>\'');
        process.exit(1);
      }
      const task = JSON.parse(taskJson);
      task.acceptanceCriteria = normalizeCriteria(task.acceptanceCriteria);
      const result = createIssue({ repo, task });
      console.log(JSON.stringify(result));
      break;
    }

    case 'update-issue': {
      const repo = getArg('--repo');
      const issueNumber = parseInt(getArg('--issue'), 10);
      const iteration = parseInt(getArg('--iteration'), 10);
      const maxIterations = parseInt(getArg('--max-iterations'), 10);
      const resultsJson = getArg('--results');
      const criteriaJson = getArg('--criteria');
      if (!repo || !issueNumber || !iteration || !maxIterations || !resultsJson || !criteriaJson) {
        console.error('Usage: node lib/github/index.js update-issue --repo owner/name --issue N --iteration N --max-iterations N --results \'<json>\' --criteria \'<json>\'');
        process.exit(1);
      }
      updateIssue({
        repo,
        issueNumber,
        iteration,
        maxIterations,
        results: JSON.parse(resultsJson),
        criteria: JSON.parse(criteriaJson),
      });
      console.log(JSON.stringify({ ok: true }));
      break;
    }

    case 'close-issue': {
      const repo = getArg('--repo');
      const issueNumber = parseInt(getArg('--issue'), 10);
      const taskTitle = getArg('--task-title');
      const iterationsUsed = parseInt(getArg('--iterations-used'), 10);
      if (!repo || !issueNumber) {
        console.error('Usage: node lib/github/index.js close-issue --repo owner/name --issue N --task-title "..." --iterations-used N');
        process.exit(1);
      }
      closeIssue({ repo, issueNumber, taskTitle: taskTitle || 'Unknown', iterationsUsed: iterationsUsed || 0 });
      console.log(JSON.stringify({ ok: true }));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: resolve-repo, create-issue, update-issue, close-issue');
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Verify the CLI entry point loads correctly**

Run: `node lib/github/index.js 2>&1`
Expected: `Unknown command: undefined` and exit 1

Run: `node lib/github/index.js resolve-repo --repo test/repo 2>&1`
Expected: `{"repo":"test/repo"}`

- [ ] **Step 3: Commit**

```bash
git add lib/github/index.js
git commit -m "feat: add GitHub CLI entry point for Bash integration"
```

---

### Task 5: Wire `--repo` Flag into Bash

**Files:**
- Modify: `ralph-loop` (lines ~9, ~204-244, ~1079-1108)

- [ ] **Step 1: Add `REPO_OVERRIDE` global and `--repo` flag parsing**

In the globals section (after line 16, `GITHUB_ENABLED=true`), add:

```bash
REPO_OVERRIDE=""
TARGET_REPO=""
```

In `parse_arguments()`, add a new case before the `-*)` catch-all (before line 246):

```bash
            --repo)
                if [ -z "${2:-}" ]; then
                    error_exit "--repo requires an argument in owner/name format" "Example: ./ralph-loop my-prd.md --repo myorg/myrepo"
                fi
                REPO_OVERRIDE="$2"
                shift 2
                ;;
```

- [ ] **Step 2: Add `resolve_target_repo` function and call it from `main()`**

Add a new function after `validate_prd_json` (around line 558):

```bash
# Resolve target GitHub repository
resolve_target_repo() {
    if [ "$GITHUB_ENABLED" = false ]; then
        return 0
    fi

    local resolve_args="--task-file \"$JSON_FILE\""
    if [ -n "$REPO_OVERRIDE" ]; then
        resolve_args="--repo \"$REPO_OVERRIDE\" $resolve_args"
    fi

    local resolve_result
    resolve_result=$(eval node lib/github/index.js resolve-repo $resolve_args 2>&1)
    local resolve_exit=$?

    if [ $resolve_exit -ne 0 ]; then
        echo -e "${YELLOW}[WARN] GitHub repo resolution failed: $resolve_result${NC}"
        echo -e "${YELLOW}[WARN] Disabling GitHub integration for this run. Use --repo or add 'repository' to PRD.${NC}"
        GITHUB_ENABLED=false
        return 0
    fi

    TARGET_REPO=$(echo "$resolve_result" | jq -r '.repo')

    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[INFO] Target GitHub repo: $TARGET_REPO${NC}"
    fi
}
```

In `main()`, call it after `validate_prd_json` (after line 1600):

```bash
    # Resolve GitHub repository
    resolve_target_repo
```

- [ ] **Step 3: Verify --repo flag parses correctly**

Run: `./ralph-loop examples/simple-feature.md --dry-run --repo test/repo --verbose 2>&1 | grep "Target GitHub repo"`
Expected: `[INFO] Target GitHub repo: test/repo`

Run: `./ralph-loop examples/simple-feature.md --dry-run --no-github --verbose 2>&1 | grep -c "Target GitHub repo"`
Expected: `0` (skipped because GitHub disabled)

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat: add --repo flag and resolve_target_repo function"
```

---

### Task 6: Wire Issue Creation into Main Loop

**Files:**
- Modify: `ralph-loop` (in `run_ralph_loop()`, around lines 1130-1140)

- [ ] **Step 1: Add `ensure_task_issue` function**

Add this function before `run_ralph_loop()` (before line 1078):

```bash
# Create GitHub issue for a task if one doesn't exist
ensure_task_issue() {
    local task_id="$1"
    local task_index="$2"

    if [ "$GITHUB_ENABLED" = false ]; then
        return 0
    fi

    # Check if task already has an issueNumber
    local existing_issue=$(jq -r ".tasks[$task_index].issueNumber // empty" "$JSON_FILE")
    if [ -n "$existing_issue" ]; then
        if [ "$VERBOSE" = true ]; then
            echo -e "${BLUE}[INFO] Task $task_id already has issue #$existing_issue${NC}"
        fi
        return 0
    fi

    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[INFO] Creating GitHub issue for $task_id...${NC}"
    fi

    local task_json=$(jq -c ".tasks[$task_index]" "$JSON_FILE")
    local create_result
    create_result=$(node lib/github/index.js create-issue \
        --repo "$TARGET_REPO" \
        --task "$task_json" 2>&1)
    local create_exit=$?

    if [ $create_exit -ne 0 ]; then
        echo -e "${YELLOW}[WARN] Failed to create issue for $task_id: $create_result${NC}"
        return 0  # Non-fatal — continue without issue
    fi

    local issue_number=$(echo "$create_result" | jq -r '.issueNumber')
    local issue_url=$(echo "$create_result" | jq -r '.issueUrl')

    # Write issueNumber and issueUrl back to PRD JSON
    local updated_prd=$(jq \
        --argjson idx "$task_index" \
        --argjson num "$issue_number" \
        --arg url "$issue_url" \
        '.tasks[$idx].issueNumber = $num | .tasks[$idx].issueUrl = $url' \
        "$JSON_FILE")
    echo "$updated_prd" | jq '.' > "$JSON_FILE"

    if [ "$VERBOSE" = true ]; then
        echo -e "${GREEN}[INFO] Created issue #$issue_number: $issue_url${NC}"
    fi
}
```

- [ ] **Step 2: Call `ensure_task_issue` in the main loop**

In `run_ralph_loop()`, after `update_task_attempts "$next_task_id"` (line 1134) and before `log_iteration`, add:

```bash
        # Get task index (needed for issue creation and later updates)
        local task_index=$(jq ".tasks | map(.id) | index(\"$next_task_id\")" "$JSON_FILE")

        # Create GitHub issue if needed
        ensure_task_issue "$next_task_id" "$task_index"
```

- [ ] **Step 3: Verify issue creation is gated behind GITHUB_ENABLED**

Run: `./ralph-loop examples/simple-feature.md --dry-run --no-github --verbose 2>&1 | grep -c "Creating GitHub issue"`
Expected: `0`

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat: wire issue creation into main loop for each task"
```

---

### Task 7: Wire Issue Update (Iteration Comments) into Main Loop

**Files:**
- Modify: `ralph-loop` (in `run_ralph_loop()`, after criteria verification, around lines 1384-1455)

- [ ] **Step 1: Add `post_iteration_comment` function**

Add this function after `ensure_task_issue`:

```bash
# Post iteration results as a comment on the task's GitHub issue
post_iteration_comment() {
    local task_id="$1"
    local task_index="$2"
    local current_iteration="$3"
    local verify_result="$4"

    if [ "$GITHUB_ENABLED" = false ]; then
        return 0
    fi

    local issue_number=$(jq -r ".tasks[$task_index].issueNumber // empty" "$JSON_FILE")
    if [ -z "$issue_number" ]; then
        return 0  # No issue to update
    fi

    local criteria_json=$(jq -c ".tasks[$task_index].acceptanceCriteria" "$JSON_FILE")
    local results_json=$(echo "$verify_result" | jq -c '.results')

    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[INFO] Posting iteration comment to issue #$issue_number...${NC}"
    fi

    node lib/github/index.js update-issue \
        --repo "$TARGET_REPO" \
        --issue "$issue_number" \
        --iteration "$current_iteration" \
        --max-iterations "$MAX_ITERATIONS" \
        --results "$results_json" \
        --criteria "$criteria_json" 2>&1 || {
        echo -e "${YELLOW}[WARN] Failed to post comment to issue #$issue_number${NC}"
    }
}
```

- [ ] **Step 2: Call `post_iteration_comment` after criteria verification**

In `run_ralph_loop()`, after the criteria verification result is processed (after updating `criteriaResults` in both the pass and fail branches), add the call. Insert after the `jq` update in the **pass** branch (after line ~1384):

```bash
            # Post iteration comment to GitHub issue
            post_iteration_comment "$next_task_id" "$task_index" "$iteration" "$verify_result"
```

And also in the **fail** branch, after the per-criterion tracking loop (after line ~1434):

```bash
            # Post iteration comment to GitHub issue
            post_iteration_comment "$next_task_id" "$task_index" "$iteration" "$verify_result"
```

- [ ] **Step 3: Commit**

```bash
git add ralph-loop
git commit -m "feat: post iteration results as GitHub issue comments"
```

---

### Task 8: Wire Issue Close on Task Completion

**Files:**
- Modify: `ralph-loop` (in the pass branch of criteria verification, around line 1384)

- [ ] **Step 1: Add `close_task_issue` function**

Add this function after `post_iteration_comment`:

```bash
# Close the GitHub issue when a task completes
close_task_issue() {
    local task_id="$1"
    local task_index="$2"
    local iterations_used="$3"

    if [ "$GITHUB_ENABLED" = false ]; then
        return 0
    fi

    local issue_number=$(jq -r ".tasks[$task_index].issueNumber // empty" "$JSON_FILE")
    if [ -z "$issue_number" ]; then
        return 0
    fi

    local task_title=$(jq -r ".tasks[$task_index].title" "$JSON_FILE")

    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[INFO] Closing issue #$issue_number (task complete)...${NC}"
    fi

    node lib/github/index.js close-issue \
        --repo "$TARGET_REPO" \
        --issue "$issue_number" \
        --task-title "$task_title" \
        --iterations-used "$iterations_used" 2>&1 || {
        echo -e "${YELLOW}[WARN] Failed to close issue #$issue_number${NC}"
    }

    if [ "$VERBOSE" = true ]; then
        echo -e "${GREEN}[INFO] Issue #$issue_number closed${NC}"
    fi
}
```

- [ ] **Step 2: Call `close_task_issue` in the pass branch**

In the criteria-pass branch (after `post_iteration_comment`), add:

```bash
            # Close the GitHub issue
            close_task_issue "$next_task_id" "$task_index" "$iteration"
```

- [ ] **Step 3: Commit**

```bash
git add ralph-loop
git commit -m "feat: close GitHub issue when all task criteria pass"
```

---

### Task 9: Resume Cross-Check

**Files:**
- Modify: `ralph-loop` (in resume section of `run_ralph_loop()`, around lines 1095-1108)

- [ ] **Step 1: Add `crosscheck_issues` function**

```bash
# On resume, cross-check task issue states for consistency
crosscheck_issues() {
    if [ "$GITHUB_ENABLED" = false ]; then
        return 0
    fi

    local task_count=$(jq '.tasks | length' "$JSON_FILE")
    local idx=0
    local warnings=0

    while [ $idx -lt $task_count ]; do
        local issue_number=$(jq -r ".tasks[$idx].issueNumber // empty" "$JSON_FILE")
        local task_passes=$(jq -r ".tasks[$idx].passes" "$JSON_FILE")
        local task_id=$(jq -r ".tasks[$idx].id" "$JSON_FILE")

        if [ -n "$issue_number" ]; then
            # Check issue state via gh
            local issue_state
            issue_state=$(gh issue view "$issue_number" --repo "$TARGET_REPO" --json state --jq '.state' 2>/dev/null || echo "UNKNOWN")

            if [ "$task_passes" = "true" ] && [ "$issue_state" = "OPEN" ]; then
                echo -e "${YELLOW}[WARN] Task $task_id is marked complete but issue #$issue_number is still open${NC}"
                warnings=$((warnings + 1))
            elif [ "$task_passes" = "false" ] && [ "$issue_state" = "CLOSED" ]; then
                echo -e "${YELLOW}[WARN] Task $task_id is incomplete but issue #$issue_number is closed${NC}"
                warnings=$((warnings + 1))
            fi
        fi

        idx=$((idx + 1))
    done

    if [ $warnings -gt 0 ]; then
        echo -e "${YELLOW}[WARN] Found $warnings issue state inconsistencies. Local JSON is source of truth.${NC}"
    elif [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[INFO] Issue cross-check passed — all consistent${NC}"
    fi
}
```

- [ ] **Step 2: Call `crosscheck_issues` in the resume path**

In `run_ralph_loop()`, inside the `if [ "$RESUME" = true ]` block (after `echo -e "${BLUE}[INFO] Resuming from iteration $iteration${NC}"`), add:

```bash
        # Cross-check GitHub issue states
        crosscheck_issues
```

- [ ] **Step 3: Commit**

```bash
git add ralph-loop
git commit -m "feat: cross-check GitHub issue states on --resume"
```

---

### Task 10: Bash Integration Tests

**Files:**
- Create: `tests/test-github.sh`

- [ ] **Step 1: Write integration tests**

```bash
#!/usr/bin/env bash
# tests/test-github.sh — Integration tests for GitHub module CLI

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
GITHUB_CLI="$PROJECT_ROOT/lib/github/index.js"

pass() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

info() {
    echo -e "${YELLOW}INFO:${NC} $1"
}

setup() {
    TEST_DIR=$(mktemp -d)
    info "Created test directory: $TEST_DIR"
}

cleanup() {
    if [ -n "$TEST_DIR" ] && [ -d "$TEST_DIR" ]; then
        rm -rf "$TEST_DIR"
        info "Cleaned up test directory"
    fi
}

# --- Tests ---

test_resolve_repo_with_cli_flag() {
    echo ""
    echo "Test 1: resolve-repo with --repo flag"

    local output
    output=$(node "$GITHUB_CLI" resolve-repo --repo test-owner/test-repo 2>&1)
    local exit_code=$?

    if [ "$exit_code" -eq 0 ]; then
        pass "resolve-repo exits 0 with valid --repo"
    else
        fail "resolve-repo exited $exit_code, expected 0. Output: $output"
    fi

    if echo "$output" | jq -e '.repo == "test-owner/test-repo"' > /dev/null 2>&1; then
        pass "resolve-repo returns correct repo"
    else
        fail "resolve-repo did not return expected repo. Output: $output"
    fi
}

test_resolve_repo_with_prd_field() {
    echo ""
    echo "Test 2: resolve-repo from PRD repository field"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "Test PRD",
  "repository": "prd-owner/prd-repo",
  "tasks": []
}
EOF

    local output
    output=$(node "$GITHUB_CLI" resolve-repo --task-file "$TEST_DIR/prd.json" 2>&1)
    local exit_code=$?

    if [ "$exit_code" -eq 0 ]; then
        pass "resolve-repo exits 0 with PRD repository field"
    else
        fail "resolve-repo exited $exit_code. Output: $output"
    fi

    if echo "$output" | jq -e '.repo == "prd-owner/prd-repo"' > /dev/null 2>&1; then
        pass "resolve-repo returns PRD repo"
    else
        fail "resolve-repo did not return PRD repo. Output: $output"
    fi
}

test_resolve_repo_cli_overrides_prd() {
    echo ""
    echo "Test 3: --repo flag overrides PRD repository field"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "Test PRD",
  "repository": "prd-owner/prd-repo",
  "tasks": []
}
EOF

    local output
    output=$(node "$GITHUB_CLI" resolve-repo --repo cli-owner/cli-repo --task-file "$TEST_DIR/prd.json" 2>&1)

    if echo "$output" | jq -e '.repo == "cli-owner/cli-repo"' > /dev/null 2>&1; then
        pass "CLI --repo overrides PRD repository field"
    else
        fail "CLI --repo did not override. Output: $output"
    fi
}

test_resolve_repo_invalid_format() {
    echo ""
    echo "Test 4: resolve-repo rejects invalid format"

    local output
    output=$(node "$GITHUB_CLI" resolve-repo --repo "no-slash" 2>&1)
    local exit_code=$?

    if [ "$exit_code" -ne 0 ]; then
        pass "resolve-repo rejects invalid format"
    else
        fail "resolve-repo accepted invalid format. Output: $output"
    fi
}

test_unknown_command() {
    echo ""
    echo "Test 5: unknown command exits with error"

    local output
    output=$(node "$GITHUB_CLI" nonsense 2>&1)
    local exit_code=$?

    if [ "$exit_code" -ne 0 ]; then
        pass "Unknown command exits non-zero"
    else
        fail "Unknown command exited 0. Output: $output"
    fi
}

test_repo_flag_in_ralph_loop() {
    echo ""
    echo "Test 6: --repo flag accepted by ralph-loop"

    local output
    output=$("$PROJECT_ROOT/ralph-loop" examples/simple-feature.md --dry-run --repo test/repo 2>&1)
    local exit_code=$?

    if [ "$exit_code" -eq 0 ]; then
        pass "--repo flag accepted by ralph-loop with --dry-run"
    else
        fail "--repo flag caused error. Exit: $exit_code Output: $output"
    fi
}

test_no_github_skips_resolution() {
    echo ""
    echo "Test 7: --no-github skips repo resolution"

    local output
    output=$("$PROJECT_ROOT/ralph-loop" examples/simple-feature.md --dry-run --no-github --verbose 2>&1)

    if echo "$output" | grep -q "Target GitHub repo"; then
        fail "--no-github should skip repo resolution"
    else
        pass "--no-github skips repo resolution"
    fi
}

# --- Main ---

trap cleanup EXIT
setup

echo "═══════════════════════════════════════════════════"
echo " GitHub Module Integration Tests"
echo "═══════════════════════════════════════════════════"

test_resolve_repo_with_cli_flag
test_resolve_repo_with_prd_field
test_resolve_repo_cli_overrides_prd
test_resolve_repo_invalid_format
test_unknown_command
test_repo_flag_in_ralph_loop
test_no_github_skips_resolution

echo ""
echo "═══════════════════════════════════════════════════"
echo " Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
echo "═══════════════════════════════════════════════════"

if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
fi

exit 0
```

- [ ] **Step 2: Make the test file executable and run it**

Run: `chmod +x tests/test-github.sh && ./tests/test-github.sh`
Expected: All 7 tests pass (tests 6 and 7 depend on Tasks 5 being complete)

- [ ] **Step 3: Add test-github.sh to test-all.sh**

In `tests/test-all.sh`, add a line to run the new test suite alongside the existing ones:

```bash
run_test_suite "GitHub Integration" "./tests/test-github.sh"
```

- [ ] **Step 4: Run the full test suite**

Run: `./tests/test-all.sh`
Expected: All test suites pass including the new GitHub tests

- [ ] **Step 5: Commit**

```bash
git add tests/test-github.sh tests/test-all.sh
git commit -m "test: add integration tests for GitHub module and --repo flag"
```

---

### Task 11: Update Help Text and Documentation

**Files:**
- Modify: `ralph-loop` (in `show_help()`, around lines 28-190)

- [ ] **Step 1: Add --repo flag to help output**

Find the `--no-github` help entry in `show_help()` and add `--repo` after it:

```bash
  --repo owner/name      Override target GitHub repository
                          (default: PRD "repository" field or git remote origin)
```

- [ ] **Step 2: Verify help shows the new flag**

Run: `./ralph-loop --help 2>&1 | grep -A2 "\-\-repo"`
Expected: Shows the `--repo` flag with description

- [ ] **Step 3: Commit**

```bash
git add ralph-loop
git commit -m "docs: add --repo flag to help text"
```

---

### Task 12: Final Verification — Full Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run all Jest unit tests**

Run: `npx jest --no-coverage`
Expected: All tests pass (repo.test.js, issues.test.js, schema.test.js, runner.test.js, builder.test.js)

- [ ] **Step 2: Run all Bash integration tests**

Run: `./tests/test-all.sh`
Expected: All test suites pass including new test-github.sh

- [ ] **Step 3: Run a dry-run with --repo to verify end-to-end**

Run: `./ralph-loop examples/simple-feature.md --dry-run --repo test-owner/test-repo --verbose`
Expected: Shows target repo info, builds prompt, exits cleanly

- [ ] **Step 4: Run a dry-run with --no-github**

Run: `./ralph-loop examples/simple-feature.md --dry-run --no-github --verbose`
Expected: No GitHub output, prompt builds normally

- [ ] **Step 5: Commit any remaining fixes, then tag**

```bash
git add -A
git commit -m "feat: complete Phase 2 — GitHub Issues integration"
```
