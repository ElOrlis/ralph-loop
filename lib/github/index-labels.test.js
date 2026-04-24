// lib/github/index-labels.test.js
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

describe('lib/github/index.js label subcommands', () => {
  test('add-label without required args exits 1', () => {
    const r = run(['add-label']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/add-label/);
  });

  test('remove-label without required args exits 1', () => {
    const r = run(['remove-label']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/remove-label/);
  });
});
