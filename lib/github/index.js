#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { resolveRepo } = require('./repo');
const { createIssue, updateIssue, closeIssue } = require('./issues');
const { normalizeCriteria } = require('../criteria/schema');

const command = process.argv[2];

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

async function main() {
  switch (command) {
    case 'resolve-repo': {
      const cliRepo = getArg('--repo');
      const taskFile = getArg('--task-file');
      let prdRepository = null;
      if (taskFile) {
        const prd = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
        prdRepository = prd.repository || null;
      }
      const repo = resolveRepo({ cliRepo, prdRepository });
      console.log(JSON.stringify({ repo }));
      break;
    }

    case 'create-issue': {
      const repo = getArg('--repo');
      const taskJson = getArg('--task');
      if (!repo || !taskJson) {
        console.error('Usage: node lib/github/index.js create-issue --repo owner/name --task \'<json>\'');
        process.exit(1);
      }
      const task = JSON.parse(taskJson);
      task.acceptanceCriteria = normalizeCriteria(task.acceptanceCriteria);
      const result = createIssue({ repo, task });
      console.log(JSON.stringify(result));
      break;
    }

    case 'update-issue': {
      const repo = getArg('--repo');
      const issueNumber = parseInt(getArg('--issue'), 10);
      const iteration = parseInt(getArg('--iteration'), 10);
      const maxIterations = parseInt(getArg('--max-iterations'), 10);
      const resultsJson = getArg('--results');
      const criteriaJson = getArg('--criteria');
      if (!repo || !issueNumber || !iteration || !maxIterations || !resultsJson || !criteriaJson) {
        console.error('Usage: node lib/github/index.js update-issue --repo owner/name --issue N --iteration N --max-iterations N --results \'<json>\' --criteria \'<json>\'');
        process.exit(1);
      }
      updateIssue({
        repo,
        issueNumber,
        iteration,
        maxIterations,
        results: JSON.parse(resultsJson),
        criteria: JSON.parse(criteriaJson),
      });
      console.log(JSON.stringify({ ok: true }));
      break;
    }

    case 'close-issue': {
      const repo = getArg('--repo');
      const issueNumber = parseInt(getArg('--issue'), 10);
      const taskTitle = getArg('--task-title');
      const iterationsUsed = parseInt(getArg('--iterations-used'), 10);
      if (!repo || !issueNumber) {
        console.error('Usage: node lib/github/index.js close-issue --repo owner/name --issue N --task-title "..." --iterations-used N');
        process.exit(1);
      }
      closeIssue({ repo, issueNumber, taskTitle: taskTitle || 'Unknown', iterationsUsed: iterationsUsed || 0 });
      console.log(JSON.stringify({ ok: true }));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: resolve-repo, create-issue, update-issue, close-issue');
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
