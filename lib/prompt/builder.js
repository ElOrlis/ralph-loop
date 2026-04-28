'use strict';

function buildPrompt(task, options) {
  const { jsonFile, progressFile, reviewerFeedback } = options;
  const lines = [];

  lines.push(`You are working on task "${task.title}" (${task.id}, priority ${task.priority}).`);
  lines.push('');

  if (task.description) {
    lines.push(`Description: ${task.description}`);
    lines.push('');
  }

  lines.push('After your turn, I will verify your work by running these checks:');

  task.acceptanceCriteria.forEach((c, i) => {
    const num = i + 1;
    switch (c.type) {
      case 'shell':
        lines.push(`  ${num}. ${c.text} — run: ${c.command} (expecting exit code ${c.expectExitCode ?? 0})`);
        break;
      case 'http':
        lines.push(`  ${num}. ${c.text} — ${c.method || 'GET'} ${c.url} (expecting status ${c.expectStatus})`);
        break;
      case 'file-exists':
        lines.push(`  ${num}. ${c.text} — check file exists: ${c.path}`);
        break;
      case 'grep':
        lines.push(`  ${num}. ${c.text} — grep for "${c.pattern}" in ${c.path}`);
        break;
      case 'manual':
        lines.push(`  ${num}. ${c.text} — (manual review, not automatically verified)`);
        break;
      default:
        lines.push(`  ${num}. ${c.text}`);
    }
  });

  lines.push('');
  lines.push(`Work in this directory. Do not modify ${jsonFile} or ${progressFile}.`);
  lines.push('When you believe the task is complete, just say "DONE".');

  if (reviewerFeedback && String(reviewerFeedback).trim()) {
    lines.push('');
    lines.push('## Reviewer Feedback');
    lines.push('');
    lines.push('A second agent reviewed prior failed iterations and suggested:');
    lines.push('');
    lines.push(String(reviewerFeedback).trim());
  }

  return lines.join('\n');
}

function buildReviewPrompt({ task, criteriaResults, agentOutputTail }) {
  const failing = (criteriaResults || []).filter((r) => r.passed === false);
  const lines = [];
  lines.push(`You are reviewing a failed iteration of task "${task.title}" (${task.id}).`);
  lines.push('');
  lines.push('The implementing agent could not satisfy these acceptance criteria:');
  lines.push('');
  failing.forEach((r) => {
    const c = task.acceptanceCriteria[r.criterion - 1];
    const text = (c && c.text) || `Criterion ${r.criterion}`;
    const err = r.error ? ` — error: ${r.error}` : '';
    lines.push(`- ${text}${err}`);
  });
  lines.push('');
  lines.push('Last lines of the implementing agent\'s output:');
  lines.push('');
  lines.push('```');
  lines.push(String(agentOutputTail || '').trim() || '(no output captured)');
  lines.push('```');
  lines.push('');
  lines.push('Suggest a different approach for the next iteration. Be concrete: name files,');
  lines.push('functions, libraries, or commands. Do not write code yourself; the implementer');
  lines.push('will read your suggestion and act on it. Keep the response under 300 words.');
  return lines.join('\n');
}

module.exports = { buildPrompt, buildReviewPrompt };
