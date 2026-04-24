#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { buildGraph, detectCycle, pickNextTask } = require('./graph');

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

function usage(msg) {
  console.error(msg);
  process.exit(1);
}

const command = process.argv[2];

try {
  switch (command) {
    case 'next-task': {
      const taskFile = getArg('--task-file');
      if (!taskFile) usage('Usage: next-task --task-file <path>');
      const prd = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
      const tasks = prd.tasks || [];
      const reply = pickNextTask(tasks);
      console.log(JSON.stringify(reply));
      break;
    }

    case 'validate': {
      const taskFile = getArg('--task-file');
      if (!taskFile) usage('Usage: validate --task-file <path>');
      const prd = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
      const tasks = prd.tasks || [];
      let graph;
      try {
        graph = buildGraph(tasks);
      } catch (err) {
        console.error(err.message);
        process.exit(1);
      }
      const cycle = detectCycle(graph);
      if (cycle) {
        console.error(`graph has a cycle: ${cycle.join(' -> ')}`);
        process.exit(1);
      }
      console.log(JSON.stringify({ ok: true, cycle: null }));
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: next-task, validate');
      process.exit(1);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
