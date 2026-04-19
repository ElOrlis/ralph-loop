'use strict';

const { slugify } = require('./slug');

describe('slugify', () => {
  test('lowercases and replaces spaces', () => {
    expect(slugify('Add JWT Validation')).toBe('add-jwt-validation');
  });

  test('collapses non-alphanumeric runs to single dash', () => {
    expect(slugify('Fix!!!  the:::bug')).toBe('fix-the-bug');
  });

  test('trims leading and trailing dashes', () => {
    expect(slugify('---hi---')).toBe('hi');
  });

  test('returns empty string for empty or non-string input', () => {
    expect(slugify('')).toBe('');
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
    expect(slugify(42)).toBe('');
  });

  test('strips unicode and symbols', () => {
    expect(slugify('Café ☕ — tea')).toBe('caf-tea');
  });

  test('truncates to 40 chars by default, breaking at last dash', () => {
    const input = 'one two three four five six seven eight nine';
    const out = slugify(input);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('-')).toBe(false);
    // Should break at a word boundary — last dash within 40 chars
    expect(input.toLowerCase()).toContain(out.replace(/-/g, ' ').slice(0, 20));
  });

  test('truncates mid-token with hard cut when no dash exists in range', () => {
    const longWord = 'a'.repeat(80);
    const out = slugify(longWord);
    expect(out.length).toBe(40);
    expect(out).toBe('a'.repeat(40));
  });

  test('accepts a custom maxLength', () => {
    expect(slugify('hello world one two three', 10)).toBe('hello');
  });
});
