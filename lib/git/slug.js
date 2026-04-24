'use strict';

function slugify(input, maxLength = 40) {
  if (typeof input !== 'string' || !input) return '';

  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (cleaned.length <= maxLength) return cleaned;

  const windowed = cleaned.slice(0, maxLength);
  const lastDash = windowed.lastIndexOf('-');
  if (lastDash > 0) return windowed.slice(0, lastDash);
  return windowed;
}

module.exports = { slugify };
