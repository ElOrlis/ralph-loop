const { runCriterion } = require('./runner');
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
