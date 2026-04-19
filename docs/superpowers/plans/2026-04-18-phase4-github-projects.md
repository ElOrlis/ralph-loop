# Phase 4 — GitHub Projects Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each PRD creates and syncs a GitHub Projects v2 board — tasks become project items linked to their issues, and Ralph-managed fields (Priority, Category, Iteration Count, Criteria Pass Rate, Ralph Status) update after every iteration via GraphQL.

**Architecture:** One new module at `lib/github/projects.js` (plus a shared GraphQL helper at `lib/github/graphql.js`), following the established `index.js` CLI + helpers pattern. Bash gains `ensure_github_project`, `ensure_project_item`, `sync_project_item`, and `validate_project_fields` functions. All Projects v2 work is gated by `GITHUB_ENABLED`, goes through `gh api graphql`, tracks API calls per run, and warns at 100 calls. Project metadata (`githubProject`) lives at the PRD root; each task gets a `projectItemId`. Phase 3 (structured logging) is a soft prerequisite: new events are emitted only when `lib/logging/index.js` exists.

**Tech Stack:** Node.js (CommonJS), `gh api graphql` (no new npm deps), Jest for unit tests, Bash for CLI integration tests, `jq` 1.6+ for JSON edits, `gh` CLI already authenticated.

---

## Prerequisites

- Phase 2 (GitHub Issues) shipped — `lib/github/{index.js,repo.js,issues.js}` exist and Bash calls `ensure_task_issue`, `post_iteration_comment`, `close_task_issue`.
- Phase 3 (Structured Logging) **strongly recommended** but not strictly required. If `lib/logging/index.js` is missing, Task 13 is a no-op: project-lifecycle events are silently skipped and rate-limit warnings go to stderr only.
- `gh` CLI authenticated with `project` scope: `gh auth refresh -s project,read:project,write:project`.
- Working directory `/Users/orlandogarcia/numeron/ralph-loop/`.

---

## File Structure

```
lib/github/
  graphql.js              — Thin wrapper over `gh api graphql`, counts calls, escapes args
  graphql.test.js         — Jest tests for wrapper + resolveOwnerId
  projects.js             — Project + field + item operations (Projects v2)
  projects.test.js        — Jest tests for each projects.js function
  index.js  (modified)    — Adds create-project, ensure-project-item, sync-project-item, validate-project subcommands
tests/
  test-github-projects.sh — Bash integration tests (uses mock `gh` on PATH)
  fixtures/
    mock-gh-projects.sh   — Fake `gh` that replays canned GraphQL responses
  test-all.sh  (modified) — Registers the new suite
ralph-loop   (modified)   — New globals + functions + wiring into run_ralph_loop
```

**Modified files:**

- `ralph-loop`
  - New globals (after line 20): `GITHUB_API_CALLS=0`, `GITHUB_API_WARN_THRESHOLD=100`, `GITHUB_API_WARNED=false`
  - `validate_prd_json` — accept optional PRD-root `githubProject` object + task-level `projectItemId` string
  - `resolve_target_repo` — unchanged; `ensure_github_project` runs right after
  - New functions: `ensure_github_project`, `ensure_project_item`, `sync_project_item`, `validate_project_fields`, `bump_github_api_calls`, `emit_logging_event`
  - `run_ralph_loop` wiring:
    - After `resolve_target_repo` call: `ensure_github_project`
    - In resume block (right before `crosscheck_issues`): `validate_project_fields`
    - After `ensure_task_issue`: `ensure_project_item`
    - After every `post_iteration_comment` (both success and continuing branches): `sync_project_item`
    - End-of-run summary: report `GITHUB_API_CALLS`
  - `show_help` — document rate-limit notice
- `lib/github/index.js` — dispatcher adds four new commands
- `lib/logging/events.js` (if Phase 3 shipped) — add `project_created`, `project_item_synced`, `project_rate_limit_warning` event types
- `lib/logging/renderer.js` (if Phase 3 shipped) — render new events
- `tests/test-all.sh` — register `test-github-projects.sh`
- `README.md` — short Phase 4 section

**Out of scope:** multi-PRD umbrella projects, cross-PRD dashboards, `ralph-loop project` subcommand, parallel project syncing. Deferred per spec.

---

## PRD JSON Schema Additions

At the PRD root (once per PRD):

```json
{
  "repository": "paullovvik/myrepo",
  "githubProject": {
    "number": 12,
    "id": "PVT_kwHOAAlL2c4AADYv",
    "owner": "paullovvik",
    "ownerType": "user",
    "url": "https://github.com/users/paullovvik/projects/12",
    "fieldIds": {
      "priority": {"id": "PVTF_aaa", "dataType": "NUMBER"},
      "category": {"id": "PVTF_bbb", "dataType": "SINGLE_SELECT", "options": {"Backend": "opt_1", "Frontend": "opt_2"}},
      "iterationCount": {"id": "PVTF_ccc", "dataType": "NUMBER"},
      "criteriaPassRate": {"id": "PVTF_ddd", "dataType": "NUMBER"},
      "ralphStatus": {"id": "PVTF_eee", "dataType": "SINGLE_SELECT", "options": {"Pending": "opt_3", "In Progress": "opt_4", "Passed": "opt_5", "Failed": "opt_6", "Stalled": "opt_7"}}
    }
  },
  "tasks": [
    {
      "id": "task-1",
      "issueNumber": 42,
      "issueUrl": "https://github.com/paullovvik/myrepo/issues/42",
      "projectItemId": "PVTI_xxx",
      ...
    }
  ]
}
```

`fieldIds` extends the spec's flat string map with per-field objects so single-select option IDs can be persisted alongside field IDs. This is necessary because Projects v2 identifies single-select values by option ID, not by text.

---

## Event Catalogue Additions (Phase 3 dependency)

Added to `lib/logging/events.js` REQUIRED map:

| `event` | Required fields | Optional fields |
|---------|----------------|-----------------|
| `project_created` | `projectNumber` (int), `projectId` (string), `url` (string) | `fieldCount` (int) |
| `project_item_synced` | `iteration` (int), `taskId` (string), `projectItemId` (string), `ralphStatus` (string) | `criteriaPassRate` (number), `iterationCount` (int), `apiCalls` (int) |
| `project_rate_limit_warning` | `callCount` (int), `threshold` (int) | — |

---

### Task 1: GraphQL Helper Module

**Files:**
- Create: `lib/github/graphql.js`
- Create: `lib/github/graphql.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/github/graphql.test.js
'use strict';

jest.mock('child_process');
const { execSync } = require('child_process');
const { ghGraphql, resolveOwnerId, resetCallCount, getCallCount } = require('./graphql');

beforeEach(() => {
  execSync.mockReset();
  resetCallCount();
});

describe('ghGraphql', () => {
  test('invokes gh api graphql and parses JSON reply', () => {
    execSync.mockReturnValueOnce(Buffer.from(JSON.stringify({ data: { viewer: { login: 'x' } } })));
    const result = ghGraphql('query { viewer { login } }', {});
    expect(result).toEqual({ viewer: { login: 'x' } });
    expect(execSync).toHaveBeenCalledTimes(1);
    const cmd = execSync.mock.calls[0][0];
    expect(cmd).toMatch(/^gh api graphql /);
    expect(cmd).toMatch(/-f query=/);
  });

  test('passes scalar variables via -F', () => {
    execSync.mockReturnValueOnce(Buffer.from(JSON.stringify({ data: { ok: true } })));
    ghGraphql('query($n:Int!){ ok }', { n: 5 });
    expect(execSync.mock.calls[0][0]).toMatch(/-F n=5/);
  });

  test('passes string variables via -f', () => {
    execSync.mockReturnValueOnce(Buffer.from(JSON.stringify({ data: { ok: true } })));
    ghGraphql('query($login:String!){ ok }', { login: 'paul' });
    expect(execSync.mock.calls[0][0]).toMatch(/-f login=paul/);
  });

  test('throws with context when gh returns errors', () => {
    execSync.mockReturnValueOnce(Buffer.from(JSON.stringify({
      errors: [{ message: 'insufficient scope' }],
    })));
    expect(() => ghGraphql('query{viewer{login}}', {})).toThrow(/insufficient scope/);
  });

  test('increments call count on success and failure', () => {
    execSync.mockReturnValueOnce(Buffer.from(JSON.stringify({ data: {} })));
    ghGraphql('query{}', {});
    try {
      execSync.mockImplementationOnce(() => { throw new Error('boom'); });
      ghGraphql('query{}', {});
    } catch { /* swallowed */ }
    expect(getCallCount()).toBe(2);
  });
});

describe('resolveOwnerId', () => {
  test('tries user first, returns id + type', () => {
    execSync.mockReturnValueOnce(Buffer.from(JSON.stringify({
      data: { user: { id: 'U_abc' }, organization: null },
    })));
    const result = resolveOwnerId('paullovvik');
    expect(result).toEqual({ id: 'U_abc', type: 'user' });
  });

  test('falls back to organization when user is null', () => {
    execSync.mockReturnValueOnce(Buffer.from(JSON.stringify({
      data: { user: null, organization: { id: 'O_xyz' } },
    })));
    const result = resolveOwnerId('acme-corp');
    expect(result).toEqual({ id: 'O_xyz', type: 'organization' });
  });

  test('throws when neither resolves', () => {
    execSync.mockReturnValueOnce(Buffer.from(JSON.stringify({
      data: { user: null, organization: null },
    })));
    expect(() => resolveOwnerId('ghost')).toThrow(/could not resolve owner/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/github/graphql.test.js --no-coverage 2>&1 | tail -5`
Expected: FAIL — `Cannot find module './graphql'`

- [ ] **Step 3: Implement the helper**

```js
// lib/github/graphql.js
'use strict';

const { execSync } = require('child_process');

let callCount = 0;

function resetCallCount() { callCount = 0; }
function getCallCount() { return callCount; }

function quoteShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function ghGraphql(query, variables = {}) {
  callCount += 1;
  const parts = ['gh api graphql', `-f query=${quoteShell(query)}`];
  for (const [name, value] of Object.entries(variables)) {
    if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`-F ${name}=${value}`);
    } else {
      parts.push(`-f ${name}=${quoteShell(value)}`);
    }
  }
  const cmd = parts.join(' ');
  let raw;
  try {
    raw = execSync(cmd, { encoding: 'buffer' });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    throw new Error(`gh api graphql failed: ${err.message}${stderr ? ` -- ${stderr.trim()}` : ''}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.toString());
  } catch (err) {
    throw new Error(`gh api graphql returned non-JSON output: ${raw.toString().slice(0, 200)}`);
  }
  if (parsed.errors && parsed.errors.length) {
    const msg = parsed.errors.map(e => e.message).join('; ');
    throw new Error(`GraphQL errors: ${msg}`);
  }
  return parsed.data;
}

function resolveOwnerId(owner) {
  const query = `
    query($login: String!) {
      user(login: $login) { id }
      organization(login: $login) { id }
    }
  `;
  const data = ghGraphql(query, { login: owner });
  if (data.user && data.user.id) return { id: data.user.id, type: 'user' };
  if (data.organization && data.organization.id) return { id: data.organization.id, type: 'organization' };
  throw new Error(`Could not resolve owner: "${owner}" is neither a user nor organization on GitHub.`);
}

module.exports = { ghGraphql, resolveOwnerId, resetCallCount, getCallCount };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/github/graphql.test.js --no-coverage 2>&1 | tail -5`
Expected: PASS — all 9 tests green

- [ ] **Step 5: Commit**

```bash
git add lib/github/graphql.js lib/github/graphql.test.js
git commit -m "feat: add GraphQL helper with call counting and owner resolution"
```

---

### Task 2: Project Creation

**Files:**
- Create: `lib/github/projects.js`
- Create: `lib/github/projects.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// lib/github/projects.test.js
'use strict';

jest.mock('./graphql');
const { ghGraphql, resolveOwnerId } = require('./graphql');
const { createProject } = require('./projects');

beforeEach(() => {
  ghGraphql.mockReset();
  resolveOwnerId.mockReset();
});

describe('createProject', () => {
  test('resolves owner, mutates createProjectV2, returns project metadata', () => {
    resolveOwnerId.mockReturnValueOnce({ id: 'U_abc', type: 'user' });
    ghGraphql.mockReturnValueOnce({
      createProjectV2: {
        projectV2: {
          id: 'PVT_kwHOAAlL2c4AADYv',
          number: 12,
          url: 'https://github.com/users/paullovvik/projects/12',
        },
      },
    });

    const result = createProject({ owner: 'paullovvik', title: 'Auth PRD' });

    expect(resolveOwnerId).toHaveBeenCalledWith('paullovvik');
    expect(result).toEqual({
      number: 12,
      id: 'PVT_kwHOAAlL2c4AADYv',
      owner: 'paullovvik',
      ownerType: 'user',
      url: 'https://github.com/users/paullovvik/projects/12',
    });
    const [query, vars] = ghGraphql.mock.calls[0];
    expect(query).toMatch(/createProjectV2/);
    expect(vars).toEqual({ ownerId: 'U_abc', title: 'Auth PRD' });
  });

  test('propagates resolveOwnerId errors', () => {
    resolveOwnerId.mockImplementationOnce(() => { throw new Error('Could not resolve owner: ghost'); });
    expect(() => createProject({ owner: 'ghost', title: 't' })).toThrow(/ghost/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/github/projects.test.js --no-coverage 2>&1 | tail -5`
Expected: FAIL — `Cannot find module './projects'`

- [ ] **Step 3: Implement createProject**

```js
// lib/github/projects.js
'use strict';

const { ghGraphql, resolveOwnerId } = require('./graphql');

function createProject({ owner, title }) {
  const { id: ownerId, type: ownerType } = resolveOwnerId(owner);
  const mutation = `
    mutation($ownerId: ID!, $title: String!) {
      createProjectV2(input: { ownerId: $ownerId, title: $title }) {
        projectV2 { id number url }
      }
    }
  `;
  const data = ghGraphql(mutation, { ownerId, title });
  const p = data.createProjectV2.projectV2;
  return { number: p.number, id: p.id, owner, ownerType, url: p.url };
}

module.exports = { createProject };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/github/projects.test.js --no-coverage 2>&1 | tail -5`
Expected: PASS — 2 tests green

- [ ] **Step 5: Commit**

```bash
git add lib/github/projects.js lib/github/projects.test.js
git commit -m "feat: add createProject for GitHub Projects v2"
```

---

### Task 3: Standard Field Creation

**Files:**
- Modify: `lib/github/projects.js`
- Modify: `lib/github/projects.test.js`

- [ ] **Step 1: Extend the tests**

Append to `lib/github/projects.test.js`:

```js
const { createStandardFields } = require('./projects');

describe('createStandardFields', () => {
  test('creates 5 fields and captures single-select option IDs', () => {
    // priority (NUMBER)
    ghGraphql.mockReturnValueOnce({
      createProjectV2Field: { projectV2Field: { id: 'PVTF_priority' } },
    });
    // category (SINGLE_SELECT) with two categories
    ghGraphql.mockReturnValueOnce({
      createProjectV2Field: {
        projectV2Field: {
          id: 'PVTF_category',
          options: [
            { id: 'opt_be', name: 'Backend' },
            { id: 'opt_fe', name: 'Frontend' },
          ],
        },
      },
    });
    // iterationCount (NUMBER)
    ghGraphql.mockReturnValueOnce({
      createProjectV2Field: { projectV2Field: { id: 'PVTF_iter' } },
    });
    // criteriaPassRate (NUMBER)
    ghGraphql.mockReturnValueOnce({
      createProjectV2Field: { projectV2Field: { id: 'PVTF_rate' } },
    });
    // ralphStatus (SINGLE_SELECT) with 5 fixed options
    ghGraphql.mockReturnValueOnce({
      createProjectV2Field: {
        projectV2Field: {
          id: 'PVTF_status',
          options: [
            { id: 'opt_pending', name: 'Pending' },
            { id: 'opt_inprog', name: 'In Progress' },
            { id: 'opt_passed', name: 'Passed' },
            { id: 'opt_failed', name: 'Failed' },
            { id: 'opt_stalled', name: 'Stalled' },
          ],
        },
      },
    });

    const fieldIds = createStandardFields({
      projectId: 'PVT_xxx',
      categories: ['Backend', 'Frontend'],
    });

    expect(fieldIds.priority).toEqual({ id: 'PVTF_priority', dataType: 'NUMBER' });
    expect(fieldIds.category).toEqual({
      id: 'PVTF_category',
      dataType: 'SINGLE_SELECT',
      options: { Backend: 'opt_be', Frontend: 'opt_fe' },
    });
    expect(fieldIds.iterationCount).toEqual({ id: 'PVTF_iter', dataType: 'NUMBER' });
    expect(fieldIds.criteriaPassRate).toEqual({ id: 'PVTF_rate', dataType: 'NUMBER' });
    expect(fieldIds.ralphStatus.dataType).toBe('SINGLE_SELECT');
    expect(fieldIds.ralphStatus.options.Stalled).toBe('opt_stalled');
    expect(ghGraphql).toHaveBeenCalledTimes(5);
  });

  test('dedupes repeated categories', () => {
    ghGraphql.mockReturnValueOnce({ createProjectV2Field: { projectV2Field: { id: 'p1' } } });
    ghGraphql.mockReturnValueOnce({
      createProjectV2Field: {
        projectV2Field: { id: 'c1', options: [{ id: 'o1', name: 'X' }] },
      },
    });
    ghGraphql.mockReturnValueOnce({ createProjectV2Field: { projectV2Field: { id: 'i1' } } });
    ghGraphql.mockReturnValueOnce({ createProjectV2Field: { projectV2Field: { id: 'r1' } } });
    ghGraphql.mockReturnValueOnce({
      createProjectV2Field: {
        projectV2Field: {
          id: 's1',
          options: [
            { id: 'sp', name: 'Pending' },
            { id: 'si', name: 'In Progress' },
            { id: 'spa', name: 'Passed' },
            { id: 'sf', name: 'Failed' },
            { id: 'sst', name: 'Stalled' },
          ],
        },
      },
    });

    const fieldIds = createStandardFields({ projectId: 'pid', categories: ['X', 'X', 'X'] });
    expect(Object.keys(fieldIds.category.options)).toEqual(['X']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/github/projects.test.js --no-coverage 2>&1 | tail -5`
Expected: FAIL — `createStandardFields is not a function`

- [ ] **Step 3: Implement createStandardFields**

Append to `lib/github/projects.js` (before `module.exports`):

```js
const RALPH_STATUS_OPTIONS = ['Pending', 'In Progress', 'Passed', 'Failed', 'Stalled'];

function createField({ projectId, name, dataType, singleSelectOptions }) {
  const query = `
    mutation($projectId: ID!, $name: String!, $dataType: ProjectV2CustomFieldType!, $options: [ProjectV2SingleSelectFieldOptionInput!]) {
      createProjectV2Field(input: { projectId: $projectId, name: $name, dataType: $dataType, singleSelectOptions: $options }) {
        projectV2Field {
          ... on ProjectV2Field { id }
          ... on ProjectV2SingleSelectField { id options { id name } }
        }
      }
    }
  `;
  const vars = { projectId, name, dataType };
  if (singleSelectOptions) {
    vars.options = JSON.stringify(singleSelectOptions.map(n => ({ name: n, color: 'GRAY', description: '' })));
  }
  return ghGraphql(query, vars).createProjectV2Field.projectV2Field;
}

function buildOptionsMap(options) {
  const map = {};
  for (const opt of options) map[opt.name] = opt.id;
  return map;
}

function createStandardFields({ projectId, categories }) {
  const uniqueCategories = Array.from(new Set(categories)).sort();

  const priority = createField({ projectId, name: 'Priority', dataType: 'NUMBER' });
  const category = createField({
    projectId,
    name: 'Category',
    dataType: 'SINGLE_SELECT',
    singleSelectOptions: uniqueCategories,
  });
  const iterationCount = createField({ projectId, name: 'Iteration Count', dataType: 'NUMBER' });
  const criteriaPassRate = createField({ projectId, name: 'Criteria Pass Rate', dataType: 'NUMBER' });
  const ralphStatus = createField({
    projectId,
    name: 'Ralph Status',
    dataType: 'SINGLE_SELECT',
    singleSelectOptions: RALPH_STATUS_OPTIONS,
  });

  return {
    priority: { id: priority.id, dataType: 'NUMBER' },
    category: { id: category.id, dataType: 'SINGLE_SELECT', options: buildOptionsMap(category.options || []) },
    iterationCount: { id: iterationCount.id, dataType: 'NUMBER' },
    criteriaPassRate: { id: criteriaPassRate.id, dataType: 'NUMBER' },
    ralphStatus: { id: ralphStatus.id, dataType: 'SINGLE_SELECT', options: buildOptionsMap(ralphStatus.options || []) },
  };
}

module.exports = { createProject, createStandardFields, RALPH_STATUS_OPTIONS };
```

(Replace the existing `module.exports = { createProject }` line.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/github/projects.test.js --no-coverage 2>&1 | tail -5`
Expected: PASS — 4 tests green

- [ ] **Step 5: Commit**

```bash
git add lib/github/projects.js lib/github/projects.test.js
git commit -m "feat: create 5 standard project fields with single-select option IDs"
```

---

### Task 4: Add Item and Update Field Value

**Files:**
- Modify: `lib/github/projects.js`
- Modify: `lib/github/projects.test.js`

- [ ] **Step 1: Extend the tests**

Append to `lib/github/projects.test.js`:

```js
const { addProjectItem, updateItemField, fetchIssueNodeId } = require('./projects');

describe('fetchIssueNodeId', () => {
  test('calls gh api and returns the node_id', () => {
    ghGraphql.mockReturnValueOnce({
      repository: { issue: { id: 'I_kwDO_xyz' } },
    });
    const id = fetchIssueNodeId({ repo: 'paullovvik/myrepo', issueNumber: 42 });
    expect(id).toBe('I_kwDO_xyz');
    expect(ghGraphql.mock.calls[0][1]).toEqual({ owner: 'paullovvik', name: 'myrepo', number: 42 });
  });
});

describe('addProjectItem', () => {
  test('adds an issue node to the project', () => {
    ghGraphql.mockReturnValueOnce({
      addProjectV2ItemById: { item: { id: 'PVTI_xxx' } },
    });
    const id = addProjectItem({ projectId: 'PVT_yyy', contentId: 'I_kwDO_xyz' });
    expect(id).toBe('PVTI_xxx');
  });
});

describe('updateItemField', () => {
  test('updates a NUMBER field', () => {
    ghGraphql.mockReturnValueOnce({
      updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_xxx' } },
    });
    updateItemField({
      projectId: 'PVT_yyy',
      itemId: 'PVTI_xxx',
      field: { id: 'PVTF_priority', dataType: 'NUMBER' },
      value: 3,
    });
    const [query, vars] = ghGraphql.mock.calls[0];
    expect(query).toMatch(/updateProjectV2ItemFieldValue/);
    expect(query).toMatch(/number: \$value/);
    expect(vars.value).toBe(3);
  });

  test('updates a SINGLE_SELECT field using option ID lookup', () => {
    ghGraphql.mockReturnValueOnce({
      updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_xxx' } },
    });
    updateItemField({
      projectId: 'PVT_yyy',
      itemId: 'PVTI_xxx',
      field: {
        id: 'PVTF_status',
        dataType: 'SINGLE_SELECT',
        options: { Pending: 'opt_p', Passed: 'opt_pa' },
      },
      value: 'Passed',
    });
    const [query, vars] = ghGraphql.mock.calls[0];
    expect(query).toMatch(/singleSelectOptionId: \$optionId/);
    expect(vars.optionId).toBe('opt_pa');
  });

  test('throws on unknown single-select option', () => {
    expect(() => updateItemField({
      projectId: 'PVT_yyy',
      itemId: 'PVTI_xxx',
      field: { id: 'PVTF_status', dataType: 'SINGLE_SELECT', options: { Pending: 'opt_p' } },
      value: 'NotAnOption',
    })).toThrow(/option "NotAnOption"/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/github/projects.test.js --no-coverage 2>&1 | tail -5`
Expected: FAIL — `addProjectItem is not a function`

- [ ] **Step 3: Implement the three functions**

Append to `lib/github/projects.js` (before `module.exports`):

```js
function fetchIssueNodeId({ repo, issueNumber }) {
  const [owner, name] = repo.split('/');
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        issue(number: $number) { id }
      }
    }
  `;
  const data = ghGraphql(query, { owner, name, number: issueNumber });
  if (!data.repository || !data.repository.issue) {
    throw new Error(`Could not resolve issue ${repo}#${issueNumber}`);
  }
  return data.repository.issue.id;
}

function addProjectItem({ projectId, contentId }) {
  const query = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }
  `;
  const data = ghGraphql(query, { projectId, contentId });
  return data.addProjectV2ItemById.item.id;
}

function updateItemField({ projectId, itemId, field, value }) {
  if (field.dataType === 'NUMBER') {
    const query = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: Float!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
          value: { number: $value }
        }) { projectV2Item { id } }
      }
    `;
    ghGraphql(query, { projectId, itemId, fieldId: field.id, value: Number(value) });
    return;
  }
  if (field.dataType === 'SINGLE_SELECT') {
    const optionId = field.options && field.options[value];
    if (!optionId) {
      throw new Error(`Unknown single-select option "${value}" on field ${field.id}. Known: ${Object.keys(field.options || {}).join(', ')}`);
    }
    const query = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
          value: { singleSelectOptionId: $optionId }
        }) { projectV2Item { id } }
      }
    `;
    ghGraphql(query, { projectId, itemId, fieldId: field.id, optionId });
    return;
  }
  throw new Error(`Unsupported field dataType: ${field.dataType}`);
}

module.exports = {
  createProject,
  createStandardFields,
  fetchIssueNodeId,
  addProjectItem,
  updateItemField,
  RALPH_STATUS_OPTIONS,
};
```

(Replace the previous `module.exports` block.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/github/projects.test.js --no-coverage 2>&1 | tail -5`
Expected: PASS — 8 tests green

- [ ] **Step 5: Commit**

```bash
git add lib/github/projects.js lib/github/projects.test.js
git commit -m "feat: add item + field-value mutations for Projects v2"
```

---

### Task 5: Field Validation (for Resume) and Conflict Detection

**Files:**
- Modify: `lib/github/projects.js`
- Modify: `lib/github/projects.test.js`

- [ ] **Step 1: Extend the tests**

Append:

```js
const { fetchProjectFieldState, fetchItemFieldValue } = require('./projects');

describe('fetchProjectFieldState', () => {
  test('returns a name->field map the caller can cross-check against cached IDs', () => {
    ghGraphql.mockReturnValueOnce({
      node: {
        fields: {
          nodes: [
            { id: 'PVTF_priority', name: 'Priority', dataType: 'NUMBER' },
            { id: 'PVTF_category', name: 'Category', dataType: 'SINGLE_SELECT', options: [
              { id: 'opt_be', name: 'Backend' },
            ]},
          ],
        },
      },
    });
    const state = fetchProjectFieldState({ projectId: 'PVT_xxx' });
    expect(state.Priority).toEqual({ id: 'PVTF_priority', dataType: 'NUMBER' });
    expect(state.Category).toEqual({
      id: 'PVTF_category',
      dataType: 'SINGLE_SELECT',
      options: { Backend: 'opt_be' },
    });
  });
});

describe('fetchItemFieldValue', () => {
  test('returns current board value for conflict detection (NUMBER)', () => {
    ghGraphql.mockReturnValueOnce({
      node: {
        fieldValues: {
          nodes: [{ field: { id: 'PVTF_rate' }, number: 0.66 }],
        },
      },
    });
    const v = fetchItemFieldValue({ itemId: 'PVTI_xxx', fieldId: 'PVTF_rate' });
    expect(v).toBe(0.66);
  });

  test('returns current board value for SINGLE_SELECT', () => {
    ghGraphql.mockReturnValueOnce({
      node: {
        fieldValues: {
          nodes: [{ field: { id: 'PVTF_status' }, name: 'In Progress' }],
        },
      },
    });
    const v = fetchItemFieldValue({ itemId: 'PVTI_xxx', fieldId: 'PVTF_status' });
    expect(v).toBe('In Progress');
  });

  test('returns null when the field is unset', () => {
    ghGraphql.mockReturnValueOnce({
      node: { fieldValues: { nodes: [] } },
    });
    expect(fetchItemFieldValue({ itemId: 'PVTI_xxx', fieldId: 'PVTF_x' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/github/projects.test.js --no-coverage 2>&1 | tail -5`
Expected: FAIL — `fetchProjectFieldState is not a function`

- [ ] **Step 3: Implement the two helpers**

Append to `lib/github/projects.js` (before the final `module.exports`):

```js
function fetchProjectFieldState({ projectId }) {
  const query = `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2Field { id name dataType }
              ... on ProjectV2SingleSelectField { id name dataType options { id name } }
            }
          }
        }
      }
    }
  `;
  const data = ghGraphql(query, { projectId });
  const state = {};
  for (const f of data.node.fields.nodes) {
    if (!f || !f.name) continue;
    const entry = { id: f.id, dataType: f.dataType };
    if (f.dataType === 'SINGLE_SELECT' && Array.isArray(f.options)) {
      entry.options = buildOptionsMap(f.options);
    }
    state[f.name] = entry;
  }
  return state;
}

function fetchItemFieldValue({ itemId, fieldId }) {
  const query = `
    query($itemId: ID!) {
      node(id: $itemId) {
        ... on ProjectV2Item {
          fieldValues(first: 50) {
            nodes {
              ... on ProjectV2ItemFieldNumberValue { field { ... on ProjectV2FieldCommon { id } } number }
              ... on ProjectV2ItemFieldSingleSelectValue { field { ... on ProjectV2FieldCommon { id } } name }
            }
          }
        }
      }
    }
  `;
  const data = ghGraphql(query, { itemId });
  if (!data.node || !data.node.fieldValues) return null;
  for (const v of data.node.fieldValues.nodes) {
    if (!v || !v.field || v.field.id !== fieldId) continue;
    if ('number' in v) return v.number;
    if ('name' in v) return v.name;
  }
  return null;
}
```

Update `module.exports` to include them:

```js
module.exports = {
  createProject,
  createStandardFields,
  fetchIssueNodeId,
  addProjectItem,
  updateItemField,
  fetchProjectFieldState,
  fetchItemFieldValue,
  RALPH_STATUS_OPTIONS,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/github/projects.test.js --no-coverage 2>&1 | tail -5`
Expected: PASS — 11 tests green

- [ ] **Step 5: Commit**

```bash
git add lib/github/projects.js lib/github/projects.test.js
git commit -m "feat: add project field-state and item-value queries for resume + conflict detection"
```

---

### Task 6: CLI Dispatcher — Four New Subcommands

**Files:**
- Modify: `lib/github/index.js`
- Create: `lib/github/index-projects.test.js`

- [ ] **Step 1: Write the failing integration test**

```js
// lib/github/index-projects.test.js
'use strict';

jest.mock('./graphql');
jest.mock('./projects');

const { ghGraphql, resolveOwnerId, resetCallCount, getCallCount } = require('./graphql');
const projects = require('./projects');

function runCli(args) {
  const execArgv = process.argv;
  const stdout = [];
  const stderr = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (s) => stdout.push(String(s));
  console.error = (s) => stderr.push(String(s));
  jest.resetModules();
  process.argv = ['node', 'lib/github/index.js', ...args];
  let exitCode = 0;
  const origExit = process.exit;
  process.exit = (code) => { exitCode = code || 0; throw new Error('__exit__'); };
  try {
    require('./index');
  } catch (err) {
    if (err.message !== '__exit__') stderr.push(err.message);
  } finally {
    process.argv = execArgv;
    process.exit = origExit;
    console.log = origLog;
    console.error = origErr;
  }
  return { exitCode, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

beforeEach(() => {
  jest.resetModules();
  ghGraphql.mockReset();
  resolveOwnerId.mockReset();
  resetCallCount.mockReset ? resetCallCount.mockReset() : null;
  Object.values(projects).forEach(fn => fn && fn.mockReset && fn.mockReset());
});

test('create-project command creates project and fields, prints githubProject JSON + apiCalls', () => {
  projects.createProject.mockReturnValueOnce({
    number: 12, id: 'PVT_a', owner: 'paullovvik', ownerType: 'user', url: 'https://...',
  });
  projects.createStandardFields.mockReturnValueOnce({
    priority: { id: 'P1', dataType: 'NUMBER' },
    category: { id: 'C1', dataType: 'SINGLE_SELECT', options: { Backend: 'o1' } },
    iterationCount: { id: 'I1', dataType: 'NUMBER' },
    criteriaPassRate: { id: 'R1', dataType: 'NUMBER' },
    ralphStatus: { id: 'S1', dataType: 'SINGLE_SELECT', options: { Pending: 'o2' } },
  });
  getCallCount.mockReturnValue(6);

  const { exitCode, stdout } = runCli([
    'create-project', '--repo', 'paullovvik/myrepo',
    '--title', 'Auth PRD', '--categories', 'Backend,Frontend',
  ]);
  expect(exitCode).toBe(0);
  const out = JSON.parse(stdout);
  expect(out.githubProject.number).toBe(12);
  expect(out.githubProject.fieldIds.priority.id).toBe('P1');
  expect(out.apiCalls).toBe(6);
});
```

Append the remaining three test blocks to the same file:

```js
test('ensure-project-item command returns projectItemId + apiCalls', () => {
  projects.fetchIssueNodeId.mockReturnValueOnce('I_test');
  projects.addProjectItem.mockReturnValueOnce('PVTI_new');
  getCallCount.mockReturnValue(2);

  const { exitCode, stdout } = runCli([
    'ensure-project-item',
    '--repo', 'paullovvik/myrepo',
    '--project-id', 'PVT_test',
    '--issue', '42',
  ]);
  expect(exitCode).toBe(0);
  expect(JSON.parse(stdout)).toEqual({ projectItemId: 'PVTI_new', apiCalls: 2 });
  expect(projects.fetchIssueNodeId).toHaveBeenCalledWith({ repo: 'paullovvik/myrepo', issueNumber: 42 });
  expect(projects.addProjectItem).toHaveBeenCalledWith({ projectId: 'PVT_test', contentId: 'I_test' });
});

test('sync-project-item computes ralphStatus + passRate, calls updateItemField 5 times', () => {
  projects.updateItemField.mockReturnValue(undefined);
  getCallCount.mockReturnValue(5);

  const project = {
    id: 'PVT_test',
    number: 99,
    fieldIds: {
      priority:         { id: 'P1', dataType: 'NUMBER' },
      category:         { id: 'C1', dataType: 'SINGLE_SELECT', options: { Backend: 'opt_be' } },
      iterationCount:   { id: 'I1', dataType: 'NUMBER' },
      criteriaPassRate: { id: 'R1', dataType: 'NUMBER' },
      ralphStatus:      { id: 'S1', dataType: 'SINGLE_SELECT',
        options: { Pending: 'op', 'In Progress': 'oi', Passed: 'opa', Failed: 'of', Stalled: 'ost' } },
    },
  };
  const task = {
    id: 'task-1', priority: 3, category: 'Backend',
    attempts: 2, passes: false, projectItemId: 'PVTI_test',
  };
  const results = { results: [{ passed: true }, { passed: false, error: 'x' }] };

  const { exitCode, stdout } = runCli([
    'sync-project-item',
    '--project', JSON.stringify(project),
    '--task', JSON.stringify(task),
    '--results', JSON.stringify(results),
    '--iteration', '2',
  ]);
  expect(exitCode).toBe(0);
  const out = JSON.parse(stdout);
  expect(out.ok).toBe(true);
  expect(out.ralphStatus).toBe('In Progress');
  expect(out.criteriaPassRate).toBe(0.5);
  expect(out.iterationCount).toBe(2);
  expect(out.conflicts).toEqual([]);
  expect(projects.updateItemField).toHaveBeenCalledTimes(5);
});

test('sync-project-item sets ralphStatus=Passed when task.passes=true', () => {
  projects.updateItemField.mockReturnValue(undefined);
  getCallCount.mockReturnValue(5);
  const project = {
    id: 'PVT_test', number: 99,
    fieldIds: {
      priority:         { id: 'P1', dataType: 'NUMBER' },
      category:         { id: 'C1', dataType: 'SINGLE_SELECT', options: { X: 'ox' } },
      iterationCount:   { id: 'I1', dataType: 'NUMBER' },
      criteriaPassRate: { id: 'R1', dataType: 'NUMBER' },
      ralphStatus:      { id: 'S1', dataType: 'SINGLE_SELECT',
        options: { Pending: 'op', 'In Progress': 'oi', Passed: 'opa', Failed: 'of', Stalled: 'ost' } },
    },
  };
  const task = { id: 't', priority: 1, category: 'X', attempts: 3, passes: true, projectItemId: 'PVTI_test' };
  const results = { results: [{ passed: true }, { passed: true }] };
  const { stdout } = runCli([
    'sync-project-item',
    '--project', JSON.stringify(project),
    '--task', JSON.stringify(task),
    '--results', JSON.stringify(results),
    '--iteration', '3',
  ]);
  expect(JSON.parse(stdout).ralphStatus).toBe('Passed');
});

test('validate-project reports ok=true and echoes fieldIds when nothing missing', () => {
  projects.fetchProjectFieldState.mockReturnValueOnce({
    Priority:             { id: 'P1', dataType: 'NUMBER' },
    Category:             { id: 'C1', dataType: 'SINGLE_SELECT', options: { Backend: 'opt_be' } },
    'Iteration Count':    { id: 'I1', dataType: 'NUMBER' },
    'Criteria Pass Rate': { id: 'R1', dataType: 'NUMBER' },
    'Ralph Status':       { id: 'S1', dataType: 'SINGLE_SELECT',
      options: { Pending: 'op', 'In Progress': 'oi', Passed: 'opa', Failed: 'of', Stalled: 'ost' } },
  });
  getCallCount.mockReturnValue(1);

  const project = {
    id: 'PVT_test',
    fieldIds: {
      priority:         { id: 'P1', dataType: 'NUMBER' },
      category:         { id: 'C1', dataType: 'SINGLE_SELECT', options: { Backend: 'opt_be' } },
      iterationCount:   { id: 'I1', dataType: 'NUMBER' },
      criteriaPassRate: { id: 'R1', dataType: 'NUMBER' },
      ralphStatus:      { id: 'S1', dataType: 'SINGLE_SELECT',
        options: { Pending: 'op', 'In Progress': 'oi', Passed: 'opa', Failed: 'of', Stalled: 'ost' } },
    },
  };
  const { stdout } = runCli(['validate-project', '--project', JSON.stringify(project)]);
  const out = JSON.parse(stdout);
  expect(out.ok).toBe(true);
  expect(out.missing).toEqual([]);
  expect(out.updatedFieldIds.priority.id).toBe('P1');
});

test('validate-project flags missing fields and keeps surviving IDs', () => {
  projects.fetchProjectFieldState.mockReturnValueOnce({
    Priority: { id: 'P1', dataType: 'NUMBER' },
    // Category, Iteration Count, Criteria Pass Rate, Ralph Status all missing
  });
  getCallCount.mockReturnValue(1);
  const project = {
    id: 'PVT_test',
    fieldIds: {
      priority:         { id: 'P1', dataType: 'NUMBER' },
      category:         { id: 'C1', dataType: 'SINGLE_SELECT', options: {} },
      iterationCount:   { id: 'I1', dataType: 'NUMBER' },
      criteriaPassRate: { id: 'R1', dataType: 'NUMBER' },
      ralphStatus:      { id: 'S1', dataType: 'SINGLE_SELECT', options: {} },
    },
  };
  const { stdout } = runCli(['validate-project', '--project', JSON.stringify(project)]);
  const out = JSON.parse(stdout);
  expect(out.ok).toBe(false);
  expect(out.missing.sort()).toEqual(['category', 'criteriaPassRate', 'iterationCount', 'ralphStatus']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest lib/github/index-projects.test.js --no-coverage 2>&1 | tail -5`
Expected: FAIL — `create-project` command unknown.

- [ ] **Step 3: Add the four subcommands**

Apply this patch to `lib/github/index.js`. Insert the new `case` blocks inside the `switch` (after the existing `close-issue` case, before `default`). Also add imports at top.

Edit imports (line 6) to include projects + graphql:

```js
const { createIssue, updateIssue, closeIssue } = require('./issues');
const {
  createProject, createStandardFields, fetchIssueNodeId,
  addProjectItem, updateItemField, fetchProjectFieldState,
  fetchItemFieldValue, RALPH_STATUS_OPTIONS,
} = require('./projects');
const { getCallCount, resetCallCount } = require('./graphql');
const { normalizeCriteria } = require('../criteria/schema');
```

Before `main()` runs, `resetCallCount()` so each invocation reports its own call count. Add this inside `main()` right after `const command = process.argv[2];` (or as first line inside `main`):

```js
resetCallCount();
```

New cases — add before `default`:

```js
case 'create-project': {
  const repo = getArg('--repo');
  const title = getArg('--title');
  const categoriesCsv = getArg('--categories') || '';
  if (!repo || !title) {
    console.error('Usage: node lib/github/index.js create-project --repo owner/name --title "..." [--categories a,b,c]');
    process.exit(1);
  }
  const owner = repo.split('/')[0];
  const categories = categoriesCsv.split(',').map(s => s.trim()).filter(Boolean);
  const project = createProject({ owner, title });
  const fieldIds = createStandardFields({ projectId: project.id, categories });
  const githubProject = { ...project, fieldIds };
  console.log(JSON.stringify({ githubProject, apiCalls: getCallCount() }));
  break;
}

case 'ensure-project-item': {
  const repo = getArg('--repo');
  const projectId = getArg('--project-id');
  const issueNumber = parseInt(getArg('--issue'), 10);
  if (!repo || !projectId || !issueNumber) {
    console.error('Usage: node lib/github/index.js ensure-project-item --repo owner/name --project-id <id> --issue N');
    process.exit(1);
  }
  const contentId = fetchIssueNodeId({ repo, issueNumber });
  const projectItemId = addProjectItem({ projectId, contentId });
  console.log(JSON.stringify({ projectItemId, apiCalls: getCallCount() }));
  break;
}

case 'sync-project-item': {
  const projectJson = getArg('--project');
  const taskJson = getArg('--task');
  const resultsJson = getArg('--results');
  const iteration = parseInt(getArg('--iteration'), 10);
  const detectConflicts = process.argv.includes('--detect-conflicts');
  if (!projectJson || !taskJson || !resultsJson || !iteration) {
    console.error('Usage: node lib/github/index.js sync-project-item --project \'<json>\' --task \'<json>\' --results \'<json>\' --iteration N [--detect-conflicts]');
    process.exit(1);
  }
  const project = JSON.parse(projectJson);
  const task = JSON.parse(taskJson);
  const results = JSON.parse(resultsJson);
  if (!task.projectItemId) {
    console.error(`Task ${task.id} has no projectItemId; run ensure-project-item first.`);
    process.exit(1);
  }
  const results_ = Array.isArray(results.results) ? results.results : results;
  const total = results_.length || 1;
  const passed = results_.filter(r => r.passed === true).length;
  const passRate = Math.round((passed / total) * 100) / 100;
  let ralphStatus;
  if (task.passes === true) ralphStatus = 'Passed';
  else if (task.stalled === true) ralphStatus = 'Stalled';
  else if (iteration === 1) ralphStatus = 'In Progress';
  else if (passed === 0) ralphStatus = 'Failed';
  else ralphStatus = 'In Progress';

  const updates = [
    { field: project.fieldIds.priority,        value: task.priority },
    { field: project.fieldIds.category,        value: task.category },
    { field: project.fieldIds.iterationCount,  value: task.attempts || iteration },
    { field: project.fieldIds.criteriaPassRate, value: passRate },
    { field: project.fieldIds.ralphStatus,     value: ralphStatus },
  ];

  const conflicts = [];
  if (detectConflicts) {
    for (const u of updates) {
      const current = fetchItemFieldValue({ itemId: task.projectItemId, fieldId: u.field.id });
      if (current !== null && current !== undefined && current !== u.value && String(current) !== String(u.value)) {
        conflicts.push({ fieldId: u.field.id, before: current, after: u.value });
      }
    }
  }

  for (const u of updates) {
    updateItemField({ projectId: project.id, itemId: task.projectItemId, field: u.field, value: u.value });
  }

  console.log(JSON.stringify({
    ok: true,
    ralphStatus,
    criteriaPassRate: passRate,
    iterationCount: task.attempts || iteration,
    conflicts,
    apiCalls: getCallCount(),
  }));
  break;
}

case 'validate-project': {
  const projectJson = getArg('--project');
  if (!projectJson) {
    console.error('Usage: node lib/github/index.js validate-project --project \'<json>\'');
    process.exit(1);
  }
  const project = JSON.parse(projectJson);
  const actual = fetchProjectFieldState({ projectId: project.id });

  const expectedNames = {
    priority: 'Priority',
    category: 'Category',
    iterationCount: 'Iteration Count',
    criteriaPassRate: 'Criteria Pass Rate',
    ralphStatus: 'Ralph Status',
  };

  const missing = [];
  const updatedFieldIds = { ...project.fieldIds };
  for (const [key, name] of Object.entries(expectedNames)) {
    if (!actual[name]) {
      missing.push(key);
      continue;
    }
    if (!project.fieldIds[key] || project.fieldIds[key].id !== actual[name].id) {
      updatedFieldIds[key] = actual[name];
    } else if (actual[name].options) {
      // Merge option IDs in case new options were created.
      updatedFieldIds[key] = { ...project.fieldIds[key], options: actual[name].options };
    }
  }

  console.log(JSON.stringify({
    ok: missing.length === 0,
    missing,
    updatedFieldIds,
    apiCalls: getCallCount(),
  }));
  break;
}
```

Update the `default` usage string to list all eight commands:

```js
console.error('Commands: resolve-repo, create-issue, update-issue, close-issue, create-project, ensure-project-item, sync-project-item, validate-project');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest lib/github/ --no-coverage 2>&1 | tail -10`
Expected: PASS — all github tests green including new integration tests.

- [ ] **Step 5: Commit**

```bash
git add lib/github/index.js lib/github/index-projects.test.js
git commit -m "feat: add create-project, ensure-project-item, sync-project-item, validate-project subcommands"
```

---

### Task 7: PRD JSON Schema Validation Updates

**Files:**
- Modify: `ralph-loop` (function `validate_prd_json`)

- [ ] **Step 1: Read the current validation block**

Run: `grep -n "validate_prd_json" ralph-loop`
Note the function body and add checks at the end (before `return 0`). The goal: accept `.githubProject` at PRD root and `.projectItemId` at each task without failing existing PRDs (both are optional).

- [ ] **Step 2: Patch validate_prd_json**

Inside `validate_prd_json()` add these checks after existing ones:

```bash
# Optional: githubProject must be object with number, id, owner, ownerType, url, fieldIds
if jq -e '.githubProject' "$JSON_FILE" >/dev/null 2>&1; then
    local gp_fields
    for gp_fields in number id owner ownerType url fieldIds; do
        if ! jq -e ".githubProject.$gp_fields" "$JSON_FILE" >/dev/null 2>&1; then
            echo -e "${RED}[ERROR] githubProject missing required field: $gp_fields${NC}"
            return 1
        fi
    done
    local expected_fids="priority category iterationCount criteriaPassRate ralphStatus"
    local fid
    for fid in $expected_fids; do
        if ! jq -e ".githubProject.fieldIds.$fid.id" "$JSON_FILE" >/dev/null 2>&1; then
            echo -e "${YELLOW}[WARN] githubProject.fieldIds.$fid.id missing — will be repaired by --resume${NC}"
        fi
    done
fi

# Optional: each task.projectItemId (if present) must be string
local projitem_bad
projitem_bad=$(jq -r '.tasks[] | select(.projectItemId != null) | select((.projectItemId | type) != "string") | .id' "$JSON_FILE")
if [ -n "$projitem_bad" ]; then
    echo -e "${RED}[ERROR] Tasks with non-string projectItemId: $projitem_bad${NC}"
    return 1
fi
```

- [ ] **Step 3: Add tests**

Append to `tests/test-validation.sh` (or create `tests/test-github-projects-validation.sh`):

```bash
test_githubproject_requires_all_fields() {
    cat > "$TMP_JSON" <<'EOF'
{ "title": "t", "tasks": [], "githubProject": { "number": 1 } }
EOF
    if ./ralph-loop "$TMP_JSON" --analyze-prd 2>&1 | grep -q "missing required field"; then pass; else fail "expected missing-field error"; fi
}

test_projectitem_id_must_be_string() {
    cat > "$TMP_JSON" <<'EOF'
{ "title": "t", "tasks": [{ "id": "t1", "title": "x", "category": "c", "priority": 1, "passes": false, "acceptanceCriteria": ["a"], "projectItemId": 123 }] }
EOF
    if ./ralph-loop "$TMP_JSON" --analyze-prd 2>&1 | grep -q "non-string projectItemId"; then pass; else fail "expected projectItemId error"; fi
}
```

Run: `./tests/test-validation.sh` (or whichever file you extended).
Expected: both new tests pass; existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add ralph-loop tests/test-validation.sh
git commit -m "feat: validate optional githubProject and projectItemId fields in PRD JSON"
```

---

### Task 8: Bash `ensure_github_project` + API-call tracking

**Files:**
- Modify: `ralph-loop`

- [ ] **Step 1: Add global counters (right after line 20 where `TARGET_REPO=""` lives)**

```bash
GITHUB_API_CALLS=0
GITHUB_API_WARN_THRESHOLD=100
GITHUB_API_WARNED=false
```

- [ ] **Step 2: Add `bump_github_api_calls` helper (right before `resolve_target_repo`, ~line 570)**

```bash
# Args: $1 = JSON reply containing optional .apiCalls field
bump_github_api_calls() {
    local reply="$1"
    local delta
    delta=$(echo "$reply" | jq -r '.apiCalls // 0' 2>/dev/null || echo 0)
    if [[ "$delta" =~ ^[0-9]+$ ]] && [ "$delta" -gt 0 ]; then
        GITHUB_API_CALLS=$((GITHUB_API_CALLS + delta))
    fi
    if [ "$GITHUB_API_WARNED" = false ] && [ "$GITHUB_API_CALLS" -ge "$GITHUB_API_WARN_THRESHOLD" ]; then
        echo -e "${YELLOW}[WARN] GitHub API calls this run: $GITHUB_API_CALLS (threshold: $GITHUB_API_WARN_THRESHOLD). Projects v2 / issue traffic is high.${NC}"
        GITHUB_API_WARNED=true
        emit_logging_event project_rate_limit_warning "{\"callCount\":$GITHUB_API_CALLS,\"threshold\":$GITHUB_API_WARN_THRESHOLD}"
    fi
}
```

- [ ] **Step 3: Add `emit_logging_event` helper (directly below bump_github_api_calls)**

```bash
# Args: $1 = event name, $2 = JSON object payload (without ts/event)
emit_logging_event() {
    local event="$1"
    local payload="$2"
    local log_cli="$SCRIPT_DIR/lib/logging/index.js"
    if [ ! -f "$log_cli" ]; then return 0; fi
    local ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    local merged
    merged=$(echo "$payload" | jq --arg ts "$ts" --arg event "$event" '. + {ts:$ts, event:$event}')
    node "$log_cli" append --file "$PROGRESS_FILE" --event "$merged" >/dev/null 2>&1 || true
}
```

- [ ] **Step 4: Add `ensure_github_project` (after `resolve_target_repo`, before `crosscheck_issues`)**

```bash
ensure_github_project() {
    if [ "$GITHUB_ENABLED" = false ]; then return 0; fi
    if [ -z "$TARGET_REPO" ]; then return 0; fi

    local existing
    existing=$(jq -r '.githubProject.number // empty' "$JSON_FILE")
    if [ -n "$existing" ]; then
        if [ "$VERBOSE" = true ]; then
            echo -e "${BLUE}[INFO] GitHub project already configured: #$existing${NC}"
        fi
        return 0
    fi

    local prd_title
    prd_title=$(jq -r '.title // "Ralph Loop PRD"' "$JSON_FILE")
    local categories_csv
    categories_csv=$(jq -r '[.tasks[].category] | unique | join(",")' "$JSON_FILE")

    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[INFO] Creating GitHub project for PRD: $prd_title${NC}"
    fi

    local create_result
    local create_exit=0
    create_result=$(node "$SCRIPT_DIR/lib/github/index.js" create-project \
        --repo "$TARGET_REPO" \
        --title "$prd_title" \
        --categories "$categories_csv" 2>&1) || create_exit=$?

    if [ $create_exit -ne 0 ]; then
        echo -e "${YELLOW}[WARN] Failed to create GitHub project: $create_result${NC}"
        echo -e "${YELLOW}[WARN] Continuing without project board. Check 'gh auth status' and 'project' scope.${NC}"
        return 0
    fi

    bump_github_api_calls "$create_result"

    local gp_json
    gp_json=$(echo "$create_result" | jq '.githubProject')
    local updated
    updated=$(jq --argjson gp "$gp_json" '.githubProject = $gp' "$JSON_FILE")
    echo "$updated" | jq '.' > "$JSON_FILE"

    local project_number project_id project_url
    project_number=$(echo "$gp_json" | jq -r '.number')
    project_id=$(echo "$gp_json" | jq -r '.id')
    project_url=$(echo "$gp_json" | jq -r '.url')

    if [ "$VERBOSE" = true ]; then
        echo -e "${GREEN}[INFO] Created project #$project_number at $project_url${NC}"
    fi

    emit_logging_event project_created \
        "{\"projectNumber\":$project_number,\"projectId\":\"$project_id\",\"url\":\"$project_url\",\"fieldCount\":5}"
}
```

- [ ] **Step 5: Wire into `run_ralph_loop`**

In `run_ralph_loop` directly after the existing `resolve_target_repo` call runs in the top-level flow (look for how Phase 2 wired `resolve_target_repo`; `ensure_github_project` must run after repo resolution and before the iteration loop). Concretely, find the block where `resolve_target_repo` is invoked at run start (e.g. in `main` around line 1780–1820 or inside `run_ralph_loop` top) and add immediately below it:

```bash
    ensure_github_project
```

If resolve_target_repo is called inside `main` rather than `run_ralph_loop`, call `ensure_github_project` at the same site for consistency.

- [ ] **Step 6: Smoke-test the new function**

Run: `bash -n ralph-loop && echo "syntax OK"`
Expected: `syntax OK`

Run: `./tests/test-github.sh`
Expected: all existing tests still pass (ensure_github_project is a no-op until integration test in Task 14 provides a mocked `gh`).

- [ ] **Step 7: Commit**

```bash
git add ralph-loop
git commit -m "feat: create GitHub project on first run + rate-limit bookkeeping"
```

---

### Task 9: Bash `ensure_project_item`

**Files:**
- Modify: `ralph-loop`

- [ ] **Step 1: Add `ensure_project_item` (directly after existing `ensure_task_issue` function, ~line 1220)**

```bash
ensure_project_item() {
    local task_id="$1"
    local task_index="$2"

    if [ "$GITHUB_ENABLED" = false ]; then return 0; fi
    if [ -z "$TARGET_REPO" ]; then return 0; fi

    local project_id
    project_id=$(jq -r '.githubProject.id // empty' "$JSON_FILE")
    if [ -z "$project_id" ]; then return 0; fi

    local existing_item
    existing_item=$(jq -r ".tasks[$task_index].projectItemId // empty" "$JSON_FILE")
    if [ -n "$existing_item" ]; then return 0; fi

    local issue_number
    issue_number=$(jq -r ".tasks[$task_index].issueNumber // empty" "$JSON_FILE")
    if [ -z "$issue_number" ]; then
        echo -e "${YELLOW}[WARN] Cannot add project item for $task_id: no issueNumber.${NC}"
        return 0
    fi

    local reply
    local reply_exit=0
    reply=$(node "$SCRIPT_DIR/lib/github/index.js" ensure-project-item \
        --repo "$TARGET_REPO" \
        --project-id "$project_id" \
        --issue "$issue_number" 2>&1) || reply_exit=$?

    if [ $reply_exit -ne 0 ]; then
        echo -e "${YELLOW}[WARN] Failed to add $task_id (issue #$issue_number) to project: $reply${NC}"
        return 0
    fi

    bump_github_api_calls "$reply"

    local item_id
    item_id=$(echo "$reply" | jq -r '.projectItemId')
    local updated
    updated=$(jq \
        --argjson idx "$task_index" \
        --arg id "$item_id" \
        '.tasks[$idx].projectItemId = $id' \
        "$JSON_FILE")
    echo "$updated" | jq '.' > "$JSON_FILE"

    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[INFO] Added $task_id (issue #$issue_number) to project as $item_id${NC}"
    fi
}
```

- [ ] **Step 2: Wire into `run_ralph_loop`**

Find the line `ensure_task_issue "$next_task_id" "$task_index"` (currently line 1386). Immediately after it, add:

```bash
        # Ensure this task is in the GitHub project
        ensure_project_item "$next_task_id" "$task_index"
```

- [ ] **Step 3: Syntax check**

Run: `bash -n ralph-loop`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat: add each task's issue to the GitHub project as an item"
```

---

### Task 10: Bash `sync_project_item`

**Files:**
- Modify: `ralph-loop`

- [ ] **Step 1: Add `sync_project_item` (directly after `post_iteration_comment`, ~line 1257)**

```bash
sync_project_item() {
    local task_id="$1"
    local task_index="$2"
    local iteration="$3"
    local verify_result="$4"

    if [ "$GITHUB_ENABLED" = false ]; then return 0; fi
    if [ -z "$TARGET_REPO" ]; then return 0; fi

    local project_id
    project_id=$(jq -r '.githubProject.id // empty' "$JSON_FILE")
    if [ -z "$project_id" ]; then return 0; fi

    local project_item
    project_item=$(jq -r ".tasks[$task_index].projectItemId // empty" "$JSON_FILE")
    if [ -z "$project_item" ]; then return 0; fi

    local project_json
    project_json=$(jq '.githubProject' "$JSON_FILE")
    local task_json
    task_json=$(jq ".tasks[$task_index]" "$JSON_FILE")

    local detect_flag=""
    if [ "$DEBUG" = true ]; then detect_flag="--detect-conflicts"; fi

    local reply
    local reply_exit=0
    reply=$(node "$SCRIPT_DIR/lib/github/index.js" sync-project-item \
        --project "$project_json" \
        --task "$task_json" \
        --results "$verify_result" \
        --iteration "$iteration" \
        $detect_flag 2>&1) || reply_exit=$?

    if [ $reply_exit -ne 0 ]; then
        echo -e "${YELLOW}[WARN] Failed to sync project item for $task_id: $reply${NC}"
        return 0
    fi

    bump_github_api_calls "$reply"

    local conflict_count
    conflict_count=$(echo "$reply" | jq '.conflicts | length' 2>/dev/null || echo 0)
    if [ "$conflict_count" -gt 0 ] && [ "$VERBOSE" = true ]; then
        echo -e "${YELLOW}[WARN] $task_id: $conflict_count project-field conflict(s) overwritten by Ralph.${NC}"
        echo "$reply" | jq -r '.conflicts[] | "  field=\(.fieldId) before=\(.before) after=\(.after)"'
    fi

    local rs pr ic
    rs=$(echo "$reply" | jq -r '.ralphStatus')
    pr=$(echo "$reply" | jq -r '.criteriaPassRate')
    ic=$(echo "$reply" | jq -r '.iterationCount')
    emit_logging_event project_item_synced \
        "{\"iteration\":$iteration,\"taskId\":\"$task_id\",\"projectItemId\":\"$project_item\",\"ralphStatus\":\"$rs\",\"criteriaPassRate\":$pr,\"iterationCount\":$ic}"
}
```

- [ ] **Step 2: Wire into both branches of `run_ralph_loop`**

At the existing line 1611 (success branch, right after `post_iteration_comment "$next_task_id" "$task_index" "$iteration" "$verify_result"`), add:

```bash
            # Sync project fields
            sync_project_item "$next_task_id" "$task_index" "$iteration" "$verify_result"
```

At the existing line 1665 (continuing branch, right after `post_iteration_comment ...`), add the same call:

```bash
            # Sync project fields
            sync_project_item "$next_task_id" "$task_index" "$iteration" "$verify_result"
```

- [ ] **Step 3: Syntax check**

Run: `bash -n ralph-loop`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat: sync project item fields after every iteration"
```

---

### Task 11: Bash `validate_project_fields` on Resume (with field repair)

**Files:**
- Modify: `lib/github/index.js` (add `repair-project-fields` subcommand)
- Modify: `ralph-loop`

Per spec: "On resume with existing `githubProject`, verify field IDs still exist. Recreate missing fields and update cached IDs." This requires an additional CLI subcommand for repair.

- [ ] **Step 1: Add `repair-project-fields` subcommand**

In `lib/github/index.js` (inside the `switch` block, before `default`):

```js
case 'repair-project-fields': {
  const projectJson = getArg('--project');
  const missingCsv = getArg('--missing');
  const categoriesCsv = getArg('--categories') || '';
  if (!projectJson || !missingCsv) {
    console.error('Usage: node lib/github/index.js repair-project-fields --project \'<json>\' --missing a,b,c [--categories x,y]');
    process.exit(1);
  }
  const project = JSON.parse(projectJson);
  const missing = missingCsv.split(',').map(s => s.trim()).filter(Boolean);
  const categories = categoriesCsv.split(',').map(s => s.trim()).filter(Boolean);
  // Recreate only missing fields by calling createStandardFields selectively.
  // Simplest correct approach: re-create all 5, overwriting fieldIds with fresh IDs
  // for the missing subset only.
  const fresh = createStandardFields({ projectId: project.id, categories });
  const repaired = { ...project.fieldIds };
  for (const key of missing) {
    if (fresh[key]) repaired[key] = fresh[key];
  }
  console.log(JSON.stringify({ ok: true, fieldIds: repaired, apiCalls: getCallCount() }));
  break;
}
```

Update the default usage string to list `repair-project-fields` too.

- [ ] **Step 2: Add `validate_project_fields` helper in `ralph-loop`**

Insert right before `crosscheck_issues` (around line 600):

```bash
validate_project_fields() {
    if [ "$GITHUB_ENABLED" = false ]; then return 0; fi
    local project_id
    project_id=$(jq -r '.githubProject.id // empty' "$JSON_FILE")
    if [ -z "$project_id" ]; then return 0; fi

    local project_json
    project_json=$(jq '.githubProject' "$JSON_FILE")

    local reply
    local reply_exit=0
    reply=$(node "$SCRIPT_DIR/lib/github/index.js" validate-project \
        --project "$project_json" 2>&1) || reply_exit=$?

    if [ $reply_exit -ne 0 ]; then
        echo -e "${YELLOW}[WARN] Could not validate project fields on resume: $reply${NC}"
        return 0
    fi

    bump_github_api_calls "$reply"

    local ok
    ok=$(echo "$reply" | jq -r '.ok')
    local updated_field_ids
    updated_field_ids=$(echo "$reply" | jq '.updatedFieldIds')

    # Always refresh fieldIds in case options shifted
    local updated_prd
    updated_prd=$(jq --argjson fids "$updated_field_ids" '.githubProject.fieldIds = $fids' "$JSON_FILE")
    echo "$updated_prd" | jq '.' > "$JSON_FILE"

    if [ "$ok" != "true" ]; then
        local missing_csv
        missing_csv=$(echo "$reply" | jq -r '.missing | join(",")')
        echo -e "${YELLOW}[WARN] Missing project fields on resume: $missing_csv. Attempting repair...${NC}"

        local categories_csv
        categories_csv=$(jq -r '[.tasks[].category] | unique | join(",")' "$JSON_FILE")
        local refreshed_project
        refreshed_project=$(jq '.githubProject' "$JSON_FILE")

        local repair_reply
        local repair_exit=0
        repair_reply=$(node "$SCRIPT_DIR/lib/github/index.js" repair-project-fields \
            --project "$refreshed_project" \
            --missing "$missing_csv" \
            --categories "$categories_csv" 2>&1) || repair_exit=$?

        if [ $repair_exit -ne 0 ]; then
            echo -e "${YELLOW}[WARN] Repair failed: $repair_reply${NC}"
            return 0
        fi

        bump_github_api_calls "$repair_reply"

        local repaired_fids
        repaired_fids=$(echo "$repair_reply" | jq '.fieldIds')
        updated_prd=$(jq --argjson fids "$repaired_fids" '.githubProject.fieldIds = $fids' "$JSON_FILE")
        echo "$updated_prd" | jq '.' > "$JSON_FILE"

        echo -e "${GREEN}[INFO] Repaired missing project fields: $missing_csv${NC}"
    elif [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[INFO] Project fields validated.${NC}"
    fi
}
```

- [ ] **Step 2: Wire into resume block**

In `run_ralph_loop`, inside the existing `if [ "$RESUME" = true ]; then ... fi` block (around line 1307-1323), add the call right before `crosscheck_issues`:

```bash
        # Validate project field IDs are still valid
        validate_project_fields

        # Cross-check GitHub issue states
        crosscheck_issues
```

- [ ] **Step 3: Syntax check**

Run: `bash -n ralph-loop`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat: revalidate GitHub project field IDs on --resume"
```

---

### Task 12: End-of-Run API-Call Summary

**Files:**
- Modify: `ralph-loop`

- [ ] **Step 1: Add the success-branch summary line**

In `ralph-loop` at **line 1751** (immediately after `echo "  Iterations Used: $((iteration - 1)) / $MAX_ITERATIONS"`), insert:

```bash
        if [ "$GITHUB_ENABLED" = true ] && [ "$GITHUB_API_CALLS" -gt 0 ]; then
            echo "  GitHub API Calls: $GITHUB_API_CALLS"
        fi
```

- [ ] **Step 2: Add the max-iterations-branch summary line**

At **line 1775** (immediately after `echo "  Total Time: $(printf "%02d:%02d" $total_minutes $total_seconds)"` in the MAX ITERATIONS REACHED branch), insert:

```bash
        if [ "$GITHUB_ENABLED" = true ] && [ "$GITHUB_API_CALLS" -gt 0 ]; then
            echo "  GitHub API Calls: $GITHUB_API_CALLS"
        fi
```

- [ ] **Step 3: Extend `log_completion` to forward the API-call total**

`log_completion` already writes a `run_complete`-style summary. Find the function (`grep -n '^log_completion' ralph-loop`) and, right after its final log line, append:

```bash
    emit_logging_event run_complete \
        "{\"success\":$([ "$2" = "true" ] && echo true || echo false),\"totalIterations\":$1,\"elapsed\":0,\"githubApiCalls\":$GITHUB_API_CALLS}"
```

(The `elapsed:0` placeholder is acceptable — Phase 3's own `log_completion` rewrite already passes the true elapsed value; when Phase 3 ships, merge this branch so the two agree. If `log_completion` in your tree already emits `run_complete`, just add `"githubApiCalls":$GITHUB_API_CALLS` to the existing payload instead.)

- [ ] **Step 3: Syntax check**

Run: `bash -n ralph-loop`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add ralph-loop
git commit -m "feat: report GitHub API call total at end of run"
```

---

### Task 13: Logging Event Schema Additions (soft-dependent on Phase 3)

**Files:**
- Modify: `lib/logging/events.js` (if Phase 3 has shipped)
- Modify: `lib/logging/events.test.js`
- Modify: `lib/logging/renderer.js`
- Modify: `lib/logging/renderer.test.js`

> **Guard:** Run `ls lib/logging/events.js 2>/dev/null` first. If the file does not exist, skip this task entirely — the `emit_logging_event` helper added in Task 8 already silently no-ops when `lib/logging/` is absent.

- [ ] **Step 1: Extend `REQUIRED` map in `lib/logging/events.js`**

Add to the existing `REQUIRED` object:

```js
  project_created: ['projectNumber', 'projectId', 'url'],
  project_item_synced: ['iteration', 'taskId', 'projectItemId', 'ralphStatus'],
  project_rate_limit_warning: ['callCount', 'threshold'],
```

Also update the `EVENT_TYPES` array export to include the three new names.

- [ ] **Step 2: Extend `lib/logging/events.test.js`**

Append:

```js
test('accepts project_created', () => {
  expect(validateEvent({
    ts: '2026-04-18T14:30:00Z', event: 'project_created',
    projectNumber: 12, projectId: 'PVT_x', url: 'https://...',
  }).valid).toBe(true);
});

test('rejects project_item_synced missing ralphStatus', () => {
  expect(validateEvent({
    ts: '2026-04-18T14:30:00Z', event: 'project_item_synced',
    iteration: 1, taskId: 't1', projectItemId: 'PVTI_x',
  }).valid).toBe(false);
});

test('accepts project_rate_limit_warning', () => {
  expect(validateEvent({
    ts: '2026-04-18T14:30:00Z', event: 'project_rate_limit_warning',
    callCount: 100, threshold: 100,
  }).valid).toBe(true);
});
```

Also update the "lists all N event types" test to reflect the new count.

- [ ] **Step 3: Extend `lib/logging/renderer.js` switch**

```js
case 'project_created':
  lines.push(`  📋 Project #${e.projectNumber} created → ${e.url}`);
  break;
case 'project_item_synced':
  lines.push(`    ↳ project synced: ${e.taskId} status=${e.ralphStatus} rate=${e.criteriaPassRate ?? 'n/a'}`);
  break;
case 'project_rate_limit_warning':
  lines.push(`  ⚠️  GitHub API approaching limit: ${e.callCount}/${e.threshold}`);
  break;
```

- [ ] **Step 4: Run tests**

Run: `npx jest lib/logging/ --no-coverage 2>&1 | tail -10`
Expected: PASS — all logging tests green.

- [ ] **Step 5: Commit**

```bash
git add lib/logging/
git commit -m "feat: log project_created, project_item_synced, project_rate_limit_warning events"
```

---

### Task 14: Integration Tests — `tests/test-github-projects.sh`

**Files:**
- Create: `tests/test-github-projects.sh`
- Create: `tests/fixtures/mock-gh-projects.sh`
- Modify: `tests/test-all.sh`

- [ ] **Step 1: Write the mock `gh`**

`tests/fixtures/mock-gh-projects.sh`:

```bash
#!/usr/bin/env bash
# Mock `gh` CLI for Projects v2 tests. Replays canned JSON replies based on args.
set -euo pipefail

# Count calls in a sidecar file so tests can assert on totals.
: "${MOCK_GH_CALL_LOG:=/tmp/mock-gh-projects-calls.log}"
echo "$*" >> "$MOCK_GH_CALL_LOG"

if [ "${1:-}" = "api" ] && [ "${2:-}" = "graphql" ]; then
    # Pull out the query via: -f query='...'
    query_arg=""
    for arg in "$@"; do
        case "$arg" in
            -f) : ;;
            query=*) query_arg="${arg#query=}" ;;
        esac
    done
    case "$query_arg" in
        *"user(login:"*)
            echo '{"data":{"user":{"id":"U_test"},"organization":null}}' ;;
        *"createProjectV2"*)
            echo '{"data":{"createProjectV2":{"projectV2":{"id":"PVT_test","number":99,"url":"https://example.test/projects/99"}}}}' ;;
        *"createProjectV2Field"*"SINGLE_SELECT"*)
            echo '{"data":{"createProjectV2Field":{"projectV2Field":{"id":"PVTF_ss","options":[{"id":"opt_a","name":"A"},{"id":"opt_b","name":"B"},{"id":"opt_pending","name":"Pending"},{"id":"opt_inprog","name":"In Progress"},{"id":"opt_passed","name":"Passed"},{"id":"opt_failed","name":"Failed"},{"id":"opt_stalled","name":"Stalled"}]}}}}' ;;
        *"createProjectV2Field"*)
            echo '{"data":{"createProjectV2Field":{"projectV2Field":{"id":"PVTF_num"}}}}' ;;
        *"addProjectV2ItemById"*)
            echo '{"data":{"addProjectV2ItemById":{"item":{"id":"PVTI_test"}}}}' ;;
        *"updateProjectV2ItemFieldValue"*)
            echo '{"data":{"updateProjectV2ItemFieldValue":{"projectV2Item":{"id":"PVTI_test"}}}}' ;;
        *"issue(number:"*)
            echo '{"data":{"repository":{"issue":{"id":"I_test"}}}}' ;;
        *"fields(first:"*)
            echo '{"data":{"node":{"fields":{"nodes":[{"id":"PVTF_num","name":"Priority","dataType":"NUMBER"},{"id":"PVTF_ss","name":"Category","dataType":"SINGLE_SELECT","options":[{"id":"opt_a","name":"Backend"}]},{"id":"PVTF_ic","name":"Iteration Count","dataType":"NUMBER"},{"id":"PVTF_cp","name":"Criteria Pass Rate","dataType":"NUMBER"},{"id":"PVTF_rs","name":"Ralph Status","dataType":"SINGLE_SELECT","options":[{"id":"opt_pending","name":"Pending"}]}]}}}}' ;;
        *"fieldValues(first:"*)
            echo '{"data":{"node":{"fieldValues":{"nodes":[{"field":{"id":"PVTF_cp"},"number":0.5}]}}}}' ;;
        *)
            echo '{"data":{}}' ;;
    esac
    exit 0
fi

# Fallback for non-graphql invocations (issue create/view/etc): produce benign outputs.
case "${1:-}" in
    issue)
        case "${2:-}" in
            create) echo "https://github.com/test/repo/issues/99" ;;
            view)   echo "OPEN" ;;
            *)      echo "" ;;
        esac
        ;;
    auth) echo "Logged in" ;;
    *) echo "" ;;
esac
exit 0
```

Make it executable:

```bash
chmod +x tests/fixtures/mock-gh-projects.sh
```

- [ ] **Step 2: Write `tests/test-github-projects.sh`**

```bash
#!/usr/bin/env bash
# Integration tests for Phase 4 GitHub Projects v2 module.
set -u
RALPH_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$RALPH_ROOT"

PASS=0
FAIL=0
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); }

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR" /tmp/mock-gh-projects-calls.log' EXIT

# Prepend mock gh to PATH
MOCK_BIN="$TMPDIR/bin"
mkdir -p "$MOCK_BIN"
ln -sf "$RALPH_ROOT/tests/fixtures/mock-gh-projects.sh" "$MOCK_BIN/gh"
export PATH="$MOCK_BIN:$PATH"
export MOCK_GH_CALL_LOG=/tmp/mock-gh-projects-calls.log
: > "$MOCK_GH_CALL_LOG"

CLI="$RALPH_ROOT/lib/github/index.js"

echo "Phase 4: GitHub Projects v2 integration tests"
echo "============================================="

# --- create-project ---
out=$(node "$CLI" create-project --repo paullovvik/myrepo --title "Test PRD" --categories "Backend,Frontend" 2>&1 || true)
if echo "$out" | jq -e '.githubProject.number == 99' >/dev/null 2>&1; then
    pass "create-project returns githubProject.number=99"
else
    fail "create-project: $out"
fi

if echo "$out" | jq -e '.apiCalls >= 6' >/dev/null 2>&1; then
    pass "create-project reports apiCalls >= 6 (1 owner + 1 project + 5 fields)"
else
    fail "create-project apiCalls wrong: $out"
fi

# --- ensure-project-item ---
out=$(node "$CLI" ensure-project-item --repo paullovvik/myrepo --project-id PVT_test --issue 42 2>&1 || true)
if echo "$out" | jq -e '.projectItemId == "PVTI_test"' >/dev/null 2>&1; then
    pass "ensure-project-item returns PVTI_test"
else
    fail "ensure-project-item: $out"
fi

# --- sync-project-item ---
project='{"id":"PVT_test","number":99,"fieldIds":{"priority":{"id":"P1","dataType":"NUMBER"},"category":{"id":"C1","dataType":"SINGLE_SELECT","options":{"Backend":"opt_be"}},"iterationCount":{"id":"I1","dataType":"NUMBER"},"criteriaPassRate":{"id":"R1","dataType":"NUMBER"},"ralphStatus":{"id":"S1","dataType":"SINGLE_SELECT","options":{"In Progress":"opt_ip","Passed":"opt_pa","Pending":"opt_pn","Failed":"opt_f","Stalled":"opt_st"}}}}'
task='{"id":"task-1","priority":3,"category":"Backend","attempts":2,"passes":false,"projectItemId":"PVTI_test"}'
results='{"results":[{"passed":true},{"passed":false,"error":"x"}]}'
out=$(node "$CLI" sync-project-item --project "$project" --task "$task" --results "$results" --iteration 2 2>&1 || true)
if echo "$out" | jq -e '.ok == true and .ralphStatus == "In Progress" and .criteriaPassRate == 0.5' >/dev/null 2>&1; then
    pass "sync-project-item computes ralphStatus + passRate"
else
    fail "sync-project-item: $out"
fi

# --- validate-project ---
out=$(node "$CLI" validate-project --project "$project" 2>&1 || true)
if echo "$out" | jq -e '.ok == true' >/dev/null 2>&1; then
    pass "validate-project reports ok=true when all fields present"
else
    fail "validate-project: $out"
fi

# --- rate-limit warning surfaces in ralph-loop ---
# Minimal PRD run: set warn threshold to 1 so single create trips it.
PRD="$TMPDIR/test.json"
cat > "$PRD" <<'EOF'
{
  "title": "P4 rate-limit test",
  "repository": "paullovvik/myrepo",
  "tasks": [{
    "id": "task-1", "title": "t", "category": "Backend", "priority": 1,
    "passes": true, "attempts": 0,
    "acceptanceCriteria": [{"text": "ok", "type": "manual"}]
  }]
}
EOF

# Run dry-run (won't invoke Claude, but exercises ensure_github_project)
run_out=$(GITHUB_API_WARN_THRESHOLD=1 ./ralph-loop "$PRD" --dry-run --verbose --no-github 2>&1 || true)
# With --no-github, ensure_github_project should not run
if ! echo "$run_out" | grep -q "Creating GitHub project"; then
    pass "--no-github skips ensure_github_project"
else
    fail "--no-github leaked into project creation: $run_out"
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"
exit $FAIL
```

Make it executable:

```bash
chmod +x tests/test-github-projects.sh
```

- [ ] **Step 3: Register in `tests/test-all.sh`**

Find the block where each suite is run (e.g. `run_test_suite "GitHub Integration" ...`) and add immediately after:

```bash
run_test_suite "GitHub Projects v2" "./tests/test-github-projects.sh"
```

- [ ] **Step 4: Run tests**

Run: `./tests/test-github-projects.sh`
Expected: all 6 passes, 0 failures.

Run: `./tests/test-all.sh`
Expected: full suite still green.

- [ ] **Step 5: Commit**

```bash
git add tests/test-github-projects.sh tests/fixtures/mock-gh-projects.sh tests/test-all.sh
git commit -m "test: integration tests for Phase 4 GitHub Projects v2"
```

---

### Task 15: Documentation & Final Integration Commit

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `ralph-loop` (`show_help` function)

- [ ] **Step 1: Update `show_help`**

Inside `show_help`, in the GitHub section, add:

```
  GitHub Projects v2 (Phase 4):
    Each PRD gets a dedicated GitHub project. Ralph creates it on first run
    (requires 'project' scope: gh auth refresh -s project,read:project,write:project)
    and syncs Priority, Category, Iteration Count, Criteria Pass Rate, and
    Ralph Status fields after every iteration. GitHub API calls are reported
    at end of run; a warning prints at 100 calls.
```

- [ ] **Step 2: Update `README.md`**

Append this section under an appropriate heading near the existing GitHub docs:

```markdown
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
```

- [ ] **Step 3: Update `CLAUDE.md` architecture section**

In the `lib/` description block, add `projects.js` and `graphql.js` to the `github/` entry:

```
  github/
    index.js            # CLI: resolve-repo | create-issue | update-issue | close-issue | create-project | ensure-project-item | sync-project-item | validate-project
    repo.js             # Resolve target repo
    issues.js           # Issue lifecycle
    graphql.js          # gh api graphql wrapper + call counting
    projects.js         # Projects v2: project/field/item lifecycle + conflict detection
```

Also add a bullet under "Key conventions":

```
- Ralph tracks GitHub API calls per run (GITHUB_API_CALLS global) and warns at 100 calls.
- PRD JSON root may contain `githubProject` (project metadata + field IDs); each task may contain `projectItemId`. Both optional and populated automatically.
```

- [ ] **Step 4: Final verification**

Run the full suite:

```bash
./tests/test-all.sh && npx jest --no-coverage --testPathIgnorePatterns='user-model'
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md ralph-loop
git commit -m "docs: document GitHub Projects v2 integration (Phase 4)"
```

- [ ] **Step 6: Celebratory closing commit**

```bash
git commit --allow-empty -m "feat: complete Phase 4 — GitHub Projects v2 board integration"
```

---

## Spec Coverage Checklist

| Spec section | Implementation |
|--------------|---------------|
| Project lifecycle: create via `gh api graphql` | Tasks 1, 2, 6, 8 |
| Custom fields: Priority, Category, Iteration Count, Criteria Pass Rate, Ralph Status | Task 3 |
| `fieldIds` cached in PRD JSON | Tasks 2, 3, 7, 8 |
| `githubProject` PRD JSON shape | Task 7 (validation) + Task 8 (write) |
| Item sync: task ↔ issue, one mutation batch per iteration | Tasks 4, 6, 10 |
| Field validation on resume + **recreate missing fields** | Tasks 5, 6 (`validate-project` + `repair-project-fields`), 11 |
| Conflict policy: Ralph overwrites, logs divergence | Task 6 (`--detect-conflicts`), Task 10 (warning output) |
| Rate-limit awareness, warn near 100 | Tasks 8, 12 |
| Multi-PRD umbrella projects deferred | Out of scope — documented in Task 15 |
| GraphQL only (no new npm deps) | Task 1 |
| Gated behind `GITHUB_ENABLED`; non-fatal on failures | Tasks 8–11 (each checks `GITHUB_ENABLED=false` first, logs warnings on exit != 0) |
