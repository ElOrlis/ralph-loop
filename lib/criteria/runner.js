'use strict';

const { execSync } = require('child_process');
const fs = require('fs');

async function runCriterion(criterion) {
  switch (criterion.type) {
    case 'shell':
      return runShell(criterion);
    case 'file-exists':
      return runFileExists(criterion);
    case 'grep':
      return runGrep(criterion);
    case 'http':
      return runHttp(criterion);
    case 'manual':
      return { passed: null, skipped: true };
    default:
      return { passed: false, error: `Unknown criterion type: ${criterion.type}` };
  }
}

function runShell(criterion) {
  const expectExitCode = criterion.expectExitCode ?? 0;
  try {
    execSync(criterion.command, { stdio: 'pipe', timeout: 60000 });
    return expectExitCode === 0
      ? { passed: true }
      : { passed: false, error: `Expected exit code ${expectExitCode} but got 0` };
  } catch (err) {
    const actualCode = err.status ?? 1;
    if (actualCode === expectExitCode) {
      return { passed: true };
    }
    return { passed: false, error: `Expected exit code ${expectExitCode} but got ${actualCode}` };
  }
}

function runFileExists(criterion) {
  if (fs.existsSync(criterion.path)) {
    return { passed: true };
  }
  return { passed: false, error: `File not found: ${criterion.path}` };
}

function runGrep(criterion) {
  try {
    const content = fs.readFileSync(criterion.path, 'utf-8');
    const regex = new RegExp(criterion.pattern);
    if (regex.test(content)) {
      return { passed: true };
    }
    return { passed: false, error: `Pattern "${criterion.pattern}" not found in ${criterion.path}` };
  } catch (err) {
    return { passed: false, error: `Grep failed: ${err.message}` };
  }
}

async function runHttp(criterion) {
  const method = criterion.method || 'GET';
  const timeout = criterion.timeout || 10000;
  const retries = criterion.retries || 0;
  const retryDelay = criterion.retryDelay || 1000;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const options = { method, signal: controller.signal };
      if (criterion.body && method !== 'GET') {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(criterion.body);
      }
      const response = await fetch(criterion.url, options);
      clearTimeout(timer);
      if (response.status === criterion.expectStatus) {
        return { passed: true };
      }
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, retryDelay));
        continue;
      }
      return { passed: false, error: `Expected status ${criterion.expectStatus} but got ${response.status}` };
    } catch (err) {
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, retryDelay));
        continue;
      }
      return { passed: false, error: `HTTP request failed: ${err.message}` };
    }
  }
}

async function verifyCriteria(criteria) {
  const results = [];
  let allPassed = true;

  for (let i = 0; i < criteria.length; i++) {
    const result = await runCriterion(criteria[i]);
    const entry = { criterion: i };

    if (result.skipped) {
      entry.passed = null;
      entry.skipped = true;
    } else {
      entry.passed = result.passed;
      if (!result.passed) {
        entry.error = result.error;
        allPassed = false;
      }
    }

    results.push(entry);
  }

  return { passed: allPassed, results };
}

module.exports = { runCriterion, verifyCriteria };
