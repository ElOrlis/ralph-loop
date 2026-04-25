'use strict';

const { createIssue, formatCriteriaChecklist, updateIssue, closeIssue, formatIterationComment } = require('./issues');
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

describe('addLabel', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('calls gh issue edit with --add-label', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));
    const { addLabel } = require('./issues');
    addLabel({ repo: 'o/r', issueNumber: 42, label: 'blocked' });
    const cmd = execSync.mock.calls[0][0];
    expect(cmd).toMatch(/gh issue edit 42/);
    expect(cmd).toMatch(/--repo "o\/r"/);
    expect(cmd).toMatch(/--add-label "blocked"/);
  });

  test('wraps errors from gh', () => {
    execSync.mockImplementationOnce(() => { throw new Error('label not found'); });
    const { addLabel } = require('./issues');
    expect(() => addLabel({ repo: 'o/r', issueNumber: 42, label: 'blocked' }))
      .toThrow(/Failed to add label "blocked" to issue 42.*label not found/);
  });
});

describe('removeLabel', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('calls gh issue edit with --remove-label', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));
    const { removeLabel } = require('./issues');
    removeLabel({ repo: 'o/r', issueNumber: 42, label: 'blocked' });
    const cmd = execSync.mock.calls[0][0];
    expect(cmd).toMatch(/gh issue edit 42/);
    expect(cmd).toMatch(/--remove-label "blocked"/);
  });

  test('is a no-op when gh reports label not present', () => {
    const { removeLabel } = require('./issues');
    execSync.mockImplementationOnce(() => {
      const e = new Error('label not found');
      e.stderr = Buffer.from('not found');
      throw e;
    });
    expect(() => removeLabel({ repo: 'o/r', issueNumber: 42, label: 'blocked' })).not.toThrow();
  });
});
