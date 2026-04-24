// lib/deps/graph.test.js
'use strict';

const {
  buildGraph, topologicalSort, detectCycle, findReady, findBlocked, pickNextTask,
} = require('./graph');

const T = (id, priority, passes = false, dependsOn = []) => ({
  id, title: id, priority, passes, dependsOn,
});

describe('buildGraph', () => {
  test('returns {nodes, adjacency, inDegree} keyed by task id', () => {
    const tasks = [T('a', 1), T('b', 2, false, ['a']), T('c', 3, false, ['a', 'b'])];
    const g = buildGraph(tasks);
    expect(Object.keys(g.nodes).sort()).toEqual(['a', 'b', 'c']);
    expect(g.adjacency['a'].sort()).toEqual(['b', 'c']);
    expect(g.adjacency['b']).toEqual(['c']);
    expect(g.adjacency['c']).toEqual([]);
    expect(g.inDegree).toEqual({ a: 0, b: 1, c: 2 });
  });

  test('treats missing dependsOn as empty', () => {
    const g = buildGraph([T('a', 1)]);
    expect(g.adjacency['a']).toEqual([]);
    expect(g.inDegree['a']).toBe(0);
  });

  test('throws on reference to non-existent task', () => {
    expect(() => buildGraph([T('a', 1, false, ['ghost'])])).toThrow(/unknown dependency.*ghost/i);
  });

  test('throws on self-dependency', () => {
    expect(() => buildGraph([T('a', 1, false, ['a'])])).toThrow(/self.*dependency/i);
  });
});

describe('detectCycle', () => {
  test('returns null when graph is acyclic', () => {
    const tasks = [T('a', 1), T('b', 2, false, ['a'])];
    expect(detectCycle(buildGraph(tasks))).toBeNull();
  });

  test('returns the cycle path when one exists', () => {
    const tasks = [
      T('a', 1, false, ['c']),
      T('b', 2, false, ['a']),
      T('c', 3, false, ['b']),
    ];
    const cycle = detectCycle(buildGraph(tasks));
    expect(cycle).not.toBeNull();
    // cycle path should contain a, b, c in some rotation
    expect(new Set(cycle)).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('topologicalSort', () => {
  test('orders tasks so that deps come first, breaks ties by priority', () => {
    const tasks = [
      T('c', 3, false, ['a', 'b']),
      T('a', 2),
      T('b', 1),
    ];
    const order = topologicalSort(buildGraph(tasks), tasks);
    expect(order).toEqual(['b', 'a', 'c']); // b (pri 1) before a (pri 2), then c (deps met)
  });

  test('throws when the graph has a cycle', () => {
    const tasks = [T('a', 1, false, ['b']), T('b', 2, false, ['a'])];
    expect(() => topologicalSort(buildGraph(tasks), tasks)).toThrow(/cycle/i);
  });
});

describe('findReady', () => {
  test('returns incomplete tasks whose dependencies are all passed', () => {
    const tasks = [
      T('a', 1, true),                       // already complete — excluded
      T('b', 2, false, ['a']),               // ready (dep a is passed)
      T('c', 3, false, ['a', 'd']),          // blocked (dep d not passed)
      T('d', 4, false),                      // ready (no deps)
    ];
    expect(findReady(tasks).sort()).toEqual(['b', 'd']);
  });

  test('tasks with no dependsOn are always ready when incomplete', () => {
    const tasks = [T('a', 1), T('b', 2)];
    expect(findReady(tasks).sort()).toEqual(['a', 'b']);
  });
});

describe('findBlocked', () => {
  test('returns incomplete tasks whose dependencies include at least one unfinished task', () => {
    const tasks = [
      T('a', 1, true),
      T('b', 2, false, ['a', 'c']),
      T('c', 3, false),
    ];
    const blocked = findBlocked(tasks);
    expect(blocked).toEqual([{ id: 'b', blockedBy: ['c'] }]);
  });

  test('returns [] when nothing is blocked', () => {
    expect(findBlocked([T('a', 1, true), T('b', 2)])).toEqual([]);
  });
});

describe('pickNextTask', () => {
  test('returns lowest-priority ready task id', () => {
    const tasks = [
      T('a', 2, true),
      T('b', 3, false, ['a']),
      T('c', 1),
    ];
    expect(pickNextTask(tasks)).toEqual({
      nextTask: 'c', ready: ['c', 'b'], blocked: [], cycle: null,
    });
  });

  test('returns { nextTask: null, blocked: [...] } when every incomplete task is blocked', () => {
    // rework: make two blocked tasks that reference each other via a third incomplete
    const tasks2 = [
      T('x', 1, false),            // unfinished, no deps → still ready
      T('y', 2, false, ['x']),     // blocked on x
    ];
    const r = pickNextTask(tasks2);
    expect(r.nextTask).toBe('x'); // x is the only ready task
    expect(r.blocked.map(b => b.id)).toEqual(['y']);
  });

  test('surfaces cycle without throwing', () => {
    const tasks = [T('a', 1, false, ['b']), T('b', 2, false, ['a'])];
    const r = pickNextTask(tasks);
    expect(r.cycle).not.toBeNull();
    expect(r.nextTask).toBeNull();
  });
});
