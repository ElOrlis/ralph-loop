# Copilot CLI Agent + Reviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--agent claude|copilot` and `--reviewer none|claude|copilot|auto` to Ralph Loop so users can swap the per-iteration agent backend and optionally invoke a second agent on criterion failure.

**Architecture:** Wrap the existing inline `claude --print` calls in a Bash `invoke_agent` function that dispatches to either binary. Add a per-failure reviewer pass that always comments on the GitHub issue and only injects feedback into the next prompt after the existing 4-failure thrash threshold. Generate per-agent MCP configs and tag commits / progress lines / issue comments with which agent ran.

**Tech Stack:** Bash 4+, Node.js (CommonJS), Jest, `jq`, `gh` CLI, fake binary shims for tests.

**Spec:** `docs/superpowers/specs/2026-04-28-copilot-cli-agent-design.md`

---

## File Map

**Modify:**
- `ralph-loop` — `parse_arguments` (new flags), preflight, `invoke_agent` helper, three claude call sites (2785/2808/2815), MCP config write (~2609), MCP log filename (~2881), `log_iteration_mcp` + new `log_iteration_agent` / `log_iteration_reviewer`, reviewer call after `verify`, resume crosscheck.
- `lib/mcp/config.js` — `buildMcpConfig({ agent })`.
- `lib/mcp/config.test.js` — agent-param tests.
- `lib/mcp/index.js` — `--agent` arg for `write-config`.
- `lib/prompt/builder.js` — `buildPrompt` accepts `reviewerFeedback`; new `buildReviewPrompt`.
- `lib/prompt/builder.test.js` — both above.
- `lib/prompt/index.js` — `build` accepts `--reviewer-feedback-file` and `--consecutive-failures`; new `build-review` command.
- `lib/git/commits.js` — `formatCommitMessage` accepts `agent` and emits `Ralph-Agent` trailer.
- `lib/git/commits.test.js` — trailer test.
- `lib/github/issues.js` — `formatIterationComment` adds Agent column; new `formatReviewerComment` + `postReviewerComment` exports.
- `lib/github/issues.test.js` — both above.
- `lib/report/aggregator.js` — parse `Agent:` / `Reviewer:` lines; emit `agentBreakdown`.
- `lib/report/aggregator.test.js` — new test cases.
- `lib/report/formatter.js` — render Agent breakdown.
- `lib/report/formatter.test.js` — render test.
- `tests/test-all.sh` — register three new Bash suites.

**Create:**
- `tests/test-agent-selection.sh`
- `tests/test-reviewer.sh`
- `tests/test-agent-resume.sh`

---

## Task 1: MCP config accepts agent parameter

**Files:**
- Modify: `lib/mcp/config.js`
- Test: `lib/mcp/config.test.js`

- [ ] **Step 1: Update test for agent param**

Replace `lib/mcp/config.test.js` body with:

```javascript
'use strict';

const { buildMcpConfig } = require('./config');

describe('buildMcpConfig', () => {
  test('claude variant returns mcpServers with mcpls command', () => {
    expect(buildMcpConfig({ agent: 'claude' })).toEqual({
      mcpServers: { mcpls: { command: 'mcpls' } },
    });
  });

  test('copilot variant returns mcpServers with mcpls command', () => {
    expect(buildMcpConfig({ agent: 'copilot' })).toEqual({
      mcpServers: { mcpls: { command: 'mcpls' } },
    });
  });

  test('defaults to claude when no agent given', () => {
    expect(buildMcpConfig()).toEqual(buildMcpConfig({ agent: 'claude' }));
  });

  test('throws on unknown agent', () => {
    expect(() => buildMcpConfig({ agent: 'gemini' })).toThrow(/unknown agent/i);
  });

  test('result is JSON-serializable and stable', () => {
    const a = JSON.stringify(buildMcpConfig({ agent: 'claude' }));
    const b = JSON.stringify(buildMcpConfig({ agent: 'claude' }));
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest lib/mcp/config.test.js --no-coverage`
Expected: FAIL on "throws on unknown agent" (current impl ignores args).

- [ ] **Step 3: Implement agent param**

Replace `lib/mcp/config.js`:

```javascript
// lib/mcp/config.js
'use strict';

const SUPPORTED = new Set(['claude', 'copilot']);

function buildMcpConfig(opts) {
  const agent = (opts && opts.agent) || 'claude';
  if (!SUPPORTED.has(agent)) {
    throw new Error(`Unknown agent: ${agent}`);
  }
  // Both Claude and Copilot CLIs accept the same `mcpServers` schema
  // for our single mcpls server today. Per-agent fields go here when
  // schemas diverge.
  return {
    mcpServers: {
      mcpls: { command: 'mcpls' },
    },
  };
}

module.exports = { buildMcpConfig };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest lib/mcp/config.test.js --no-coverage`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp/config.js lib/mcp/config.test.js
git commit -m "feat(mcp): accept agent parameter in buildMcpConfig"
```

---

## Task 2: MCP CLI accepts --agent

**Files:**
- Modify: `lib/mcp/index.js`

- [ ] **Step 1: Add --agent flag to write-config**

Replace `lib/mcp/index.js`:

```javascript
#!/usr/bin/env node
// lib/mcp/index.js
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
      const agent = getArg('--agent') || 'claude';
      if (!output) {
        console.error('Usage: node lib/mcp/index.js write-config --output <path> [--agent claude|copilot]');
        process.exit(1);
      }
      const dir = path.dirname(path.resolve(output));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(output, JSON.stringify(buildMcpConfig({ agent }), null, 2) + '\n');
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

- [ ] **Step 2: Smoke-test from shell**

Run:
```bash
TMP=$(mktemp -d); node lib/mcp/index.js write-config --output "$TMP/c.json" --agent copilot && cat "$TMP/c.json"
```
Expected: prints path, then JSON containing `"mcpServers"` and `"mcpls"`. Exit code 0.

- [ ] **Step 3: Commit**

```bash
git add lib/mcp/index.js
git commit -m "feat(mcp): add --agent flag to write-config CLI"
```

---

## Task 3: Prompt builder accepts reviewer feedback

**Files:**
- Modify: `lib/prompt/builder.js`
- Test: `lib/prompt/builder.test.js`

- [ ] **Step 1: Add failing test for reviewer feedback section**

Append to `lib/prompt/builder.test.js`:

```javascript
describe('buildPrompt reviewer feedback', () => {
  const baseTask = {
    id: 'task-1', title: 'Do thing', priority: 1,
    acceptanceCriteria: [{ type: 'manual', text: 'manual check' }],
  };
  const baseOpts = { jsonFile: 'prd.json', progressFile: 'progress.txt' };

  test('omits Reviewer Feedback section when feedback is empty', () => {
    const prompt = require('./builder').buildPrompt(baseTask, baseOpts);
    expect(prompt).not.toMatch(/Reviewer Feedback/);
  });

  test('appends Reviewer Feedback section when provided', () => {
    const prompt = require('./builder').buildPrompt(baseTask, {
      ...baseOpts, reviewerFeedback: 'try a different library',
    });
    expect(prompt).toMatch(/## Reviewer Feedback/);
    expect(prompt).toMatch(/try a different library/);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx jest lib/prompt/builder.test.js --no-coverage`
Expected: FAIL on "appends Reviewer Feedback section".

- [ ] **Step 3: Implement reviewer-feedback support**

In `lib/prompt/builder.js`, replace the function with:

```javascript
'use strict';

function buildPrompt(task, options) {
  const { jsonFile, progressFile, reviewerFeedback } = options;
  const lines = [];

  lines.push(`You are working on task "${task.title}" (${task.id}, priority ${task.priority}).`);
  lines.push('');

  if (task.description) {
    lines.push(`Description: ${task.description}`);
    lines.push('');
  }

  lines.push('After your turn, I will verify your work by running these checks:');

  task.acceptanceCriteria.forEach((c, i) => {
    const num = i + 1;
    switch (c.type) {
      case 'shell':
        lines.push(`  ${num}. ${c.text} — run: ${c.command} (expecting exit code ${c.expectExitCode ?? 0})`);
        break;
      case 'http':
        lines.push(`  ${num}. ${c.text} — ${c.method || 'GET'} ${c.url} (expecting status ${c.expectStatus})`);
        break;
      case 'file-exists':
        lines.push(`  ${num}. ${c.text} — check file exists: ${c.path}`);
        break;
      case 'grep':
        lines.push(`  ${num}. ${c.text} — grep for "${c.pattern}" in ${c.path}`);
        break;
      case 'manual':
        lines.push(`  ${num}. ${c.text} — (manual review, not automatically verified)`);
        break;
      default:
        lines.push(`  ${num}. ${c.text}`);
    }
  });

  lines.push('');
  lines.push(`Work in this directory. Do not modify ${jsonFile} or ${progressFile}.`);
  lines.push('When you believe the task is complete, just say "DONE".');

  if (reviewerFeedback && String(reviewerFeedback).trim()) {
    lines.push('');
    lines.push('## Reviewer Feedback');
    lines.push('');
    lines.push('A second agent reviewed prior failed iterations and suggested:');
    lines.push('');
    lines.push(String(reviewerFeedback).trim());
  }

  return lines.join('\n');
}

module.exports = { buildPrompt };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest lib/prompt/builder.test.js --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/prompt/builder.js lib/prompt/builder.test.js
git commit -m "feat(prompt): support optional reviewer feedback section"
```

---

## Task 4: Prompt builder gets buildReviewPrompt + CLI

**Files:**
- Modify: `lib/prompt/builder.js`
- Modify: `lib/prompt/index.js`
- Test: `lib/prompt/builder.test.js`

- [ ] **Step 1: Add failing test for buildReviewPrompt**

Append to `lib/prompt/builder.test.js`:

```javascript
describe('buildReviewPrompt', () => {
  const { buildReviewPrompt } = require('./builder');
  const task = {
    id: 'task-2', title: 'Add login', priority: 1,
    acceptanceCriteria: [
      { type: 'shell', text: 'tests pass', command: 'npm test' },
      { type: 'http', text: 'login works', method: 'POST', url: 'http://x/login', expectStatus: 200 },
    ],
  };
  const failingResults = [
    { criterion: 1, passed: true },
    { criterion: 2, passed: false, error: 'got 500' },
  ];

  test('lists failing criteria with errors', () => {
    const out = buildReviewPrompt({ task, criteriaResults: failingResults, agentOutputTail: 'log line' });
    expect(out).toMatch(/login works/);
    expect(out).toMatch(/got 500/);
    expect(out).not.toMatch(/tests pass.*FAIL/);
  });

  test('includes agent output tail', () => {
    const out = buildReviewPrompt({ task, criteriaResults: failingResults, agentOutputTail: 'TAIL_MARKER' });
    expect(out).toMatch(/TAIL_MARKER/);
  });

  test('asks for an alternative approach', () => {
    const out = buildReviewPrompt({ task, criteriaResults: failingResults, agentOutputTail: '' });
    expect(out).toMatch(/different approach|alternative/i);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx jest lib/prompt/builder.test.js --no-coverage`
Expected: FAIL — `buildReviewPrompt is not a function`.

- [ ] **Step 3: Implement buildReviewPrompt**

Append to `lib/prompt/builder.js` (before `module.exports`):

```javascript
function buildReviewPrompt({ task, criteriaResults, agentOutputTail }) {
  const failing = (criteriaResults || []).filter((r) => r.passed === false);
  const lines = [];
  lines.push(`You are reviewing a failed iteration of task "${task.title}" (${task.id}).`);
  lines.push('');
  lines.push('The implementing agent could not satisfy these acceptance criteria:');
  lines.push('');
  failing.forEach((r) => {
    const c = task.acceptanceCriteria[r.criterion - 1];
    const text = (c && c.text) || `Criterion ${r.criterion}`;
    const err = r.error ? ` — error: ${r.error}` : '';
    lines.push(`- ${text}${err}`);
  });
  lines.push('');
  lines.push('Last lines of the implementing agent\'s output:');
  lines.push('');
  lines.push('```');
  lines.push(String(agentOutputTail || '').trim() || '(no output captured)');
  lines.push('```');
  lines.push('');
  lines.push('Suggest a different approach for the next iteration. Be concrete: name files,');
  lines.push('functions, libraries, or commands. Do not write code yourself; the implementer');
  lines.push('will read your suggestion and act on it. Keep the response under 300 words.');
  return lines.join('\n');
}

module.exports = { buildPrompt, buildReviewPrompt };
```

Replace the existing `module.exports = { buildPrompt };` line with the new export above.

- [ ] **Step 4: Run unit tests**

Run: `npx jest lib/prompt/builder.test.js --no-coverage`
Expected: PASS.

- [ ] **Step 5: Add CLI subcommand `build-review` and `--reviewer-feedback-file` to `build`**

Replace `lib/prompt/index.js` with:

```javascript
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { buildPrompt, buildReviewPrompt } = require('./builder');
const { normalizeCriteria } = require('../criteria/schema');

const command = process.argv[2];

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function loadTask(taskFile, taskId) {
  const prd = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
  const task = prd.tasks.find((t) => t.id === taskId);
  if (!task) {
    console.error(`Task "${taskId}" not found in ${taskFile}`);
    process.exit(1);
  }
  return {
    ...task,
    acceptanceCriteria: normalizeCriteria(task.acceptanceCriteria),
  };
}

function main() {
  switch (command) {
    case 'build': {
      const taskFile = getArg('--task-file');
      const taskId = getArg('--task-id');
      const jsonFile = getArg('--json-file') || 'prd.json';
      const progressFile = getArg('--progress-file') || 'progress.txt';
      const feedbackFile = getArg('--reviewer-feedback-file');
      const consecutiveFailures = parseInt(getArg('--consecutive-failures') || '0', 10);
      const thrashThreshold = 4;

      if (!taskFile || !taskId) {
        console.error('Usage: node lib/prompt/index.js build --task-file <path> --task-id <id> [--json-file <name>] [--progress-file <name>] [--reviewer-feedback-file <path>] [--consecutive-failures <n>]');
        process.exit(1);
      }

      const task = loadTask(taskFile, taskId);

      let reviewerFeedback = '';
      if (feedbackFile && fs.existsSync(feedbackFile) && consecutiveFailures >= thrashThreshold) {
        reviewerFeedback = fs.readFileSync(feedbackFile, 'utf-8');
        try { fs.unlinkSync(feedbackFile); } catch {}
      }

      console.log(buildPrompt(task, { jsonFile, progressFile, reviewerFeedback }));
      break;
    }

    case 'build-review': {
      const taskFile = getArg('--task-file');
      const taskId = getArg('--task-id');
      const resultsFile = getArg('--criteria-results-file');
      const tailFile = getArg('--agent-output-tail-file');

      if (!taskFile || !taskId || !resultsFile) {
        console.error('Usage: node lib/prompt/index.js build-review --task-file <path> --task-id <id> --criteria-results-file <path> [--agent-output-tail-file <path>]');
        process.exit(1);
      }

      const task = loadTask(taskFile, taskId);
      const criteriaResults = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
      const agentOutputTail = tailFile && fs.existsSync(tailFile)
        ? fs.readFileSync(tailFile, 'utf-8')
        : '';

      console.log(buildReviewPrompt({ task, criteriaResults, agentOutputTail }));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: build, build-review');
      process.exit(1);
  }
}

main();
```

- [ ] **Step 6: Smoke-test the CLI**

Create a temp PRD JSON, run `build-review`, confirm output mentions failing criterion text.

```bash
TMP=$(mktemp -d)
cat > "$TMP/prd.json" <<'EOF'
{ "tasks": [{ "id": "t1", "title": "X", "priority": 1, "category": "feat",
  "acceptanceCriteria": ["check a", "check b"], "passes": false }] }
EOF
echo '[{"criterion":1,"passed":true},{"criterion":2,"passed":false,"error":"oops"}]' > "$TMP/r.json"
node lib/prompt/index.js build-review --task-file "$TMP/prd.json" --task-id t1 --criteria-results-file "$TMP/r.json"
```

Expected: prints the review prompt containing `check b` and `oops`. Exit 0.

- [ ] **Step 7: Commit**

```bash
git add lib/prompt/builder.js lib/prompt/index.js lib/prompt/builder.test.js
git commit -m "feat(prompt): add build-review command and reviewer-feedback gating"
```

---

## Task 5: Commit trailer Ralph-Agent

**Files:**
- Modify: `lib/git/commits.js`
- Test: `lib/git/commits.test.js`

- [ ] **Step 1: Add failing test**

Append to `lib/git/commits.test.js`:

```javascript
describe('formatCommitMessage agent trailer', () => {
  const { formatCommitMessage } = require('./commits');
  const base = {
    taskId: 't1', taskTitle: 'Build X', iteration: 1, maxIterations: 10,
    passCount: 1, totalCount: 2, issueNumber: 42, ralphStatus: 'in-progress',
  };

  test('includes Ralph-Agent trailer when agent provided', () => {
    const msg = formatCommitMessage({ ...base, agent: 'copilot' });
    expect(msg).toMatch(/^Ralph-Agent: copilot$/m);
  });

  test('omits Ralph-Agent trailer when agent missing (back-compat)', () => {
    const msg = formatCommitMessage(base);
    expect(msg).not.toMatch(/Ralph-Agent/);
  });

  test('Ralph-Agent appears after Ralph-Status', () => {
    const msg = formatCommitMessage({ ...base, agent: 'claude' });
    const idxStatus = msg.indexOf('Ralph-Status');
    const idxAgent = msg.indexOf('Ralph-Agent');
    expect(idxAgent).toBeGreaterThan(idxStatus);
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

Run: `npx jest lib/git/commits.test.js --no-coverage`
Expected: FAIL on agent-trailer tests.

- [ ] **Step 3: Implement trailer**

In `lib/git/commits.js`, change `formatCommitMessage`:

```javascript
function formatCommitMessage({
  taskId, taskTitle, iteration, maxIterations,
  passCount, totalCount, issueNumber, ralphStatus, agent,
}) {
  const firstChar = taskTitle.charAt(0).toLowerCase();
  const subject = `${taskId}: ${firstChar}${taskTitle.slice(1)}`;
  const body = `Iteration ${iteration}/${maxIterations}. Criteria: ${passCount}/${totalCount} passing.`;
  const trailers = [`Ralph-Task-Id: ${taskId}`];
  if (issueNumber) trailers.push(`Ralph-Issue: #${issueNumber}`);
  trailers.push(`Ralph-Status: ${ralphStatus}`);
  if (agent) trailers.push(`Ralph-Agent: ${agent}`);
  return [subject, '', body, '', trailers.join('\n')].join('\n');
}
```

- [ ] **Step 4: Run test**

Run: `npx jest lib/git/commits.test.js --no-coverage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/git/commits.js lib/git/commits.test.js
git commit -m "feat(git): add Ralph-Agent commit trailer"
```

---

## Task 6: Issue formatter — Agent column + reviewer comment

**Files:**
- Modify: `lib/github/issues.js`
- Test: `lib/github/issues.test.js`

- [ ] **Step 1: Add failing tests**

Append to `lib/github/issues.test.js`:

```javascript
describe('formatIterationComment agent column', () => {
  const { formatIterationComment } = require('./issues');
  const args = {
    iteration: 2, maxIterations: 10,
    results: [{ criterion: 1, passed: true }],
    criteria: [{ text: 'a' }],
    mcpStatus: 'ok',
    agent: 'copilot',
  };

  test('header table includes Agent column when agent passed', () => {
    const c = formatIterationComment(args);
    expect(c).toMatch(/\| # \| Criterion \| Result \| Agent \|/);
    expect(c).toMatch(/\| copilot \|/);
  });

  test('omits Agent column when agent absent (back-compat)', () => {
    const { agent, ...noAgent } = args;
    const c = formatIterationComment(noAgent);
    expect(c).not.toMatch(/Agent/);
  });
});

describe('formatReviewerComment', () => {
  const { formatReviewerComment } = require('./issues');

  test('renders header with reviewer agent name', () => {
    const out = formatReviewerComment({ agent: 'copilot', body: 'try a different library' });
    expect(out).toMatch(/^### Reviewer feedback \(copilot\)/);
    expect(out).toMatch(/try a different library/);
  });

  test('handles empty body gracefully', () => {
    const out = formatReviewerComment({ agent: 'claude', body: '' });
    expect(out).toMatch(/^### Reviewer feedback \(claude\)/);
    expect(out).toMatch(/_No feedback provided._/);
  });
});
```

- [ ] **Step 2: Run tests, confirm failure**

Run: `npx jest lib/github/issues.test.js --no-coverage`
Expected: FAIL on new tests.

- [ ] **Step 3: Implement**

In `lib/github/issues.js`, replace `formatIterationComment` and add `formatReviewerComment` + `postReviewerComment`:

```javascript
function formatIterationComment({ iteration, maxIterations, results, criteria, mcpStatus, agent }) {
  const includeAgent = !!agent;
  const headerRow = includeAgent
    ? '| # | Criterion | Result | Agent |'
    : '| # | Criterion | Result |';
  const sepRow = includeAgent
    ? '|---|-----------|--------|-------|'
    : '|---|-----------|--------|';

  const rows = results.map((r, i) => {
    const text = criteria[i]?.text || `Criterion ${r.criterion}`;
    let status;
    if (r.skipped || r.passed === null) status = ':large_blue_circle: skipped';
    else if (r.passed) status = ':white_check_mark: pass';
    else status = `:x: fail${r.error ? ' — ' + r.error : ''}`;
    return includeAgent
      ? `| ${i + 1} | ${text} | ${status} | ${agent} |`
      : `| ${i + 1} | ${text} | ${status} |`;
  });

  const passCount = results.filter((r) => r.passed === true).length;
  const total = results.length;

  const lines = [
    `### Iteration ${iteration}/${maxIterations}`,
    '',
    headerRow,
    sepRow,
    ...rows,
    '',
    `**Status:** ${passCount}/${total} criteria passing.${passCount === total ? ' All done!' : ' Continuing.'}`,
  ];

  if (mcpStatus) lines.push(`**MCP:** ${mcpStatus}`);

  return lines.join('\n');
}

function formatReviewerComment({ agent, body }) {
  const trimmed = (body || '').trim();
  return [
    `### Reviewer feedback (${agent})`,
    '',
    trimmed || '_No feedback provided._',
  ].join('\n');
}

function postReviewerComment({ repo, issueNumber, agent, body }) {
  const comment = formatReviewerComment({ agent, body });
  const tmpFile = require('os').tmpdir() + `/ralph-reviewer-${Date.now()}.md`;
  require('fs').writeFileSync(tmpFile, comment);
  try {
    execSync(`gh issue comment ${issueNumber} --repo "${repo}" --body-file "${tmpFile}"`, {
      encoding: 'utf-8',
    });
  } catch (err) {
    throw new Error(`Failed to post reviewer comment to issue #${issueNumber}: ${err.message}`);
  } finally {
    try { require('fs').unlinkSync(tmpFile); } catch {}
  }
}
```

Update the `module.exports` line to include the new exports:

```javascript
module.exports = {
  createIssue, updateIssue, closeIssue, formatCriteriaChecklist,
  formatIterationComment, addLabel, removeLabel,
  formatReviewerComment, postReviewerComment,
};
```

Also update `updateIssue` to forward `agent` if passed:

```javascript
function updateIssue({ repo, issueNumber, iteration, maxIterations, results, criteria, mcpStatus, agent }) {
  const comment = formatIterationComment({ iteration, maxIterations, results, criteria, mcpStatus, agent });
  // ... rest unchanged
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest lib/github/issues.test.js --no-coverage`
Expected: PASS.

- [ ] **Step 5: Wire `post-reviewer-comment` into `lib/github/index.js`**

Read existing dispatch in `lib/github/index.js` (look at how `update-issue` is wired). Add a new case so Bash can invoke this. Pattern (insert near `update-issue`):

```javascript
case 'post-reviewer-comment': {
  const repo = getArg('--repo');
  const issueNumber = parseInt(getArg('--issue-number'), 10);
  const agent = getArg('--agent');
  const bodyFile = getArg('--body-file');
  if (!repo || !issueNumber || !agent || !bodyFile) {
    console.error('Usage: post-reviewer-comment --repo <r> --issue-number <n> --agent <claude|copilot> --body-file <path>');
    process.exit(1);
  }
  const body = require('fs').readFileSync(bodyFile, 'utf-8');
  require('./issues').postReviewerComment({ repo, issueNumber, agent, body });
  break;
}
```

(If `lib/github/index.js` uses a different dispatch shape, mirror that shape — read the file before editing.)

- [ ] **Step 6: Commit**

```bash
git add lib/github/issues.js lib/github/issues.test.js lib/github/index.js
git commit -m "feat(github): add Agent column and reviewer comment formatter"
```

---

## Task 7: Report aggregator + formatter — Agent breakdown

**Files:**
- Modify: `lib/report/aggregator.js`
- Modify: `lib/report/formatter.js`
- Test: `lib/report/aggregator.test.js`
- Test: `lib/report/formatter.test.js`

- [ ] **Step 1: Add failing test for aggregator**

Append to `lib/report/aggregator.test.js`:

```javascript
describe('agentBreakdown', () => {
  const { aggregate } = require('./aggregator');

  test('counts iterations per agent and reviewer invocations', () => {
    const progress = [
      'ITERATION 1/10', 'Agent: claude', 'MCP: ok', 'Reviewer: none',
      'ITERATION 2/10', 'Agent: claude', 'MCP: ok', 'Reviewer: copilot ok',
      'ITERATION 3/10', 'Agent: copilot', 'MCP: off', 'Reviewer: none',
    ].join('\n');
    const out = aggregate({ tasks: [] }, progress);
    expect(out.agentBreakdown).toEqual({
      iterations: { claude: 2, copilot: 1 },
      reviewerInvocations: 1,
      reviewerByAgent: { copilot: 1 },
    });
  });

  test('omits agentBreakdown when no Agent lines present', () => {
    const out = aggregate({ tasks: [] }, 'ITERATION 1/10\nMCP: ok\n');
    expect(out.agentBreakdown).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx jest lib/report/aggregator.test.js --no-coverage`
Expected: FAIL.

- [ ] **Step 3: Implement aggregator change**

In `lib/report/aggregator.js`, add a `computeAgentBreakdown` and include it in the return:

```javascript
function computeAgentBreakdown(progressText) {
  const lines = progressText.split(/\r?\n/);
  const iterations = {};
  const reviewerByAgent = {};
  let reviewerInvocations = 0;
  for (const line of lines) {
    const a = line.match(/^Agent:\s*(claude|copilot)\s*$/);
    if (a) { iterations[a[1]] = (iterations[a[1]] || 0) + 1; continue; }
    const r = line.match(/^Reviewer:\s*(claude|copilot)\s+(ok|degraded|off|n\/a)\s*$/);
    if (r) {
      reviewerInvocations += 1;
      reviewerByAgent[r[1]] = (reviewerByAgent[r[1]] || 0) + 1;
    }
  }
  if (Object.keys(iterations).length === 0 && reviewerInvocations === 0) return null;
  return { iterations, reviewerInvocations, reviewerByAgent };
}
```

In `aggregate`, add:

```javascript
const agentBreakdown = computeAgentBreakdown(progress);
return { summary, tasks, hotspots, mcp, agentBreakdown };
```

- [ ] **Step 4: Run test**

Run: `npx jest lib/report/aggregator.test.js --no-coverage`
Expected: PASS.

- [ ] **Step 5: Add formatter test**

Append to `lib/report/formatter.test.js`:

```javascript
describe('formatter agent breakdown section', () => {
  const { format } = require('./formatter');
  test('renders Agent breakdown when present', () => {
    const out = format({
      summary: { totalTasks: 0, passed: 0, blocked: 0, inProgress: 0, pending: 0, iterationsUsed: 3 },
      tasks: [], hotspots: [], mcp: null,
      agentBreakdown: {
        iterations: { claude: 2, copilot: 1 },
        reviewerInvocations: 1,
        reviewerByAgent: { copilot: 1 },
      },
    });
    expect(out).toMatch(/Agent breakdown/);
    expect(out).toMatch(/claude:\s*2/);
    expect(out).toMatch(/copilot:\s*1/);
    expect(out).toMatch(/Reviewer invocations:\s*1/);
  });

  test('omits Agent breakdown when null', () => {
    const out = require('./formatter').format({
      summary: { totalTasks: 0, passed: 0, blocked: 0, inProgress: 0, pending: 0, iterationsUsed: 0 },
      tasks: [], hotspots: [], mcp: null, agentBreakdown: null,
    });
    expect(out).not.toMatch(/Agent breakdown/);
  });
});
```

- [ ] **Step 6: Run, confirm failure**

Run: `npx jest lib/report/formatter.test.js --no-coverage`
Expected: FAIL.

- [ ] **Step 7: Implement formatter**

Read `lib/report/formatter.js` to see the existing `format` function and where to insert the section. Add (near where `mcp` is rendered):

```javascript
if (data.agentBreakdown) {
  lines.push('');
  lines.push('Agent breakdown');
  lines.push('---------------');
  for (const [name, count] of Object.entries(data.agentBreakdown.iterations)) {
    lines.push(`  ${name}: ${count}`);
  }
  lines.push(`  Reviewer invocations: ${data.agentBreakdown.reviewerInvocations}`);
  for (const [name, count] of Object.entries(data.agentBreakdown.reviewerByAgent)) {
    lines.push(`    by ${name}: ${count}`);
  }
}
```

(Adapt to the existing formatter's line-collection idiom — the formatter currently builds a string; mirror its structure.)

- [ ] **Step 8: Run test**

Run: `npx jest lib/report/formatter.test.js --no-coverage`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/report/aggregator.js lib/report/aggregator.test.js lib/report/formatter.js lib/report/formatter.test.js
git commit -m "feat(report): add Agent breakdown to offline report"
```

---

## Task 8: ralph-loop — `--agent` flag + invoke_agent helper + preflight

**Files:**
- Modify: `ralph-loop`

This task only changes Bash; verification is via the new Bash test suite written in Task 11.

- [ ] **Step 1: Add globals (top of file, near MCP_ENABLED)**

After `MCP_CONFIG_FILE=""` (line ~21), add:

```bash
AGENT="claude"
AGENT_EXPLICIT=false
REVIEWER="none"
```

- [ ] **Step 2: Add CLI flag parsing**

In `parse_arguments` (~line 320), add cases beside `--mcp`:

```bash
            --agent)
                if [ -z "${2:-}" ]; then
                    error_exit "--agent requires a value: claude or copilot" "Example: ./ralph-loop my-prd.md --agent copilot"
                fi
                case "$2" in
                    claude|copilot) AGENT="$2"; AGENT_EXPLICIT=true ;;
                    *) error_exit "--agent must be 'claude' or 'copilot' (got: $2)" "Run './ralph-loop --help' for options." ;;
                esac
                shift 2
                ;;
            --reviewer)
                if [ -z "${2:-}" ]; then
                    error_exit "--reviewer requires a value: none, claude, copilot, or auto" "Example: ./ralph-loop my-prd.md --reviewer auto"
                fi
                case "$2" in
                    none|claude|copilot|auto) REVIEWER="$2" ;;
                    *) error_exit "--reviewer must be one of: none, claude, copilot, auto (got: $2)" "Run './ralph-loop --help' for options." ;;
                esac
                shift 2
                ;;
```

- [ ] **Step 3: Resolve `auto` reviewer and run preflight**

After `parse_arguments` returns (find where `parse_arguments "$@"` is called and immediately follow it), add:

```bash
# Resolve --reviewer auto
if [ "$REVIEWER" = "auto" ]; then
    if [ "$AGENT_EXPLICIT" = true ]; then
        if [ "$AGENT" = "claude" ]; then REVIEWER="copilot"; else REVIEWER="claude"; fi
    else
        REVIEWER="copilot"
    fi
fi

# Preflight: required binaries on PATH
if ! command -v "$AGENT" >/dev/null 2>&1; then
    error_exit "Agent binary '$AGENT' not found on PATH" "Install it or pick a different --agent value."
fi
if [ "$REVIEWER" != "none" ] && [ "$REVIEWER" != "$AGENT" ]; then
    if ! command -v "$REVIEWER" >/dev/null 2>&1; then
        error_exit "Reviewer binary '$REVIEWER' not found on PATH" "Install it or pick a different --reviewer value."
    fi
fi
```

- [ ] **Step 4: Add `invoke_agent` helper function**

Add a new function definition (place near `check_thrash` ~line 2273, or in any helper-function area):

```bash
# invoke_agent <agent> <prompt_file> <mcp_config_file>
# Captures stdout+stderr into global $agent_output, returns the agent exit code.
invoke_agent() {
    local agent="$1"
    local prompt_file="$2"
    local mcp_config="$3"
    local mcp_args=()
    if [ -n "$mcp_config" ]; then
        mcp_args+=(--mcp-config "$mcp_config")
    fi
    case "$agent" in
        claude)
            agent_output=$(claude --dangerously-skip-permissions --print "${mcp_args[@]}" < "$prompt_file" 2>&1)
            return $?
            ;;
        copilot)
            agent_output=$(copilot -p --allow-all-tools "${mcp_args[@]}" < "$prompt_file" 2>&1)
            return $?
            ;;
        *)
            agent_output="invoke_agent: unsupported agent: $agent"
            return 2
            ;;
    esac
}
```

- [ ] **Step 5: Replace the three inline `claude` invocations**

At lines 2785, 2808, 2815 (the three `if claude_output=$(claude --dangerously-skip-permissions --print "${mcp_args[@]}" < "$prompt_file" 2>&1)` sites in DEBUG/VERBOSE/quiet branches), replace each with:

```bash
                if invoke_agent "$AGENT" "$prompt_file" "${mcp_args[*]:+$MCP_CONFIG_FILE_PRIMARY}"; then
                    claude_output="$agent_output"
                    api_success=true
                    # ... existing post-success logic in that branch
                else
                    claude_exit_code=$?
                    claude_output="$agent_output"
                fi
```

Where `MCP_CONFIG_FILE_PRIMARY` is set in Task 9. For now (this task), keep using `$MCP_CONFIG_FILE` literally:

```bash
                local primary_mcp=""
                if [ "$MCP_ENABLED" = true ]; then primary_mcp="$MCP_CONFIG_FILE"; fi
                if invoke_agent "$AGENT" "$prompt_file" "$primary_mcp"; then
                    claude_output="$agent_output"
                    api_success=true
                    # (keep the existing DEBUG/VERBOSE echo blocks unchanged)
                else
                    claude_exit_code=$?
                    claude_output="$agent_output"
                fi
```

(Read the surrounding 5–10 lines for each of the three sites and preserve the existing log/echo blocks; only the agent-invocation line itself changes.)

- [ ] **Step 6: Update `--help` text**

Find `show_help` (search for `--mcp` block) and add:

```
  --agent <claude|copilot>
                          Pick the agent backend for the iteration loop.
                          Default: claude.
  --reviewer <none|claude|copilot|auto>
                          On criterion failure, run a second agent to
                          suggest a different approach. 'auto' picks the
                          opposite of --agent (or copilot if --agent is
                          default). Default: none.
```

- [ ] **Step 7: Verify Bash syntax**

Run: `bash -n ./ralph-loop`
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add ralph-loop
git commit -m "feat(ralph-loop): add --agent flag with invoke_agent helper and preflight"
```

---

## Task 9: ralph-loop — per-agent MCP config + log filename suffix

**Files:**
- Modify: `ralph-loop`

- [ ] **Step 1: Replace single MCP config write with per-agent writes**

Find the block at ~line 2608–2613 that calls `node "$SCRIPT_DIR/lib/mcp/index.js" write-config --output "$MCP_CONFIG_FILE"`. Replace with:

```bash
    if [ "$MCP_ENABLED" = true ]; then
        # Compute per-agent config paths under STATE_DIR.
        MCP_CONFIG_FILE_CLAUDE="${STATE_DIR}/mcp-config.claude.json"
        MCP_CONFIG_FILE_COPILOT="${STATE_DIR}/mcp-config.copilot.json"

        # Write the primary agent's config always.
        if ! node "$SCRIPT_DIR/lib/mcp/index.js" write-config \
                --output "${STATE_DIR}/mcp-config.${AGENT}.json" \
                --agent "$AGENT" > /dev/null; then
            error_exit "Failed to write MCP config for $AGENT" "Check filesystem permissions and rerun."
        fi

        # If reviewer is a different agent, write its config too.
        if [ "$REVIEWER" != "none" ] && [ "$REVIEWER" != "$AGENT" ]; then
            if ! node "$SCRIPT_DIR/lib/mcp/index.js" write-config \
                    --output "${STATE_DIR}/mcp-config.${REVIEWER}.json" \
                    --agent "$REVIEWER" > /dev/null; then
                error_exit "Failed to write MCP config for $REVIEWER" "Check filesystem permissions and rerun."
            fi
        fi

        # Back-compat: keep the legacy MCP_CONFIG_FILE pointing at the primary.
        MCP_CONFIG_FILE="${STATE_DIR}/mcp-config.${AGENT}.json"
        if [ "$VERBOSE" = true ]; then
            echo -e "${BLUE}[VERBOSE] MCP enabled; primary config at $MCP_CONFIG_FILE${NC}"
        fi
    fi
```

- [ ] **Step 2: Suffix the per-iteration MCP log with the agent name**

At ~line 2881, replace:

```bash
                > "${STATE_DIR}/mcp-iteration-${iteration}.log" 2>/dev/null || true
```

With:

```bash
                > "${STATE_DIR}/mcp-iteration-${iteration}.${AGENT}.log" 2>/dev/null || true
```

- [ ] **Step 3: Verify Bash syntax**

Run: `bash -n ./ralph-loop`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat(ralph-loop): write per-agent MCP configs and suffix iteration logs"
```

---

## Task 10: ralph-loop — reviewer call + comment + thrash-gated injection

**Files:**
- Modify: `ralph-loop`

- [ ] **Step 1: Add helper to count consecutive criterion failures from progress.txt**

Add near `check_thrash`:

```bash
# Count the most recent run of consecutive iteration FAILs from PROGRESS_FILE.
# Echo the integer count.
recent_consecutive_failures() {
    local count=0
    if [ ! -f "$PROGRESS_FILE" ]; then echo 0; return; fi
    # Walk backward over Result: lines.
    local line
    while IFS= read -r line; do
        if [[ "$line" =~ ^Result:\ FAILED ]]; then
            count=$((count + 1))
        elif [[ "$line" =~ ^Result: ]]; then
            break
        fi
    done < <(grep -E '^Result:' "$PROGRESS_FILE" | tail -r 2>/dev/null || tac)
    echo "$count"
}
```

- [ ] **Step 2: Add the reviewer invocation step**

Find the verify call site (search for `node "$SCRIPT_DIR/lib/criteria/index.js" verify`). After verify returns and after `criteria_results` is captured but before `commit_iteration`, insert:

```bash
        # Reviewer pass: only when --reviewer != none AND at least one criterion failed.
        if [ "$REVIEWER" != "none" ]; then
            local fail_count
            fail_count=$(echo "$criteria_results" | jq '[.[] | select(.passed==false)] | length' 2>/dev/null || echo 0)
            if [ "$fail_count" -gt 0 ]; then
                local reviewer_results_file="${STATE_DIR}/reviewer-results-${iteration}.json"
                local reviewer_tail_file="${STATE_DIR}/reviewer-tail-${iteration}.txt"
                local reviewer_prompt_file="${STATE_DIR}/reviewer-prompt-${iteration}.txt"
                local reviewer_feedback_file="${STATE_DIR}/reviewer-feedback.txt"

                echo "$criteria_results" > "$reviewer_results_file"
                echo "$claude_output" | tail -n 80 > "$reviewer_tail_file"

                if ! node "$SCRIPT_DIR/lib/prompt/index.js" build-review \
                        --task-file "$JSON_FILE" \
                        --task-id "$next_task_id" \
                        --criteria-results-file "$reviewer_results_file" \
                        --agent-output-tail-file "$reviewer_tail_file" \
                        > "$reviewer_prompt_file"; then
                    echo -e "${YELLOW}[WARN] Failed to build reviewer prompt; skipping reviewer pass.${NC}"
                else
                    local reviewer_mcp=""
                    if [ "$MCP_ENABLED" = true ]; then
                        reviewer_mcp="${STATE_DIR}/mcp-config.${REVIEWER}.json"
                    fi
                    local reviewer_status="ok"
                    if invoke_agent "$REVIEWER" "$reviewer_prompt_file" "$reviewer_mcp"; then
                        echo "$agent_output" > "$reviewer_feedback_file"
                    else
                        reviewer_status="degraded"
                        echo -e "${YELLOW}[WARN] Reviewer ($REVIEWER) call failed; continuing.${NC}"
                        echo "$agent_output" > "$reviewer_feedback_file"
                    fi

                    # Always-on: post comment to GitHub issue.
                    if [ "$GITHUB_ENABLED" = true ] && [ -n "$TARGET_REPO" ] && [ -n "$issue_number" ]; then
                        node "$SCRIPT_DIR/lib/github/index.js" post-reviewer-comment \
                            --repo "$TARGET_REPO" \
                            --issue-number "$issue_number" \
                            --agent "$REVIEWER" \
                            --body-file "$reviewer_feedback_file" \
                            >/dev/null 2>&1 \
                            || echo -e "${YELLOW}[WARN] Failed to post reviewer comment.${NC}"
                    fi

                    log_iteration_reviewer "$REVIEWER" "$reviewer_status"
                fi

                rm -f "$reviewer_results_file" "$reviewer_tail_file" "$reviewer_prompt_file"
            else
                log_iteration_reviewer "$REVIEWER" "n/a"
            fi
        else
            log_iteration_reviewer "none" "n/a"
        fi
```

(Locate the precise variable names for `criteria_results`, `claude_output`, `issue_number`, `next_task_id` in the surrounding code and adjust if they differ — read the iteration block first.)

- [ ] **Step 3: Pass reviewer-feedback file + consecutive-failure count to `prompt build`**

Find where Bash currently calls `node "$SCRIPT_DIR/lib/prompt/index.js" build`. Update to:

```bash
        local consecutive_failures
        consecutive_failures=$(recent_consecutive_failures)
        local feedback_args=()
        local feedback_path="${STATE_DIR}/reviewer-feedback.txt"
        if [ -f "$feedback_path" ]; then
            feedback_args+=(--reviewer-feedback-file "$feedback_path" --consecutive-failures "$consecutive_failures")
        fi

        claude_prompt=$(node "$SCRIPT_DIR/lib/prompt/index.js" build \
            --task-file "$JSON_FILE" \
            --task-id "$next_task_id" \
            --json-file "$JSON_FILE" \
            --progress-file "$PROGRESS_FILE" \
            "${feedback_args[@]}")
```

(Match the existing variable names and arg order — read the existing call before editing.)

- [ ] **Step 4: Verify Bash syntax**

Run: `bash -n ./ralph-loop`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add ralph-loop
git commit -m "feat(ralph-loop): reviewer pass with thrash-gated prompt injection"
```

---

## Task 11: ralph-loop — Agent + Reviewer progress lines, commit trailer wiring, resume crosscheck

**Files:**
- Modify: `ralph-loop`

- [ ] **Step 1: Add log helpers**

Near `log_iteration_mcp` (~line 2103), add:

```bash
log_iteration_agent() {
    local agent="$1"
    cat >> "$PROGRESS_FILE" << EOF
Agent: $agent
EOF
}

log_iteration_reviewer() {
    local agent="$1"
    local status="$2"
    cat >> "$PROGRESS_FILE" << EOF
Reviewer: $agent $status
EOF
}
```

- [ ] **Step 2: Call `log_iteration_agent` immediately before `log_iteration_mcp`**

Find the `log_iteration_mcp "$mcp_status"` call. Insert one line above:

```bash
        log_iteration_agent "$AGENT"
        log_iteration_mcp "$mcp_status"
```

(`log_iteration_reviewer` is already called inside Task 10's reviewer block.)

- [ ] **Step 3: Pass `--agent` to commit_iteration's commits**

Find the call to `commit_iteration` (it eventually calls `node lib/git/index.js commit ...` or invokes `formatCommitMessage`). Locate the wiring in `lib/git/index.js`:

```bash
grep -n "formatCommitMessage\|Ralph-Status" lib/git/index.js
```

In `lib/git/index.js`, the `commit` subcommand parses CLI args. Add:

```javascript
const agent = getArg('--agent');
// ... pass into the call:
commitIteration({ ..., agent });
```

(Read the existing `commit` case before editing; match its style.) Then in `ralph-loop`'s `commit_iteration` Bash function, add `--agent "$AGENT"` to the command line.

- [ ] **Step 4: Pass `--agent` to `update-issue` (Agent column on iteration comment)**

Find the Bash call to `node "$SCRIPT_DIR/lib/github/index.js" update-issue ...`. Append `--agent "$AGENT"`. Then in `lib/github/index.js`, the `update-issue` case must read `--agent` and forward it into `updateIssue({ ..., agent })`. (The library function was updated in Task 6; only the CLI bridge needs the new flag.)

- [ ] **Step 5: Resume crosscheck warning**

Find `crosscheck_issues`. Add at the bottom (or in the resume parser block where the last iteration is read from `progress.txt`):

```bash
    if [ "$RESUME" = true ] && [ -f "$PROGRESS_FILE" ]; then
        local prev_agent
        prev_agent=$(grep -E '^Agent: ' "$PROGRESS_FILE" | tail -n 1 | awk '{print $2}')
        if [ -n "$prev_agent" ] && [ "$prev_agent" != "$AGENT" ]; then
            echo -e "${YELLOW}[WARN] Previous run used agent '$prev_agent'; current run uses '$AGENT'. Continuing.${NC}"
        fi
    fi
```

- [ ] **Step 6: Verify Bash syntax + run JS suite**

Run:
```bash
bash -n ./ralph-loop
npx jest --no-coverage --testPathIgnorePatterns='user-model'
```
Expected: bash exit 0; Jest passes.

- [ ] **Step 7: Commit**

```bash
git add ralph-loop lib/git/index.js lib/github/index.js
git commit -m "feat(ralph-loop): log Agent/Reviewer, wire commit trailer, resume warning"
```

---

## Task 12: Bash test suites

**Files:**
- Create: `tests/test-agent-selection.sh`
- Create: `tests/test-reviewer.sh`
- Create: `tests/test-agent-resume.sh`
- Modify: `tests/test-all.sh`

Existing suites already use shim binaries on `PATH` — read `tests/test-mcp.sh` for the canonical pattern before writing these.

- [ ] **Step 1: Create `tests/test-agent-selection.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0
FAIL=0

assert() {
    local name="$1"; shift
    if "$@"; then echo "  ✓ $name"; PASS=$((PASS+1)); else echo "  ✗ $name"; FAIL=$((FAIL+1)); fi
}

setup_workdir() {
    WORKDIR=$(mktemp -d)
    SHIM_DIR="$WORKDIR/bin"
    mkdir -p "$SHIM_DIR"
    cat > "$SHIM_DIR/claude" <<'EOF'
#!/usr/bin/env bash
echo "DONE"
EOF
    cat > "$SHIM_DIR/copilot" <<'EOF'
#!/usr/bin/env bash
echo "DONE"
EOF
    chmod +x "$SHIM_DIR/claude" "$SHIM_DIR/copilot"
    cat > "$WORKDIR/prd.md" <<'EOF'
## Task: Demo task
**Category**: feat
**Priority**: 1
### Acceptance Criteria
- always pass `[shell: true]`
EOF
}

teardown_workdir() {
    rm -rf "$WORKDIR"
}

test_default_agent_is_claude() {
    setup_workdir
    PATH="$SHIM_DIR:$PATH" \
        "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" \
        --no-github --max-iterations 1 --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1
    grep -q '^Agent: claude$' "$WORKDIR/.state"/*/progress.txt
    local rc=$?
    teardown_workdir
    return $rc
}

test_explicit_copilot_agent() {
    setup_workdir
    PATH="$SHIM_DIR:$PATH" \
        "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" --agent copilot \
        --no-github --max-iterations 1 --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1
    grep -q '^Agent: copilot$' "$WORKDIR/.state"/*/progress.txt
    local rc=$?
    teardown_workdir
    return $rc
}

test_missing_agent_binary_fails_preflight() {
    setup_workdir
    rm "$SHIM_DIR/copilot"  # only claude available
    PATH="$SHIM_DIR:$PATH" \
        "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" --agent copilot \
        --no-github --max-iterations 1 --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1
    local rc=$?
    teardown_workdir
    [ "$rc" -ne 0 ]
}

test_mcp_log_uses_agent_suffix() {
    setup_workdir
    # Make the shim mention "mcpls" so classifier marks degraded.
    cat > "$SHIM_DIR/copilot" <<'EOF'
#!/usr/bin/env bash
echo "mcpls error"
EOF
    chmod +x "$SHIM_DIR/copilot"
    PATH="$SHIM_DIR:$PATH" \
        "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" --agent copilot --mcp \
        --no-github --max-iterations 1 --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1
    ls "$WORKDIR/.state"/*/mcp-iteration-1.copilot.log >/dev/null 2>&1
    local rc=$?
    teardown_workdir
    return $rc
}

echo "=== test-agent-selection.sh ==="
assert "default agent is claude" test_default_agent_is_claude
assert "explicit --agent copilot" test_explicit_copilot_agent
assert "missing binary fails preflight" test_missing_agent_binary_fails_preflight
assert "MCP log uses agent suffix" test_mcp_log_uses_agent_suffix

echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
```

`chmod +x tests/test-agent-selection.sh`

- [ ] **Step 2: Create `tests/test-reviewer.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0; FAIL=0

assert() { local n="$1"; shift; if "$@"; then echo "  ✓ $n"; PASS=$((PASS+1)); else echo "  ✗ $n"; FAIL=$((FAIL+1)); fi }

setup() {
    WORKDIR=$(mktemp -d)
    SHIM_DIR="$WORKDIR/bin"; mkdir -p "$SHIM_DIR"
    cat > "$SHIM_DIR/claude" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo "DONE"
EOF
    cat > "$SHIM_DIR/copilot" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
echo "REVIEWER_SUGGESTION: try X"
EOF
    chmod +x "$SHIM_DIR"/*
    # Failing PRD criterion so reviewer fires.
    cat > "$WORKDIR/prd.md" <<'EOF'
## Task: Demo
**Category**: feat
**Priority**: 1
### Acceptance Criteria
- never pass `[shell: false]`
EOF
}
teardown() { rm -rf "$WORKDIR"; }

test_no_reviewer_logs_none() {
    setup
    PATH="$SHIM_DIR:$PATH" "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" \
        --no-github --max-iterations 1 --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1 || true
    grep -q '^Reviewer: none ' "$WORKDIR/.state"/*/progress.txt
    local rc=$?; teardown; return $rc
}

test_auto_reviewer_picks_other_agent() {
    setup
    PATH="$SHIM_DIR:$PATH" "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" \
        --no-github --max-iterations 1 --reviewer auto --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1 || true
    grep -q '^Reviewer: copilot ' "$WORKDIR/.state"/*/progress.txt
    local rc=$?; teardown; return $rc
}

test_reviewer_writes_feedback_file() {
    setup
    PATH="$SHIM_DIR:$PATH" "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" \
        --no-github --max-iterations 1 --reviewer copilot --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1 || true
    grep -q 'REVIEWER_SUGGESTION: try X' "$WORKDIR/.state"/*/reviewer-feedback.txt
    local rc=$?; teardown; return $rc
}

test_reviewer_skipped_when_all_pass() {
    setup
    # Replace failing criterion with a passing one.
    cat > "$WORKDIR/prd.md" <<'EOF'
## Task: Demo
**Category**: feat
**Priority**: 1
### Acceptance Criteria
- always pass `[shell: true]`
EOF
    PATH="$SHIM_DIR:$PATH" "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" \
        --no-github --max-iterations 1 --reviewer copilot --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out.log" 2>&1 || true
    grep -q '^Reviewer: copilot n/a' "$WORKDIR/.state"/*/progress.txt
    local rc=$?; teardown; return $rc
}

echo "=== test-reviewer.sh ==="
assert "no reviewer logs none" test_no_reviewer_logs_none
assert "auto reviewer picks copilot when claude is primary" test_auto_reviewer_picks_other_agent
assert "reviewer writes feedback file on failure" test_reviewer_writes_feedback_file
assert "reviewer skipped (n/a) when all criteria pass" test_reviewer_skipped_when_all_pass

echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
```

`chmod +x tests/test-reviewer.sh`

- [ ] **Step 3: Create `tests/test-agent-resume.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PASS=0; FAIL=0

assert() { local n="$1"; shift; if "$@"; then echo "  ✓ $n"; PASS=$((PASS+1)); else echo "  ✗ $n"; FAIL=$((FAIL+1)); fi }

setup() {
    WORKDIR=$(mktemp -d)
    SHIM_DIR="$WORKDIR/bin"; mkdir -p "$SHIM_DIR"
    for a in claude copilot; do
        cat > "$SHIM_DIR/$a" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null; echo DONE
EOF
        chmod +x "$SHIM_DIR/$a"
    done
    cat > "$WORKDIR/prd.md" <<'EOF'
## Task: Demo
**Category**: feat
**Priority**: 1
### Acceptance Criteria
- always pass `[shell: true]`
EOF
}
teardown() { rm -rf "$WORKDIR"; }

test_resume_with_different_agent_warns() {
    setup
    # First run with claude.
    PATH="$SHIM_DIR:$PATH" "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" \
        --no-github --max-iterations 1 --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out1.log" 2>&1
    # Resume with copilot.
    PATH="$SHIM_DIR:$PATH" "$ROOT_DIR/ralph-loop" "$WORKDIR/prd.md" \
        --no-github --resume --max-iterations 1 --agent copilot --state-dir "$WORKDIR/.state" \
        > "$WORKDIR/out2.log" 2>&1 || true
    grep -q "Previous run used agent 'claude'" "$WORKDIR/out2.log"
    local rc=$?; teardown; return $rc
}

echo "=== test-agent-resume.sh ==="
assert "resume with switched agent emits warning" test_resume_with_different_agent_warns

echo "Pass: $PASS  Fail: $FAIL"
[ "$FAIL" -eq 0 ]
```

`chmod +x tests/test-agent-resume.sh`

- [ ] **Step 4: Register suites in `tests/test-all.sh`**

Read `tests/test-all.sh` to see the suite-registration pattern. Add (alongside other test invocations):

```bash
"$SCRIPT_DIR/test-agent-selection.sh"
"$SCRIPT_DIR/test-reviewer.sh"
"$SCRIPT_DIR/test-agent-resume.sh"
```

- [ ] **Step 5: Run new suites individually**

Run:
```bash
./tests/test-agent-selection.sh
./tests/test-reviewer.sh
./tests/test-agent-resume.sh
```
Expected: each prints `Fail: 0` and exits 0.

- [ ] **Step 6: Run full Bash suite**

Run: `./tests/test-all.sh`
Expected: all suites pass; exit 0.

- [ ] **Step 7: Run full Jest suite**

Run: `npx jest --no-coverage --testPathIgnorePatterns='user-model'`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add tests/test-agent-selection.sh tests/test-reviewer.sh tests/test-agent-resume.sh tests/test-all.sh
chmod +x tests/test-agent-selection.sh tests/test-reviewer.sh tests/test-agent-resume.sh
git commit -m "test: bash suites for agent selection, reviewer, and resume"
```

---

## Task 13: Update CLAUDE.md and README

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md` (if present)

- [ ] **Step 1: Add `--agent` and `--reviewer` to the `### Run the tool` snippet in `CLAUDE.md`**

Replace the existing usage line with:

```bash
./ralph-loop <prd-file.md> [--max-iterations N] [--verbose] [--debug] [--resume] \
  [--analyze-prd] [--dry-run] [--no-github] [--no-branch] [--repo owner/name] \
  [--mcp] [--report] [--state-dir <path>] [--migrate-state] \
  [--agent claude|copilot] [--reviewer none|claude|copilot|auto]
```

Add a new bullet under "Key conventions":

> - Agent backend is selected with `--agent claude|copilot` (default `claude`). Optional `--reviewer none|claude|copilot|auto` runs a second agent on criterion failure; `auto` picks the opposite of `--agent`. Reviewer feedback is always commented on the issue (when GitHub is on) and is injected into the next prompt only after 4 consecutive failures (the existing thrash threshold). Per-agent MCP configs live at `.ralph/<slug>/mcp-config.<agent>.json`. Per-iteration MCP logs are suffixed `mcp-iteration-N.<agent>.log`. Commits include a `Ralph-Agent: <agent>` trailer.

- [ ] **Step 2: Run a quick sanity check on docs**

Run: `grep -n "agent\|reviewer" CLAUDE.md | head -20`
Expected: shows the new mentions.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document --agent and --reviewer flags"
```

---

## Self-Review Notes

**Spec coverage check:**
- Goals: `--agent` (T8), `--reviewer` (T8/T10), reviewer comment (T6/T10), thrash-gated injection (T4/T10), MCP per-agent (T1/T2/T9), observability — commit trailer (T5/T11), progress lines (T11), issue comment column (T6/T11), report breakdown (T7), resume warning (T11). ✓
- Non-goals: alternating implementer / per-iteration switching / cost tracking — none introduced. ✓
- Risks: Copilot flag drift (mitigated: single dispatch fn, T8 step 4); output heuristic (kept; T9 step 2 just renames the log file); config sprawl (T9 writes only what's needed). ✓

**Type/name consistency:**
- `agent_output` is the new captured-output global (T8); legacy `claude_output` is kept as an alias inside the three call-sites for minimal blast radius (T8 step 5). The reviewer block (T10) uses `agent_output` directly because it's introduced in the same file revision.
- `MCP_CONFIG_FILE` remains the back-compat handle pointing at the primary agent's config (T9 step 1); reviewer config path is computed inline from `${STATE_DIR}/mcp-config.${REVIEWER}.json`.
- `formatCommitMessage` accepts `agent` (T5); CLI bridge `lib/git/index.js commit` forwards `--agent` (T11 step 3).
- `formatIterationComment` accepts `agent` (T6); CLI bridge `lib/github/index.js update-issue` forwards `--agent` (T11 step 4).

**Placeholders:** none — every code step shows the code; every command step shows the command and expected outcome.
