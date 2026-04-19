'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

function buildPRBody({ taskId, taskTitle, issueNumber }) {
  const lines = [
    `**Task:** ${taskId} — ${taskTitle}`,
    '',
    '_This pull request is managed by [ralph-loop](https://github.com/numeron/ralph-loop)._',
    '_Each iteration is a separate commit with `Ralph-Status` trailers._',
  ];
  if (issueNumber) {
    lines.push('');
    lines.push(`Closes #${issueNumber}`);
  }
  return lines.join('\n');
}

function prExistsForBranch({ repo, branchName }) {
  try {
    const out = execSync(
      `gh pr view "${branchName}" --repo "${repo}" --json number,url`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(out);
    return parsed.number || null;
  } catch {
    return null;
  }
}

function ensureDraftPR({ repo, branchName, baseBranch, taskId, taskTitle, issueNumber }) {
  // Attempt to find an existing PR first; re-fetch URL so caller gets both fields.
  try {
    const out = execSync(
      `gh pr view "${branchName}" --repo "${repo}" --json number,url`,
      { encoding: 'utf-8' }
    );
    const parsed = JSON.parse(out);
    if (parsed && parsed.number) {
      return { prNumber: parsed.number, prUrl: parsed.url, created: false };
    }
  } catch {
    // No existing PR for this branch — proceed to create.
  }

  const body = buildPRBody({ taskId, taskTitle, issueNumber });
  const title = `${taskId}: ${taskTitle}`;

  const bodyFile = path.join(os.tmpdir(), `ralph-pr-body-${Date.now()}-${process.pid}.md`);
  fs.writeFileSync(bodyFile, body);

  const escapedTitle = title.replace(/"/g, '\\"');
  const cmd = [
    'gh pr create',
    `--repo "${repo}"`,
    '--draft',
    `--base "${baseBranch}"`,
    `--head "${branchName}"`,
    `--title "${escapedTitle}"`,
    `--body-file "${bodyFile}"`,
  ].join(' ');

  let output;
  try {
    const raw = execSync(cmd, { encoding: 'utf-8' });
    output = String(raw).trim();
  } catch (err) {
    throw new Error(`Failed to create draft PR for ${branchName}: ${err.message}`);
  } finally {
    try { fs.unlinkSync(bodyFile); } catch {}
  }

  const match = output.match(/\/pull\/(\d+)/);
  if (!match) {
    throw new Error(`Could not parse PR number from gh output: ${output}`);
  }
  return { prNumber: parseInt(match[1], 10), prUrl: output, created: true };
}

function markPRReady({ repo, prNumber }) {
  try {
    execSync(`gh pr ready ${prNumber} --repo "${repo}"`, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(`Failed to mark PR #${prNumber} ready: ${err.message}`);
  }
}

module.exports = { buildPRBody, prExistsForBranch, ensureDraftPR, markPRReady };
