'use strict';

const path = require('path');
const { computeSlug, resolvePaths } = require('./resolver');

describe('computeSlug', () => {
  test('returns <basename>-<hash4> for a repo-relative path', () => {
    const slug = computeSlug('docs/prds/auth-system.md');
    expect(slug).toMatch(/^auth-system-[0-9a-f]{4}$/);
  });

  test('is deterministic for the same input', () => {
    const a = computeSlug('docs/prds/auth-system.md');
    const b = computeSlug('docs/prds/auth-system.md');
    expect(a).toBe(b);
  });

  test('differs when the path differs', () => {
    const a = computeSlug('docs/prds/auth-system.md');
    const b = computeSlug('services/auth/docs/prds/auth-system.md');
    expect(a).not.toBe(b);
  });

  test('respects RALPH_SLUG_HASH_LEN env var', () => {
    const prev = process.env.RALPH_SLUG_HASH_LEN;
    process.env.RALPH_SLUG_HASH_LEN = '8';
    try {
      const slug = computeSlug('docs/prds/auth-system.md');
      expect(slug).toMatch(/^auth-system-[0-9a-f]{8}$/);
    } finally {
      if (prev === undefined) delete process.env.RALPH_SLUG_HASH_LEN;
      else process.env.RALPH_SLUG_HASH_LEN = prev;
    }
  });

  test('strips .md and .json extensions for the basename', () => {
    expect(computeSlug('a/b/foo.md')).toMatch(/^foo-[0-9a-f]{4}$/);
    expect(computeSlug('a/b/foo.json')).toMatch(/^foo-[0-9a-f]{4}$/);
  });
});

describe('resolvePaths', () => {
  test('with stateDirOverride returns paths under that dir, no slug', () => {
    const r = resolvePaths({ stateDirOverride: '/tmp/custom-state' });
    expect(r.stateDir).toBe('/tmp/custom-state');
    expect(r.jsonFile).toBe('/tmp/custom-state/prd.json');
    expect(r.progressFile).toBe('/tmp/custom-state/progress.txt');
    expect(r.mcpConfigFile).toBe('/tmp/custom-state/mcp-config.json');
    expect(r.slug).toBeNull();
    expect(r.source).toBeNull();
  });

  test('with repoRoot + relPath returns slug-based paths', () => {
    const r = resolvePaths({
      repoRoot: '/repo',
      relPath: 'docs/prds/auth-system.md',
    });
    expect(r.slug).toMatch(/^auth-system-[0-9a-f]{4}$/);
    expect(r.stateDir).toBe(`/repo/.ralph/${r.slug}`);
    expect(r.jsonFile).toBe(`/repo/.ralph/${r.slug}/prd.json`);
    expect(r.progressFile).toBe(`/repo/.ralph/${r.slug}/progress.txt`);
    expect(r.mcpConfigFile).toBe(`/repo/.ralph/${r.slug}/mcp-config.json`);
    expect(r.source).toBe('docs/prds/auth-system.md');
  });

  test('throws when neither override nor (repoRoot+relPath) provided', () => {
    expect(() => resolvePaths({})).toThrow(/repoRoot.*relPath|stateDirOverride/);
  });
});
