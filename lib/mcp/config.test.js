'use strict';

const { buildMcpConfig } = require('./config');

describe('buildMcpConfig', () => {
  test('returns mcpServers config with mcpls entry', () => {
    expect(buildMcpConfig()).toEqual({
      mcpServers: {
        mcpls: { command: 'mcpls' },
      },
    });
  });

  test('result is JSON-serializable and stable', () => {
    const a = JSON.stringify(buildMcpConfig());
    const b = JSON.stringify(buildMcpConfig());
    expect(a).toBe(b);
    expect(JSON.parse(a)).toHaveProperty('mcpServers.mcpls.command', 'mcpls');
  });
});
