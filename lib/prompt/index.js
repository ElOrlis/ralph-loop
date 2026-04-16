#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { buildPrompt } = require('./builder');
const { normalizeCriteria } = require('../criteria/schema');

const command = process.argv[2];

function main() {
  switch (command) {
    case 'build': {
      const taskFile = getArg('--task-file');
      const taskId = getArg('--task-id');
      const jsonFile = getArg('--json-file') || 'prd.json';
      const progressFile = getArg('--progress-file') || 'progress.txt';

      if (!taskFile || !taskId) {
        console.error('Usage: node lib/prompt/index.js build --task-file <path> --task-id <id> [--json-file <name>] [--progress-file <name>]');
        process.exit(1);
      }

      const prd = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
      const task = prd.tasks.find(t => t.id === taskId);
      if (!task) {
        console.error(`Task "${taskId}" not found in ${taskFile}`);
        process.exit(1);
      }

      const normalizedTask = {
        ...task,
        acceptanceCriteria: normalizeCriteria(task.acceptanceCriteria)
      };

      const prompt = buildPrompt(normalizedTask, { jsonFile, progressFile });
      console.log(prompt);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: build');
      process.exit(1);
  }
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

main();
