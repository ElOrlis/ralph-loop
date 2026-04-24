// lib/deps/index.test.js
'use strict';

const fs = require('fs');
const os = require('os');
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

function writeTempPrd(prd) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-deps-'));
  const file = path.join(dir, 'prd.json');
  fs.writeFileSync(file, JSON.stringify(prd));
  return file;
}

describe('lib/deps/index.js CLI', () => {
  test('next-task returns { nextTask, ready, blocked, cycle }', () => {
    const file = writeTempPrd({
      title: 'x', tasks: [
        { id: 'a', title: 'A', priority: 1, acceptanceCriteria: ['x'], passes: true, attempts: 1 },
        { id: 'b', title: 'B', priority: 2, acceptanceCriteria: ['x'], passes: false, attempts: 0, dependsOn: ['a'] },
        { id: 'c', title: 'C', priority: 3, acceptanceCriteria: ['x'], passes: false, attempts: 0, dependsOn: ['d'] },
        { id: 'd', title: 'D', priority: 4, acceptanceCriteria: ['x'], passes: false, attempts: 0 },
      ],
    });
    const r = run(['next-task', '--task-file', file]);
    expect(r.exit).toBe(0);
    const reply = JSON.parse(r.stdout);
    expect(reply.nextTask).toBe('b');                // b (priority 2) ready before d (priority 4)
    expect(reply.ready.sort()).toEqual(['b', 'd']);
    expect(reply.blocked).toEqual([{ id: 'c', blockedBy: ['d'] }]);
    expect(reply.cycle).toBeNull();
  });

  test('next-task reports cycle without throwing', () => {
    const file = writeTempPrd({
      title: 'x', tasks: [
        { id: 'a', title: 'A', priority: 1, acceptanceCriteria: ['x'], passes: false, attempts: 0, dependsOn: ['b'] },
        { id: 'b', title: 'B', priority: 2, acceptanceCriteria: ['x'], passes: false, attempts: 0, dependsOn: ['a'] },
      ],
    });
    const r = run(['next-task', '--task-file', file]);
    expect(r.exit).toBe(0);
    const reply = JSON.parse(r.stdout);
    expect(reply.nextTask).toBeNull();
    expect(reply.cycle).not.toBeNull();
  });

  test('validate exits 0 on valid graph', () => {
    const file = writeTempPrd({
      title: 'x', tasks: [
        { id: 'a', title: 'A', priority: 1, acceptanceCriteria: ['x'], passes: false, attempts: 0 },
      ],
    });
    const r = run(['validate', '--task-file', file]);
    expect(r.exit).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, cycle: null });
  });

  test('validate exits 1 on unknown dependency', () => {
    const file = writeTempPrd({
      title: 'x', tasks: [
        { id: 'a', title: 'A', priority: 1, acceptanceCriteria: ['x'], passes: false, attempts: 0, dependsOn: ['ghost'] },
      ],
    });
    const r = run(['validate', '--task-file', file]);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/unknown dependency/i);
  });

  test('validate exits 1 on cycle', () => {
    const file = writeTempPrd({
      title: 'x', tasks: [
        { id: 'a', title: 'A', priority: 1, acceptanceCriteria: ['x'], passes: false, attempts: 0, dependsOn: ['b'] },
        { id: 'b', title: 'B', priority: 2, acceptanceCriteria: ['x'], passes: false, attempts: 0, dependsOn: ['a'] },
      ],
    });
    const r = run(['validate', '--task-file', file]);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/cycle/i);
  });

  test('unknown command exits 1', () => {
    const r = run(['wat']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/unknown command/i);
  });

  test('next-task without --task-file exits 1 with usage', () => {
    const r = run(['next-task']);
    expect(r.exit).toBe(1);
    expect(r.stderr).toMatch(/--task-file/);
  });
});
