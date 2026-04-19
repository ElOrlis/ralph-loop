// lib/git/branches.test.js
'use strict';

jest.mock('child_process');
const { execSync } = require('child_process');
const {
  computeBranchName,
  currentBranch,
  branchExists,
  ensureBranch,
  switchTo,
} = require('./branches');

beforeEach(() => {
  execSync.mockReset();
});

describe('computeBranchName', () => {
  test('combines prd slug, task id, and title slug', () => {
    expect(
      computeBranchName({ prdSlug: 'auth-feature', taskId: 'task-3', title: 'Add JWT Validation' })
    ).toBe('ralph/auth-feature/task-3-add-jwt-validation');
  });

  test('truncates overly long titles', () => {
    const title = 'An extremely verbose task title that should be abbreviated to fit';
    const name = computeBranchName({ prdSlug: 'x', taskId: 'task-1', title });
    const tail = name.split('/').pop();
    expect(tail.length).toBeLessThanOrEqual(8 /* "task-1-" length cap */ + 40);
  });

  test('throws if prdSlug or taskId missing', () => {
    expect(() => computeBranchName({ prdSlug: '', taskId: 't', title: 'x' }))
      .toThrow(/prdSlug/);
    expect(() => computeBranchName({ prdSlug: 'p', taskId: '', title: 'x' }))
      .toThrow(/taskId/);
  });
});

describe('currentBranch', () => {
  test('returns the output of git rev-parse --abbrev-ref HEAD', () => {
    execSync.mockReturnValueOnce(Buffer.from('main\n'));
    expect(currentBranch()).toBe('main');
    expect(execSync.mock.calls[0][0]).toMatch(/git rev-parse --abbrev-ref HEAD/);
  });

  test('throws if git fails', () => {
    execSync.mockImplementationOnce(() => { throw new Error('not a repo'); });
    expect(() => currentBranch()).toThrow(/not a repo|current branch/i);
  });
});

describe('branchExists', () => {
  test('returns true when git show-ref exits 0', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));
    expect(branchExists('feature/x')).toBe(true);
  });

  test('returns false when git show-ref exits non-zero', () => {
    execSync.mockImplementationOnce(() => {
      const err = new Error('missing');
      err.status = 1;
      throw err;
    });
    expect(branchExists('feature/x')).toBe(false);
  });
});

describe('ensureBranch', () => {
  test('creates branch off base when missing', () => {
    execSync
      .mockImplementationOnce(() => { const e = new Error('x'); e.status = 1; throw e; }) // show-ref: missing
      .mockReturnValueOnce(Buffer.from('abc123\n'))                                       // rev-parse base
      .mockReturnValueOnce(Buffer.from(''));                                              // branch create
    const result = ensureBranch({ name: 'ralph/x/task-1-y', baseBranch: 'main' });
    expect(result).toEqual({ created: true, baseSha: 'abc123' });
    expect(execSync.mock.calls[2][0]).toMatch(/git branch "ralph\/x\/task-1-y" "main"/);
  });

  test('returns created=false when branch already exists', () => {
    execSync.mockReturnValueOnce(Buffer.from('')); // show-ref: exists
    const result = ensureBranch({ name: 'ralph/x/task-1-y', baseBranch: 'main' });
    expect(result).toEqual({ created: false });
    expect(execSync).toHaveBeenCalledTimes(1);
  });
});

describe('switchTo', () => {
  test('runs git checkout <branch>', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));
    switchTo('ralph/x/task-1-y');
    expect(execSync.mock.calls[0][0]).toMatch(/git checkout "ralph\/x\/task-1-y"/);
  });

  test('wraps git checkout failures with a clear message', () => {
    execSync.mockImplementationOnce(() => { throw new Error('conflict'); });
    expect(() => switchTo('b')).toThrow(/switch.*branch.*b.*conflict/i);
  });
});
