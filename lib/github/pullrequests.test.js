'use strict';

jest.mock('child_process');
const { execSync } = require('child_process');
const {
  ensureDraftPR, markPRReady, prExistsForBranch, buildPRBody,
} = require('./pullrequests');

beforeEach(() => { execSync.mockReset(); });

describe('buildPRBody', () => {
  test('includes Closes trailer when issueNumber provided', () => {
    const body = buildPRBody({ taskId: 'task-3', taskTitle: 'Add X', issueNumber: 42 });
    expect(body).toMatch(/Closes #42/);
    expect(body).toMatch(/task-3/);
  });

  test('omits Closes trailer when issueNumber absent', () => {
    const body = buildPRBody({ taskId: 'task-3', taskTitle: 'Add X', issueNumber: null });
    expect(body).not.toMatch(/Closes/);
  });
});

describe('prExistsForBranch', () => {
  test('returns number when gh pr view succeeds', () => {
    execSync.mockReturnValueOnce(Buffer.from(JSON.stringify({ number: 7 })));
    expect(prExistsForBranch({ repo: 'o/r', branchName: 'ralph/x/task-1-y' })).toBe(7);
  });

  test('returns null when gh pr view fails (no PR for branch)', () => {
    execSync.mockImplementationOnce(() => { const e = new Error('no pr'); e.status = 1; throw e; });
    expect(prExistsForBranch({ repo: 'o/r', branchName: 'b' })).toBeNull();
  });
});

describe('ensureDraftPR', () => {
  test('returns existing prNumber when branch already has a PR', () => {
    execSync.mockReturnValueOnce(Buffer.from(JSON.stringify({ number: 9, url: 'https://x/pr/9' })));
    const r = ensureDraftPR({
      repo: 'o/r', branchName: 'b', baseBranch: 'main',
      taskId: 't-1', taskTitle: 'X', issueNumber: 1,
    });
    expect(r).toEqual({ prNumber: 9, prUrl: 'https://x/pr/9', created: false });
  });

  test('creates a draft PR when none exists; returns parsed URL + number', () => {
    // First call: prExistsForBranch -> no PR (status 1).
    execSync.mockImplementationOnce(() => { const e = new Error('no pr'); e.status = 1; throw e; });
    // Second call: gh pr create prints the URL.
    execSync.mockReturnValueOnce(Buffer.from('https://github.com/o/r/pull/17\n'));
    const r = ensureDraftPR({
      repo: 'o/r', branchName: 'b', baseBranch: 'main',
      taskId: 't-1', taskTitle: 'X', issueNumber: 42,
    });
    expect(r).toEqual({ prNumber: 17, prUrl: 'https://github.com/o/r/pull/17', created: true });
    const createCmd = execSync.mock.calls[1][0];
    expect(createCmd).toMatch(/gh pr create/);
    expect(createCmd).toMatch(/--draft/);
    expect(createCmd).toMatch(/--head "b"/);
    expect(createCmd).toMatch(/--base "main"/);
  });

  test('wraps gh pr create errors', () => {
    execSync.mockImplementationOnce(() => { const e = new Error('no pr'); e.status = 1; throw e; });
    execSync.mockImplementationOnce(() => { throw new Error('push first'); });
    expect(() => ensureDraftPR({
      repo: 'o/r', branchName: 'b', baseBranch: 'main',
      taskId: 't', taskTitle: 'T', issueNumber: null,
    })).toThrow(/Failed to create draft PR.*push first/i);
  });
});

describe('markPRReady', () => {
  test('runs gh pr ready <n>', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));
    markPRReady({ repo: 'o/r', prNumber: 17 });
    expect(execSync.mock.calls[0][0]).toMatch(/gh pr ready 17 --repo "o\/r"/);
  });

  test('wraps gh pr ready failures', () => {
    execSync.mockImplementationOnce(() => { throw new Error('not draft'); });
    expect(() => markPRReady({ repo: 'o/r', prNumber: 17 })).toThrow(/mark PR.*17.*not draft/i);
  });
});
