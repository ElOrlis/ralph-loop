const { normalizeCriteria } = require('./schema');

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
