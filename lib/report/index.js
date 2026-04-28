#!/usr/bin/env node
// lib/report/index.js
'use strict';

const fs = require('fs');
const { aggregate } = require('./aggregator');
const { format } = require('./formatter');

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx === process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

function main() {
  const command = process.argv[2];
  if (command !== 'report') {
    console.error(`Unknown command: ${command}`);
    console.error('Available: report');
    process.exit(1);
  }

  const taskFile = getArg('--task-file');
  const progressFile = getArg('--progress-file');
  if (!taskFile) {
    console.error('Usage: node lib/report/index.js report --task-file <path> [--progress-file <path>]');
    process.exit(1);
  }

  let prdJson;
  try {
    prdJson = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
  } catch (err) {
    console.error(`Failed to read PRD JSON from ${taskFile}: ${err.message}`);
    process.exit(1);
  }

  let progressText = '';
  if (progressFile) {
    try {
      progressText = fs.readFileSync(progressFile, 'utf-8');
    } catch (err) {
      // missing progress file is fine — fresh PRD with no run yet
      progressText = '';
    }
  }

  const report = aggregate(prdJson, progressText);
  process.stdout.write(format(report) + '\n');
}

main();
