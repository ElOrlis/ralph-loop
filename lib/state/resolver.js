'use strict';

const path = require('path');
const crypto = require('crypto');

function computeSlug(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new Error('computeSlug: relPath must be a non-empty string');
  }
  const len = parseInt(process.env.RALPH_SLUG_HASH_LEN || '4', 10);
  if (!Number.isFinite(len) || len < 4 || len > 40) {
    throw new Error(`RALPH_SLUG_HASH_LEN must be between 4 and 40 (got ${process.env.RALPH_SLUG_HASH_LEN})`);
  }
  const basename = path.basename(relPath).replace(/\.(md|json)$/i, '');
  const hash = crypto.createHash('sha1').update(relPath).digest('hex').slice(0, len);
  return `${basename}-${hash}`;
}

function resolvePaths({ stateDirOverride, repoRoot, relPath } = {}) {
  if (stateDirOverride) {
    const stateDir = path.resolve(stateDirOverride);
    return {
      stateDir,
      jsonFile: path.join(stateDir, 'prd.json'),
      progressFile: path.join(stateDir, 'progress.txt'),
      mcpConfigFile: path.join(stateDir, 'mcp-config.json'),
      slug: null,
      source: null,
    };
  }
  if (!repoRoot || !relPath) {
    throw new Error('resolvePaths: must provide stateDirOverride OR (repoRoot AND relPath)');
  }
  const slug = computeSlug(relPath);
  const stateDir = path.join(repoRoot, '.ralph', slug);
  return {
    stateDir,
    jsonFile: path.join(stateDir, 'prd.json'),
    progressFile: path.join(stateDir, 'progress.txt'),
    mcpConfigFile: path.join(stateDir, 'mcp-config.json'),
    slug,
    source: relPath,
  };
}

module.exports = { computeSlug, resolvePaths };
