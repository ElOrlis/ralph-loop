'use strict';

const path = require('path');
const { execFileSync } = require('child_process');
const CLI = path.join(__dirname, 'index.js');

function run(args) {
  try {
    const out = execFileSync('node', [CLI, ...args], { encoding: 'utf-8' });
    return { exit: 0, stdout: out.trim(), stderr: '' };
  } catch (err) {
    return {
      exit: err.status || 1,
      stdout: (err.stdout || '').toString().trim(),
      stderr: (err.stderr || '').toString().trim(),
    };
  }
}

describe('lib/github/index.js PR subcommands (usage output)', () => {
  test('ensure-pr without required flags exits 1 with usage', () => {
    const r = run(['ensure-pr']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/ensure-pr.*--repo.*--branch.*--base/);
  });

  test('mark-pr-ready without required flags exits 1 with usage', () => {
    const r = run(['mark-pr-ready']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/mark-pr-ready.*--repo.*--pr/);
  });

  test('unknown command lists all commands including PR ones', () => {
    const r = run(['nonsense']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/ensure-pr/);
    expect(r.stderr).toMatch(/mark-pr-ready/);
  });
});
