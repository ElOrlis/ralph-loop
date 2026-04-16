'use strict';

const { execSync } = require('child_process');

const REPO_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

function validateRepoFormat(repo, source) {
  if (!REPO_PATTERN.test(repo)) {
    throw new Error(`Invalid repository format from ${source}: "${repo}". Expected "owner/name".`);
  }
}

function parseGitRemote() {
  let url;
  try {
    url = String(execSync('git remote get-url origin', { encoding: 'utf-8' })).trim();
  } catch {
    return null;
  }

  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  if (httpsMatch) return httpsMatch[1];

  return null;
}

function resolveRepo({ cliRepo, prdRepository }) {
  // 1. CLI flag (highest priority)
  if (cliRepo) {
    validateRepoFormat(cliRepo, '--repo flag');
    return cliRepo;
  }

  // 2. PRD JSON field
  if (prdRepository) {
    validateRepoFormat(prdRepository, 'PRD repository field');
    return prdRepository;
  }

  // 3. Git remote fallback
  const gitRepo = parseGitRemote();
  if (gitRepo) return gitRepo;

  throw new Error(
    'Could not resolve target repository. Provide --repo owner/name, ' +
    'add "repository" to the PRD JSON, or run from a git repo with a GitHub remote.'
  );
}

module.exports = { resolveRepo, parseGitRemote };
