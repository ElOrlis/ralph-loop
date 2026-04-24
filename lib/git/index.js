#!/usr/bin/env node
'use strict';

const { slugify } = require('./slug');
const {
  computeBranchName, currentBranch, ensureBranch, switchTo,
} = require('./branches');
const { hasUncommittedChanges, stashPush, stashPop } = require('./stash');
const { commitIteration } = require('./commits');
const { execSync } = require('child_process');

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function getFlag(name) {
  return process.argv.includes(name);
}

function quote(v) { return `"${String(v).replace(/"/g, '\\"')}"`; }

function usage(msg) {
  console.error(msg);
  process.exit(1);
}

const command = process.argv[2];

try {
  switch (command) {
    case 'slugify': {
      const input = getArg('--input');
      if (input === null) usage('Usage: slugify --input "<text>"');
      console.log(JSON.stringify({ slug: slugify(input) }));
      break;
    }

    case 'branch-name': {
      const prdSlug = getArg('--prd-slug');
      const taskId  = getArg('--task-id');
      const title   = getArg('--title') || '';
      if (!prdSlug || !taskId) usage('Usage: branch-name --prd-slug <s> --task-id <id> --title "<t>"');
      console.log(JSON.stringify({ branchName: computeBranchName({ prdSlug, taskId, title }) }));
      break;
    }

    case 'current-branch': {
      console.log(JSON.stringify({ branch: currentBranch() }));
      break;
    }

    case 'ensure-branch': {
      const name = getArg('--name');
      const base = getArg('--base');
      if (!name || !base) usage('Usage: ensure-branch --name <b> --base <b>');
      const result = ensureBranch({ name, baseBranch: base });
      console.log(JSON.stringify(result));
      break;
    }

    case 'switch-to': {
      const name = getArg('--name');
      if (!name) usage('Usage: switch-to --name <b>');
      switchTo(name);
      console.log(JSON.stringify({ ok: true, branch: name }));
      break;
    }

    case 'has-uncommitted': {
      console.log(JSON.stringify({ dirty: hasUncommittedChanges() }));
      break;
    }

    case 'stash-push': {
      const message = getArg('--message') || `ralph-loop-${Date.now()}`;
      const stashed = stashPush(message);
      console.log(JSON.stringify({ stashed }));
      break;
    }

    case 'stash-pop': {
      stashPop();
      console.log(JSON.stringify({ ok: true }));
      break;
    }

    case 'commit-iteration': {
      const taskId        = getArg('--task-id');
      const taskTitle     = getArg('--task-title') || taskId;
      const iteration     = parseInt(getArg('--iteration'), 10);
      const maxIterations = parseInt(getArg('--max-iterations'), 10);
      const passCount     = parseInt(getArg('--pass-count'), 10);
      const totalCount    = parseInt(getArg('--total-count'), 10);
      const rawIssue      = getArg('--issue');
      const issueNumber   = rawIssue ? parseInt(rawIssue, 10) : null;
      const ralphStatus   = getArg('--status');
      const skipIfEmpty   = getFlag('--skip-if-empty');
      if (!taskId || !ralphStatus || isNaN(iteration) || isNaN(maxIterations)) {
        usage('Usage: commit-iteration --task-id --task-title --iteration --max-iterations --pass-count --total-count --status [--issue N] [--skip-if-empty]');
      }
      const sha = commitIteration({
        taskId, taskTitle, iteration, maxIterations,
        passCount: passCount || 0, totalCount: totalCount || 0,
        issueNumber, ralphStatus, skipIfEmpty,
      });
      console.log(JSON.stringify({ sha, skipped: sha === null }));
      break;
    }

    case 'push': {
      const branch = getArg('--branch');
      const remote = getArg('--remote') || 'origin';
      if (!branch) usage('Usage: push --branch <b> [--remote <r>]');
      // Push failures are intentionally non-fatal: we report { ok: false } on stdout and exit 0
      // so the Bash caller (push_task_branch) can warn and continue instead of aborting the run.
      try {
        execSync(`git push -u ${quote(remote)} ${quote(branch)}`, { encoding: 'utf-8' });
        console.log(JSON.stringify({ ok: true }));
      } catch (err) {
        console.log(JSON.stringify({ ok: false, error: err.message }));
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: slugify, branch-name, current-branch, ensure-branch, switch-to, has-uncommitted, stash-push, stash-pop, commit-iteration, push');
      process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
