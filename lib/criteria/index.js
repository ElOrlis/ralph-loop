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

    case 'suggest': {
      const taskFile = getArg('--task-file');
      if (!taskFile) {
        console.error('Usage: node lib/criteria/index.js suggest --task-file <path>');
        process.exit(1);
      }
      const prdJson = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
      const { suggestForCriterion } = require('./suggestions');

      let totalSuggestions = 0;
      const tasks = (prdJson.tasks || []).map((t) => {
        const criteria = Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria : [];
        const taskSuggestions = [];
        criteria.forEach((c, idx) => {
          const text = typeof c === 'string' ? c : (c && c.text) || '';
          // Only suggest for untyped criteria (string or {type: 'manual'} or no type)
          const ctype = typeof c === 'object' && c ? c.type : null;
          if (ctype && ctype !== 'manual') return;
          const matches = suggestForCriterion(text);
          if (matches.length === 0) return;
          taskSuggestions.push({
            index: idx,
            original: text,
            suggestion: matches[0],
          });
          totalSuggestions += 1;
        });
        return { id: t.id, title: t.title, suggestions: taskSuggestions };
      });

      console.log(JSON.stringify({ tasks, totalSuggestions }, null, 2));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: verify, normalize, validate-json, suggest');
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
