// lib/criteria/suggestions.test.js
'use strict';

const { suggestForCriterion } = require('./suggestions');

describe('suggestForCriterion', () => {
  test('Test: Run `cmd` → shell suggestion', () => {
    const out = suggestForCriterion('Test: Run `npm test -- email.test.js` and verify all pass');
    expect(out).toEqual([
      expect.objectContaining({ type: 'shell', value: 'npm test -- email.test.js' }),
    ]);
  });

  test('Run `cmd` and verify → shell suggestion', () => {
    const out = suggestForCriterion('Run `curl -f http://localhost/health` and verify 200');
    expect(out[0]).toMatchObject({ type: 'shell', value: 'curl -f http://localhost/health' });
  });

  test('POST <url> returns <NNN> → http suggestion', () => {
    const out = suggestForCriterion('POST http://localhost/api/login returns 200');
    expect(out[0]).toMatchObject({ type: 'http', value: 'POST http://localhost/api/login -> 200' });
  });

  test('GET <url> returns <NNN> → http suggestion', () => {
    const out = suggestForCriterion('GET /healthz returns 204');
    expect(out[0]).toMatchObject({ type: 'http', value: 'GET /healthz -> 204' });
  });

  test('file `path` exists → file-exists suggestion', () => {
    const out = suggestForCriterion('Config file `./config/auth.json` exists after install');
    expect(out[0]).toMatchObject({ type: 'file-exists', value: './config/auth.json' });
  });

  test('Created `<path>` → file-exists suggestion', () => {
    const out = suggestForCriterion('Created `src/lib/auth.ts` with the new helper');
    expect(out[0]).toMatchObject({ type: 'file-exists', value: 'src/lib/auth.ts' });
  });

  test('grep `<pattern>` in `<file>` → grep suggestion', () => {
    const out = suggestForCriterion('grep `app\\.use.*auth` in `src/routes/index.js` returns a match');
    expect(out[0]).toMatchObject({
      type: 'grep',
      value: 'app\\.use.*auth in src/routes/index.js',
    });
  });

  test('vague text → no suggestion', () => {
    expect(suggestForCriterion('Validation rejects empty strings')).toEqual([]);
    expect(suggestForCriterion('Add documentation for the feature')).toEqual([]);
  });

  test('already-typed criterion → no suggestion', () => {
    expect(suggestForCriterion('Tests pass `[shell: npm test]`')).toEqual([]);
  });

  test('returns at most one suggestion per criterion', () => {
    const out = suggestForCriterion('Test: Run `npm test` and POST /api returns 200');
    expect(out.length).toBeLessThanOrEqual(1);
  });
});
