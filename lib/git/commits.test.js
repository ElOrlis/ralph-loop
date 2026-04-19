'use strict';

jest.mock('child_process');
const { execSync } = require('child_process');
const { formatCommitMessage, commitIteration } = require('./commits');

beforeEach(() => { execSync.mockReset(); });

describe('formatCommitMessage', () => {
  test('uses the spec-prescribed layout with all trailers', () => {
    const msg = formatCommitMessage({
      taskId: 'task-3',
      taskTitle: 'Add JWT validation middleware',
      iteration: 2,
      maxIterations: 15,
      passCount: 2,
      totalCount: 3,
      issueNumber: 42,
      ralphStatus: 'in-progress',
    });
    expect(msg).toBe(
      'task-3: add JWT validation middleware\n' +
      '\n' +
      'Iteration 2/15. Criteria: 2/3 passing.\n' +
      '\n' +
      'Ralph-Task-Id: task-3\n' +
      'Ralph-Issue: #42\n' +
      'Ralph-Status: in-progress'
    );
  });

  test('omits Ralph-Issue trailer when issueNumber is absent', () => {
    const msg = formatCommitMessage({
      taskId: 'task-1', taskTitle: 'Do Stuff', iteration: 1, maxIterations: 10,
      passCount: 0, totalCount: 1, issueNumber: null, ralphStatus: 'failed',
    });
    expect(msg).not.toMatch(/Ralph-Issue/);
    expect(msg).toMatch(/Ralph-Status: failed/);
    expect(msg.split('\n')[0]).toBe('task-1: do Stuff');
  });

  test('lowercases only the first character of the subject', () => {
    const msg = formatCommitMessage({
      taskId: 'task-2', taskTitle: 'ALL CAPS Title', iteration: 1, maxIterations: 5,
      passCount: 1, totalCount: 1, issueNumber: 1, ralphStatus: 'passed',
    });
    expect(msg.split('\n')[0]).toBe('task-2: aLL CAPS Title');
  });
});

describe('commitIteration', () => {
  test('runs git add -A then git commit -F <file>', () => {
    execSync.mockReturnValueOnce('')                      // add
            .mockReturnValueOnce('')                      // commit
            .mockReturnValueOnce('abc1234\n');            // rev-parse HEAD
    const sha = commitIteration({
      taskId: 'task-3', taskTitle: 'X', iteration: 1, maxIterations: 5,
      passCount: 1, totalCount: 2, issueNumber: 7, ralphStatus: 'in-progress',
    });
    expect(execSync.mock.calls[0][0]).toMatch(/git add -A/);
    expect(execSync.mock.calls[1][0]).toMatch(/git commit -F /);
    expect(sha).toBe('abc1234');
  });

  test('skips commit and returns null when working tree is clean after add', () => {
    // Simulate: git diff --cached --quiet succeeds -> nothing to commit.
    execSync.mockReturnValueOnce('');                   // add
    execSync.mockReturnValueOnce('');                   // diff --cached --quiet (exit 0)
    const sha = commitIteration({
      taskId: 'task-3', taskTitle: 'X', iteration: 1, maxIterations: 5,
      passCount: 0, totalCount: 1, issueNumber: null, ralphStatus: 'in-progress',
      skipIfEmpty: true,
    });
    expect(sha).toBeNull();
  });

  test('throws on commit failure', () => {
    execSync.mockReturnValueOnce('');                                                     // add
    execSync.mockImplementationOnce(() => { throw new Error('no commits allowed'); });    // commit
    expect(() => commitIteration({
      taskId: 'task-3', taskTitle: 'X', iteration: 1, maxIterations: 5,
      passCount: 0, totalCount: 1, issueNumber: 1, ralphStatus: 'failed',
    })).toThrow(/commit.*no commits allowed/i);
  });
});
