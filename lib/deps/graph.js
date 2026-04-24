// lib/deps/graph.js
'use strict';

function buildGraph(tasks) {
  const nodes = {};
  const adjacency = {};
  const inDegree = {};
  for (const t of tasks) {
    nodes[t.id] = t;
    adjacency[t.id] = [];
    inDegree[t.id] = 0;
  }
  for (const t of tasks) {
    const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
    for (const d of deps) {
      if (d === t.id) throw new Error(`self-dependency on task ${t.id}`);
      if (!(d in nodes)) throw new Error(`unknown dependency "${d}" on task ${t.id}`);
      adjacency[d].push(t.id);
      inDegree[t.id] += 1;
    }
  }
  return { nodes, adjacency, inDegree };
}

function detectCycle(graph) {
  // Kahn's algorithm: if we cannot drain all nodes, the remainder forms a cycle.
  const inDeg = { ...graph.inDegree };
  const queue = Object.keys(inDeg).filter(id => inDeg[id] === 0);
  let processed = 0;
  while (queue.length) {
    const n = queue.shift();
    processed += 1;
    for (const m of graph.adjacency[n]) {
      inDeg[m] -= 1;
      if (inDeg[m] === 0) queue.push(m);
    }
  }
  if (processed === Object.keys(graph.nodes).length) return null;
  return Object.keys(inDeg).filter(id => inDeg[id] > 0).sort();
}

function topologicalSort(graph, tasks) {
  const cycle = detectCycle(graph);
  if (cycle) throw new Error(`graph has a cycle: ${cycle.join(' -> ')}`);
  const inDeg = { ...graph.inDegree };
  const priorityOf = Object.fromEntries(tasks.map(t => [t.id, t.priority]));
  const byPriority = (a, b) => priorityOf[a] - priorityOf[b];
  const queue = Object.keys(inDeg).filter(id => inDeg[id] === 0).sort(byPriority);
  const order = [];
  while (queue.length) {
    const n = queue.shift();
    order.push(n);
    for (const m of graph.adjacency[n]) {
      inDeg[m] -= 1;
      if (inDeg[m] === 0) {
        queue.push(m);
        queue.sort(byPriority);
      }
    }
  }
  return order;
}

function findReady(tasks) {
  const passed = new Set(tasks.filter(t => t.passes === true).map(t => t.id));
  return tasks
    .filter(t => t.passes !== true)
    .filter(t => {
      const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
      return deps.every(d => passed.has(d));
    })
    .sort((a, b) => a.priority - b.priority)
    .map(t => t.id);
}

function findBlocked(tasks) {
  const passed = new Set(tasks.filter(t => t.passes === true).map(t => t.id));
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  const out = [];
  for (const t of tasks) {
    if (t.passes === true) continue;
    const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [];
    const unmet = deps.filter(d => !passed.has(d) && byId[d]);
    if (unmet.length > 0) out.push({ id: t.id, blockedBy: unmet });
  }
  return out;
}

function pickNextTask(tasks) {
  let graph;
  try {
    graph = buildGraph(tasks);
  } catch (err) {
    return { nextTask: null, ready: [], blocked: [], cycle: null, error: err.message };
  }
  const cycle = detectCycle(graph);
  if (cycle) return { nextTask: null, ready: [], blocked: [], cycle };
  const ready = findReady(tasks);
  const blocked = findBlocked(tasks);
  const nextTask = ready.length ? ready[0] : null;
  return { nextTask, ready, blocked, cycle: null };
}

module.exports = {
  buildGraph, topologicalSort, detectCycle, findReady, findBlocked, pickNextTask,
};
