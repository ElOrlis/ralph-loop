'use strict';

const VALID_TYPES = ['shell', 'http', 'file-exists', 'grep', 'manual'];

function normalizeCriterion(criterion) {
  if (typeof criterion === 'string') {
    return { text: criterion, type: 'manual', confidence: 'low' };
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

module.exports = { normalizeCriteria, validateCriterion, VALID_TYPES };
