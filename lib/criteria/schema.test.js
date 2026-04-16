const { normalizeCriteria, validateCriterion, parseCriterionString } = require('./schema');

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

  test('normalizes string with inline hint to typed object', () => {
    const result = normalizeCriteria(['Tests pass `[shell: npm test]`']);
    expect(result).toEqual([
      { text: 'Tests pass', type: 'shell', command: 'npm test', expectExitCode: 0 }
    ]);
  });
});

describe('parseCriterionString', () => {
  test('parses shell hint', () => {
    const result = parseCriterionString('Unit tests pass `[shell: npm test -- auth.test.js]`');
    expect(result).toEqual({
      text: 'Unit tests pass',
      type: 'shell',
      command: 'npm test -- auth.test.js',
      expectExitCode: 0
    });
  });

  test('parses http hint with method and status', () => {
    const result = parseCriterionString('Login returns 200 `[http: POST http://localhost:3000/auth/login -> 200]`');
    expect(result).toEqual({
      text: 'Login returns 200',
      type: 'http',
      url: 'http://localhost:3000/auth/login',
      method: 'POST',
      expectStatus: 200
    });
  });

  test('parses http hint with GET (default)', () => {
    const result = parseCriterionString('Health check `[http: http://localhost:3000/health -> 200]`');
    expect(result).toEqual({
      text: 'Health check',
      type: 'http',
      url: 'http://localhost:3000/health',
      method: 'GET',
      expectStatus: 200
    });
  });

  test('parses file-exists hint', () => {
    const result = parseCriterionString('Config file exists `[file-exists: ./config/auth.json]`');
    expect(result).toEqual({
      text: 'Config file exists',
      type: 'file-exists',
      path: './config/auth.json'
    });
  });

  test('parses grep hint', () => {
    const result = parseCriterionString('Route is registered `[grep: "app\\.use.*auth" in ./src/routes/index.js]`');
    expect(result).toEqual({
      text: 'Route is registered',
      type: 'grep',
      pattern: 'app\\.use.*auth',
      path: './src/routes/index.js'
    });
  });

  test('string without hint becomes manual', () => {
    const result = parseCriterionString('Users report the UI feels responsive');
    expect(result).toEqual({
      text: 'Users report the UI feels responsive',
      type: 'manual',
      confidence: 'low'
    });
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
