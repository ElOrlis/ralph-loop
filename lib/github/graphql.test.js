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
    expect(cmd).toMatch(/-f query='query \{ viewer \{ login \} \}'/);
  });

  test('passes scalar variables via -F', () => {
    execSync.mockReturnValueOnce(Buffer.from(JSON.stringify({ data: { ok: true } })));
    ghGraphql('query($n:Int!){ ok }', { n: 5 });
    expect(execSync.mock.calls[0][0]).toMatch(/-F n=5/);
  });

  test('passes string variables via -f', () => {
    execSync.mockReturnValueOnce(Buffer.from(JSON.stringify({ data: { ok: true } })));
    ghGraphql('query($login:String!){ ok }', { login: 'paul' });
    expect(execSync.mock.calls[0][0]).toMatch(/-f login='paul'/);

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

  test('rejects unsafe variable names', () => {
    expect(() => ghGraphql('query{}', { 'login;rm -rf /': 'x' })).toThrow(/invalid graphql variable name/i);
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
