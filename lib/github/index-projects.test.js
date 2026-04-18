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
  process.argv = ['node', 'lib/github/index.js', ...args];
  let exitCode = 0;
  const origExit = process.exit;
  process.exit = (code) => { exitCode = code || 0; throw new Error('__exit__'); };
  try {
    // jest.isolateModules re-executes index.js on each call while reusing
    // the same mock instances registered via jest.mock() at the top of this
    // file, so mockReturnValueOnce values set before runCli() are honoured.
    jest.isolateModules(() => {
      require('./index');
    });
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
