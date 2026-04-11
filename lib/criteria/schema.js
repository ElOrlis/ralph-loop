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

module.exports = { normalizeCriteria, VALID_TYPES };
