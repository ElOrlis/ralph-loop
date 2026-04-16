'use strict';

const { execSync } = require('child_process');

function formatCriteriaChecklist(criteria) {
  return criteria
    .map(c => `- [ ] ${c.text} (\`${c.type}\`)`)
    .join('\n');
}

function createIssue({ repo, task }) {
  const checklist = formatCriteriaChecklist(task.acceptanceCriteria);
  const body = [
    `**Task ID:** ${task.id}`,
    '',
    task.description || '_No description._',
    '',
    '## Acceptance Criteria',
    '',
    checklist || '_No criteria defined._',
    '',
    '---',
    '_Managed by [ralph-loop](https://github.com/numeron/ralph-loop)_',
  ].join('\n');

  const escapedTitle = task.title.replace(/"/g, '\\"');
  const escapedBody = body.replace(/"/g, '\\"');

  const cmd = [
    'gh issue create',
    `--repo "${repo}"`,
    `--title "${escapedTitle}"`,
    `--body "${escapedBody}"`,
    '--label "ralph-loop"',
    `--label "${task.category}"`,
  ].join(' ');

  let output;
  try {
    const raw = execSync(cmd, { encoding: 'utf-8' });
    output = (typeof raw === 'string' ? raw : raw.toString()).trim();
  } catch (err) {
    throw new Error(`Failed to create GitHub issue for ${task.id}: ${err.message}`);
  }

  // gh issue create outputs the URL: https://github.com/owner/repo/issues/42
  const issueNumber = parseInt(output.match(/\/issues\/(\d+)/)?.[1], 10);
  if (isNaN(issueNumber)) {
    throw new Error(`Failed to parse issue number from gh output: ${output}`);
  }

  return { issueNumber, issueUrl: output };
}

module.exports = { createIssue, formatCriteriaChecklist };
