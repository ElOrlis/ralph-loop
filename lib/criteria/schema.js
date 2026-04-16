'use strict';

const VALID_TYPES = ['shell', 'http', 'file-exists', 'grep', 'manual'];

function parseCriterionString(str) {
  const hintMatch = str.match(/^(.*?)\s*`\[(\w[\w-]*):\s*(.*?)\]`\s*$/);
  if (!hintMatch) {
    return { text: str.trim(), type: 'manual', confidence: 'low' };
  }

  const text = hintMatch[1].trim();
  const type = hintMatch[2];
  const body = hintMatch[3].trim();

  switch (type) {
    case 'shell':
      return { text, type: 'shell', command: body, expectExitCode: 0 };

    case 'http': {
      const httpMatch = body.match(/^(?:(GET|POST|PUT|DELETE|PATCH)\s+)?(\S+)\s*->\s*(\d+)$/);
      if (!httpMatch) return { text, type: 'manual', confidence: 'low' };
      return {
        text,
        type: 'http',
        url: httpMatch[2],
        method: httpMatch[1] || 'GET',
        expectStatus: parseInt(httpMatch[3], 10)
      };
    }

    case 'file-exists':
      return { text, type: 'file-exists', path: body };

    case 'grep': {
      const grepMatch = body.match(/^"(.*?)"\s+in\s+(\S+)$/);
      if (!grepMatch) return { text, type: 'manual', confidence: 'low' };
      return { text, type: 'grep', pattern: grepMatch[1], path: grepMatch[2] };
    }

    default:
      return { text, type: 'manual', confidence: 'low' };
  }
}

function normalizeCriterion(criterion) {
  if (typeof criterion === 'string') {
    return parseCriterionString(criterion);
  }
  return criterion;
}

function normalizeCriteria(criteria) {
  return criteria.map(normalizeCriterion);
}

function validateCriterion(criterion) {
  if (!VALID_TYPES.includes(criterion.type)) {
    return { valid: false, error: `Invalid type "${criterion.type}". Must be one of: ${VALID_TYPES.join(', ')}` };
  }

  switch (criterion.type) {
    case 'shell':
      if (!criterion.command) return { valid: false, error: 'Shell criterion requires "command" field' };
      break;
    case 'http':
      if (!criterion.url) return { valid: false, error: 'HTTP criterion requires "url" field' };
      break;
    case 'file-exists':
      if (!criterion.path) return { valid: false, error: 'File-exists criterion requires "path" field' };
      break;
    case 'grep':
      if (!criterion.pattern) return { valid: false, error: 'Grep criterion requires "pattern" field' };
      if (!criterion.path) return { valid: false, error: 'Grep criterion requires "path" field' };
      break;
    case 'manual':
      break;
  }

  return { valid: true };
}

module.exports = { normalizeCriteria, validateCriterion, parseCriterionString, VALID_TYPES };
