#!/usr/bin/env node
// lib/mcp/index.js
'use strict';

const fs = require('fs');
const path = require('path');
const { buildMcpConfig } = require('./config');

const command = process.argv[2];

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx === process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

function main() {
  switch (command) {
    case 'write-config': {
      const output = getArg('--output');
      if (!output) {
        console.error('Usage: node lib/mcp/index.js write-config --output <path>');
        process.exit(1);
      }
      const dir = path.dirname(path.resolve(output));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(output, JSON.stringify(buildMcpConfig(), null, 2) + '\n');
      console.log(output);
      break;
    }
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Available: write-config');
      process.exit(1);
  }
}

main();
