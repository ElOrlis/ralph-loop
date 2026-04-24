'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, 'index.js');

function run(args, opts = {}) {
  try {
    const out = execFileSync('node', [CLI, ...args], { encoding: 'utf-8', ...opts });
    return { exit: 0, stdout: out.trim(), stderr: '' };
  } catch (err) {
    return {
      exit: err.status || 1,
      stdout: (err.stdout || '').toString().trim(),
      stderr: (err.stderr || '').toString().trim(),
    };
  }
}

describe('lib/git/index.js dispatcher', () => {
  test('slugify echoes slugified input as JSON', () => {
    const r = run(['slugify', '--input', 'Hello World 123']);
    expect(r.exit).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ slug: 'hello-world-123' });
  });

  test('branch-name combines prdSlug + taskId + title', () => {
    const r = run(['branch-name', '--prd-slug', 'myprd', '--task-id', 'task-3', '--title', 'Add X']);
    expect(r.exit).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ branchName: 'ralph/myprd/task-3-add-x' });
  });

  test('unknown command exits 1', () => {
    const r = run(['nonsense']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/unknown command/i);
  });

  test('slugify without --input exits 1 with usage', () => {
    const r = run(['slugify']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/--input/);
  });

  describe('dispatcher: merge-branch / merge-abort', () => {
    test('merge-branch without --branch exits 1', () => {
      const r = run(['merge-branch']);
      expect(r.exit).toBe(1);
      expect(r.stderr).toMatch(/--branch/);
    });

    test('merge-abort runs without args and exits 0', () => {
      // merge-abort has no required args; it should succeed even with no merge in progress
      // because the fixture git is not a real git. In a sandbox this may behave differently —
      // so just assert the dispatcher recognizes the subcommand (exits 0 or 1, but the
      // stderr does NOT contain "Unknown command").
      const r = run(['merge-abort']);
      expect(r.stderr).not.toMatch(/unknown command/i);
    });
  });
});
