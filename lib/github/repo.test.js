'use strict';

const { resolveRepo } = require('./repo');
const { execSync } = require('child_process');

jest.mock('child_process');

describe('resolveRepo', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('CLI flag takes highest priority', () => {
    const result = resolveRepo({
      cliRepo: 'cli-owner/cli-repo',
      prdRepository: 'prd-owner/prd-repo',
    });
    expect(result).toBe('cli-owner/cli-repo');
  });

  test('PRD repository field is second priority', () => {
    execSync.mockReturnValue(Buffer.from('https://github.com/git-owner/git-repo.git\n'));
    const result = resolveRepo({
      cliRepo: null,
      prdRepository: 'prd-owner/prd-repo',
    });
    expect(result).toBe('prd-owner/prd-repo');
  });

  test('falls back to git remote origin', () => {
    execSync.mockReturnValue(Buffer.from('https://github.com/git-owner/git-repo.git\n'));
    const result = resolveRepo({ cliRepo: null, prdRepository: null });
    expect(result).toBe('git-owner/git-repo');
  });

  test('parses SSH git remote URL', () => {
    execSync.mockReturnValue(Buffer.from('git@github.com:ssh-owner/ssh-repo.git\n'));
    const result = resolveRepo({ cliRepo: null, prdRepository: null });
    expect(result).toBe('ssh-owner/ssh-repo');
  });

  test('throws when no source resolves', () => {
    execSync.mockImplementation(() => { throw new Error('not a git repo'); });
    expect(() => resolveRepo({ cliRepo: null, prdRepository: null }))
      .toThrow('Could not resolve target repository');
  });

  test('validates owner/name format for CLI flag', () => {
    expect(() => resolveRepo({ cliRepo: 'invalid', prdRepository: null }))
      .toThrow('Invalid repository format');
  });

  test('validates owner/name format for PRD field', () => {
    expect(() => resolveRepo({ cliRepo: null, prdRepository: 'no-slash' }))
      .toThrow('Invalid repository format');
  });
});
