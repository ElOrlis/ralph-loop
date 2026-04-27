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

function formatIterationComment({ iteration, maxIterations, results, criteria, mcpStatus }) {
  const rows = results.map((r, i) => {
    const text = criteria[i]?.text || `Criterion ${r.criterion}`;
    let status;
    if (r.skipped || r.passed === null) {
      status = ':large_blue_circle: skipped';
    } else if (r.passed) {
      status = ':white_check_mark: pass';
    } else {
      status = `:x: fail${r.error ? ' — ' + r.error : ''}`;
    }
    return `| ${i + 1} | ${text} | ${status} |`;
  });

  const passCount = results.filter(r => r.passed === true).length;
  const total = results.length;

  const lines = [
    `### Iteration ${iteration}/${maxIterations}`,
    '',
    '| # | Criterion | Result |',
    '|---|-----------|--------|',
    ...rows,
    '',
    `**Status:** ${passCount}/${total} criteria passing.${passCount === total ? ' All done!' : ' Continuing.'}`,
  ];

  if (mcpStatus) {
    lines.push(`**MCP:** ${mcpStatus}`);
  }

  return lines.join('\n');
}

function updateIssue({ repo, issueNumber, iteration, maxIterations, results, criteria, mcpStatus }) {
  const comment = formatIterationComment({ iteration, maxIterations, results, criteria, mcpStatus });

  const tmpFile = require('os').tmpdir() + `/ralph-comment-${Date.now()}.md`;
  require('fs').writeFileSync(tmpFile, comment);

  try {
    execSync(`gh issue comment ${issueNumber} --repo "${repo}" --body-file "${tmpFile}"`, {
      encoding: 'utf-8',
    });
  } catch (err) {
    throw new Error(`Failed to update GitHub issue #${issueNumber}: ${err.message}`);
  } finally {
    try { require('fs').unlinkSync(tmpFile); } catch {}
  }
}

function closeIssue({ repo, issueNumber, taskTitle, iterationsUsed }) {
  const comment = `:white_check_mark: Task completed: ${taskTitle}. All criteria passed after ${iterationsUsed} iteration(s). Closing.`;
  const escapedComment = comment.replace(/"/g, '\\"');

  try {
    execSync(`gh issue comment ${issueNumber} --repo "${repo}" --body "${escapedComment}"`, {
      encoding: 'utf-8',
    });
    execSync(`gh issue close ${issueNumber} --repo "${repo}"`, {
      encoding: 'utf-8',
    });
  } catch (err) {
    throw new Error(`Failed to close GitHub issue #${issueNumber}: ${err.message}`);
  }
}

function addLabel({ repo, issueNumber, label }) {
  const cmd = [
    `gh issue edit ${issueNumber}`,
    `--repo "${repo}"`,
    `--add-label "${label.replace(/"/g, '\\"')}"`,
  ].join(' ');
  try {
    execSync(cmd, { encoding: 'utf-8' });
  } catch (err) {
    throw new Error(`Failed to add label "${label}" to issue ${issueNumber}: ${err.message}`);
  }
}

function removeLabel({ repo, issueNumber, label }) {
  const cmd = [
    `gh issue edit ${issueNumber}`,
    `--repo "${repo}"`,
    `--remove-label "${label.replace(/"/g, '\\"')}"`,
  ].join(' ');
  try {
    execSync(cmd, { encoding: 'utf-8' });
  } catch (err) {
    // Label not present on issue is a common no-op condition — swallow quietly.
    const msg = (err.stderr || err.message || '').toString();
    if (/not found/i.test(msg)) return;
    throw new Error(`Failed to remove label "${label}" from issue ${issueNumber}: ${err.message}`);
  }
}

module.exports = { createIssue, updateIssue, closeIssue, formatCriteriaChecklist, formatIterationComment, addLabel, removeLabel };
