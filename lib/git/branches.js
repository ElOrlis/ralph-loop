// lib/git/branches.js
'use strict';

const { execSync } = require('child_process');
const { slugify } = require('./slug');

function quote(v) {
  return `"${String(v).replace(/"/g, '\\"')}"`;
}

function computeBranchName({ prdSlug, taskId, title }) {
  if (!prdSlug) throw new Error('computeBranchName: prdSlug is required');
  if (!taskId)  throw new Error('computeBranchName: taskId is required');
  const titleSlug = slugify(title);
  const tail = titleSlug ? `${taskId}-${titleSlug}` : taskId;
  return `ralph/${prdSlug}/${tail}`;
}

function currentBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch (err) {
    throw new Error(`could not read current branch: ${err.message}`);
  }
}

function branchExists(name) {
  try {
    execSync(`git show-ref --verify --quiet ${quote(`refs/heads/${name}`)}`, { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

function ensureBranch({ name, baseBranch }) {
  if (branchExists(name)) return { created: false };
  let baseSha;
  try {
    baseSha = execSync(`git rev-parse ${quote(baseBranch)}`, { encoding: 'utf-8' }).trim();
  } catch (err) {
    throw new Error(`base branch "${baseBranch}" not resolvable: ${err.message}`);
  }
  try {
    execSync(`git branch ${quote(name)} ${quote(baseBranch)}`, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(`could not create branch "${name}" from "${baseBranch}": ${err.message}`);
  }
  return { created: true, baseSha };
}

function switchTo(name) {
  try {
    execSync(`git checkout ${quote(name)}`, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(`could not switch to branch "${name}": ${err.message}`);
  }
}

module.exports = {
  computeBranchName,
  currentBranch,
  branchExists,
  ensureBranch,
  switchTo,
};
