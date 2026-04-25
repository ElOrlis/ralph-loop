// lib/git/merge.test.js
'use strict';

jest.mock('child_process');
const { execSync } = require('child_process');
const { mergeBranch, mergeAbort } = require('./merge');

beforeEach(() => { execSync.mockReset(); });

describe('mergeBranch', () => {
  test('returns { ok: true, sha } when git merge --no-edit succeeds', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));                        // git merge
    execSync.mockReturnValueOnce(Buffer.from('deadbeef1234\n'));          // git rev-parse HEAD
    const r = mergeBranch({ branch: 'ralph/x/task-1-y' });
    expect(r).toEqual({ ok: true, sha: 'deadbeef1234' });
    expect(execSync.mock.calls[0][0]).toMatch(/git merge --no-edit "ralph\/x\/task-1-y"/);
  });

  test('returns { ok: false, conflict: true, files: [...] } on merge conflict', () => {
    // git merge exits non-zero with "CONFLICT" text on stderr/stdout.
    execSync.mockImplementationOnce(() => {
      const e = new Error('merge failed');
      e.status = 1;
      e.stdout = Buffer.from('CONFLICT (content): Merge conflict in src/auth.js\n');
      throw e;
    });
    // Subsequent call: read conflicting files via ls-files -u, then abort.
    execSync.mockReturnValueOnce(Buffer.from('100644 abc 1\tsrc/auth.js\n100644 def 2\tsrc/auth.js\n'));
    execSync.mockReturnValueOnce(Buffer.from(''));                        // git merge --abort
    const r = mergeBranch({ branch: 'ralph/x/task-1-y' });
    expect(r).toEqual({
      ok: false,
      conflict: true,
      files: ['src/auth.js'],
    });
  });

  test('wraps non-conflict errors', () => {
    execSync.mockImplementationOnce(() => {
      const e = new Error('boom');
      e.status = 128;
      throw e;
    });
    expect(() => mergeBranch({ branch: 'b' })).toThrow(/git merge failed.*boom/i);
  });
});

describe('mergeAbort', () => {
  test('runs git merge --abort and returns { ok: true }', () => {
    execSync.mockReturnValueOnce(Buffer.from(''));
    expect(mergeAbort()).toEqual({ ok: true });
    expect(execSync.mock.calls[0][0]).toMatch(/git merge --abort/);
  });

  test('swallows errors (no merge in progress)', () => {
    execSync.mockImplementationOnce(() => { const e = new Error('no merge'); e.status = 128; throw e; });
    expect(mergeAbort()).toEqual({ ok: true });
  });
});
