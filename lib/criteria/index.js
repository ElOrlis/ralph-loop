#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { normalizeCriteria, validateCriterion } = require('./schema');
const { verifyCriteria } = require('./runner');

const command = process.argv[2];

async function main() {
  switch (command) {
    case 'verify': {
      const taskFile = getArg('--task-file');
      const taskId = getArg('--task-id');
      if (!taskFile || !taskId) {
        console.error('Usage: node lib/criteria/index.js verify --task-file <path> --task-id <id>');
        process.exit(1);
      }
      const prd = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
      const task = prd.tasks.find(t => t.id === taskId);
      if (!task) {
        console.error(`Task "${taskId}" not found in ${taskFile}`);
        process.exit(1);
      }
      const criteria = normalizeCriteria(task.acceptanceCriteria);
      const invalid = criteria.map(c => validateCriterion(c)).find(r => !r.valid);
      if (invalid) {
        console.error(`Invalid criterion: ${invalid.error}`);
        process.exit(1);
      }
      const result = await verifyCriteria(criteria);
      console.log(JSON.stringify(result));
      process.exit(result.passed ? 0 : 1);
    }

    case 'normalize': {
      const input = JSON.parse(fs.readFileSync('/dev/stdin', 'utf-8'));
      const normalized = normalizeCriteria(input);
      console.log(JSON.stringify(normalized));
      break;
    }

    case 'validate-json': {
      const file = getArg('--file');
      if (!file) {
        console.error('Usage: node lib/criteria/index.js validate-json --file <path>');
        process.exit(1);
      }
      try {
        JSON.parse(fs.readFileSync(file, 'utf-8'));
        console.log(JSON.stringify({ valid: true }));
      } catch (err) {
        console.log(JSON.stringify({ valid: false, error: err.message }));
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: verify, normalize, validate-json');
      process.exit(1);
  }
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
