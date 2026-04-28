#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { resolveRepo } = require('./repo');
const { createIssue, updateIssue, closeIssue } = require('./issues');
const {
  createProject, createStandardFields, fetchIssueNodeId,
  addProjectItem, updateItemField, fetchProjectFieldState,
  fetchItemFieldValue, RALPH_STATUS_OPTIONS,
} = require('./projects');
const { getCallCount, resetCallCount } = require('./graphql');
const { normalizeCriteria } = require('../criteria/schema');
const { ensureDraftPR, markPRReady } = require('./pullrequests');

const command = process.argv[2];

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

async function main() {
  resetCallCount();
  switch (command) {
    case 'resolve-repo': {
      const cliRepo = getArg('--repo');
      const taskFile = getArg('--task-file');
      let prdRepository = null;
      if (taskFile) {
        const prd = JSON.parse(fs.readFileSync(taskFile, 'utf-8'));
        prdRepository = prd.repository || null;
      }
      const repo = resolveRepo({ cliRepo, prdRepository });
      console.log(JSON.stringify({ repo }));
      break;
    }

    case 'create-issue': {
      const repo = getArg('--repo');
      const taskJson = getArg('--task');
      if (!repo || !taskJson) {
        console.error('Usage: node lib/github/index.js create-issue --repo owner/name --task \'<json>\'');
        process.exit(1);
      }
      const task = JSON.parse(taskJson);
      task.acceptanceCriteria = normalizeCriteria(task.acceptanceCriteria);
      const result = createIssue({ repo, task });
      console.log(JSON.stringify(result));
      break;
    }

    case 'update-issue': {
      const repo = getArg('--repo');
      const issueNumber = parseInt(getArg('--issue'), 10);
      const iteration = parseInt(getArg('--iteration'), 10);
      const maxIterations = parseInt(getArg('--max-iterations'), 10);
      const resultsJson = getArg('--results');
      const criteriaJson = getArg('--criteria');
      const mcpStatus = getArg('--mcp-status') || undefined;
      const agent = getArg('--agent') || undefined;
      if (!repo || !issueNumber || !iteration || !maxIterations || !resultsJson || !criteriaJson) {
        console.error('Usage: node lib/github/index.js update-issue --repo owner/name --issue N --iteration N --max-iterations N --results \'<json>\' --criteria \'<json>\' [--mcp-status <status>] [--agent <name>]');
        process.exit(1);
      }
      updateIssue({
        repo,
        issueNumber,
        iteration,
        maxIterations,
        results: JSON.parse(resultsJson),
        criteria: JSON.parse(criteriaJson),
        mcpStatus,
        agent,
      });
      console.log(JSON.stringify({ ok: true }));
      break;
    }

    case 'close-issue': {
      const repo = getArg('--repo');
      const issueNumber = parseInt(getArg('--issue'), 10);
      const taskTitle = getArg('--task-title');
      const iterationsUsed = parseInt(getArg('--iterations-used'), 10);
      if (!repo || !issueNumber) {
        console.error('Usage: node lib/github/index.js close-issue --repo owner/name --issue N --task-title "..." --iterations-used N');
        process.exit(1);
      }
      closeIssue({ repo, issueNumber, taskTitle: taskTitle || 'Unknown', iterationsUsed: iterationsUsed || 0 });
      console.log(JSON.stringify({ ok: true }));
      break;
    }

    case 'add-label': {
      const repo = getArg('--repo');
      const issueNumber = parseInt(getArg('--issue'), 10);
      const label = getArg('--label');
      if (!repo || !issueNumber || !label) {
        console.error('Usage: node lib/github/index.js add-label --repo owner/name --issue N --label "<label>"');
        process.exit(1);
      }
      const { addLabel } = require('./issues');
      addLabel({ repo, issueNumber, label });
      console.log(JSON.stringify({ ok: true }));
      break;
    }

    case 'remove-label': {
      const repo = getArg('--repo');
      const issueNumber = parseInt(getArg('--issue'), 10);
      const label = getArg('--label');
      if (!repo || !issueNumber || !label) {
        console.error('Usage: node lib/github/index.js remove-label --repo owner/name --issue N --label "<label>"');
        process.exit(1);
      }
      const { removeLabel } = require('./issues');
      removeLabel({ repo, issueNumber, label });
      console.log(JSON.stringify({ ok: true }));
      break;
    }

    case 'create-project': {
      const repo = getArg('--repo');
      const title = getArg('--title');
      const categoriesCsv = getArg('--categories') || '';
      if (!repo || !title) {
        console.error('Usage: node lib/github/index.js create-project --repo owner/name --title "..." [--categories a,b,c]');
        process.exit(1);
      }
      const owner = repo.split('/')[0];
      const categories = categoriesCsv.split(',').map(s => s.trim()).filter(Boolean);
      const project = createProject({ owner, title });
      const fieldIds = createStandardFields({ projectId: project.id, categories });
      const githubProject = { ...project, fieldIds };
      console.log(JSON.stringify({ githubProject, apiCalls: getCallCount() }));
      break;
    }

    case 'ensure-project-item': {
      const repo = getArg('--repo');
      const projectId = getArg('--project-id');
      const issueNumber = parseInt(getArg('--issue'), 10);
      if (!repo || !projectId || !issueNumber) {
        console.error('Usage: node lib/github/index.js ensure-project-item --repo owner/name --project-id <id> --issue N');
        process.exit(1);
      }
      const contentId = fetchIssueNodeId({ repo, issueNumber });
      const projectItemId = addProjectItem({ projectId, contentId });
      console.log(JSON.stringify({ projectItemId, apiCalls: getCallCount() }));
      break;
    }

    case 'sync-project-item': {
      const projectJson = getArg('--project');
      const taskJson = getArg('--task');
      const resultsJson = getArg('--results');
      const iteration = parseInt(getArg('--iteration'), 10);
      const detectConflicts = process.argv.includes('--detect-conflicts');
      if (!projectJson || !taskJson || !resultsJson || !iteration) {
        console.error('Usage: node lib/github/index.js sync-project-item --project \'<json>\' --task \'<json>\' --results \'<json>\' --iteration N [--detect-conflicts]');
        process.exit(1);
      }
      const project = JSON.parse(projectJson);
      const task = JSON.parse(taskJson);
      const results = JSON.parse(resultsJson);
      if (!task.projectItemId) {
        console.error(`Task ${task.id} has no projectItemId; run ensure-project-item first.`);
        process.exit(1);
      }
      const results_ = Array.isArray(results.results) ? results.results : results;
      const total = results_.length || 1;
      const passed = results_.filter(r => r.passed === true).length;
      const passRate = Math.round((passed / total) * 100) / 100;
      let ralphStatus;
      if (task.passes === true) ralphStatus = 'Passed';
      else if (task.status === 'blocked') ralphStatus = 'Blocked';
      else if (task.stalled === true) ralphStatus = 'Stalled';
      else if (iteration === 1) ralphStatus = 'In Progress';
      else if (passed === 0) ralphStatus = 'Failed';
      else ralphStatus = 'In Progress';

      const updates = [
        { field: project.fieldIds.priority,        value: task.priority },
        { field: project.fieldIds.category,        value: task.category },
        { field: project.fieldIds.iterationCount,  value: task.attempts || iteration },
        { field: project.fieldIds.criteriaPassRate, value: passRate },
        { field: project.fieldIds.ralphStatus,     value: ralphStatus },
      ];

      const conflicts = [];
      if (detectConflicts) {
        for (const u of updates) {
          const current = fetchItemFieldValue({ itemId: task.projectItemId, fieldId: u.field.id });
          if (current !== null && current !== undefined && current !== u.value && String(current) !== String(u.value)) {
            conflicts.push({ fieldId: u.field.id, before: current, after: u.value });
          }
        }
      }

      for (const u of updates) {
        updateItemField({ projectId: project.id, itemId: task.projectItemId, field: u.field, value: u.value });
      }

      console.log(JSON.stringify({
        ok: true,
        ralphStatus,
        criteriaPassRate: passRate,
        iterationCount: task.attempts || iteration,
        conflicts,
        apiCalls: getCallCount(),
      }));
      break;
    }

    case 'validate-project': {
      const projectJson = getArg('--project');
      if (!projectJson) {
        console.error('Usage: node lib/github/index.js validate-project --project \'<json>\'');
        process.exit(1);
      }
      const project = JSON.parse(projectJson);
      const actual = fetchProjectFieldState({ projectId: project.id });

      const expectedNames = {
        priority: 'Priority',
        category: 'Category',
        iterationCount: 'Iteration Count',
        criteriaPassRate: 'Criteria Pass Rate',
        ralphStatus: 'Ralph Status',
      };

      const missing = [];
      const updatedFieldIds = { ...project.fieldIds };
      for (const [key, name] of Object.entries(expectedNames)) {
        if (!actual[name]) {
          missing.push(key);
          continue;
        }
        if (!project.fieldIds[key] || project.fieldIds[key].id !== actual[name].id) {
          updatedFieldIds[key] = actual[name];
        } else if (actual[name].options) {
          // Merge option IDs in case new options were created.
          updatedFieldIds[key] = { ...project.fieldIds[key], options: actual[name].options };
        }
      }

      console.log(JSON.stringify({
        ok: missing.length === 0,
        missing,
        updatedFieldIds,
        apiCalls: getCallCount(),
      }));
      break;
    }

    case 'repair-project-fields': {
      const projectJson = getArg('--project');
      const missingCsv = getArg('--missing');
      const categoriesCsv = getArg('--categories') || '';
      if (!projectJson || !missingCsv) {
        console.error('Usage: node lib/github/index.js repair-project-fields --project \'<json>\' --missing a,b,c [--categories x,y]');
        process.exit(1);
      }
      const project = JSON.parse(projectJson);
      const missing = missingCsv.split(',').map(s => s.trim()).filter(Boolean);
      const categories = categoriesCsv.split(',').map(s => s.trim()).filter(Boolean);
      // Recreate only missing fields by calling createStandardFields selectively.
      // Simplest correct approach: re-create all 5, overwriting fieldIds with fresh IDs
      // for the missing subset only.
      const fresh = createStandardFields({ projectId: project.id, categories });
      const repaired = { ...project.fieldIds };
      for (const key of missing) {
        if (fresh[key]) repaired[key] = fresh[key];
      }
      console.log(JSON.stringify({ ok: true, fieldIds: repaired, apiCalls: getCallCount() }));
      break;
    }

    case 'ensure-pr': {
      const repo = getArg('--repo');
      const branchName = getArg('--branch');
      const baseBranch = getArg('--base');
      const taskId = getArg('--task-id');
      const taskTitle = getArg('--task-title') || taskId;
      const issueRaw = getArg('--issue');
      const issueNumber = issueRaw ? parseInt(issueRaw, 10) : null;
      if (!repo || !branchName || !baseBranch || !taskId) {
        console.error('Usage: node lib/github/index.js ensure-pr --repo owner/name --branch <b> --base <b> --task-id <id> [--task-title "..."] [--issue N]');
        process.exit(1);
      }
      const result = ensureDraftPR({ repo, branchName, baseBranch, taskId, taskTitle, issueNumber });
      console.log(JSON.stringify(result));
      break;
    }

    case 'mark-pr-ready': {
      const repo = getArg('--repo');
      const prNumber = parseInt(getArg('--pr'), 10);
      if (!repo || !prNumber) {
        console.error('Usage: node lib/github/index.js mark-pr-ready --repo owner/name --pr N');
        process.exit(1);
      }
      markPRReady({ repo, prNumber });
      console.log(JSON.stringify({ ok: true }));
      break;
    }

    case 'post-reviewer-comment': {
      const repo = getArg('--repo');
      const issueNumber = parseInt(getArg('--issue-number'), 10);
      const agent = getArg('--agent');
      const bodyFile = getArg('--body-file');
      if (!repo || !issueNumber || !agent || !bodyFile) {
        console.error('Usage: post-reviewer-comment --repo <r> --issue-number <n> --agent <claude|copilot> --body-file <path>');
        process.exit(1);
      }
      const body = require('fs').readFileSync(bodyFile, 'utf-8');
      require('./issues').postReviewerComment({ repo, issueNumber, agent, body });
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Commands: resolve-repo, create-issue, update-issue, close-issue, add-label, remove-label, create-project, ensure-project-item, sync-project-item, validate-project, repair-project-fields, ensure-pr, mark-pr-ready, post-reviewer-comment');
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
