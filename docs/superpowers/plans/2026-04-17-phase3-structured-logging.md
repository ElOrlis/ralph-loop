# Phase 3 — Structured Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-form `progress.txt` log with a structured JSONL event stream (`progress.jsonl`) and ship a `ralph-loop log` subcommand plus a `lib/logging/` module that writes events, reads iteration state, and renders pretty output — enabling reliable resume, cost tracking, and machine-readable run history.

**Architecture:** One new Node.js module at `lib/logging/` following the established `index.js` CLI + helpers pattern used by `lib/criteria/`, `lib/github/`, and `lib/prompt/`. Bash calls `node lib/logging/index.js <command> <args>` for every log write. The main `ralph-loop` script swaps its `progress.txt` writers (`log_iteration`, `log_iteration_result`, `log_learnings`, `log_completion`) for append-event calls, replaces the grep-based `get_last_iteration` with a JSONL reader, and gains a `log` subcommand for rendering. The legacy `progress.txt` continues to exist only as a migration signal — a warning is printed on `--resume` if only the old file is present.

**Tech Stack:** Node.js (CommonJS, matching existing modules), Jest for unit tests, Bash for CLI integration tests, no new runtime dependencies (built-in `fs`, `readline`).

---

## File Structure

```
lib/logging/
  index.js          — CLI entry (Bash: node lib/logging/index.js <command> <args>)
  events.js         — Event schema: required fields per event type, validation
  jsonl.js          — Append event, read last event by type, stream all events
  renderer.js       — JSONL -> box-drawing pretty output + run summary
  events.test.js    — Jest unit tests for schema validation
  jsonl.test.js     — Jest unit tests for append and read
  renderer.test.js  — Jest unit tests for rendering
tests/
  test-logging.sh   — Bash integration tests for the CLI
```

**Modified files:**
- `ralph-loop`
  - `initialize_progress_file` — switch from `progress.txt` to `progress.jsonl`, emit `run_start` / `run_resume`
  - `get_last_iteration` — call `node lib/logging/index.js last-iteration ...`
  - `log_iteration`, `log_iteration_result`, `log_learnings`, `log_completion` — replace bodies with `append` calls
  - `run_ralph_loop` — emit `iteration_start`, `criterion_result` per criterion, `iteration_end`, `api_call`, `task_complete`, `thrash_warning`, `run_complete`
  - `show_help` — document `ralph-loop log` and `--format` flag
  - `parse_arguments` — recognise `log` as a first-positional subcommand and dispatch
  - `main` — route to `render_log_command` when subcommand is `log`
- `tests/test-resume.sh`, `tests/test-progress.sh`, `tests/test-progress-visualization.sh` — update assertions that look inside `progress.txt` to look inside `progress.jsonl` or its rendered output
- `tests/test-all.sh` — register `test-logging.sh`

**Out of scope:** No automatic format conversion from existing `progress.txt` files. Cost tracking token counts are best-effort only — if the Claude CLI doesn't surface them, `tokensIn`/`tokensOut` fields are omitted.

---

## Event Catalogue

Every event MUST include `ts` (ISO 8601 UTC) and `event` (string). Type-specific required fields below are enforced by `lib/logging/events.js`.

| `event` | Required fields | Optional fields |
|---------|----------------|-----------------|
| `run_start` | `prdFile` (string), `maxIterations` (int) | — |
| `run_resume` | `prdFile` (string), `lastIteration` (int), `maxIterations` (int) | — |
| `iteration_start` | `iteration` (int), `taskId` (string), `taskTitle` (string) | — |
| `api_call` | `iteration` (int), `taskId` (string), `durationSeconds` (int) | `tokensIn` (int), `tokensOut` (int) |
| `criterion_result` | `iteration` (int), `taskId` (string), `criterionIndex` (int), `passed` (bool\|null) | `error` (string), `skipped` (bool) |
| `iteration_end` | `iteration` (int), `taskId` (string), `criteriaPassCount` (int), `criteriaTotalCount` (int) | — |
| `task_complete` | `taskId` (string), `iterationsUsed` (int) | — |
| `thrash_warning` | `taskId` (string), `criterionIndex` (int), `consecutiveFailures` (int) | — |
| `run_complete` | `success` (bool), `totalIterations` (int), `elapsed` (int seconds) | `githubApiCalls` (int), `totalApiDurationSeconds` (int), `estimatedTokensIn` (int), `estimatedTokensOut` (int) |

---

### Task 1: Event Schema Module

**Files:**
- Create: `lib/logging/events.js`
- Create: `lib/logging/events.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/logging/events.test.js
'use strict';

const { validateEvent, EVENT_TYPES } = require('./events');

describe('EVENT_TYPES', () => {
  test('lists all nine event types', () => {
    expect(EVENT_TYPES.sort()).toEqual([
      'api_call',
      'criterion_result',
      'iteration_end',
      'iteration_start',
      'run_complete',
      'run_resume',
      'run_start',
      'task_complete',
      'thrash_warning',
    ]);
  });
});

describe('validateEvent', () => {
  test('accepts a valid run_start event', () => {
    const result = validateEvent({
      ts: '2026-04-17T14:30:00Z',
      event: 'run_start',
      prdFile: 'auth.md',
      maxIterations: 15,
    });
    expect(result).toEqual({ valid: true });
  });

  test('rejects unknown event type', () => {
    const result = validateEvent({ ts: '2026-04-17T14:30:00Z', event: 'bogus' });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/unknown event type/i);
  });

  test('requires ts and event', () => {
    expect(validateEvent({ event: 'run_start', prdFile: 'x', maxIterations: 1 }).valid).toBe(false);
    expect(validateEvent({ ts: '2026-04-17T14:30:00Z', prdFile: 'x', maxIterations: 1 }).valid).toBe(false);
  });

  test('rejects run_start missing prdFile', () => {
    const result = validateEvent({
      ts: '2026-04-17T14:30:00Z',
      event: 'run_start',
      maxIterations: 15,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/prdFile/);
  });

  test('accepts iteration_end with counts', () => {
    expect(validateEvent({
      ts: '2026-04-17T14:30:00Z',
      event: 'iteration_end',
      iteration: 3,
      taskId: 'task-1',
      criteriaPassCount: 2,
      criteriaTotalCount: 3,
    }).valid).toBe(true);
  });

  test('accepts criterion_result with passed=null (skipped)', () => {
    expect(validateEvent({
      ts: '2026-04-17T14:30:00Z',
      event: 'criterion_result',
      iteration: 1,
      taskId: 'task-1',
      criterionIndex: 0,
      passed: null,
      skipped: true,
    }).valid).toBe(true);
  });

  test('rejects criterion_result missing passed field', () => {
    const result = validateEvent({
      ts: '2026-04-17T14:30:00Z',
      event: 'criterion_result',
      iteration: 1,
      taskId: 'task-1',
      criterionIndex: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/passed/);
  });

  test('accepts api_call without tokens', () => {
    expect(validateEvent({
      ts: '2026-04-17T14:30:00Z',
      event: 'api_call',
      iteration: 1,
      taskId: 'task-1',
      durationSeconds: 72,
    }).valid).toBe(true);
  });

  test('accepts run_complete with optional totals', () => {
    expect(validateEvent({
      ts: '2026-04-17T14:30:00Z',
      event: 'run_complete',
      success: true,
      totalIterations: 8,
      elapsed: 600,
      githubApiCalls: 12,
      totalApiDurationSeconds: 420,
    }).valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/logging/events.test.js --no-coverage 2>&1 | tail -5`
Expected: FAIL — `Cannot find module './events'`

- [ ] **Step 3: Implement the schema**

```js
// lib/logging/events.js
'use strict';

const REQUIRED = {
  run_start: ['prdFile', 'maxIterations'],
  run_resume: ['prdFile', 'lastIteration', 'maxIterations'],
  iteration_start: ['iteration', 'taskId', 'taskTitle'],
  api_call: ['iteration', 'taskId', 'durationSeconds'],
  criterion_result: ['iteration', 'taskId', 'criterionIndex', 'passed'],
  iteration_end: ['iteration', 'taskId', 'criteriaPassCount', 'criteriaTotalCount'],
  task_complete: ['taskId', 'iterationsUsed'],
  thrash_warning: ['taskId', 'criterionIndex', 'consecutiveFailures'],
  run_complete: ['success', 'totalIterations', 'elapsed'],
};

const EVENT_TYPES = Object.keys(REQUIRED);

function validateEvent(event) {
  if (!event || typeof event !== 'object') {
    return { valid: false, error: 'event must be an object' };
  }
  if (typeof event.ts !== 'string') {
    return { valid: false, error: 'missing or invalid "ts" field' };
  }
  if (typeof event.event !== 'string') {
    return { valid: false, error: 'missing or invalid "event" field' };
  }
  if (!EVENT_TYPES.includes(event.event)) {
    return { valid: false, error: `unknown event type: ${event.event}` };
  }
  for (const key of REQUIRED[event.event]) {
    if (!(key in event)) {
      return { valid: false, error: `${event.event} missing required field "${key}"` };
    }
  }
  return { valid: true };
}

module.exports = { validateEvent, EVENT_TYPES, REQUIRED };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/logging/events.test.js --no-coverage`
Expected: PASS — all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/logging/events.js lib/logging/events.test.js
git commit -m "feat(logging): add event schema with validator for nine event types"
```

---

### Task 2: JSONL Append Writer

**Files:**
- Create: `lib/logging/jsonl.js`
- Create: `lib/logging/jsonl.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/logging/jsonl.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { appendEvent, readEvents, lastEventOfType } = require('./jsonl');

function tmpFile() {
  return path.join(os.tmpdir(), `ralph-jsonl-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}

describe('appendEvent', () => {
  test('writes a single JSON line ending in newline', () => {
    const file = tmpFile();
    appendEvent(file, {
      ts: '2026-04-17T14:30:00Z',
      event: 'run_start',
      prdFile: 'auth.md',
      maxIterations: 15,
    });
    const contents = fs.readFileSync(file, 'utf-8');
    expect(contents.endsWith('\n')).toBe(true);
    expect(contents.split('\n').filter(Boolean)).toHaveLength(1);
    const parsed = JSON.parse(contents.trim());
    expect(parsed.event).toBe('run_start');
    fs.unlinkSync(file);
  });

  test('appends to existing file without overwriting', () => {
    const file = tmpFile();
    appendEvent(file, { ts: '2026-04-17T14:30:00Z', event: 'run_start', prdFile: 'a.md', maxIterations: 1 });
    appendEvent(file, {
      ts: '2026-04-17T14:30:01Z',
      event: 'iteration_start',
      iteration: 1,
      taskId: 'task-1',
      taskTitle: 'Do the thing',
    });
    const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    fs.unlinkSync(file);
  });

  test('throws on invalid event', () => {
    const file = tmpFile();
    expect(() => appendEvent(file, { event: 'run_start' })).toThrow(/ts/);
    expect(fs.existsSync(file)).toBe(false);
  });

  test('auto-fills ts when not provided', () => {
    const file = tmpFile();
    appendEvent(file, { event: 'run_start', prdFile: 'x.md', maxIterations: 1 });
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8').trim());
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    fs.unlinkSync(file);
  });
});

describe('readEvents', () => {
  test('returns empty array when file missing', () => {
    expect(readEvents('/nonexistent/path.jsonl')).toEqual([]);
  });

  test('skips malformed lines but keeps valid ones', () => {
    const file = tmpFile();
    fs.writeFileSync(
      file,
      '{"ts":"2026-04-17T14:30:00Z","event":"run_start","prdFile":"a","maxIterations":1}\n' +
      'not json\n' +
      '{"ts":"2026-04-17T14:30:01Z","event":"iteration_start","iteration":1,"taskId":"t","taskTitle":"T"}\n'
    );
    const events = readEvents(file);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('run_start');
    expect(events[1].event).toBe('iteration_start');
    fs.unlinkSync(file);
  });
});

describe('lastEventOfType', () => {
  test('returns the last matching event', () => {
    const file = tmpFile();
    appendEvent(file, { event: 'iteration_end', iteration: 1, taskId: 't', criteriaPassCount: 0, criteriaTotalCount: 1 });
    appendEvent(file, { event: 'iteration_end', iteration: 2, taskId: 't', criteriaPassCount: 1, criteriaTotalCount: 1 });
    appendEvent(file, { event: 'iteration_start', iteration: 3, taskId: 't', taskTitle: 'T' });
    const result = lastEventOfType(file, 'iteration_end');
    expect(result.iteration).toBe(2);
    fs.unlinkSync(file);
  });

  test('returns null when no matching event', () => {
    const file = tmpFile();
    appendEvent(file, { event: 'run_start', prdFile: 'x', maxIterations: 1 });
    expect(lastEventOfType(file, 'iteration_end')).toBeNull();
    fs.unlinkSync(file);
  });

  test('returns null when file missing', () => {
    expect(lastEventOfType('/nonexistent/path.jsonl', 'run_start')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/logging/jsonl.test.js --no-coverage 2>&1 | tail -5`
Expected: FAIL — `Cannot find module './jsonl'`

- [ ] **Step 3: Implement JSONL IO**

```js
// lib/logging/jsonl.js
'use strict';

const fs = require('fs');
const { validateEvent } = require('./events');

function appendEvent(file, event) {
  const enriched = { ts: event.ts || new Date().toISOString(), ...event };
  const result = validateEvent(enriched);
  if (!result.valid) {
    throw new Error(`Invalid event: ${result.error}`);
  }
  fs.appendFileSync(file, JSON.stringify(enriched) + '\n');
}

function readEvents(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf-8');
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // Skip malformed lines; log reader must be resilient.
    }
  }
  return events;
}

function lastEventOfType(file, eventType) {
  const events = readEvents(file);
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].event === eventType) return events[i];
  }
  return null;
}

module.exports = { appendEvent, readEvents, lastEventOfType };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/logging/jsonl.test.js --no-coverage`
Expected: PASS — all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/logging/jsonl.js lib/logging/jsonl.test.js
git commit -m "feat(logging): add JSONL append writer and last-event-of-type reader"
```

---

### Task 3: Pretty Renderer

**Files:**
- Create: `lib/logging/renderer.js`
- Create: `lib/logging/renderer.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/logging/renderer.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderJsonl, renderSummary } = require('./renderer');
const { appendEvent } = require('./jsonl');

function tmpFile() {
  return path.join(os.tmpdir(), `ralph-render-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}

describe('renderJsonl', () => {
  test('includes header and run_start block', () => {
    const file = tmpFile();
    appendEvent(file, {
      ts: '2026-04-17T14:30:00Z',
      event: 'run_start',
      prdFile: 'auth.md',
      maxIterations: 15,
    });
    const output = renderJsonl(file);
    expect(output).toContain('RALPH LOOP PROGRESS LOG');
    expect(output).toContain('auth.md');
    expect(output).toContain('Max Iterations: 15');
    fs.unlinkSync(file);
  });

  test('renders an iteration block with task and result', () => {
    const file = tmpFile();
    appendEvent(file, { ts: '2026-04-17T14:30:00Z', event: 'run_start', prdFile: 'a.md', maxIterations: 5 });
    appendEvent(file, {
      ts: '2026-04-17T14:30:01Z',
      event: 'iteration_start',
      iteration: 1,
      taskId: 'task-3',
      taskTitle: 'Add JWT validation',
    });
    appendEvent(file, {
      ts: '2026-04-17T14:30:50Z',
      event: 'iteration_end',
      iteration: 1,
      taskId: 'task-3',
      criteriaPassCount: 2,
      criteriaTotalCount: 3,
    });
    const output = renderJsonl(file);
    expect(output).toContain('ITERATION 1/5');
    expect(output).toContain('task-3 - Add JWT validation');
    expect(output).toContain('2/3 criteria passing');
    fs.unlinkSync(file);
  });

  test('renders criterion_result lines with pass/fail/skipped markers', () => {
    const file = tmpFile();
    appendEvent(file, { ts: '2026-04-17T14:30:00Z', event: 'run_start', prdFile: 'a.md', maxIterations: 5 });
    appendEvent(file, { ts: '2026-04-17T14:30:01Z', event: 'iteration_start', iteration: 1, taskId: 't', taskTitle: 'T' });
    appendEvent(file, { ts: '2026-04-17T14:30:02Z', event: 'criterion_result', iteration: 1, taskId: 't', criterionIndex: 0, passed: true });
    appendEvent(file, { ts: '2026-04-17T14:30:03Z', event: 'criterion_result', iteration: 1, taskId: 't', criterionIndex: 1, passed: false, error: 'exit code 1' });
    appendEvent(file, { ts: '2026-04-17T14:30:04Z', event: 'criterion_result', iteration: 1, taskId: 't', criterionIndex: 2, passed: null, skipped: true });
    const output = renderJsonl(file);
    expect(output).toMatch(/Criterion 1.*PASS/);
    expect(output).toMatch(/Criterion 2.*FAIL.*exit code 1/);
    expect(output).toMatch(/Criterion 3.*SKIPPED/);
    fs.unlinkSync(file);
  });

  test('renders a RESUMED SESSION block for run_resume', () => {
    const file = tmpFile();
    appendEvent(file, { ts: '2026-04-17T14:30:00Z', event: 'run_start', prdFile: 'a.md', maxIterations: 5 });
    appendEvent(file, { ts: '2026-04-17T15:00:00Z', event: 'run_resume', prdFile: 'a.md', lastIteration: 2, maxIterations: 5 });
    const output = renderJsonl(file);
    expect(output).toContain('RESUMED SESSION');
    expect(output).toContain('Continuing from iteration: 3');
    fs.unlinkSync(file);
  });

  test('returns an empty-file notice when file missing', () => {
    const output = renderJsonl('/nonexistent.jsonl');
    expect(output).toContain('No progress log found');
  });
});

describe('renderSummary', () => {
  test('aggregates totals across api_call and run_complete events', () => {
    const file = tmpFile();
    appendEvent(file, { ts: '2026-04-17T14:30:00Z', event: 'run_start', prdFile: 'a.md', maxIterations: 5 });
    appendEvent(file, { ts: '2026-04-17T14:30:05Z', event: 'api_call', iteration: 1, taskId: 't', durationSeconds: 30, tokensIn: 1200, tokensOut: 4500 });
    appendEvent(file, { ts: '2026-04-17T14:31:00Z', event: 'api_call', iteration: 2, taskId: 't', durationSeconds: 40, tokensIn: 800, tokensOut: 3000 });
    appendEvent(file, {
      ts: '2026-04-17T14:32:00Z',
      event: 'run_complete',
      success: true,
      totalIterations: 2,
      elapsed: 120,
      githubApiCalls: 6,
    });
    const summary = renderSummary(file);
    expect(summary).toContain('Total Iterations: 2');
    expect(summary).toContain('API Call Duration: 70s');
    expect(summary).toContain('Estimated Tokens In: 2000');
    expect(summary).toContain('Estimated Tokens Out: 7500');
    expect(summary).toContain('GitHub API Calls: 6');
    fs.unlinkSync(file);
  });

  test('returns a no-data notice when run_complete missing', () => {
    const file = tmpFile();
    appendEvent(file, { ts: '2026-04-17T14:30:00Z', event: 'run_start', prdFile: 'a.md', maxIterations: 5 });
    const summary = renderSummary(file);
    expect(summary).toContain('Run is in progress');
    fs.unlinkSync(file);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/logging/renderer.test.js --no-coverage 2>&1 | tail -5`
Expected: FAIL — `Cannot find module './renderer'`

- [ ] **Step 3: Implement the renderer**

```js
// lib/logging/renderer.js
'use strict';

const { readEvents } = require('./jsonl');

const RULE = '════════════════════════════════════════════════════════════════════════════';

function header(prdFile, maxIterations, ts) {
  return [
    '╔════════════════════════════════════════════════════════════════════════════╗',
    '║                         RALPH LOOP PROGRESS LOG                            ║',
    '╚════════════════════════════════════════════════════════════════════════════╝',
    '',
    `Start Time: ${ts}`,
    `PRD Path: ${prdFile}`,
    `Max Iterations: ${maxIterations}`,
    '',
    RULE,
    '',
  ].join('\n');
}

function resumeBlock(lastIteration, ts) {
  return [
    '',
    RULE,
    'RESUMED SESSION',
    `Resume Time: ${ts}`,
    `Continuing from iteration: ${lastIteration + 1}`,
    RULE,
    '',
  ].join('\n');
}

function iterationHeader(iteration, maxIterations, taskId, taskTitle, ts) {
  return [
    '┌────────────────────────────────────────────────────────────────────────────┐',
    `│ ITERATION ${iteration}/${maxIterations}`,
    `│ Timestamp: ${ts}`,
    `│ Working on: ${taskId} - ${taskTitle}`,
    '└────────────────────────────────────────────────────────────────────────────┘',
    '',
  ].join('\n');
}

function criterionLine(criterionIndex, passed, error, skipped) {
  const num = criterionIndex + 1;
  if (skipped || passed === null) return `  Criterion ${num}: SKIPPED (manual)`;
  if (passed) return `  Criterion ${num}: PASS`;
  return `  Criterion ${num}: FAIL${error ? ` — ${error}` : ''}`;
}

function iterationFooter(pass, total) {
  return `Result: ${pass}/${total} criteria passing.\n\n${RULE}\n`;
}

function renderJsonl(file) {
  const events = readEvents(file);
  if (events.length === 0) return 'No progress log found.\n';

  const maxIterationsByRun = events.find(e => e.event === 'run_start')?.maxIterations || 0;
  let out = '';

  for (const e of events) {
    switch (e.event) {
      case 'run_start':
        out += header(e.prdFile, e.maxIterations, e.ts);
        break;
      case 'run_resume':
        out += resumeBlock(e.lastIteration, e.ts);
        break;
      case 'iteration_start':
        out += iterationHeader(e.iteration, maxIterationsByRun, e.taskId, e.taskTitle, e.ts);
        break;
      case 'criterion_result':
        out += criterionLine(e.criterionIndex, e.passed, e.error, e.skipped) + '\n';
        break;
      case 'iteration_end':
        out += '\n' + iterationFooter(e.criteriaPassCount, e.criteriaTotalCount);
        break;
      case 'task_complete':
        out += `\n✓ Task ${e.taskId} completed after ${e.iterationsUsed} iteration(s).\n`;
        break;
      case 'thrash_warning':
        out += `\n⚠ Thrash: task ${e.taskId} criterion ${e.criterionIndex + 1} failed ${e.consecutiveFailures} times.\n`;
        break;
      case 'api_call':
        // Silent in the pretty log — surfaced in summary only.
        break;
      case 'run_complete':
        out += '\n' + (e.success ? successBlock(e) : failureBlock(e));
        break;
      default:
        break;
    }
  }
  return out;
}

function successBlock(e) {
  return [
    '╔════════════════════════════════════════════════════════════════════════════╗',
    '║                           COMPLETION SUCCESSFUL                            ║',
    '╚════════════════════════════════════════════════════════════════════════════╝',
    '',
    `Completion Time: ${e.ts}`,
    `Total Iterations: ${e.totalIterations}`,
    `Elapsed: ${e.elapsed}s`,
    'Status: ALL TASKS COMPLETED ✓',
    '',
  ].join('\n');
}

function failureBlock(e) {
  return [
    '╔════════════════════════════════════════════════════════════════════════════╗',
    '║                          MAX ITERATIONS REACHED                            ║',
    '╚════════════════════════════════════════════════════════════════════════════╝',
    '',
    `Stop Time: ${e.ts}`,
    `Total Iterations: ${e.totalIterations}`,
    `Elapsed: ${e.elapsed}s`,
    '',
  ].join('\n');
}

function renderSummary(file) {
  const events = readEvents(file);
  const complete = events.find(e => e.event === 'run_complete');
  if (!complete) return 'Run is in progress — summary available after completion.\n';

  let apiDuration = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let haveTokens = false;
  for (const e of events) {
    if (e.event !== 'api_call') continue;
    apiDuration += e.durationSeconds || 0;
    if (typeof e.tokensIn === 'number') { tokensIn += e.tokensIn; haveTokens = true; }
    if (typeof e.tokensOut === 'number') { tokensOut += e.tokensOut; haveTokens = true; }
  }

  const lines = [
    '╔════════════════════════════════════════════════════════════════════════════╗',
    '║                              RUN SUMMARY                                   ║',
    '╚════════════════════════════════════════════════════════════════════════════╝',
    '',
    `Success: ${complete.success ? 'yes' : 'no'}`,
    `Total Iterations: ${complete.totalIterations}`,
    `Elapsed: ${complete.elapsed}s`,
    `API Call Duration: ${apiDuration}s`,
  ];
  if (haveTokens) {
    lines.push(`Estimated Tokens In: ${tokensIn}`);
    lines.push(`Estimated Tokens Out: ${tokensOut}`);
  }
  if (typeof complete.githubApiCalls === 'number') {
    lines.push(`GitHub API Calls: ${complete.githubApiCalls}`);
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = { renderJsonl, renderSummary };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/logging/renderer.test.js --no-coverage`
Expected: PASS — all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/logging/renderer.js lib/logging/renderer.test.js
git commit -m "feat(logging): render JSONL events to box-drawing pretty output + summary"
```

---

### Task 4: CLI Entry Point

**Files:**
- Create: `lib/logging/index.js`

- [ ] **Step 1: Write the CLI wrapper**

```js
// lib/logging/index.js
#!/usr/bin/env node
'use strict';

const { appendEvent, lastEventOfType } = require('./jsonl');
const { renderJsonl, renderSummary } = require('./renderer');

const command = process.argv[2];

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function main() {
  switch (command) {
    case 'append': {
      const file = getArg('--file');
      const eventJson = getArg('--event');
      if (!file || !eventJson) {
        console.error('Usage: node lib/logging/index.js append --file <path> --event \'<json>\'');
        process.exit(1);
      }
      let event;
      try {
        event = JSON.parse(eventJson);
      } catch (err) {
        console.error(`Invalid --event JSON: ${err.message}`);
        process.exit(1);
      }
      appendEvent(file, event);
      console.log(JSON.stringify({ ok: true }));
      break;
    }

    case 'last-iteration': {
      const file = getArg('--file');
      if (!file) {
        console.error('Usage: node lib/logging/index.js last-iteration --file <path>');
        process.exit(1);
      }
      const last = lastEventOfType(file, 'iteration_end');
      console.log(JSON.stringify({ iteration: last ? last.iteration : 0 }));
      break;
    }

    case 'render': {
      const file = getArg('--file');
      const format = getArg('--format') || 'pretty';
      if (!file) {
        console.error('Usage: node lib/logging/index.js render --file <path> [--format pretty|json]');
        process.exit(1);
      }
      if (format === 'json') {
        const fs = require('fs');
        if (!fs.existsSync(file)) {
          console.error(`Log file not found: ${file}`);
          process.exit(1);
        }
        process.stdout.write(fs.readFileSync(file, 'utf-8'));
      } else {
        process.stdout.write(renderJsonl(file));
      }
      break;
    }

    case 'summary': {
      const file = getArg('--file');
      if (!file) {
        console.error('Usage: node lib/logging/index.js summary --file <path>');
        process.exit(1);
      }
      process.stdout.write(renderSummary(file));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: append, last-iteration, render, summary');
      process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
```

- [ ] **Step 2: Smoke-test the CLI**

Run: `node lib/logging/index.js 2>&1`
Expected: `Unknown command: undefined` and exit 1.

Run: `node lib/logging/index.js last-iteration --file /tmp/does-not-exist.jsonl`
Expected: `{"iteration":0}` on stdout, exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/logging/index.js
git commit -m "feat(logging): add CLI entry (append, last-iteration, render, summary)"
```

---

### Task 5: Bash Integration Test for Logging CLI

**Files:**
- Create: `tests/test-logging.sh`
- Modify: `tests/test-all.sh`

- [ ] **Step 1: Write the integration tests**

```bash
#!/usr/bin/env bash
# tests/test-logging.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTS_PASSED=0
TESTS_FAILED=0

pass() { echo "  ✓ $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo "  ✗ $1"; echo "    $2"; TESTS_FAILED=$((TESTS_FAILED + 1)); }

tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

echo "=== Logging CLI integration tests ==="

log_file="$tmpdir/progress.jsonl"

# Test 1: append run_start
out=$(node "$SCRIPT_DIR/lib/logging/index.js" append \
  --file "$log_file" \
  --event '{"event":"run_start","prdFile":"a.md","maxIterations":5}')
if echo "$out" | grep -q '"ok":true'; then pass "append run_start returns ok"
else fail "append run_start returns ok" "got: $out"; fi

# Test 2: file contains one line
line_count=$(wc -l < "$log_file" | tr -d ' ')
if [ "$line_count" = "1" ]; then pass "file has one line"
else fail "file has one line" "got $line_count"; fi

# Test 3: appended line auto-fills ts
if grep -q '"ts":"20' "$log_file"; then pass "appended event has ts"
else fail "appended event has ts" "contents: $(cat "$log_file")"; fi

# Test 4: append iteration_end x2 and query last-iteration
node "$SCRIPT_DIR/lib/logging/index.js" append --file "$log_file" \
  --event '{"event":"iteration_end","iteration":1,"taskId":"t","criteriaPassCount":1,"criteriaTotalCount":2}' > /dev/null
node "$SCRIPT_DIR/lib/logging/index.js" append --file "$log_file" \
  --event '{"event":"iteration_end","iteration":2,"taskId":"t","criteriaPassCount":2,"criteriaTotalCount":2}' > /dev/null
last=$(node "$SCRIPT_DIR/lib/logging/index.js" last-iteration --file "$log_file")
if [ "$last" = '{"iteration":2}' ]; then pass "last-iteration returns latest iteration_end"
else fail "last-iteration returns latest iteration_end" "got: $last"; fi

# Test 5: last-iteration on empty file returns 0
missing_file="$tmpdir/nope.jsonl"
last=$(node "$SCRIPT_DIR/lib/logging/index.js" last-iteration --file "$missing_file")
if [ "$last" = '{"iteration":0}' ]; then pass "last-iteration on missing file returns 0"
else fail "last-iteration on missing file returns 0" "got: $last"; fi

# Test 6: render pretty contains header
out=$(node "$SCRIPT_DIR/lib/logging/index.js" render --file "$log_file")
if echo "$out" | grep -q "RALPH LOOP PROGRESS LOG"; then pass "render pretty includes header"
else fail "render pretty includes header" "got: $out"; fi

# Test 7: render json outputs raw JSONL
out=$(node "$SCRIPT_DIR/lib/logging/index.js" render --file "$log_file" --format json)
if [ "$out" = "$(cat "$log_file")" ]; then pass "render --format json outputs raw JSONL"
else fail "render --format json outputs raw JSONL" "mismatch"; fi

# Test 8: append rejects invalid event
if node "$SCRIPT_DIR/lib/logging/index.js" append --file "$log_file" --event '{"event":"bogus"}' 2>/dev/null; then
  fail "append rejects unknown event" "exit code 0"
else
  pass "append rejects unknown event"
fi

echo ""
echo "Passed: $TESTS_PASSED, Failed: $TESTS_FAILED"
[ "$TESTS_FAILED" = "0" ]
```

Make it executable: `chmod +x tests/test-logging.sh`

- [ ] **Step 2: Register with test-all.sh**

Locate the test registration block in `tests/test-all.sh` (it lists each `test-*.sh` file) and add `test-logging.sh` alongside the others in the same style as the existing entries. If it currently looks like:

```bash
for suite in test-conversion.sh test-validation.sh test-resume.sh test-help.sh \
             test-analysis.sh test-completion-detection.sh test-criteria.sh \
             test-dry-run.sh test-github.sh; do
```

Change it to:

```bash
for suite in test-conversion.sh test-validation.sh test-resume.sh test-help.sh \
             test-analysis.sh test-completion-detection.sh test-criteria.sh \
             test-dry-run.sh test-github.sh test-logging.sh; do
```

(Match the actual pattern in the file — whichever loop, array, or switch registers the suites.)

- [ ] **Step 3: Run the new suite**

Run: `./tests/test-logging.sh`
Expected: `Passed: 8, Failed: 0` and exit 0.

- [ ] **Step 4: Commit**

```bash
git add tests/test-logging.sh tests/test-all.sh
git commit -m "test(logging): add bash integration tests for logging CLI"
```

---

### Task 6: Swap `initialize_progress_file` to JSONL

**Files:**
- Modify: `ralph-loop` (function `initialize_progress_file` starting near line 860, and the `PROGRESS_FILE=""` global near line 23)

- [ ] **Step 1: Add an `LOG_FILE` global alongside `PROGRESS_FILE`**

Near line 23 of `ralph-loop`, after `PROGRESS_FILE=""` add:

```bash
LOG_FILE=""
```

Rationale: we keep `PROGRESS_FILE` variable wired up only as a legacy pointer for the migration check. `LOG_FILE` is the new canonical path and points at `progress.jsonl`.

- [ ] **Step 2: Rewrite `initialize_progress_file` to write JSONL**

Replace the entire `initialize_progress_file` function (the one currently creating `progress.txt` with box-drawing characters) with:

```bash
initialize_progress_file() {
    local prd_dir
    prd_dir=$(dirname "$JSON_FILE")
    local jsonl_file="${prd_dir}/progress.jsonl"
    local legacy_file="${prd_dir}/progress.txt"

    # --dry-run must not write any files or prompt the user
    if [ "$DRY_RUN" = true ]; then
        LOG_FILE="$jsonl_file"
        PROGRESS_FILE="$jsonl_file"
        return 0
    fi

    # Migration warning: legacy progress.txt but no progress.jsonl
    if [ -f "$legacy_file" ] && [ ! -f "$jsonl_file" ] && [ "$RESUME" = true ]; then
        echo -e "${YELLOW}[WARN] Found legacy progress.txt but no progress.jsonl.${NC}"
        echo -e "${YELLOW}       Starting fresh logging. Archiving the old file.${NC}"
        local ts
        ts=$(date +%Y%m%d-%H%M%S)
        mv "$legacy_file" "${prd_dir}/progress-${ts}.txt"
    fi

    # Existing JSONL with iterations + no --resume -> prompt user
    if [ -f "$jsonl_file" ] && [ "$RESUME" = false ]; then
        local has_iterations
        has_iterations=$(node "$SCRIPT_DIR/lib/logging/index.js" last-iteration --file "$jsonl_file" | \
            jq -r '.iteration')
        if [ "$has_iterations" != "0" ]; then
            prompt_resume_or_fresh_jsonl "$jsonl_file"
        fi
    fi

    # Fresh start: archive existing JSONL
    if [ -f "$jsonl_file" ] && [ "$RESUME" = false ]; then
        local ts
        ts=$(date +%Y%m%d-%H%M%S)
        mv "$jsonl_file" "${prd_dir}/progress-${ts}.jsonl"
        if [ "$VERBOSE" = true ]; then
            echo -e "${BLUE}[INFO] Archived existing log to: progress-${ts}.jsonl${NC}"
        fi
    fi

    LOG_FILE="$jsonl_file"
    PROGRESS_FILE="$jsonl_file"

    if [ "$RESUME" = false ]; then
        emit_event "$(jq -cn \
            --arg event "run_start" \
            --arg prdFile "$JSON_FILE" \
            --argjson maxIterations "$MAX_ITERATIONS" \
            '{event:$event, prdFile:$prdFile, maxIterations:$maxIterations}')"
        if [ "$VERBOSE" = true ]; then
            echo -e "${GREEN}✓${NC} Created log file: $LOG_FILE"
        fi
    else
        local last_iteration
        last_iteration=$(node "$SCRIPT_DIR/lib/logging/index.js" last-iteration --file "$LOG_FILE" | \
            jq -r '.iteration')
        emit_event "$(jq -cn \
            --arg event "run_resume" \
            --arg prdFile "$JSON_FILE" \
            --argjson lastIteration "${last_iteration:-0}" \
            --argjson maxIterations "$MAX_ITERATIONS" \
            '{event:$event, prdFile:$prdFile, lastIteration:$lastIteration, maxIterations:$maxIterations}')"

        local completed_count
        local total_count
        completed_count=$(jq '[.tasks[] | select(.passes == true)] | length' "$JSON_FILE")
        total_count=$(jq '.tasks | length' "$JSON_FILE")

        echo ""
        echo -e "${GREEN}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║                         RESUMING RALPH LOOP                                ║${NC}"
        echo -e "${GREEN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo "Resume Summary:"
        echo "  Last completed iteration: ${last_iteration:-0}"
        echo "  Tasks completed: $completed_count / $total_count"
        echo "  Continuing from iteration: $(( ${last_iteration:-0} + 1 ))"
        echo ""
    fi
}

# Emit a single JSONL event (auto-fills ts). Non-fatal on failure.
emit_event() {
    local event_json="$1"
    if [ -z "$LOG_FILE" ] || [ "$DRY_RUN" = true ]; then
        return 0
    fi
    node "$SCRIPT_DIR/lib/logging/index.js" append \
        --file "$LOG_FILE" \
        --event "$event_json" > /dev/null 2>&1 || {
            echo -e "${YELLOW}[WARN] Failed to write log event${NC}" >&2
        }
}

prompt_resume_or_fresh_jsonl() {
    local jsonl_file="$1"
    echo ""
    echo -e "${YELLOW}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║                   EXISTING PROGRESS DETECTED                               ║${NC}"
    echo -e "${YELLOW}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "An existing log file was found at:"
    echo "  $jsonl_file"
    echo ""
    local last_iteration
    last_iteration=$(node "$SCRIPT_DIR/lib/logging/index.js" last-iteration --file "$jsonl_file" | \
        jq -r '.iteration')
    local completed_count
    local total_count
    completed_count=$(jq '[.tasks[] | select(.passes == true)] | length' "$JSON_FILE")
    total_count=$(jq '.tasks | length' "$JSON_FILE")
    echo "Last completed iteration: ${last_iteration:-0}"
    echo "Tasks completed: $completed_count / $total_count"
    echo ""
    echo "What would you like to do?"
    echo "  [R] Resume from where you left off (continue from iteration $(( ${last_iteration:-0} + 1 )))"
    echo "  [F] Fresh start (archive existing progress and start from iteration 1)"
    echo ""
    read -p "Enter choice (R/F): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Rr]$ ]]; then
        RESUME=true
        echo -e "${GREEN}Resuming from iteration $(( ${last_iteration:-0} + 1 ))${NC}"
    elif [[ $REPLY =~ ^[Ff]$ ]]; then
        RESUME=false
        echo -e "${BLUE}Starting fresh run${NC}"
    else
        error_exit "Invalid choice. Please enter R or F." "Press R to resume or F to start fresh."
    fi
}
```

Delete the old `prompt_resume_or_fresh` function (the one that reads `progress.txt`) — it is superseded by `prompt_resume_or_fresh_jsonl`.

- [ ] **Step 3: Sanity-check with --dry-run**

Run:
```bash
cat > /tmp/phase3-smoke.md << 'EOF'
# Test PRD
## Task: Smoke test
**Category**: Test
**Priority**: 1
### Acceptance Criteria
- Some check
EOF
./ralph-loop /tmp/phase3-smoke.md --dry-run
```
Expected: prompt preview prints, no `progress.jsonl` is created in `/tmp/`.

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat(logging): initialize progress.jsonl + emit run_start/run_resume"
```

---

### Task 7: Replace `get_last_iteration` with JSONL Reader

**Files:**
- Modify: `ralph-loop` (function `get_last_iteration` starting near line 799)

- [ ] **Step 1: Replace the body**

Replace the current function:

```bash
get_last_iteration() {
    local progress_file="$1"

    if [ ! -f "$progress_file" ]; then
        echo "0"
        return
    fi

    local last_iteration=$(grep -o "ITERATION [0-9]\+/" "$progress_file" | tail -1 | grep -o "[0-9]\+" || echo "")

    if [ -z "$last_iteration" ]; then
        echo "0"
    else
        echo "$last_iteration"
    fi
}
```

with:

```bash
get_last_iteration() {
    local log_file="$1"
    if [ ! -f "$log_file" ]; then
        echo "0"
        return
    fi
    node "$SCRIPT_DIR/lib/logging/index.js" last-iteration --file "$log_file" \
        | jq -r '.iteration // 0'
}
```

- [ ] **Step 2: Verify by running test-resume.sh in dry mode**

Run: `bash -n ralph-loop`
Expected: no syntax errors.

Run: `./tests/test-resume.sh 2>&1 | tail -10` (if any assertion fails, note it — we fix those assertions in Task 13).

- [ ] **Step 3: Commit**

```bash
git add ralph-loop
git commit -m "feat(logging): read last iteration from progress.jsonl"
```

---

### Task 8: Emit `iteration_start` and `api_call` Events

**Files:**
- Modify: `ralph-loop` (inside `run_ralph_loop`, around line 1389 where `log_iteration` is called, and around line 1522 where `api_duration` is computed)

- [ ] **Step 1: Replace the `log_iteration` call with `emit_event` for `iteration_start`**

Find the call:

```bash
        # Log iteration start
        log_iteration "$iteration" "$next_task_id" "$task_title"
```

Replace it with:

```bash
        emit_event "$(jq -cn \
            --arg event "iteration_start" \
            --argjson iteration "$iteration" \
            --arg taskId "$next_task_id" \
            --arg taskTitle "$task_title" \
            '{event:$event, iteration:$iteration, taskId:$taskId, taskTitle:$taskTitle}')"
```

- [ ] **Step 2: Emit `api_call` after Claude returns**

Locate the block that sets `api_duration`:

```bash
        local api_end_time=$(date +%s)
        local api_duration=$((api_end_time - api_start_time))

        rm -f "$prompt_file"
```

Append, immediately after `local api_duration=...`:

```bash
        # Best-effort token extraction from Claude CLI output
        local tokens_in=""
        local tokens_out=""
        tokens_in=$(echo "$claude_output" | grep -oE '"input_tokens":[[:space:]]*[0-9]+' | head -1 | grep -oE '[0-9]+' || true)
        tokens_out=$(echo "$claude_output" | grep -oE '"output_tokens":[[:space:]]*[0-9]+' | head -1 | grep -oE '[0-9]+' || true)

        local api_event
        api_event=$(jq -cn \
            --arg event "api_call" \
            --argjson iteration "$iteration" \
            --arg taskId "$next_task_id" \
            --argjson durationSeconds "$api_duration" \
            --arg tokensIn "${tokens_in:-}" \
            --arg tokensOut "${tokens_out:-}" \
            '{event:$event, iteration:$iteration, taskId:$taskId, durationSeconds:$durationSeconds}
             + (if $tokensIn != "" then {tokensIn:($tokensIn|tonumber)} else {} end)
             + (if $tokensOut != "" then {tokensOut:($tokensOut|tonumber)} else {} end)')
        emit_event "$api_event"
```

- [ ] **Step 3: Smoke-test by running the tool with `--dry-run` and then inspecting the JSONL**

Since `--dry-run` short-circuits before Claude is called, we test the events indirectly via `./tests/test-logging.sh` which already covers the append path. The full integration will be exercised in Task 14.

Run: `bash -n ralph-loop`
Expected: no syntax errors.

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat(logging): emit iteration_start and api_call events"
```

---

### Task 9: Emit `criterion_result` and `iteration_end` Events

**Files:**
- Modify: `ralph-loop` (inside `run_ralph_loop`, around lines 1596–1662 where verify results are processed)

- [ ] **Step 1: Emit one `criterion_result` per item after verification**

Find the block that begins:

```bash
        if [ "$verify_exit" -eq 0 ]; then
            # All criteria passed — mark task complete
```

Immediately before that `if`, add:

```bash
        # Emit criterion_result events for each criterion in this iteration
        local rc_idx=0
        local rc_total
        rc_total=$(echo "$verify_result" | jq '.results | length' 2>/dev/null || echo "0")
        while [ "$rc_idx" -lt "$rc_total" ]; do
            local rc_passed
            local rc_error
            local rc_skipped
            rc_passed=$(echo "$verify_result" | jq ".results[$rc_idx].passed")
            rc_error=$(echo "$verify_result" | jq -r ".results[$rc_idx].error // empty")
            rc_skipped=$(echo "$verify_result" | jq -r ".results[$rc_idx].skipped // false")
            local rc_event
            rc_event=$(jq -cn \
                --arg event "criterion_result" \
                --argjson iteration "$iteration" \
                --arg taskId "$next_task_id" \
                --argjson criterionIndex "$rc_idx" \
                --argjson passed "$rc_passed" \
                --arg error "$rc_error" \
                --argjson skipped "$rc_skipped" \
                '{event:$event, iteration:$iteration, taskId:$taskId, criterionIndex:$criterionIndex, passed:$passed}
                 + (if $error != "" then {error:$error} else {} end)
                 + (if $skipped then {skipped:true} else {} end)')
            emit_event "$rc_event"
            rc_idx=$((rc_idx + 1))
        done
```

- [ ] **Step 2: Emit `iteration_end` after both branches**

Find the line just before `# Check if ALL tasks are now complete` (around line 1689), inside `run_ralph_loop`. Add:

```bash
        # Emit iteration_end summary
        local pass_count_end
        local total_count_end
        pass_count_end=$(echo "$verify_result" | jq '[.results[] | select(.passed == true)] | length' 2>/dev/null || echo 0)
        total_count_end=$(echo "$verify_result" | jq '.results | length' 2>/dev/null || echo 0)
        emit_event "$(jq -cn \
            --arg event "iteration_end" \
            --argjson iteration "$iteration" \
            --arg taskId "$next_task_id" \
            --argjson criteriaPassCount "$pass_count_end" \
            --argjson criteriaTotalCount "$total_count_end" \
            '{event:$event, iteration:$iteration, taskId:$taskId, criteriaPassCount:$criteriaPassCount, criteriaTotalCount:$criteriaTotalCount}')"
```

- [ ] **Step 3: Remove the now-redundant `log_iteration_result` call bodies**

Find the two calls to `log_iteration_result` (one in the pass branch, one in the fail branch). Delete them — the `iteration_end` event carries the equivalent information.

Also remove the helper functions `log_iteration`, `log_iteration_result`, `log_learnings` definitions themselves (they are no longer called anywhere).

- [ ] **Step 4: Verify syntax**

Run: `bash -n ralph-loop`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add ralph-loop
git commit -m "feat(logging): emit criterion_result and iteration_end events"
```

---

### Task 10: Emit `task_complete` and `thrash_warning` Events

**Files:**
- Modify: `ralph-loop` (inside `run_ralph_loop`)

- [ ] **Step 1: Emit `task_complete` when a task passes**

Inside the `if [ "$verify_exit" -eq 0 ]; then` branch, after the task JSON is updated and BEFORE the existing `post_iteration_comment` call, add:

```bash
            local iterations_used
            iterations_used=$(jq -r ".tasks[$task_index].attempts // 1" "$JSON_FILE")
            emit_event "$(jq -cn \
                --arg event "task_complete" \
                --arg taskId "$next_task_id" \
                --argjson iterationsUsed "$iterations_used" \
                '{event:$event, taskId:$taskId, iterationsUsed:$iterationsUsed}')"
```

- [ ] **Step 2: Emit `thrash_warning` when `check_thrash` fires**

Locate the thrash block (around line 1669):

```bash
            local thrash_criterion
            if thrash_criterion=$(check_thrash "$next_task_id"); then
                echo ""
                echo -e "${YELLOW}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
```

Insert right after `if thrash_criterion=$(check_thrash "$next_task_id"); then`:

```bash
                local thrash_failures
                thrash_failures=$(jq -r ".tasks[$task_index].criteriaResults[$thrash_criterion].attempts // 0" "$JSON_FILE")
                emit_event "$(jq -cn \
                    --arg event "thrash_warning" \
                    --arg taskId "$next_task_id" \
                    --argjson criterionIndex "$thrash_criterion" \
                    --argjson consecutiveFailures "$thrash_failures" \
                    '{event:$event, taskId:$taskId, criterionIndex:$criterionIndex, consecutiveFailures:$consecutiveFailures}')"
```

- [ ] **Step 3: Verify syntax**

Run: `bash -n ralph-loop`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat(logging): emit task_complete and thrash_warning events"
```

---

### Task 11: Emit `run_complete` Event with Summary Stats

**Files:**
- Modify: `ralph-loop` (at the end of `run_ralph_loop` — success + failure branches and the old `log_completion` function)

- [ ] **Step 1: Add a counter for GitHub API calls**

Near the top of `ralph-loop` (alongside the other globals such as `MAX_ITERATIONS`), add:

```bash
GITHUB_API_CALLS=0
```

Then, in each place `ensure_task_issue`, `post_iteration_comment`, `close_task_issue`, and `crosscheck_issues` invoke `node .../lib/github/index.js`, bump the counter. Find each call site and add `GITHUB_API_CALLS=$((GITHUB_API_CALLS + 1))` immediately after the `node ... 2>&1 || ...` block. There are four call sites; increment once per site. Example for `ensure_task_issue`:

```bash
    node "$SCRIPT_DIR/lib/github/index.js" create-issue \
        --repo "$TARGET_REPO" \
        --task "$task_json" 2>&1 || { ... }
    GITHUB_API_CALLS=$((GITHUB_API_CALLS + 1))
```

Repeat at the three other `node "$SCRIPT_DIR/lib/github/index.js" ...` call sites.

- [ ] **Step 2: Emit `run_complete` in the success branch**

Locate the success branch in `run_ralph_loop` (around line 1738, after `if [ "$completion_detected" = true ]; then`). Find `log_completion "$((iteration - 1))" true` and replace with:

```bash
        emit_event "$(jq -cn \
            --arg event "run_complete" \
            --argjson success true \
            --argjson totalIterations "$((iteration - 1))" \
            --argjson elapsed "$total_elapsed" \
            --argjson githubApiCalls "$GITHUB_API_CALLS" \
            '{event:$event, success:$success, totalIterations:$totalIterations, elapsed:$elapsed, githubApiCalls:$githubApiCalls}')"
```

- [ ] **Step 3: Emit `run_complete` in the failure branch**

Find `log_completion "$MAX_ITERATIONS" false` and replace with:

```bash
        emit_event "$(jq -cn \
            --arg event "run_complete" \
            --argjson success false \
            --argjson totalIterations "$MAX_ITERATIONS" \
            --argjson elapsed "$total_elapsed" \
            --argjson githubApiCalls "$GITHUB_API_CALLS" \
            '{event:$event, success:$success, totalIterations:$totalIterations, elapsed:$elapsed, githubApiCalls:$githubApiCalls}')"
```

- [ ] **Step 4: Print the run summary from the logging module**

After each `run_complete` emit, add:

```bash
        node "$SCRIPT_DIR/lib/logging/index.js" summary --file "$LOG_FILE" 2>/dev/null || true
```

- [ ] **Step 5: Delete the old `log_completion` function**

It is no longer called. Remove its definition entirely.

- [ ] **Step 6: Verify syntax**

Run: `bash -n ralph-loop`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add ralph-loop
git commit -m "feat(logging): emit run_complete with summary totals and GitHub call count"
```

---

### Task 12: Add `ralph-loop log` Subcommand

**Files:**
- Modify: `ralph-loop` (`parse_arguments`, `main`, and `show_help`)

- [ ] **Step 1: Detect the `log` subcommand in `parse_arguments`**

Add a `SUBCOMMAND=""` global near line 24. Then, at the very beginning of `parse_arguments` (after the `if [ $# -eq 0 ]` check), add:

```bash
    # First positional token "log" activates the log-render subcommand.
    if [ "${1:-}" = "log" ]; then
        SUBCOMMAND="log"
        shift
        # Remaining args: <prd-file> [--format pretty|json]
        while [ $# -gt 0 ]; do
            case "$1" in
                --format)
                    if [ -z "${2:-}" ]; then
                        error_exit "--format requires pretty or json" "Example: ./ralph-loop log my-prd.md --format json"
                    fi
                    LOG_FORMAT="$2"
                    shift 2
                    ;;
                *)
                    if [ -z "$PRD_FILE" ]; then
                        PRD_FILE="$1"
                        shift
                    else
                        error_exit "Unexpected argument: $1" "Usage: ./ralph-loop log <prd-file> [--format pretty|json]"
                    fi
                    ;;
            esac
        done
        if [ -z "$PRD_FILE" ]; then
            error_exit "log subcommand requires <prd-file>" "Usage: ./ralph-loop log <prd-file> [--format pretty|json]"
        fi
        return 0
    fi
```

Also add at top of the file (with other globals):

```bash
SUBCOMMAND=""
LOG_FORMAT="pretty"
```

- [ ] **Step 2: Add a `render_log_command` function**

Add this function anywhere before `main`:

```bash
render_log_command() {
    local prd_dir
    prd_dir=$(dirname "$PRD_FILE")
    local log_file="${prd_dir}/progress.jsonl"

    if [ ! -f "$log_file" ]; then
        echo -e "${YELLOW}No log file found at $log_file${NC}" >&2
        exit 1
    fi

    if [ "$LOG_FORMAT" = "json" ]; then
        node "$SCRIPT_DIR/lib/logging/index.js" render --file "$log_file" --format json
    else
        node "$SCRIPT_DIR/lib/logging/index.js" render --file "$log_file"
    fi
}
```

- [ ] **Step 3: Route from `main`**

At the top of `main` — right after `parse_arguments "$@"` — add:

```bash
    if [ "$SUBCOMMAND" = "log" ]; then
        render_log_command
        exit 0
    fi
```

- [ ] **Step 4: Update `show_help` to document the subcommand and `--format`**

Inside `show_help`, find the "COMMAND-LINE OPTIONS" (or equivalent) section and add a new section:

```bash
╔════════════════════════════════════════════════════════════════════════════╗
║                         LOG SUBCOMMAND                                     ║
╚════════════════════════════════════════════════════════════════════════════╝

  ralph-loop log <prd-file> [--format pretty|json]

    Render the structured progress log for a PRD.
    --format pretty   (default) Box-drawing human-readable output.
    --format json     Raw JSONL, one event per line.
```

- [ ] **Step 5: Integration test for the subcommand**

Add at the bottom of `tests/test-logging.sh`, before the final `exit` line:

```bash
# Test 9: ralph-loop log subcommand (smoke — requires a PRD + log)
prd_md="$tmpdir/sample.md"
cat > "$prd_md" << 'EOF'
# Test
## Task: A
**Category**: T
**Priority**: 1
### Acceptance Criteria
- Check
EOF
prd_json="${prd_md%.md}.json"
jq -n '{tasks:[]}' > "$prd_json"
mv "$log_file" "$tmpdir/progress.jsonl"
out=$("$SCRIPT_DIR/ralph-loop" log "$prd_md" 2>&1 || true)
if echo "$out" | grep -q "RALPH LOOP PROGRESS LOG"; then pass "ralph-loop log renders pretty output"
else fail "ralph-loop log renders pretty output" "got: $out"; fi

out_json=$("$SCRIPT_DIR/ralph-loop" log "$prd_md" --format json 2>&1 || true)
if echo "$out_json" | head -1 | grep -q '"event":"run_start"'; then pass "ralph-loop log --format json emits raw JSONL"
else fail "ralph-loop log --format json emits raw JSONL" "got first line: $(echo "$out_json" | head -1)"; fi
```

Update the earlier pass/fail total expectation — now 10 tests pass instead of 8. Run: `./tests/test-logging.sh`
Expected: `Passed: 10, Failed: 0`.

- [ ] **Step 6: Commit**

```bash
git add ralph-loop tests/test-logging.sh
git commit -m "feat(logging): add ralph-loop log subcommand with --format pretty|json"
```

---

### Task 13: Update Existing Bash Tests That Reference `progress.txt`

**Files:**
- Modify: `tests/test-resume.sh`, `tests/test-progress.sh`, `tests/test-progress-visualization.sh`

- [ ] **Step 1: Survey the assertions**

Run: `grep -n "progress.txt\|ITERATION.*/\|box-drawing\|╔\|╚\|═" tests/test-resume.sh tests/test-progress.sh tests/test-progress-visualization.sh`

For each match, decide:
- Assertions that seed a fake `progress.txt` to test resume behaviour → seed `progress.jsonl` with an `iteration_end` event instead (use `node lib/logging/index.js append --file ... --event '...'`).
- Assertions that grep for box-drawing in `progress.txt` contents → render via `node lib/logging/index.js render --file progress.jsonl` and grep that output.
- Assertions that check the file exists → rename references to `progress.jsonl`.

- [ ] **Step 2: Rewrite `test-resume.sh` fixtures**

Anywhere a test currently does something like:

```bash
cat > "$test_dir/progress.txt" << 'EOF'
... ITERATION 3/15 ...
EOF
```

Replace with:

```bash
node "$SCRIPT_DIR/lib/logging/index.js" append \
    --file "$test_dir/progress.jsonl" \
    --event '{"event":"run_start","prdFile":"fixture.md","maxIterations":15}' > /dev/null
node "$SCRIPT_DIR/lib/logging/index.js" append \
    --file "$test_dir/progress.jsonl" \
    --event '{"event":"iteration_end","iteration":3,"taskId":"task-1","criteriaPassCount":1,"criteriaTotalCount":1}' > /dev/null
```

Update any `grep "ITERATION 3/15" progress.txt` to call `render` first, or directly inspect JSONL with `jq`.

- [ ] **Step 3: Run the full suite**

Run: `./tests/test-all.sh`
Expected: all suites pass.

- [ ] **Step 4: Commit**

```bash
git add tests/test-resume.sh tests/test-progress.sh tests/test-progress-visualization.sh
git commit -m "test: migrate progress.txt fixtures to progress.jsonl"
```

---

### Task 14: Update Help Text and CLAUDE.md Surface References

**Files:**
- Modify: `ralph-loop` (`show_help` — any line mentioning `progress.txt`)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Grep for lingering `progress.txt` mentions**

Run: `grep -n "progress.txt" ralph-loop CLAUDE.md`

- [ ] **Step 2: Update each match**

In `show_help`, replace any occurrence such as:

```
3. REVIEW RESULTS
   Check progress.txt for detailed logs and your-prd.json for final status.
```

with:

```
3. REVIEW RESULTS
   Run `ralph-loop log <prd-file>` to view progress, or read progress.jsonl for raw events.
```

Same for the "Progress Log" line printed at the end of `run_ralph_loop` — change `PROGRESS_FILE` label from `progress.txt` to `progress.jsonl` (the variable itself is already correct after Task 6; only the display text needs a one-word tweak if any copy still says "progress.txt").

In `CLAUDE.md`, update any sentence that says `progress.txt` (e.g., the Architecture section's description of logging) to reference `progress.jsonl` and the `log` subcommand.

- [ ] **Step 3: Verify help**

Run: `./ralph-loop --help | head -80`
Expected: help text mentions `progress.jsonl` and `ralph-loop log`.

- [ ] **Step 4: Commit**

```bash
git add ralph-loop CLAUDE.md
git commit -m "docs(logging): update help and CLAUDE.md for progress.jsonl + log subcommand"
```

---

### Task 15: End-to-End Verification and Cleanup

**Files:** (no code changes; verification only)

- [ ] **Step 1: Run the full bash suite**

Run: `./tests/test-all.sh`
Expected: all suites pass.

- [ ] **Step 2: Run the full Jest suite**

Run: `npx jest --no-coverage --testPathIgnorePatterns='user-model'`
Expected: all tests pass, including the 25+ new tests for `lib/logging/*`.

- [ ] **Step 3: End-to-end dry run on a real PRD**

Run:
```bash
mkdir -p /tmp/ralph-phase3-e2e
cat > /tmp/ralph-phase3-e2e/sample.md << 'EOF'
# Sample
## Task: Say hello
**Category**: Demo
**Priority**: 1
### Acceptance Criteria
- Prints hello `[shell: echo hello]`
EOF
./ralph-loop /tmp/ralph-phase3-e2e/sample.md --dry-run
```
Expected: prompt preview appears; `/tmp/ralph-phase3-e2e/progress.jsonl` is NOT created (dry run).

- [ ] **Step 4: End-to-end log rendering**

Simulate a completed run by appending events directly, then render:

```bash
LOG=/tmp/ralph-phase3-e2e/progress.jsonl
node lib/logging/index.js append --file "$LOG" --event '{"event":"run_start","prdFile":"/tmp/ralph-phase3-e2e/sample.md","maxIterations":5}'
node lib/logging/index.js append --file "$LOG" --event '{"event":"iteration_start","iteration":1,"taskId":"task-1","taskTitle":"Say hello"}'
node lib/logging/index.js append --file "$LOG" --event '{"event":"criterion_result","iteration":1,"taskId":"task-1","criterionIndex":0,"passed":true}'
node lib/logging/index.js append --file "$LOG" --event '{"event":"iteration_end","iteration":1,"taskId":"task-1","criteriaPassCount":1,"criteriaTotalCount":1}'
node lib/logging/index.js append --file "$LOG" --event '{"event":"task_complete","taskId":"task-1","iterationsUsed":1}'
node lib/logging/index.js append --file "$LOG" --event '{"event":"run_complete","success":true,"totalIterations":1,"elapsed":42,"githubApiCalls":0}'

./ralph-loop log /tmp/ralph-phase3-e2e/sample.md
./ralph-loop log /tmp/ralph-phase3-e2e/sample.md --format json
```

Expected:
- Pretty output shows header, iteration block, criterion PASS line, COMPLETION SUCCESSFUL block.
- JSON output shows six lines, each a valid JSON object with `ts` and `event`.

- [ ] **Step 5: Verify migration warning**

```bash
rm -f /tmp/ralph-phase3-e2e/progress.jsonl
touch /tmp/ralph-phase3-e2e/progress.txt
./ralph-loop /tmp/ralph-phase3-e2e/sample.md --resume 2>&1 | head -20
```
Expected: `[WARN] Found legacy progress.txt but no progress.jsonl.` printed to stderr, old file archived.

- [ ] **Step 6: Clean up**

```bash
rm -rf /tmp/ralph-phase3-e2e
```

- [ ] **Step 7: Final commit (if any doc polish emerged)**

If anything needed adjusting during end-to-end runs, fix it and commit:

```bash
git add -A
git commit -m "chore(logging): phase 3 e2e verification fixes"
```

Otherwise, Phase 3 is complete — do not create an empty commit.

---

## Self-Review Checklist (run before marking plan complete)

- [ ] Every event in the spec's "Event types" list has an emit site in `ralph-loop` (Tasks 6–11).
- [ ] `lib/logging/` file set matches spec: `index.js`, `jsonl.js`, `renderer.js` plus the schema helper (`events.js`).
- [ ] `ralph-loop log <prd-file> [--format pretty|json]` works (Task 12).
- [ ] Migration warning fires when only `progress.txt` exists on `--resume` (Task 6).
- [ ] Resume reads `iteration_end` from JSONL (Task 7) and emits a `run_resume` event (Task 6).
- [ ] Cost-tracking totals appear in summary: API duration, tokens (best-effort), GitHub API calls (Tasks 8, 11, renderer).
- [ ] Function names are consistent across tasks: `emit_event`, `get_last_iteration`, `appendEvent`, `readEvents`, `lastEventOfType`, `renderJsonl`, `renderSummary`, `validateEvent`.
- [ ] No placeholders, no "TBD", no "similar to Task N".

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-17-phase3-structured-logging.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
