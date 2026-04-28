// lib/report/aggregator.js
'use strict';

function aggregate(prdJson, progressText) {
  const progress = typeof progressText === 'string' ? progressText : '';
  const tasksRaw = Array.isArray(prdJson.tasks) ? prdJson.tasks : [];

  const tasks = tasksRaw.map((t) => {
    const criteria = Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria : [];
    const results = Array.isArray(t.criteriaResults) ? t.criteriaResults : [];
    let criteriaPassed = 0;
    for (let i = 0; i < criteria.length; i++) {
      const r = results[i];
      if (r && r.passed === true) criteriaPassed += 1;
    }
    let status;
    if (t.passes === true) status = 'passed';
    else if (t.status === 'blocked') status = 'blocked';
    else if ((t.attempts || 0) > 0) status = 'in-progress';
    else status = 'pending';

    return {
      id: t.id,
      title: t.title,
      priority: t.priority,
      status,
      attempts: t.attempts || 0,
      criteriaPassed,
      criteriaTotal: criteria.length,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
      blockedBy: Array.isArray(t.blockedBy) ? t.blockedBy : [],
      completedAt: t.completedAt || null,
    };
  });

  const summary = {
    totalTasks: tasks.length,
    passed: tasks.filter((t) => t.status === 'passed').length,
    blocked: tasks.filter((t) => t.status === 'blocked').length,
    inProgress: tasks.filter((t) => t.status === 'in-progress').length,
    pending: tasks.filter((t) => t.status === 'pending').length,
    iterationsUsed: countIterations(progress),
  };

  const hotspots = computeHotspots(tasksRaw);
  const mcp = computeMcp(progress);
  const agentBreakdown = computeAgentBreakdown(progress);

  return { summary, tasks, hotspots, mcp, agentBreakdown };
}

function countIterations(progressText) {
  const matches = progressText.match(/ITERATION\s+\d+\/\d+/g);
  return matches ? matches.length : 0;
}

function computeHotspots(tasksRaw) {
  // criteriaResults is flat: one entry per criterion, with `attempts`
  // counting consecutive failures (reset on pass). A hotspot is any
  // criterion whose `attempts` is >= 2.
  const out = [];
  for (const t of tasksRaw) {
    const criteria = Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria : [];
    const results = Array.isArray(t.criteriaResults) ? t.criteriaResults : [];
    for (let i = 0; i < criteria.length; i++) {
      const r = results[i];
      const attempts = r && typeof r.attempts === 'number' ? r.attempts : 0;
      if (attempts >= 2) {
        out.push({
          taskId: t.id,
          criterionIndex: i,
          criterionText: typeof criteria[i] === 'string'
            ? criteria[i]
            : (criteria[i] && (criteria[i].text || criteria[i].value)) || '',
          failCount: attempts,
          lastError: r && r.error ? r.error : '',
        });
      }
    }
  }
  out.sort((a, b) => b.failCount - a.failCount);
  return out;
}

function computeMcp(progressText) {
  const lines = progressText.split(/\r?\n/);
  let ok = 0; let degraded = 0; let off = 0;
  for (const line of lines) {
    const m = line.match(/^MCP:\s*(ok|degraded|off)\s*$/);
    if (!m) continue;
    if (m[1] === 'ok') ok += 1;
    else if (m[1] === 'degraded') degraded += 1;
    else if (m[1] === 'off') off += 1;
  }
  const total = ok + degraded + off;
  if (total === 0) return null;
  return { ok, degraded, off, total };
}

function computeAgentBreakdown(progressText) {
  const lines = progressText.split(/\r?\n/);
  const iterations = {};
  const reviewerByAgent = {};
  let reviewerInvocations = 0;
  for (const line of lines) {
    const a = line.match(/^Agent:\s*(claude|copilot)\s*$/);
    if (a) { iterations[a[1]] = (iterations[a[1]] || 0) + 1; continue; }
    const r = line.match(/^Reviewer:\s*(claude|copilot)\s+(ok|degraded|off|n\/a)\s*$/);
    if (r) {
      reviewerInvocations += 1;
      reviewerByAgent[r[1]] = (reviewerByAgent[r[1]] || 0) + 1;
    }
  }
  if (Object.keys(iterations).length === 0 && reviewerInvocations === 0) return null;
  return { iterations, reviewerInvocations, reviewerByAgent };
}

module.exports = { aggregate };
