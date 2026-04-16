const { runCriterion, verifyCriteria } = require('./runner');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('runCriterion', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('shell type', () => {
    test('passes when command exits 0', async () => {
      const result = await runCriterion({ type: 'shell', command: 'true', expectExitCode: 0 });
      expect(result.passed).toBe(true);
    });

    test('fails when command exits non-zero', async () => {
      const result = await runCriterion({ type: 'shell', command: 'false', expectExitCode: 0 });
      expect(result.passed).toBe(false);
      expect(result.error).toMatch(/exit code/i);
    });

    test('passes when exit code matches non-zero expectation', async () => {
      const result = await runCriterion({ type: 'shell', command: 'false', expectExitCode: 1 });
      expect(result.passed).toBe(true);
    });
  });

  describe('file-exists type', () => {
    test('passes when file exists', async () => {
      const filePath = path.join(tmpDir, 'exists.txt');
      fs.writeFileSync(filePath, 'hello');
      const result = await runCriterion({ type: 'file-exists', path: filePath });
      expect(result.passed).toBe(true);
    });

    test('fails when file does not exist', async () => {
      const result = await runCriterion({ type: 'file-exists', path: path.join(tmpDir, 'nope.txt') });
      expect(result.passed).toBe(false);
      expect(result.error).toMatch(/not found|does not exist/i);
    });
  });

  describe('manual type', () => {
    test('returns skipped', async () => {
      const result = await runCriterion({ type: 'manual', text: 'Looks good' });
      expect(result.passed).toBe(null);
      expect(result.skipped).toBe(true);
    });
  });

  describe('grep type', () => {
    test('passes when pattern matches file content', async () => {
      const filePath = path.join(tmpDir, 'routes.js');
      fs.writeFileSync(filePath, 'app.use("/auth", authRouter);\n');
      const result = await runCriterion({ type: 'grep', pattern: 'app\\.use.*auth', path: filePath });
      expect(result.passed).toBe(true);
    });

    test('fails when pattern does not match', async () => {
      const filePath = path.join(tmpDir, 'routes.js');
      fs.writeFileSync(filePath, 'app.get("/home", homeHandler);\n');
      const result = await runCriterion({ type: 'grep', pattern: 'app\\.use.*auth', path: filePath });
      expect(result.passed).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    test('fails when file does not exist', async () => {
      const result = await runCriterion({ type: 'grep', pattern: 'anything', path: path.join(tmpDir, 'missing.js') });
      expect(result.passed).toBe(false);
      expect(result.error).toMatch(/failed/i);
    });
  });
});

describe('verifyCriteria', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('all criteria pass -> passed true', async () => {
    const filePath = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(filePath, 'hello');
    const criteria = [
      { type: 'shell', command: 'true', expectExitCode: 0 },
      { type: 'file-exists', path: filePath }
    ];
    const result = await verifyCriteria(criteria);
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({ criterion: 0, passed: true });
    expect(result.results[1]).toEqual({ criterion: 1, passed: true });
  });

  test('one criterion fails -> passed false', async () => {
    const criteria = [
      { type: 'shell', command: 'true', expectExitCode: 0 },
      { type: 'shell', command: 'false', expectExitCode: 0 }
    ];
    const result = await verifyCriteria(criteria);
    expect(result.passed).toBe(false);
    expect(result.results[0].passed).toBe(true);
    expect(result.results[1].passed).toBe(false);
    expect(result.results[1].error).toBeDefined();
  });

  test('manual criteria are skipped and do not block pass', async () => {
    const criteria = [
      { type: 'shell', command: 'true', expectExitCode: 0 },
      { type: 'manual', text: 'Looks good' }
    ];
    const result = await verifyCriteria(criteria);
    expect(result.passed).toBe(true);
    expect(result.results[1]).toEqual({ criterion: 1, passed: null, skipped: true });
  });

  test('empty criteria -> passed true', async () => {
    const result = await verifyCriteria([]);
    expect(result.passed).toBe(true);
    expect(result.results).toEqual([]);
  });
});
