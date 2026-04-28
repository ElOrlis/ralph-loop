// lib/report/formatter.test.js
'use strict';

const { format } = require('./formatter');

const sample = {
  summary: {
    totalTasks: 2,
    passed: 1,
    blocked: 1,
    inProgress: 0,
    pending: 0,
    iterationsUsed: 3,
  },
  tasks: [
    {
      id: 'task-1',
      title: 'Backend',
      priority: 1,
      status: 'passed',
      attempts: 3,
      criteriaPassed: 2,
      criteriaTotal: 2,
      dependsOn: [],
      blockedBy: [],
      completedAt: '2026-04-25T10:00:00Z',
    },
    {
      id: 'task-2',
      title: 'Frontend',
      priority: 2,
      status: 'blocked',
      attempts: 1,
      criteriaPassed: 0,
      criteriaTotal: 1,
      dependsOn: ['task-1'],
      blockedBy: ['task-1'],
      completedAt: null,
    },
  ],
  hotspots: [
    {
      taskId: 'task-1',
      criterionIndex: 0,
      criterionText: 'A passing one that flapped',
      failCount: 2,
      lastError: 'connection refused',
    },
  ],
  mcp: { ok: 2, degraded: 1, off: 0, total: 3 },
};

describe('format', () => {
  test('output contains all four section headers', () => {
    const out = format(sample);
    expect(out).toContain('Run Summary');
    expect(out).toContain('Per-Task Breakdown');
    expect(out).toContain('Criteria Hotspots');
    expect(out).toContain('MCP Health');
  });

  test('summary numbers appear in output', () => {
    const out = format(sample);
    expect(out).toMatch(/Total Tasks:\s*2/);
    expect(out).toMatch(/Passed:\s*1/);
    expect(out).toMatch(/Blocked:\s*1/);
    expect(out).toMatch(/Iterations Used:\s*3/);
  });

  test('per-task rows include id and status', () => {
    const out = format(sample);
    expect(out).toContain('task-1');
    expect(out).toContain('task-2');
    expect(out).toMatch(/passed/);
    expect(out).toMatch(/blocked/);
  });

  test('hotspots show task id and fail count', () => {
    const out = format(sample);
    expect(out).toContain('task-1');
    expect(out).toMatch(/2 failures/);
    expect(out).toContain('connection refused');
  });

  test('MCP health section shown only when mcp present', () => {
    const out = format(sample);
    expect(out).toMatch(/ok:\s*2/);
    expect(out).toMatch(/degraded:\s*1/);

    const noMcp = format({ ...sample, mcp: null });
    expect(noMcp).not.toContain('MCP Health');
  });

  test('hotspots section omitted when no hotspots', () => {
    const noHot = format({ ...sample, hotspots: [] });
    expect(noHot).not.toContain('Criteria Hotspots');
  });
});

describe('formatter agent breakdown section', () => {
  test('renders Agent breakdown when present', () => {
    const out = format({
      summary: { totalTasks: 0, passed: 0, blocked: 0, inProgress: 0, pending: 0, iterationsUsed: 3 },
      tasks: [], hotspots: [], mcp: null,
      agentBreakdown: {
        iterations: { claude: 2, copilot: 1 },
        reviewerInvocations: 1,
        reviewerByAgent: { copilot: 1 },
      },
    });
    expect(out).toMatch(/Agent breakdown/);
    expect(out).toMatch(/claude:\s*2/);
    expect(out).toMatch(/copilot:\s*1/);
    expect(out).toMatch(/Reviewer invocations:\s*1/);
  });

  test('omits Agent breakdown when null', () => {
    const out = format({
      summary: { totalTasks: 0, passed: 0, blocked: 0, inProgress: 0, pending: 0, iterationsUsed: 0 },
      tasks: [], hotspots: [], mcp: null, agentBreakdown: null,
    });
    expect(out).not.toMatch(/Agent breakdown/);
  });
});
