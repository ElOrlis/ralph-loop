'use strict';

const { execSync } = require('child_process');

function quote(v) { return `"${String(v).replace(/"/g, '\\"')}"`; }

function hasUncommittedChanges() {
  try { execSync('git diff --quiet', { encoding: 'utf-8' }); }
  catch { return true; }
  try { execSync('git diff --cached --quiet', { encoding: 'utf-8' }); }
  catch { return true; }
  const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf-8' }).trim();
  return untracked.length > 0;
}

function stashPush(message) {
  let out;
  try {
    out = execSync(`git stash push -u -m ${quote(message)}`, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(`git stash push failed: ${err.message}`);
  }
  return !/no local changes to save/i.test(out);
}

function stashPop() {
  try {
    execSync('git stash pop', { encoding: 'utf-8' });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    throw new Error(`git stash pop failed: ${stderr || err.message}`);
  }
}

module.exports = { hasUncommittedChanges, stashPush, stashPop };
