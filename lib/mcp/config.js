// lib/mcp/config.js
'use strict';

const SUPPORTED = new Set(['claude', 'copilot']);

function buildMcpConfig(opts) {
  const agent = (opts && opts.agent) || 'claude';
  if (!SUPPORTED.has(agent)) {
    throw new Error(`Unknown agent: ${agent}`);
  }
  // Both Claude and Copilot CLIs accept the same `mcpServers` schema
  // for our single mcpls server today. Per-agent fields go here when
  // schemas diverge.
  return {
    mcpServers: {
      mcpls: { command: 'mcpls' },
    },
  };
}

module.exports = { buildMcpConfig };
