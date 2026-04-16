const { buildPrompt } = require('./builder');

describe('buildPrompt', () => {
  const baseTask = {
    id: 'task-3',
    title: 'Add JWT validation',
    description: 'Add JWT validation middleware to the auth route.',
    priority: 3,
    acceptanceCriteria: [
      { text: 'Unit tests pass', type: 'shell', command: 'npm test -- auth.test.js', expectExitCode: 0 },
      { text: 'Login returns 200', type: 'http', url: 'http://localhost:3000/auth/login', method: 'POST', expectStatus: 200 },
      { text: 'Config exists', type: 'file-exists', path: './config/auth.json' }
    ]
  };

  test('includes task title and id', () => {
    const prompt = buildPrompt(baseTask, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('Add JWT validation');
    expect(prompt).toContain('task-3');
  });

  test('includes description', () => {
    const prompt = buildPrompt(baseTask, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('Add JWT validation middleware to the auth route.');
  });

  test('lists verification commands for shell criteria', () => {
    const prompt = buildPrompt(baseTask, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('npm test -- auth.test.js');
    expect(prompt).toMatch(/exit code 0/i);
  });

  test('lists verification for http criteria', () => {
    const prompt = buildPrompt(baseTask, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('http://localhost:3000/auth/login');
    expect(prompt).toContain('200');
  });

  test('lists verification for file-exists criteria', () => {
    const prompt = buildPrompt(baseTask, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('./config/auth.json');
  });

  test('tells Claude not to modify PRD or progress files', () => {
    const prompt = buildPrompt(baseTask, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('auth.json');
    expect(prompt).toMatch(/do not modify/i);
  });

  test('includes DONE signal', () => {
    const prompt = buildPrompt(baseTask, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('DONE');
  });

  test('handles manual criteria gracefully', () => {
    const task = {
      ...baseTask,
      acceptanceCriteria: [
        { text: 'Looks good', type: 'manual', confidence: 'low' }
      ]
    };
    const prompt = buildPrompt(task, { jsonFile: 'auth.json', progressFile: 'progress.txt' });
    expect(prompt).toContain('Looks good');
    expect(prompt).toMatch(/manual|not automatically verified/i);
  });
});
