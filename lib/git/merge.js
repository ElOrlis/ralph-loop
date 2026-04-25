// lib/git/merge.js
'use strict';

const { execSync } = require('child_process');

function quote(v) { return `"${String(v).replace(/"/g, '\\"')}"`; }

function parseConflictFiles(stdout) {
  // "CONFLICT (content): Merge conflict in src/foo.js"
  const re = /Merge conflict in (\S+)/g;
  const files = new Set();
  let m;
  while ((m = re.exec(stdout)) !== null) files.add(m[1]);
  return [...files];
}

function mergeBranch({ branch }) {
  if (!branch) throw new Error('mergeBranch: branch is required');
  try {
    execSync(`git merge --no-edit ${quote(branch)}`, { encoding: 'utf-8' });
  } catch (err) {
    const stdout = (err.stdout || '').toString();
    const stderr = (err.stderr || '').toString();
    const combined = stdout + stderr;
    if (/CONFLICT/i.test(combined)) {
      let files = parseConflictFiles(stdout);
      if (files.length === 0) {
        try {
          const unmerged = execSync('git ls-files -u', { encoding: 'utf-8' });
          files = [...new Set(
            unmerged.split('\n').map(l => l.split('\t')[1]).filter(Boolean)
          )];
        } catch {
          files = [];
        }
      }
      try { execSync('git merge --abort', { encoding: 'utf-8' }); } catch {}
      return { ok: false, conflict: true, files };
    }
    throw new Error(`git merge failed: ${err.message}`);
  }
  const shaOutput = execSync('git rev-parse HEAD', { encoding: 'utf-8' });
  const sha = (typeof shaOutput === 'string' ? shaOutput : shaOutput.toString()).trim();
  return { ok: true, sha };
}

function mergeAbort() {
  try { execSync('git merge --abort', { encoding: 'utf-8' }); } catch {}
  return { ok: true };
}

module.exports = { mergeBranch, mergeAbort };
