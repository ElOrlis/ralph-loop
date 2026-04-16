# Phase 1 — Executable Criteria Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `<promise>COMPLETE</promise>` protocol with machine-verifiable acceptance criteria that Ralph executes and evaluates independently — Claude no longer decides pass/fail.

**Architecture:** New Node.js modules under `lib/criteria/` and `lib/prompt/` are called from the Bash orchestrator via `node lib/<module>/index.js <command> <args>`. Each module has a CLI entry point (`index.js`) that parses args, calls the logic, writes JSON to stdout, and exits 0/1. The Bash script gains `--dry-run` and `--no-github` flags (Phase 0 prerequisites), then swaps its hardcoded prompt and completion detection with calls to these modules.

**Tech Stack:** Bash 4.0+, Node.js (no external deps beyond what's in the repo), Jest for JS tests, existing Bash test harness pattern for integration tests.

---

## File Structure

```
lib/
  prompt/
    index.js            # CLI entry: parses args, calls builder, prints JSON to stdout
    builder.js          # Builds Claude prompts with task details and verification commands
    builder.test.js     # Jest tests for builder
  criteria/
    index.js            # CLI entry: parses args, routes to runner/schema, prints JSON to stdout
    schema.js           # Validates and normalizes criteria (string -> typed object)
    schema.test.js      # Jest tests for schema
    runner.js           # Executes typed criteria (shell, http, file-exists, grep)
    runner.test.js      # Jest tests for runner
tests/
  test-dry-run.sh       # Bash integration tests for --dry-run flag
  test-criteria.sh      # Bash integration tests for criteria verification flow
```

**Modified files:**
- `ralph-loop` — new flags, prompt builder integration, criteria verification integration, remove `<promise>COMPLETE</promise>` detection
- `package.json` — update Jest config to find tests in `lib/`
- `tests/test-all.sh` — add new test suites

---

### Task 1: Update Jest Config for `lib/` Tests

**Files:**
- Modify: `package.json:24-27`

- [ ] **Step 1: Update Jest config in package.json**

Add `testMatch` so Jest finds tests in both `tests/` and `lib/`:

```json
"jest": {
  "testEnvironment": "node",
  "testMatch": [
    "**/tests/**/*.test.js",
    "**/lib/**/*.test.js"
  ]
}
```

- [ ] **Step 2: Verify Jest config works**

Run: `npx jest --listTests`
Expected: lists existing `tests/user-model.test.js` (no new test files yet, but config is valid)

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: update Jest config to discover tests in lib/"
```

---

### Task 2: Criteria Schema — Normalize Legacy Strings

**Files:**
- Create: `lib/criteria/schema.js`
- Create: `lib/criteria/schema.test.js`

- [ ] **Step 1: Write failing tests for legacy string normalization**

```js
// lib/criteria/schema.test.js
const { normalizeCriteria } = require('./schema');

describe('normalizeCriteria', () => {
  test('converts plain string to manual criterion', () => {
    const result = normalizeCriteria(['Users can log in']);
    expect(result).toEqual([
      { text: 'Users can log in', type: 'manual', confidence: 'low' }
    ]);
  });

  test('passes through typed object unchanged', () => {
    const input = [{ text: 'Tests pass', type: 'shell', command: 'npm test', expectExitCode: 0 }];
    const result = normalizeCriteria(input);
    expect(result).toEqual(input);
  });

  test('handles mixed array of strings and objects', () => {
    const input = [
      'Users report UI feels responsive',
      { text: 'Tests pass', type: 'shell', command: 'npm test', expectExitCode: 0 }
    ];
    const result = normalizeCriteria(input);
    expect(result).toEqual([
      { text: 'Users report UI feels responsive', type: 'manual', confidence: 'low' },
      { text: 'Tests pass', type: 'shell', command: 'npm test', expectExitCode: 0 }
    ]);
  });

  test('returns empty array for empty input', () => {
    expect(normalizeCriteria([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/criteria/schema.test.js --verbose`
Expected: FAIL — `Cannot find module './schema'`

- [ ] **Step 3: Implement normalizeCriteria**

```js
// lib/criteria/schema.js
'use strict';

const VALID_TYPES = ['shell', 'http', 'file-exists', 'grep', 'manual'];

function normalizeCriterion(criterion) {
  if (typeof criterion === 'string') {
    return { text: criterion, type: 'manual', confidence: 'low' };
  }
  return criterion;
}

function normalizeCriteria(criteria) {
  return criteria.map(normalizeCriterion);
}

module.exports = { normalizeCriteria, VALID_TYPES };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/criteria/schema.test.js --verbose`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/criteria/schema.js lib/criteria/schema.test.js
git commit -m "feat: add criteria schema with legacy string normalization"
```

---

### Task 3: Criteria Schema — Validate Typed Objects

**Files:**
- Modify: `lib/criteria/schema.js`
- Modify: `lib/criteria/schema.test.js`

- [ ] **Step 1: Write failing tests for validation**

Append to `lib/criteria/schema.test.js`:

```js
const { validateCriterion } = require('./schema');

describe('validateCriterion', () => {
  test('valid shell criterion passes', () => {
    const c = { text: 'Tests pass', type: 'shell', command: 'npm test', expectExitCode: 0 };
    expect(validateCriterion(c)).toEqual({ valid: true });
  });

  test('shell criterion without command fails', () => {
    const c = { text: 'Tests pass', type: 'shell', expectExitCode: 0 };
    const result = validateCriterion(c);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/command/i);
  });

  test('valid http criterion passes', () => {
    const c = { text: 'Returns 200', type: 'http', url: 'http://localhost:3000', expectStatus: 200 };
    expect(validateCriterion(c)).toEqual({ valid: true });
  });

  test('http criterion without url fails', () => {
    const c = { text: 'Returns 200', type: 'http', expectStatus: 200 };
    const result = validateCriterion(c);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/url/i);
  });

  test('valid file-exists criterion passes', () => {
    const c = { text: 'Config exists', type: 'file-exists', path: './config.json' };
    expect(validateCriterion(c)).toEqual({ valid: true });
  });

  test('file-exists without path fails', () => {
    const c = { text: 'Config exists', type: 'file-exists' };
    const result = validateCriterion(c);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/path/i);
  });

  test('valid grep criterion passes', () => {
    const c = { text: 'Route registered', type: 'grep', pattern: 'app\\.use', path: './src/index.js' };
    expect(validateCriterion(c)).toEqual({ valid: true });
  });

  test('grep without pattern fails', () => {
    const c = { text: 'Route registered', type: 'grep', path: './src/index.js' };
    const result = validateCriterion(c);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/pattern/i);
  });

  test('grep without path fails', () => {
    const c = { text: 'Route registered', type: 'grep', pattern: 'app\\.use' };
    const result = validateCriterion(c);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/path/i);
  });

  test('manual criterion always passes', () => {
    const c = { text: 'Looks good', type: 'manual', confidence: 'low' };
    expect(validateCriterion(c)).toEqual({ valid: true });
  });

  test('unknown type fails', () => {
    const c = { text: 'Something', type: 'unknown' };
    const result = validateCriterion(c);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/type/i);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx jest lib/criteria/schema.test.js --verbose`
Expected: New `validateCriterion` tests FAIL — function not exported

- [ ] **Step 3: Implement validateCriterion**

Add to `lib/criteria/schema.js` before `module.exports`:

```js
function validateCriterion(criterion) {
  if (!VALID_TYPES.includes(criterion.type)) {
    return { valid: false, error: `Invalid type "${criterion.type}". Must be one of: ${VALID_TYPES.join(', ')}` };
  }

  switch (criterion.type) {
    case 'shell':
      if (!criterion.command) return { valid: false, error: 'Shell criterion requires "command" field' };
      break;
    case 'http':
      if (!criterion.url) return { valid: false, error: 'HTTP criterion requires "url" field' };
      break;
    case 'file-exists':
      if (!criterion.path) return { valid: false, error: 'File-exists criterion requires "path" field' };
      break;
    case 'grep':
      if (!criterion.pattern) return { valid: false, error: 'Grep criterion requires "pattern" field' };
      if (!criterion.path) return { valid: false, error: 'Grep criterion requires "path" field' };
      break;
    case 'manual':
      break;
  }

  return { valid: true };
}
```

Update exports:

```js
module.exports = { normalizeCriteria, validateCriterion, VALID_TYPES };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/criteria/schema.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/criteria/schema.js lib/criteria/schema.test.js
git commit -m "feat: add criteria validation for all typed criterion formats"
```

---

### Task 4: Criteria Schema — Parse Markdown Inline Type Hints

**Files:**
- Modify: `lib/criteria/schema.js`
- Modify: `lib/criteria/schema.test.js`

The markdown parser in `ralph-loop` extracts criteria as plain strings. Some strings contain inline type hints like `` `[shell: npm test]` ``. This function parses those hints into typed objects.

- [ ] **Step 1: Write failing tests for markdown hint parsing**

Append to `lib/criteria/schema.test.js`:

```js
const { parseCriterionString } = require('./schema');

describe('parseCriterionString', () => {
  test('parses shell hint', () => {
    const result = parseCriterionString('Unit tests pass `[shell: npm test -- auth.test.js]`');
    expect(result).toEqual({
      text: 'Unit tests pass',
      type: 'shell',
      command: 'npm test -- auth.test.js',
      expectExitCode: 0
    });
  });

  test('parses http hint with method and status', () => {
    const result = parseCriterionString('Login returns 200 `[http: POST http://localhost:3000/auth/login -> 200]`');
    expect(result).toEqual({
      text: 'Login returns 200',
      type: 'http',
      url: 'http://localhost:3000/auth/login',
      method: 'POST',
      expectStatus: 200
    });
  });

  test('parses http hint with GET (default)', () => {
    const result = parseCriterionString('Health check `[http: http://localhost:3000/health -> 200]`');
    expect(result).toEqual({
      text: 'Health check',
      type: 'http',
      url: 'http://localhost:3000/health',
      method: 'GET',
      expectStatus: 200
    });
  });

  test('parses file-exists hint', () => {
    const result = parseCriterionString('Config file exists `[file-exists: ./config/auth.json]`');
    expect(result).toEqual({
      text: 'Config file exists',
      type: 'file-exists',
      path: './config/auth.json'
    });
  });

  test('parses grep hint', () => {
    const result = parseCriterionString('Route is registered `[grep: "app\\.use.*auth" in ./src/routes/index.js]`');
    expect(result).toEqual({
      text: 'Route is registered',
      type: 'grep',
      pattern: 'app\\.use.*auth',
      path: './src/routes/index.js'
    });
  });

  test('string without hint becomes manual', () => {
    const result = parseCriterionString('Users report the UI feels responsive');
    expect(result).toEqual({
      text: 'Users report the UI feels responsive',
      type: 'manual',
      confidence: 'low'
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/criteria/schema.test.js --verbose --testNamePattern="parseCriterionString"`
Expected: FAIL — function not exported

- [ ] **Step 3: Implement parseCriterionString**

Add to `lib/criteria/schema.js`:

```js
function parseCriterionString(str) {
  const hintMatch = str.match(/^(.*?)\s*`\[(\w[\w-]*):\s*(.*?)\]`\s*$/);
  if (!hintMatch) {
    return { text: str.trim(), type: 'manual', confidence: 'low' };
  }

  const text = hintMatch[1].trim();
  const type = hintMatch[2];
  const body = hintMatch[3].trim();

  switch (type) {
    case 'shell':
      return { text, type: 'shell', command: body, expectExitCode: 0 };

    case 'http': {
      const httpMatch = body.match(/^(?:(GET|POST|PUT|DELETE|PATCH)\s+)?(\S+)\s*->\s*(\d+)$/);
      if (!httpMatch) return { text, type: 'manual', confidence: 'low' };
      return {
        text,
        type: 'http',
        url: httpMatch[2],
        method: httpMatch[1] || 'GET',
        expectStatus: parseInt(httpMatch[3], 10)
      };
    }

    case 'file-exists':
      return { text, type: 'file-exists', path: body };

    case 'grep': {
      const grepMatch = body.match(/^"(.*?)"\s+in\s+(\S+)$/);
      if (!grepMatch) return { text, type: 'manual', confidence: 'low' };
      return { text, type: 'grep', pattern: grepMatch[1], path: grepMatch[2] };
    }

    default:
      return { text, type: 'manual', confidence: 'low' };
  }
}
```

Update `normalizeCriterion` to use `parseCriterionString`:

```js
function normalizeCriterion(criterion) {
  if (typeof criterion === 'string') {
    return parseCriterionString(criterion);
  }
  return criterion;
}
```

Update exports:

```js
module.exports = { normalizeCriteria, validateCriterion, parseCriterionString, VALID_TYPES };
```

- [ ] **Step 4: Run all schema tests**

Run: `npx jest lib/criteria/schema.test.js --verbose`
Expected: All tests PASS (including earlier normalization tests — verify that `normalizeCriteria(['Unit tests pass \`[shell: npm test]\`'])` now returns a shell object instead of manual)

- [ ] **Step 5: Update the normalization test for hint-aware behavior**

The test from Task 2 that says `'Users can log in'` becomes manual is still correct (no hint). But add a test to confirm hint-bearing strings are parsed:

Append to the `normalizeCriteria` describe block in `lib/criteria/schema.test.js`:

```js
  test('normalizes string with inline hint to typed object', () => {
    const result = normalizeCriteria(['Tests pass `[shell: npm test]`']);
    expect(result).toEqual([
      { text: 'Tests pass', type: 'shell', command: 'npm test', expectExitCode: 0 }
    ]);
  });
```

Run: `npx jest lib/criteria/schema.test.js --verbose`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add lib/criteria/schema.js lib/criteria/schema.test.js
git commit -m "feat: parse markdown inline type hints into typed criteria"
```

---

### Task 5: Criteria Runner — Shell and File-Exists Execution

**Files:**
- Create: `lib/criteria/runner.js`
- Create: `lib/criteria/runner.test.js`

- [ ] **Step 1: Write failing tests for shell and file-exists runners**

```js
// lib/criteria/runner.test.js
const { runCriterion } = require('./runner');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('runCriterion', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('shell type', () => {
    test('passes when command exits 0', async () => {
      const result = await runCriterion({ type: 'shell', command: 'true', expectExitCode: 0 });
      expect(result.passed).toBe(true);
    });

    test('fails when command exits non-zero', async () => {
      const result = await runCriterion({ type: 'shell', command: 'false', expectExitCode: 0 });
      expect(result.passed).toBe(false);
      expect(result.error).toMatch(/exit code/i);
    });

    test('passes when exit code matches non-zero expectation', async () => {
      const result = await runCriterion({ type: 'shell', command: 'false', expectExitCode: 1 });
      expect(result.passed).toBe(true);
    });
  });

  describe('file-exists type', () => {
    test('passes when file exists', async () => {
      const filePath = path.join(tmpDir, 'exists.txt');
      fs.writeFileSync(filePath, 'hello');
      const result = await runCriterion({ type: 'file-exists', path: filePath });
      expect(result.passed).toBe(true);
    });

    test('fails when file does not exist', async () => {
      const result = await runCriterion({ type: 'file-exists', path: path.join(tmpDir, 'nope.txt') });
      expect(result.passed).toBe(false);
      expect(result.error).toMatch(/not found|does not exist/i);
    });
  });

  describe('manual type', () => {
    test('returns skipped', async () => {
      const result = await runCriterion({ type: 'manual', text: 'Looks good' });
      expect(result.passed).toBe(null);
      expect(result.skipped).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/criteria/runner.test.js --verbose`
Expected: FAIL — `Cannot find module './runner'`

- [ ] **Step 3: Implement runCriterion for shell, file-exists, and manual**

```js
// lib/criteria/runner.js
'use strict';

const { execSync } = require('child_process');
const fs = require('fs');

async function runCriterion(criterion) {
  switch (criterion.type) {
    case 'shell':
      return runShell(criterion);
    case 'file-exists':
      return runFileExists(criterion);
    case 'grep':
      return runGrep(criterion);
    case 'http':
      return runHttp(criterion);
    case 'manual':
      return { passed: null, skipped: true };
    default:
      return { passed: false, error: `Unknown criterion type: ${criterion.type}` };
  }
}

function runShell(criterion) {
  const expectExitCode = criterion.expectExitCode ?? 0;
  try {
    execSync(criterion.command, { stdio: 'pipe', timeout: 60000 });
    return expectExitCode === 0
      ? { passed: true }
      : { passed: false, error: `Expected exit code ${expectExitCode} but got 0` };
  } catch (err) {
    const actualCode = err.status ?? 1;
    if (actualCode === expectExitCode) {
      return { passed: true };
    }
    return { passed: false, error: `Expected exit code ${expectExitCode} but got ${actualCode}` };
  }
}

function runFileExists(criterion) {
  if (fs.existsSync(criterion.path)) {
    return { passed: true };
  }
  return { passed: false, error: `File not found: ${criterion.path}` };
}

function runGrep(criterion) {
  try {
    const content = fs.readFileSync(criterion.path, 'utf-8');
    const regex = new RegExp(criterion.pattern);
    if (regex.test(content)) {
      return { passed: true };
    }
    return { passed: false, error: `Pattern "${criterion.pattern}" not found in ${criterion.path}` };
  } catch (err) {
    return { passed: false, error: `Grep failed: ${err.message}` };
  }
}

async function runHttp(criterion) {
  const method = criterion.method || 'GET';
  const timeout = criterion.timeout || 10000;
  const retries = criterion.retries || 0;
  const retryDelay = criterion.retryDelay || 1000;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const options = { method, signal: controller.signal };
      if (criterion.body && method !== 'GET') {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(criterion.body);
      }
      const response = await fetch(criterion.url, options);
      clearTimeout(timer);
      if (response.status === criterion.expectStatus) {
        return { passed: true };
      }
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, retryDelay));
        continue;
      }
      return { passed: false, error: `Expected status ${criterion.expectStatus} but got ${response.status}` };
    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, retryDelay));
        continue;
      }
      return { passed: false, error: `HTTP request failed: ${err.message}` };
    }
  }
}

module.exports = { runCriterion };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/criteria/runner.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/criteria/runner.js lib/criteria/runner.test.js
git commit -m "feat: add criteria runner for shell, file-exists, grep, http, manual types"
```

---

### Task 6: Criteria Runner — Grep Execution

**Files:**
- Modify: `lib/criteria/runner.test.js`

Grep is already implemented in Task 5's runner. This task adds dedicated tests for it.

- [ ] **Step 1: Write failing tests for grep runner**

Append to `lib/criteria/runner.test.js` inside the outer `describe`:

```js
  describe('grep type', () => {
    test('passes when pattern matches file content', async () => {
      const filePath = path.join(tmpDir, 'routes.js');
      fs.writeFileSync(filePath, 'app.use("/auth", authRouter);\n');
      const result = await runCriterion({ type: 'grep', pattern: 'app\\.use.*auth', path: filePath });
      expect(result.passed).toBe(true);
    });

    test('fails when pattern does not match', async () => {
      const filePath = path.join(tmpDir, 'routes.js');
      fs.writeFileSync(filePath, 'app.get("/home", homeHandler);\n');
      const result = await runCriterion({ type: 'grep', pattern: 'app\\.use.*auth', path: filePath });
      expect(result.passed).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    test('fails when file does not exist', async () => {
      const result = await runCriterion({ type: 'grep', pattern: 'anything', path: path.join(tmpDir, 'missing.js') });
      expect(result.passed).toBe(false);
      expect(result.error).toMatch(/failed/i);
    });
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx jest lib/criteria/runner.test.js --verbose`
Expected: All PASS (grep is already implemented)

- [ ] **Step 3: Commit**

```bash
git add lib/criteria/runner.test.js
git commit -m "test: add grep criterion runner tests"
```

---

### Task 7: Criteria Runner — Full Verification Flow

**Files:**
- Modify: `lib/criteria/runner.js`
- Modify: `lib/criteria/runner.test.js`

This adds `verifyCriteria`, the function that iterates all criteria for a task, runs each, and returns a summary result with per-criterion details.

- [ ] **Step 1: Write failing tests for verifyCriteria**

Append to `lib/criteria/runner.test.js`:

```js
const { verifyCriteria } = require('./runner');

describe('verifyCriteria', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('all criteria pass -> passed true', async () => {
    const filePath = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(filePath, 'hello');
    const criteria = [
      { type: 'shell', command: 'true', expectExitCode: 0 },
      { type: 'file-exists', path: filePath }
    ];
    const result = await verifyCriteria(criteria);
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({ criterion: 0, passed: true });
    expect(result.results[1]).toEqual({ criterion: 1, passed: true });
  });

  test('one criterion fails -> passed false', async () => {
    const criteria = [
      { type: 'shell', command: 'true', expectExitCode: 0 },
      { type: 'shell', command: 'false', expectExitCode: 0 }
    ];
    const result = await verifyCriteria(criteria);
    expect(result.passed).toBe(false);
    expect(result.results[0].passed).toBe(true);
    expect(result.results[1].passed).toBe(false);
    expect(result.results[1].error).toBeDefined();
  });

  test('manual criteria are skipped and do not block pass', async () => {
    const criteria = [
      { type: 'shell', command: 'true', expectExitCode: 0 },
      { type: 'manual', text: 'Looks good' }
    ];
    const result = await verifyCriteria(criteria);
    expect(result.passed).toBe(true);
    expect(result.results[1]).toEqual({ criterion: 1, passed: null, skipped: true });
  });

  test('empty criteria -> passed true', async () => {
    const result = await verifyCriteria([]);
    expect(result.passed).toBe(true);
    expect(result.results).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/criteria/runner.test.js --verbose --testNamePattern="verifyCriteria"`
Expected: FAIL — `verifyCriteria` not exported

- [ ] **Step 3: Implement verifyCriteria**

Add to `lib/criteria/runner.js` before `module.exports`:

```js
async function verifyCriteria(criteria) {
  const results = [];
  let allPassed = true;

  for (let i = 0; i < criteria.length; i++) {
    const result = await runCriterion(criteria[i]);
    const entry = { criterion: i };

    if (result.skipped) {
      entry.passed = null;
      entry.skipped = true;
    } else {
      entry.passed = result.passed;
      if (!result.passed) {
        entry.error = result.error;
        allPassed = false;
      }
    }

    results.push(entry);
  }

  return { passed: allPassed, results };
}
```

Update exports:

```js
module.exports = { runCriterion, verifyCriteria };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/criteria/runner.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/criteria/runner.js lib/criteria/runner.test.js
git commit -m "feat: add verifyCriteria for full task verification flow"
```

---

### Task 8: Criteria CLI Entry Point

**Files:**
- Create: `lib/criteria/index.js`

- [ ] **Step 1: Implement the CLI entry point**

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { normalizeCriteria, validateCriterion } = require('./schema');
const { verifyCriteria } = require('./runner');

const command = process.argv[2];

async function main() {
  switch (command) {
    case 'verify': {
      const taskFile = getArg('--task-file');
      const taskId = getArg('--task-id');
      if (!taskFile || !taskId) {
        console.error('Usage: node lib/criteria/index.js verify --task-file <path> --task-id <id>');
        process.exit(1);
      }
      const prd = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
      const task = prd.tasks.find(t => t.id === taskId);
      if (!task) {
        console.error(`Task "${taskId}" not found in ${taskFile}`);
        process.exit(1);
      }
      const criteria = normalizeCriteria(task.acceptanceCriteria);
      const invalid = criteria.map(c => validateCriterion(c)).find(r => !r.valid);
      if (invalid) {
        console.error(`Invalid criterion: ${invalid.error}`);
        process.exit(1);
      }
      const result = await verifyCriteria(criteria);
      console.log(JSON.stringify(result));
      process.exit(result.passed ? 0 : 1);
    }

    case 'normalize': {
      const input = JSON.parse(readStdin());
      const normalized = normalizeCriteria(input);
      console.log(JSON.stringify(normalized));
      break;
    }

    case 'validate-json': {
      const file = getArg('--file');
      if (!file) {
        console.error('Usage: node lib/criteria/index.js validate-json --file <path>');
        process.exit(1);
      }
      try {
        JSON.parse(fs.readFileSync(file, 'utf-8'));
        console.log(JSON.stringify({ valid: true }));
      } catch (err) {
        console.log(JSON.stringify({ valid: false, error: err.message }));
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: verify, normalize, validate-json');
      process.exit(1);
  }
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function readStdin() {
  return fs.readFileSync('/dev/stdin', 'utf-8');
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Test the CLI with a sample PRD JSON**

Create a temporary test file and run:

```bash
cat > /tmp/test-prd.json << 'EOF'
{
  "title": "Test",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "acceptanceCriteria": [
      {"text": "true exits 0", "type": "shell", "command": "true", "expectExitCode": 0}
    ],
    "passes": false,
    "attempts": 0
  }]
}
EOF
node lib/criteria/index.js verify --task-file /tmp/test-prd.json --task-id task-1
```

Expected output: `{"passed":true,"results":[{"criterion":0,"passed":true}]}`
Expected exit code: 0

- [ ] **Step 3: Test validate-json command**

```bash
echo '{"valid": "json"}' > /tmp/valid.json
node lib/criteria/index.js validate-json --file /tmp/valid.json
```

Expected: `{"valid":true}`

```bash
echo 'not json' > /tmp/invalid.json
node lib/criteria/index.js validate-json --file /tmp/invalid.json || echo "exit code: $?"
```

Expected: `{"valid":false,"error":"..."}` and exit code 1

- [ ] **Step 4: Commit**

```bash
git add lib/criteria/index.js
git commit -m "feat: add criteria CLI entry point with verify, normalize, validate-json commands"
```

---

### Task 9: Prompt Builder

**Files:**
- Create: `lib/prompt/builder.js`
- Create: `lib/prompt/builder.test.js`

- [ ] **Step 1: Write failing tests for prompt builder**

```js
// lib/prompt/builder.test.js
const { buildPrompt } = require('./builder');

describe('buildPrompt', () => {
  const baseTask = {
    id: 'task-3',
    title: 'Add JWT validation',
    description: 'Add JWT validation middleware to the auth route.',
    priority: 3,
    acceptanceCriteria: [
      { text: 'Unit tests pass', type: 'shell', command: 'npm test -- auth.test.js', expectExitCode: 0 },
      { text: 'Login returns 200', type: 'http', url: 'http://localhost:3000/auth/login', method: 'POST', expectStatus: 200 },
      { text: 'Config exists', type: 'file-exists', path: './config/auth.json' }
    ]
  };

  test('includes task title and id', () => {
    const prompt = buildPrompt(baseTask, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('Add JWT validation');
    expect(prompt).toContain('task-3');
  });

  test('includes description', () => {
    const prompt = buildPrompt(baseTask, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('Add JWT validation middleware to the auth route.');
  });

  test('lists verification commands for shell criteria', () => {
    const prompt = buildPrompt(baseTask, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('npm test -- auth.test.js');
    expect(prompt).toMatch(/exit code 0/i);
  });

  test('lists verification for http criteria', () => {
    const prompt = buildPrompt(baseTask, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('http://localhost:3000/auth/login');
    expect(prompt).toContain('200');
  });

  test('lists verification for file-exists criteria', () => {
    const prompt = buildPrompt(baseTask, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('./config/auth.json');
  });

  test('tells Claude not to modify PRD or progress files', () => {
    const prompt = buildPrompt(baseTask, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('auth.json');
    expect(prompt).toMatch(/do not modify/i);
  });

  test('includes DONE signal', () => {
    const prompt = buildPrompt(baseTask, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('DONE');
  });

  test('handles manual criteria gracefully', () => {
    const task = {
      ...baseTask,
      acceptanceCriteria: [
        { text: 'Looks good', type: 'manual', confidence: 'low' }
      ]
    };
    const prompt = buildPrompt(task, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('Looks good');
    expect(prompt).toMatch(/manual|not automatically verified/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/prompt/builder.test.js --verbose`
Expected: FAIL — `Cannot find module './builder'`

- [ ] **Step 3: Implement buildPrompt**

```js
// lib/prompt/builder.js
'use strict';

function buildPrompt(task, options) {
  const { jsonFile, progressFile } = options;
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

  return lines.join('\n');
}

module.exports = { buildPrompt };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/prompt/builder.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/prompt/builder.js lib/prompt/builder.test.js
git commit -m "feat: add prompt builder with verification command descriptions"
```

---

### Task 10: Prompt Builder CLI Entry Point

**Files:**
- Create: `lib/prompt/index.js`

- [ ] **Step 1: Implement the CLI entry point**

```js
#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { buildPrompt } = require('./builder');
const { normalizeCriteria } = require('../criteria/schema');

const command = process.argv[2];

function main() {
  switch (command) {
    case 'build': {
      const taskFile = getArg('--task-file');
      const taskId = getArg('--task-id');
      const jsonFile = getArg('--json-file') || 'prd.json';
      const progressFile = getArg('--progress-file') || 'progress.txt';

      if (!taskFile || !taskId) {
        console.error('Usage: node lib/prompt/index.js build --task-file <path> --task-id <id> [--json-file <name>] [--progress-file <name>]');
        process.exit(1);
      }

      const prd = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
      const task = prd.tasks.find(t => t.id === taskId);
      if (!task) {
        console.error(`Task "${taskId}" not found in ${taskFile}`);
        process.exit(1);
      }

      const normalizedTask = {
        ...task,
        acceptanceCriteria: normalizeCriteria(task.acceptanceCriteria)
      };

      const prompt = buildPrompt(normalizedTask, { jsonFile, progressFile });
      console.log(prompt);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: build');
      process.exit(1);
  }
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

main();
```

- [ ] **Step 2: Test the CLI with the same sample PRD**

```bash
node lib/prompt/index.js build --task-file /tmp/test-prd.json --task-id task-1 --json-file test-prd.json --progress-file progress.txt
```

Expected: A human-readable prompt string containing the task details and verification command.

- [ ] **Step 3: Commit**

```bash
git add lib/prompt/index.js
git commit -m "feat: add prompt builder CLI entry point"
```

---

### Task 11: Bash Integration — `--dry-run` and `--no-github` Flags

**Files:**
- Modify: `ralph-loop:9-16` (globals section)
- Modify: `ralph-loop:192-253` (parse_arguments function)
- Modify: `ralph-loop:27-173` (show_help function)
- Create: `tests/test-dry-run.sh`

- [ ] **Step 1: Add new globals to ralph-loop**

After line 14 (`ANALYZE_PRD=false`), add:

```bash
DRY_RUN=false
GITHUB_ENABLED=true
```

- [ ] **Step 2: Add flag parsing in parse_arguments**

Add these cases in the `while` loop, before the `-*)` catch-all case:

```bash
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --no-github)
                GITHUB_ENABLED=false
                shift
                ;;
```

- [ ] **Step 3: Update show_help to document new flags**

In the OPTIONS section of show_help, add after the `--help` line:

```
  --dry-run               Show next prompt and exit (don't call Claude)
  --no-github             Disable all GitHub integration
```

- [ ] **Step 4: Write integration test for --dry-run**

```bash
#!/usr/bin/env bash
# tests/test-dry-run.sh — Integration tests for --dry-run flag

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

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

test_dry_run_shows_prompt() {
    echo ""
    echo "Test 1: --dry-run shows prompt and exits"

    cat > "$TEST_DIR/test.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "description": "A test task.",
    "acceptanceCriteria": ["Criterion 1"],
    "passes": false,
    "completedAt": null,
    "attempts": 0
  }]
}
EOF

    output=$(../ralph-loop "$TEST_DIR/test.json" --dry-run 2>&1) || true

    if echo "$output" | grep -q "task-1\|Test task"; then
        pass "--dry-run displays task information"
    else
        fail "--dry-run did not display task information. Output: $output"
    fi
}

test_dry_run_does_not_call_claude() {
    echo ""
    echo "Test 2: --dry-run does not call Claude API"

    cat > "$TEST_DIR/test2.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "description": "A test task.",
    "acceptanceCriteria": ["Criterion 1"],
    "passes": false,
    "completedAt": null,
    "attempts": 0
  }]
}
EOF

    output=$(../ralph-loop "$TEST_DIR/test2.json" --dry-run 2>&1) || true

    if echo "$output" | grep -qi "calling claude\|API call"; then
        fail "--dry-run appears to call Claude API"
    else
        pass "--dry-run does not call Claude API"
    fi
}

test_no_github_flag_accepted() {
    echo ""
    echo "Test 3: --no-github flag is accepted without error"

    cat > "$TEST_DIR/test3.json" << 'EOF'
{
  "title": "Test PRD",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "description": "A test task.",
    "acceptanceCriteria": ["Criterion 1"],
    "passes": false,
    "completedAt": null,
    "attempts": 0
  }]
}
EOF

    output=$(../ralph-loop "$TEST_DIR/test3.json" --no-github --dry-run 2>&1) || true

    if echo "$output" | grep -qi "unknown option"; then
        fail "--no-github flag not recognized"
    else
        pass "--no-github flag accepted"
    fi
}

# Run tests
setup
trap cleanup EXIT

test_dry_run_shows_prompt
test_dry_run_does_not_call_claude
test_no_github_flag_accepted

echo ""
echo "════════════════════════════════════════════════════════════════════════════"
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
echo "════════════════════════════════════════════════════════════════════════════"

if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
fi
```

- [ ] **Step 5: Make the test executable and run it**

```bash
chmod +x tests/test-dry-run.sh
cd tests && ./test-dry-run.sh
```

Expected: Tests 2 and 3 pass. Test 1 may fail because dry-run logic isn't wired up yet — that's expected.

- [ ] **Step 6: Commit flag parsing changes**

```bash
git add ralph-loop tests/test-dry-run.sh
git commit -m "feat: add --dry-run and --no-github flag parsing"
```

---

### Task 12: Bash Integration — Wire Prompt Builder into Main Loop

**Files:**
- Modify: `ralph-loop:1067-1072` (prompt generation in run_ralph_loop)

This replaces the hardcoded 5-line prompt with a call to `lib/prompt/index.js`.

- [ ] **Step 1: Replace the hardcoded prompt**

Replace lines 1067-1072 in `ralph-loop` (the `claude_prompt=...` block):

```bash
        # Generate Claude prompt
        local claude_prompt="1. Read $JSON_FILE to find the highest-priority failing task.
2. Work only on that single task.
3. Run tests to verify the fix.
4. Update $JSON_FILE (set passes: true) and log learnings to $PROGRESS_FILE
5. Output \"<promise>COMPLETE</promise>\" only when all PRD tasks pass."
```

With:

```bash
        # Generate Claude prompt via prompt builder
        local json_basename=$(basename "$JSON_FILE")
        local progress_basename=$(basename "$PROGRESS_FILE")
        local claude_prompt
        claude_prompt=$(node lib/prompt/index.js build \
            --task-file "$JSON_FILE" \
            --task-id "$next_task_id" \
            --json-file "$json_basename" \
            --progress-file "$progress_basename" 2>&1)

        if [ $? -ne 0 ]; then
            error_exit "Failed to build prompt for task $next_task_id" "Check lib/prompt/ module. Error: $claude_prompt"
        fi
```

- [ ] **Step 2: Add --dry-run exit point after prompt construction**

Add immediately after the prompt generation block (before the DEBUG prompt display):

```bash
        # --dry-run: show prompt and exit
        if [ "$DRY_RUN" = true ]; then
            echo -e "${BLUE}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
            echo -e "${BLUE}║                         DRY RUN — PROMPT PREVIEW                           ║${NC}"
            echo -e "${BLUE}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
            echo ""
            echo "Task: $next_task_id - $task_title"
            echo ""
            echo "────────────────────────────────────────────────────────────────────────────"
            echo "$claude_prompt"
            echo "────────────────────────────────────────────────────────────────────────────"
            echo ""
            echo -e "${YELLOW}Dry run complete. No API call made.${NC}"
            exit 0
        fi
```

- [ ] **Step 3: Run the dry-run integration test**

```bash
cd tests && ./test-dry-run.sh
```

Expected: All 3 tests PASS

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat: wire prompt builder into main loop, implement --dry-run"
```

---

### Task 13: Bash Integration — Criteria Verification in Main Loop

**Files:**
- Modify: `ralph-loop:1248-1284` (completion detection section in run_ralph_loop)

This replaces the `<promise>COMPLETE</promise>` detection with a call to `lib/criteria/index.js verify`.

- [ ] **Step 1: Add JSON snapshot before Claude invocation**

Add just before the `# Call Claude CLI` comment (around line 1084):

```bash
        # Snapshot PRD state for error recovery
        cp "$JSON_FILE" "${JSON_FILE}.pre-iteration"
```

- [ ] **Step 2: Add JSON validation after Claude returns**

Add after `rm -f "$prompt_file"` (around line 1200), before the API metadata section:

```bash
        # Validate JSON wasn't corrupted by Claude
        local json_valid
        json_valid=$(node lib/criteria/index.js validate-json --file "$JSON_FILE" 2>&1)
        if [ $? -ne 0 ]; then
            echo -e "${YELLOW}⚠ JSON file corrupted during iteration. Restoring from snapshot.${NC}"
            cp "${JSON_FILE}.pre-iteration" "$JSON_FILE"
            log_iteration_result "$iteration" "$next_task_id" "FAILED" "JSON corrupted, restored from snapshot"
            iteration=$((iteration + 1))
            continue
        fi
```

- [ ] **Step 3: Replace the completion detection block**

Replace the entire `<promise>COMPLETE</promise>` detection block (lines 1248-1274) and the "Read updated PRD to check task status" block (lines 1276-1284) with:

```bash
        # Run criteria verification
        local verify_result
        verify_result=$(node lib/criteria/index.js verify --task-file "$JSON_FILE" --task-id "$next_task_id" 2>&1)
        local verify_exit=$?

        if [ "$DEBUG" = true ]; then
            echo -e "${BLUE}[DEBUG] Criteria verification result: $verify_result${NC}"
        fi

        # Update per-criterion tracking in PRD JSON
        local task_index=$(jq ".tasks | map(.id) | index(\"$next_task_id\")" "$JSON_FILE")
        local now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

        if [ "$verify_exit" -eq 0 ]; then
            # All criteria passed — mark task complete
            local updated_prd=$(jq \
                --argjson idx "$task_index" \
                --arg now "$now" \
                --argjson results "$verify_result" \
                '.tasks[$idx].passes = true |
                 .tasks[$idx].completedAt = $now |
                 .tasks[$idx].criteriaResults = $results.results' \
                "$JSON_FILE")
            echo "$updated_prd" | jq '.' > "$JSON_FILE"

            log_iteration_result "$iteration" "$next_task_id" "PASSED" "All criteria verified"

            if [ "$VERBOSE" = true ]; then
                echo -e "${GREEN}[INFO] Task $next_task_id: All criteria passed!${NC}"
            fi
        else
            # Some criteria failed — update results but keep passes=false
            local updated_prd=$(jq \
                --argjson idx "$task_index" \
                --arg now "$now" \
                --argjson results "$verify_result" \
                '.tasks[$idx].criteriaResults = $results.results' \
                "$JSON_FILE" 2>/dev/null || cat "$JSON_FILE")
            echo "$updated_prd" | jq '.' > "$JSON_FILE" 2>/dev/null || true

            log_iteration_result "$iteration" "$next_task_id" "IN PROGRESS" "Criteria verification: some failed"

            if [ "$VERBOSE" = true ]; then
                local pass_count=$(echo "$verify_result" | jq '[.results[] | select(.passed == true)] | length' 2>/dev/null || echo "?")
                local total_count=$(echo "$verify_result" | jq '.results | length' 2>/dev/null || echo "?")
                echo -e "${YELLOW}[INFO] Task $next_task_id: $pass_count/$total_count criteria passing${NC}"
            fi
        fi

        # Check if ALL tasks are now complete
        local remaining=$(jq '[.tasks[] | select(.passes == false)] | length' "$JSON_FILE")
        if [ "$remaining" -eq 0 ]; then
            completion_detected=true
            log_learnings "All PRD tasks have been completed successfully."
            if [ "$VERBOSE" = true ]; then
                echo -e "${GREEN}[INFO] All tasks completed!${NC}"
            fi
            break
        fi
```

- [ ] **Step 4: Clean up snapshot file at end of iteration**

Add after the progress visualization call (`show_progress`):

```bash
        # Clean up iteration snapshot
        rm -f "${JSON_FILE}.pre-iteration"
```

- [ ] **Step 5: Commit**

```bash
git add ralph-loop
git commit -m "feat: replace promise-based completion with criteria verification"
```

---

### Task 14: Thrash Detection

**Files:**
- Modify: `ralph-loop` (add thrash detection after criteria verification)

- [ ] **Step 1: Add thrash detection function**

Add this function before `run_ralph_loop`:

```bash
# Check for thrash: criterion failing 4+ consecutive times with no progress
check_thrash() {
    local task_id="$1"
    local task_index=$(jq ".tasks | map(.id) | index(\"$task_id\")" "$JSON_FILE")
    local criteria_results=$(jq -r ".tasks[$task_index].criteriaResults // []" "$JSON_FILE")
    local results_count=$(echo "$criteria_results" | jq 'length')

    if [ "$results_count" -eq 0 ]; then
        return 1  # No results yet, no thrash
    fi

    # Check each criterion for consecutive failures
    local i=0
    while [ $i -lt $results_count ]; do
        local attempts=$(echo "$criteria_results" | jq ".[$i].attempts // 0")
        local passed=$(echo "$criteria_results" | jq ".[$i].passed")

        if [ "$passed" = "false" ] && [ "$attempts" -ge 4 ]; then
            echo "$i"
            return 0  # Thrash detected, return criterion index
        fi

        i=$((i + 1))
    done

    return 1  # No thrash
}
```

- [ ] **Step 2: Track per-criterion attempt counts in the verification block**

In Task 13's verification block, after updating `criteriaResults`, add tracking for consecutive failures. Modify the jq update for the failure case to also increment per-criterion attempts:

After the `jq` update in the failure branch, add:

```bash
            # Update per-criterion attempt tracking
            local result_idx=0
            local result_count=$(echo "$verify_result" | jq '.results | length' 2>/dev/null || echo "0")
            while [ $result_idx -lt $result_count ]; do
                local crit_passed=$(echo "$verify_result" | jq ".results[$result_idx].passed")
                if [ "$crit_passed" = "false" ]; then
                    local prev_attempts=$(jq ".tasks[$task_index].criteriaResults[$result_idx].attempts // 0" "$JSON_FILE")
                    local new_attempts=$((prev_attempts + 1))
                    local updated=$(jq \
                        --argjson idx "$task_index" \
                        --argjson cidx "$result_idx" \
                        --argjson attempts "$new_attempts" \
                        '.tasks[$idx].criteriaResults[$cidx].attempts = $attempts' \
                        "$JSON_FILE")
                    echo "$updated" | jq '.' > "$JSON_FILE"
                else
                    # Reset attempt counter on pass
                    local updated=$(jq \
                        --argjson idx "$task_index" \
                        --argjson cidx "$result_idx" \
                        '.tasks[$idx].criteriaResults[$cidx].attempts = 0' \
                        "$JSON_FILE")
                    echo "$updated" | jq '.' > "$JSON_FILE"
                fi
                result_idx=$((result_idx + 1))
            done
```

- [ ] **Step 3: Call thrash detection after criteria verification**

Add after the per-criterion tracking update:

```bash
            # Check for thrash
            local thrash_criterion
            if thrash_criterion=$(check_thrash "$next_task_id"); then
                echo ""
                echo -e "${YELLOW}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
                echo -e "${YELLOW}║                          THRASH WARNING                                    ║${NC}"
                echo -e "${YELLOW}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
                echo ""
                echo -e "${YELLOW}Warning: Task $next_task_id has stalled: criterion $thrash_criterion has failed 4+${NC}"
                echo -e "${YELLOW}  consecutive times with no progress on other criteria.${NC}"
                echo -e "${YELLOW}  Consider: revising the criterion, splitting the task, or running --analyze-prd.${NC}"
                echo ""
                read -p "  Continue? [Y/n] " -n 1 -r
                echo ""
                if [[ $REPLY =~ ^[Nn]$ ]]; then
                    echo -e "${RED}Stopping at user request.${NC}"
                    log_iteration_result "$iteration" "$next_task_id" "STALLED" "User stopped after thrash warning on criterion $thrash_criterion"
                    break
                fi
            fi
```

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat: add thrash detection for stalled criteria"
```

---

### Task 15: Update `--analyze-prd` with Criteria Stats

**Files:**
- Modify: `ralph-loop:549-666` (analyze_prd function)

- [ ] **Step 1: Add criteria type breakdown to analyze_prd**

After the existing statistics block (around line 577), add:

```bash
    # Criteria type breakdown
    local all_criteria=$(echo "$prd_content" | jq -r '[.tasks[].acceptanceCriteria[]] | .[]')
    local total_criteria=$(echo "$prd_content" | jq '[.tasks[].acceptanceCriteria[]] | length')
    local typed_criteria=0
    local manual_criteria=0

    # Count criteria with inline type hints
    while IFS= read -r criterion; do
        if echo "$criterion" | grep -qE '`\[(shell|http|file-exists|grep):'; then
            typed_criteria=$((typed_criteria + 1))
        elif echo "$criterion" | jq -e '.type // empty' > /dev/null 2>&1; then
            local ctype=$(echo "$criterion" | jq -r '.type')
            if [ "$ctype" != "manual" ]; then
                typed_criteria=$((typed_criteria + 1))
            else
                manual_criteria=$((manual_criteria + 1))
            fi
        else
            manual_criteria=$((manual_criteria + 1))
        fi
    done <<< "$(echo "$prd_content" | jq -r '.tasks[].acceptanceCriteria[]')"

    local executable_pct=0
    if [ "$total_criteria" -gt 0 ]; then
        executable_pct=$((typed_criteria * 100 / total_criteria))
    fi

    echo -e "${BLUE}Criteria Analysis:${NC}"
    echo "  Total Criteria: $total_criteria"
    echo "  Executable (typed): $typed_criteria"
    echo "  Manual (untyped): $manual_criteria"
    echo "  Executable Coverage: ${executable_pct}%"
    if [ "$executable_pct" -lt 50 ]; then
        echo -e "  ${YELLOW}⚠ Low executable coverage. Add type hints to criteria for automated verification.${NC}"
    fi
    echo ""
```

- [ ] **Step 2: Run the tool to verify**

```bash
./ralph-loop examples/good-prd-example.md --analyze-prd 2>&1 | head -30
```

Expected: Output includes "Criteria Analysis:" section (if the example PRD exists; otherwise test with a temp PRD)

- [ ] **Step 3: Commit**

```bash
git add ralph-loop
git commit -m "feat: add criteria type breakdown to --analyze-prd output"
```

---

### Task 16: Update `tests/test-all.sh` and Final Integration Test

**Files:**
- Modify: `tests/test-all.sh`
- Create: `tests/test-criteria.sh`

- [ ] **Step 1: Create criteria integration test**

```bash
#!/usr/bin/env bash
# tests/test-criteria.sh — Integration tests for criteria verification

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_PASSED=0
TESTS_FAILED=0

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

test_criteria_verify_all_pass() {
    echo ""
    echo "Test 1: criteria verify with all passing criteria"

    cat > "$TEST_DIR/prd.json" << 'EOF'
{
  "title": "Test",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "acceptanceCriteria": [
      {"text": "true exits 0", "type": "shell", "command": "true", "expectExitCode": 0}
    ],
    "passes": false,
    "attempts": 0
  }]
}
EOF

    local output
    output=$(node ../lib/criteria/index.js verify --task-file "$TEST_DIR/prd.json" --task-id task-1 2>&1)
    local exit_code=$?

    if [ "$exit_code" -eq 0 ]; then
        pass "Criteria verify exits 0 when all pass"
    else
        fail "Criteria verify exited $exit_code, expected 0. Output: $output"
    fi

    if echo "$output" | jq -e '.passed == true' > /dev/null 2>&1; then
        pass "Criteria verify returns passed:true"
    else
        fail "Criteria verify did not return passed:true. Output: $output"
    fi
}

test_criteria_verify_some_fail() {
    echo ""
    echo "Test 2: criteria verify with failing criteria"

    cat > "$TEST_DIR/prd2.json" << 'EOF'
{
  "title": "Test",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "acceptanceCriteria": [
      {"text": "true exits 0", "type": "shell", "command": "true", "expectExitCode": 0},
      {"text": "false exits 0", "type": "shell", "command": "false", "expectExitCode": 0}
    ],
    "passes": false,
    "attempts": 0
  }]
}
EOF

    local output
    output=$(node ../lib/criteria/index.js verify --task-file "$TEST_DIR/prd2.json" --task-id task-1 2>&1) || true

    if echo "$output" | jq -e '.passed == false' > /dev/null 2>&1; then
        pass "Criteria verify returns passed:false when some fail"
    else
        fail "Criteria verify did not return passed:false. Output: $output"
    fi
}

test_criteria_verify_file_exists() {
    echo ""
    echo "Test 3: criteria verify with file-exists type"

    touch "$TEST_DIR/target-file.txt"

    cat > "$TEST_DIR/prd3.json" << EOF
{
  "title": "Test",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "acceptanceCriteria": [
      {"text": "File exists", "type": "file-exists", "path": "$TEST_DIR/target-file.txt"}
    ],
    "passes": false,
    "attempts": 0
  }]
}
EOF

    local output
    output=$(node ../lib/criteria/index.js verify --task-file "$TEST_DIR/prd3.json" --task-id task-1 2>&1)

    if echo "$output" | jq -e '.passed == true' > /dev/null 2>&1; then
        pass "file-exists criterion passes for existing file"
    else
        fail "file-exists criterion failed. Output: $output"
    fi
}

test_criteria_normalize_legacy_strings() {
    echo ""
    echo "Test 4: criteria verify normalizes legacy string criteria"

    cat > "$TEST_DIR/prd4.json" << 'EOF'
{
  "title": "Test",
  "tasks": [{
    "id": "task-1",
    "title": "Test task",
    "category": "Testing",
    "priority": 1,
    "acceptanceCriteria": [
      "Users can log in"
    ],
    "passes": false,
    "attempts": 0
  }]
}
EOF

    local output
    output=$(node ../lib/criteria/index.js verify --task-file "$TEST_DIR/prd4.json" --task-id task-1 2>&1)
    local exit_code=$?

    # Manual criteria are skipped, so the task should pass (no executable criteria failed)
    if [ "$exit_code" -eq 0 ]; then
        pass "Legacy string criteria are normalized and skipped as manual"
    else
        fail "Legacy string criteria caused failure. Output: $output"
    fi
}

test_validate_json_valid() {
    echo ""
    echo "Test 5: validate-json with valid JSON"

    echo '{"valid": true}' > "$TEST_DIR/valid.json"
    local output
    output=$(node ../lib/criteria/index.js validate-json --file "$TEST_DIR/valid.json" 2>&1)

    if echo "$output" | jq -e '.valid == true' > /dev/null 2>&1; then
        pass "validate-json reports valid JSON as valid"
    else
        fail "validate-json failed on valid JSON. Output: $output"
    fi
}

test_validate_json_invalid() {
    echo ""
    echo "Test 6: validate-json with invalid JSON"

    echo 'not json at all' > "$TEST_DIR/invalid.json"
    local output
    output=$(node ../lib/criteria/index.js validate-json --file "$TEST_DIR/invalid.json" 2>&1) || true

    if echo "$output" | jq -e '.valid == false' > /dev/null 2>&1; then
        pass "validate-json reports invalid JSON as invalid"
    else
        fail "validate-json did not detect invalid JSON. Output: $output"
    fi
}

# Run tests
setup
trap cleanup EXIT

test_criteria_verify_all_pass
test_criteria_verify_some_fail
test_criteria_verify_file_exists
test_criteria_normalize_legacy_strings
test_validate_json_valid
test_validate_json_invalid

echo ""
echo "════════════════════════════════════════════════════════════════════════════"
echo "Results: $TESTS_PASSED passed, $TESTS_FAILED failed"
echo "════════════════════════════════════════════════════════════════════════════"

if [ $TESTS_FAILED -gt 0 ]; then
    exit 1
fi
```

- [ ] **Step 2: Make the test executable**

```bash
chmod +x tests/test-criteria.sh
```

- [ ] **Step 3: Update test-all.sh**

Read `tests/test-all.sh` first, then add the new test suites. Add these lines where other test scripts are called:

```bash
echo "Running criteria tests..."
./test-criteria.sh
echo ""

echo "Running dry-run tests..."
./test-dry-run.sh
echo ""
```

- [ ] **Step 4: Run all tests**

```bash
cd tests && ./test-all.sh
```

Expected: All existing tests still pass, new criteria and dry-run tests pass.

Also run Jest tests:

```bash
npx jest --verbose
```

Expected: All JS unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/test-criteria.sh tests/test-dry-run.sh tests/test-all.sh
git commit -m "test: add integration tests for criteria verification and dry-run"
```

---

### Task 17: Run Full Test Suite and Verify

**Files:** None (verification only)

- [ ] **Step 1: Run all Bash tests**

```bash
cd tests && ./test-all.sh
```

Expected: All tests PASS

- [ ] **Step 2: Run all Jest tests**

```bash
npx jest --verbose
```

Expected: All tests PASS

- [ ] **Step 3: Run a --dry-run to verify end-to-end prompt generation**

Create a sample PRD with typed criteria and verify the prompt output:

```bash
cat > /tmp/e2e-test.md << 'EOF'
## Task: Create config file
**Category**: Setup
**Priority**: 1

### Acceptance Criteria
- Config file exists `[file-exists: ./config.json]`
- Schema is valid `[shell: node -e "JSON.parse(require('fs').readFileSync('./config.json'))"]`
EOF

./ralph-loop /tmp/e2e-test.md --dry-run
```

Expected: Prompt shows task details, lists verification commands, mentions "DONE" signal. No API call made.

- [ ] **Step 4: Verify JSON snapshot/restore works**

```bash
cat > /tmp/snapshot-test.json << 'EOF'
{
  "title": "Snapshot Test",
  "tasks": [{
    "id": "task-1",
    "title": "Test",
    "category": "Testing",
    "priority": 1,
    "acceptanceCriteria": [{"text": "true", "type": "shell", "command": "true", "expectExitCode": 0}],
    "passes": false,
    "attempts": 0
  }]
}
EOF

node lib/criteria/index.js validate-json --file /tmp/snapshot-test.json
```

Expected: `{"valid":true}`

- [ ] **Step 5: Final commit — no code changes, just a verification record**

If everything passes, no commit needed. If any fixes were required, they should have been committed in the relevant task.
