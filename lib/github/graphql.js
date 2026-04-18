'use strict';

const { execSync } = require('child_process');

let callCount = 0;

function resetCallCount() { callCount = 0; }
function getCallCount() { return callCount; }

function quoteShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function ghGraphql(query, variables = {}) {
  callCount += 1;
  const parts = ['gh api graphql', `-f query=${quoteShell(query)}`];
  for (const [name, value] of Object.entries(variables)) {
    if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(`-F ${name}=${value}`);
    } else {
      parts.push(`-f ${name}=${value}`);
    }
  }
  const cmd = parts.join(' ');
  let raw;
  try {
    raw = execSync(cmd, { encoding: 'buffer' });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    throw new Error(`gh api graphql failed: ${err.message}${stderr ? ` -- ${stderr.trim()}` : ''}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.toString());
  } catch (err) {
    throw new Error(`gh api graphql returned non-JSON output: ${raw.toString().slice(0, 200)}`);
  }
  if (parsed.errors && parsed.errors.length) {
    const msg = parsed.errors.map(e => e.message).join('; ');
    throw new Error(`GraphQL errors: ${msg}`);
  }
  return parsed.data;
}

function resolveOwnerId(owner) {
  const query = `
    query($login: String!) {
      user(login: $login) { id }
      organization(login: $login) { id }
    }
  `;
  const data = ghGraphql(query, { login: owner });
  if (data.user && data.user.id) return { id: data.user.id, type: 'user' };
  if (data.organization && data.organization.id) return { id: data.organization.id, type: 'organization' };
  throw new Error(`Could not resolve owner: "${owner}" is neither a user nor organization on GitHub.`);
}

module.exports = { ghGraphql, resolveOwnerId, resetCallCount, getCallCount };
