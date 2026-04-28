#!/usr/bin/env node
// lib/state/index.js
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolvePaths } = require('./resolver');

const command = process.argv[2];

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx === process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function realpathOrFail(p) {
  try {
    return fs.realpathSync(p);
  } catch (err) {
    fail(`Cannot resolve PRD path: ${p} (${err.message})`);
  }
}

function gitTopLevel(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.trim();
  } catch (err) {
    return null;
  }
}

function main() {
  switch (command) {
    case 'resolve-paths': {
      const prd = getArg('--prd');
      const stateDirOverride = getArg('--state-dir');
      if (!prd) fail('Usage: resolve-paths --prd <path> [--state-dir <path>]');
      if (stateDirOverride) {
        const r = resolvePaths({ stateDirOverride });
        process.stdout.write(JSON.stringify(r) + '\n');
        return;
      }
      const prdAbs = realpathOrFail(prd);
      const repoRoot = gitTopLevel(path.dirname(prdAbs));
      if (!repoRoot) {
        fail('Ralph requires a git repository to anchor `.ralph/`. Run inside a git repo or pass `--state-dir <path>`.');
      }
      const repoRootReal = fs.realpathSync(repoRoot);
      const relPath = path.relative(repoRootReal, prdAbs);
      if (relPath.startsWith('..')) {
        fail(`PRD ${prd} is outside the resolved repo root ${repoRootReal}`);
      }
      const r = resolvePaths({ repoRoot: repoRootReal, relPath });
      process.stdout.write(JSON.stringify(r) + '\n');
      return;
    }
    default:
      fail(`Unknown command: ${command}\nAvailable: resolve-paths`);
  }
}

main();
