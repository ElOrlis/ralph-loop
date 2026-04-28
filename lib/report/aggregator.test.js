// lib/report/aggregator.test.js
'use strict';

const { aggregate } = require('./aggregator');

// Note: criteriaResults is flat per-criterion (ralph-loop overwrites the
// whole array each iteration; failure counts accumulate in `attempts`).
const samplePrd = {
  tasks: [
    {
      id: 'task-1',
      title: 'Backend',
      priority: 1,
      passes: true,
      attempts: 3,
      completedAt: '2026-04-25T10:00:00Z',
      acceptanceCriteria: [
        { text: 'A passing one' },
        { text: 'Another' },
      ],
      criteriaResults: [
        { criterion: 0, passed: true, attempts: 2, error: 'connection refused' },
        { criterion: 1, passed: true, attempts: 0 },
      ],
      status: 'ready',
      dependsOn: [],
    },
    {
      id: 'task-2',
      title: 'Frontend',
      priority: 2,
      passes: false,
      attempts: 1,
      acceptanceCriteria: [{ text: 'Something' }],
      criteriaResults: [
        { criterion: 0, passed: false, attempts: 1, error: 'still failing' },
      ],
      status: 'blocked',
      blockedBy: ['task-1'],
      dependsOn: ['task-1'],
    },
  ],
};

const sampleProgress = `┌────┐
│ ITERATION 1/15
│ Timestamp: 2026-04-25 09:00:00
│ Working on: task-1 - Backend
└────┘
MCP: ok
┌────┐
│ ITERATION 2/15
│ Timestamp: 2026-04-25 09:30:00
│ Working on: task-1 - Backend
└────┘
MCP: degraded
┌────┐
│ ITERATION 3/15
│ Timestamp: 2026-04-25 10:00:00
│ Working on: task-1 - Backend
└────┘
MCP: ok
`;

describe('aggregate', () => {
  test('summary counts tasks by status', () => {
    const out = aggregate(samplePrd, sampleProgress);
    expect(out.summary.totalTasks).toBe(2);
    expect(out.summary.passed).toBe(1);
    expect(out.summary.blocked).toBe(1);
    expect(out.summary.iterationsUsed).toBe(3);
  });

  test('per-task breakdown reports criteria pass/total', () => {
    const out = aggregate(samplePrd, sampleProgress);
    const t1 = out.tasks.find((t) => t.id === 'task-1');
    expect(t1).toMatchObject({
      title: 'Backend',
      status: 'passed',
      attempts: 3,
      criteriaPassed: 2,
      criteriaTotal: 2,
    });
    const t2 = out.tasks.find((t) => t.id === 'task-2');
    expect(t2).toMatchObject({
      status: 'blocked',
      criteriaPassed: 0,
      criteriaTotal: 1,
      blockedBy: ['task-1'],
    });
  });

  test('hotspots include criteria with attempts >= 2, sorted desc', () => {
    const out = aggregate(samplePrd, sampleProgress);
    expect(out.hotspots).toHaveLength(1);
    expect(out.hotspots[0]).toMatchObject({
      taskId: 'task-1',
      criterionIndex: 0,
      failCount: 2,
    });
    expect(out.hotspots[0].lastError).toContain('connection refused');
  });

  test('mcp section reports counts and rate', () => {
    const out = aggregate(samplePrd, sampleProgress);
    expect(out.mcp).toMatchObject({
      ok: 2,
      degraded: 1,
      off: 0,
      total: 3,
    });
  });

  test('mcp section is null when no MCP lines present', () => {
    const out = aggregate(samplePrd, '┌────┐\n│ ITERATION 1/15\n└────┘\n');
    expect(out.mcp).toBeNull();
  });

  test('does not throw when progressText is undefined', () => {
    expect(() => aggregate(samplePrd)).not.toThrow();
    const out = aggregate(samplePrd);
    expect(out.summary.iterationsUsed).toBe(0);
    expect(out.mcp).toBeNull();
  });

  test('does not throw when progressText is null', () => {
    expect(() => aggregate(samplePrd, null)).not.toThrow();
    const out = aggregate(samplePrd, null);
    expect(out.summary.iterationsUsed).toBe(0);
  });

  test('hotspot criterionText falls back to value or empty when text is missing', () => {
    const prd = {
      tasks: [
        {
          id: 'task-x',
          title: 'X',
          priority: 1,
          passes: false,
          attempts: 1,
          acceptanceCriteria: [
            { type: 'shell', value: 'npm test' },
            { type: 'manual' },
          ],
          criteriaResults: [
            { criterion: 0, passed: false, attempts: 3, error: 'boom' },
            { criterion: 1, passed: false, attempts: 2 },
          ],
        },
      ],
    };
    const out = aggregate(prd, '');
    expect(out.hotspots).toHaveLength(2);
    const byIdx = Object.fromEntries(out.hotspots.map((h) => [h.criterionIndex, h]));
    expect(byIdx[0].criterionText).toBe('npm test');
    expect(byIdx[1].criterionText).toBe('');
  });
});
