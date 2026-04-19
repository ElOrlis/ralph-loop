'use strict';

jest.mock('child_process');
const { execSync } = require('child_process');
const { hasUncommittedChanges, stashPush, stashPop } = require('./stash');

beforeEach(() => { execSync.mockReset(); });

describe('hasUncommittedChanges', () => {
  test('returns false when all three checks are quiet', () => {
    execSync
      .mockReturnValueOnce('')   // git diff --quiet (exit 0)
      .mockReturnValueOnce('')   // git diff --cached --quiet (exit 0)
      .mockReturnValueOnce('');  // ls-files --others
    expect(hasUncommittedChanges()).toBe(false);
  });

  test('returns true when tracked diff is non-empty', () => {
    const err = new Error('diff'); err.status = 1;
    execSync
      .mockImplementationOnce(() => { throw err; }) // diff not quiet
      .mockReturnValueOnce('')
      .mockReturnValueOnce('');
    expect(hasUncommittedChanges()).toBe(true);
  });

  test('returns true when untracked files exist', () => {
    execSync
      .mockReturnValueOnce('')
      .mockReturnValueOnce('')
      .mockReturnValueOnce('new-file.txt\n');
    expect(hasUncommittedChanges()).toBe(true);
  });
});

describe('stashPush', () => {
  test('runs git stash push -u with a message and returns true on success', () => {
    execSync.mockReturnValueOnce('Saved working directory\n');
    expect(stashPush('ralph-loop-temp-1')).toBe(true);
    expect(execSync.mock.calls[0][0]).toMatch(/git stash push -u -m "ralph-loop-temp-1"/);
  });

  test('returns false when git stash says "No local changes to save"', () => {
    execSync.mockReturnValueOnce('No local changes to save\n');
    expect(stashPush('msg')).toBe(false);
  });
});

describe('stashPop', () => {
  test('runs git stash pop on success', () => {
    execSync.mockReturnValueOnce('Dropped refs/stash@{0}\n');
    expect(() => stashPop()).not.toThrow();
    expect(execSync.mock.calls[0][0]).toMatch(/git stash pop/);
  });

  test('throws wrapped error with stderr when pop fails', () => {
    const err = new Error('conflict');
    err.stderr = Buffer.from('pop failed');
    execSync.mockImplementationOnce(() => { throw err; });
    expect(() => stashPop()).toThrow(/stash pop.*pop failed|stash pop.*conflict/i);
  });
});
