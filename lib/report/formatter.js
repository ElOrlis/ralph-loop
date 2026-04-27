// lib/report/formatter.js
'use strict';

const BLUE = '\x1b[34m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const NC = '\x1b[0m';

function format(report) {
  const lines = [];
  lines.push(`${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}`);
  lines.push(`${BLUE}║                             PRD STATUS REPORT                                ║${NC}`);
  lines.push(`${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}`);
  lines.push('');

  // Section 1: Run Summary
  lines.push(`${BLUE}Run Summary:${NC}`);
  lines.push(`  Total Tasks:      ${report.summary.totalTasks}`);
  lines.push(`  Passed:           ${report.summary.passed}`);
  lines.push(`  In Progress:      ${report.summary.inProgress}`);
  lines.push(`  Blocked:          ${report.summary.blocked}`);
  lines.push(`  Pending:          ${report.summary.pending}`);
  lines.push(`  Iterations Used:  ${report.summary.iterationsUsed}`);
  lines.push('');

  // Section 2: Per-Task Breakdown
  lines.push(`${BLUE}Per-Task Breakdown:${NC}`);
  for (const t of (report.tasks || [])) {
    const statusColor = t.status === 'passed' ? GREEN
      : t.status === 'blocked' ? RED
      : t.status === 'in-progress' ? YELLOW
      : NC;
    const dependsOn = t.dependsOn || [];
    const blockedBy = t.blockedBy || [];
    const deps = dependsOn.length ? ` deps:[${dependsOn.join(',')}]` : '';
    const blocked = t.status === 'blocked' && blockedBy.length
      ? ` blocked by:[${blockedBy.join(',')}]`
      : '';
    lines.push(
      `  ${t.id} (P${t.priority}) ${statusColor}${t.status}${NC}  ` +
      `attempts=${t.attempts}  criteria=${t.criteriaPassed}/${t.criteriaTotal}` +
      deps + blocked
    );
    lines.push(`    "${t.title}"`);
  }
  lines.push('');

  // Section 3: Criteria Hotspots (omitted when empty)
  if (report.hotspots && report.hotspots.length > 0) {
    lines.push(`${BLUE}Criteria Hotspots:${NC}`);
    for (const h of report.hotspots) {
      const text = truncate(h.criterionText || '', 70);
      const err = truncate(h.lastError || '', 80);
      lines.push(`  ${h.taskId}#${h.criterionIndex + 1}  ${YELLOW}${h.failCount} failures${NC}`);
      lines.push(`    "${text}"`);
      if (err) lines.push(`    last error: ${err}`);
    }
    lines.push('');
  }

  // Section 4: MCP Health (omitted when null)
  if (report.mcp) {
    lines.push(`${BLUE}MCP Health:${NC}`);
    lines.push(`  ok:        ${report.mcp.ok}`);
    lines.push(`  degraded:  ${report.mcp.degraded}`);
    lines.push(`  off:       ${report.mcp.off}`);
    lines.push(`  total:     ${report.mcp.total}`);
    if (report.mcp.degraded > 0) {
      lines.push(`  ${YELLOW}see mcp-iteration-N.log files for degraded iterations${NC}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function truncate(s, max) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

module.exports = { format };
