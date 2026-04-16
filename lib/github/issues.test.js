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
