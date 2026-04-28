'use strict';

const { buildMcpConfig } = require('./config');

describe('buildMcpConfig', () => {
  test('claude variant returns mcpServers with mcpls command', () => {
    expect(buildMcpConfig({ agent: 'claude' })).toEqual({
      mcpServers: { mcpls: { command: 'mcpls' } },
    });
  });

  test('copilot variant returns mcpServers with mcpls command', () => {
    expect(buildMcpConfig({ agent: 'copilot' })).toEqual({
      mcpServers: { mcpls: { command: 'mcpls' } },
    });
  });

  test('defaults to claude when no agent given', () => {
    expect(buildMcpConfig()).toEqual(buildMcpConfig({ agent: 'claude' }));
  });

  test('throws on unknown agent', () => {
    expect(() => buildMcpConfig({ agent: 'gemini' })).toThrow(/unknown agent/i);
  });

  test('result is JSON-serializable and stable', () => {
    const a = JSON.stringify(buildMcpConfig({ agent: 'claude' }));
    const b = JSON.stringify(buildMcpConfig({ agent: 'claude' }));
    expect(a).toBe(b);
  });
});
