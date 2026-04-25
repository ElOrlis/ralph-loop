// lib/mcp/config.js
'use strict';

function buildMcpConfig() {
  return {
    mcpServers: {
      mcpls: { command: 'mcpls' },
    },
  };
}

module.exports = { buildMcpConfig };
