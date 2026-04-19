'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

function formatCommitMessage({
  taskId, taskTitle, iteration, maxIterations,
  passCount, totalCount, issueNumber, ralphStatus,
}) {
  const firstChar = taskTitle.charAt(0).toLowerCase();
  const subject = `${taskId}: ${firstChar}${taskTitle.slice(1)}`;
  const body = `Iteration ${iteration}/${maxIterations}. Criteria: ${passCount}/${totalCount} passing.`;
  const trailers = [`Ralph-Task-Id: ${taskId}`];
  if (issueNumber) trailers.push(`Ralph-Issue: #${issueNumber}`);
  trailers.push(`Ralph-Status: ${ralphStatus}`);
  return [subject, '', body, '', trailers.join('\n')].join('\n');
}

function commitIteration(opts) {
  execSync('git add -A', { encoding: 'utf-8' });

  if (opts.skipIfEmpty) {
    try {
      execSync('git diff --cached --quiet', { encoding: 'utf-8' });
      return null; // nothing staged; nothing to commit
    } catch {
      // staged changes exist — fall through to commit
    }
  }

  const message = formatCommitMessage(opts);
  const msgFile = path.join(os.tmpdir(), `ralph-commit-${Date.now()}-${process.pid}.txt`);
  fs.writeFileSync(msgFile, message);
  try {
    execSync(`git commit -F "${msgFile}"`, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(`git commit failed: ${err.message}`);
  } finally {
    try { fs.unlinkSync(msgFile); } catch {}
  }

  return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
}

module.exports = { formatCommitMessage, commitIteration };
