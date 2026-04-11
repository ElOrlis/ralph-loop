const { normalizeCriteria, validateCriterion } = require('./schema');

describe('normalizeCriteria', () => {
  test('converts plain string to manual criterion', () => {
    const result = normalizeCriteria(['Users can log in']);
    expect(result).toEqual([
      { text: 'Users can log in', type: 'manual', confidence: 'low' }
    ]);
  });

  test('passes through typed object unchanged', () => {
    const input = [{ text: 'Tests pass', type: 'shell', command: 'npm test', expectExitCode: 0 }];
    const result = normalizeCriteria(input);
    expect(result).toEqual(input);
  });

  test('handles mixed array of strings and objects', () => {
    const input = [
      'Users report UI feels responsive',
      { text: 'Tests pass', type: 'shell', command: 'npm test', expectExitCode: 0 }
    ];
    const result = normalizeCriteria(input);
    expect(result).toEqual([
      { text: 'Users report UI feels responsive', type: 'manual', confidence: 'low' },
      { text: 'Tests pass', type: 'shell', command: 'npm test', expectExitCode: 0 }
    ]);
  });

  test('returns empty array for empty input', () => {
    expect(normalizeCriteria([])).toEqual([]);
  });
});

describe('validateCriterion', () => {
  test('valid shell criterion passes', () => {
    const c = { text: 'Tests pass', type: 'shell', command: 'npm test', expectExitCode: 0 };
    expect(validateCriterion(c)).toEqual({ valid: true });
  });

  test('shell criterion without command fails', () => {
    const c = { text: 'Tests pass', type: 'shell', expectExitCode: 0 };
    const result = validateCriterion(c);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/command/i);
  });

  test('valid http criterion passes', () => {
    const c = { text: 'Returns 200', type: 'http', url: 'http://localhost:3000', expectStatus: 200 };
    expect(validateCriterion(c)).toEqual({ valid: true });
  });

  test('http criterion without url fails', () => {
    const c = { text: 'Returns 200', type: 'http', expectStatus: 200 };
    const result = validateCriterion(c);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/url/i);
  });

  test('valid file-exists criterion passes', () => {
    const c = { text: 'Config exists', type: 'file-exists', path: './config.json' };
    expect(validateCriterion(c)).toEqual({ valid: true });
  });

  test('file-exists without path fails', () => {
    const c = { text: 'Config exists', type: 'file-exists' };
    const result = validateCriterion(c);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/path/i);
  });

  test('valid grep criterion passes', () => {
    const c = { text: 'Route registered', type: 'grep', pattern: 'app\\.use', path: './src/index.js' };
    expect(validateCriterion(c)).toEqual({ valid: true });
  });

  test('grep without pattern fails', () => {
    const c = { text: 'Route registered', type: 'grep', path: './src/index.js' };
    const result = validateCriterion(c);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/pattern/i);
  });

  test('grep without path fails', () => {
    const c = { text: 'Route registered', type: 'grep', pattern: 'app\\.use' };
    const result = validateCriterion(c);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/path/i);
  });

  test('manual criterion always passes', () => {
    const c = { text: 'Looks good', type: 'manual', confidence: 'low' };
    expect(validateCriterion(c)).toEqual({ valid: true });
  });

  test('unknown type fails', () => {
    const c = { text: 'Something', type: 'unknown' };
    const result = validateCriterion(c);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/type/i);
  });
});
