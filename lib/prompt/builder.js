'use strict';

function buildPrompt(task, options) {
  const { jsonFile, progressFile } = options;
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

  return lines.join('\n');
}

module.exports = { buildPrompt };
