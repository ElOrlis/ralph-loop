#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { buildPrompt, buildReviewPrompt } = require('./builder');
const { normalizeCriteria } = require('../criteria/schema');

const command = process.argv[2];

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function loadTask(taskFile, taskId) {
  const prd = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
  const task = prd.tasks.find((t) => t.id === taskId);
  if (!task) {
    console.error(`Task "${taskId}" not found in ${taskFile}`);
    process.exit(1);
  }
  return {
    ...task,
    acceptanceCriteria: normalizeCriteria(task.acceptanceCriteria),
  };
}

function main() {
  switch (command) {
    case 'build': {
      const taskFile = getArg('--task-file');
      const taskId = getArg('--task-id');
      const jsonFile = getArg('--json-file') || 'prd.json';
      const progressFile = getArg('--progress-file') || 'progress.txt';
      const feedbackFile = getArg('--reviewer-feedback-file');
      const consecutiveFailures = parseInt(getArg('--consecutive-failures') || '0', 10);
      const thrashThreshold = 4;

      if (!taskFile || !taskId) {
        console.error('Usage: node lib/prompt/index.js build --task-file <path> --task-id <id> [--json-file <name>] [--progress-file <name>] [--reviewer-feedback-file <path>] [--consecutive-failures <n>]');
        process.exit(1);
      }

      const task = loadTask(taskFile, taskId);

      let reviewerFeedback = '';
      if (feedbackFile && fs.existsSync(feedbackFile) && consecutiveFailures >= thrashThreshold) {
        reviewerFeedback = fs.readFileSync(feedbackFile, 'utf-8');
        try { fs.unlinkSync(feedbackFile); } catch {}
      }

      console.log(buildPrompt(task, { jsonFile, progressFile, reviewerFeedback }));
      break;
    }

    case 'build-review': {
      const taskFile = getArg('--task-file');
      const taskId = getArg('--task-id');
      const resultsFile = getArg('--criteria-results-file');
      const tailFile = getArg('--agent-output-tail-file');

      if (!taskFile || !taskId || !resultsFile) {
        console.error('Usage: node lib/prompt/index.js build-review --task-file <path> --task-id <id> --criteria-results-file <path> [--agent-output-tail-file <path>]');
        process.exit(1);
      }

      const task = loadTask(taskFile, taskId);
      const criteriaResults = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));
      const agentOutputTail = tailFile && fs.existsSync(tailFile)
        ? fs.readFileSync(tailFile, 'utf-8')
        : '';

      console.log(buildReviewPrompt({ task, criteriaResults, agentOutputTail }));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: build, build-review');
      process.exit(1);
  }
}

main();
