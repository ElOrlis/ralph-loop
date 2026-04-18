'use strict';

const { ghGraphql, resolveOwnerId } = require('./graphql');

function createProject({ owner, title }) {
  const { id: ownerId, type: ownerType } = resolveOwnerId(owner);
  const mutation = `
    mutation($ownerId: ID!, $title: String!) {
      createProjectV2(input: { ownerId: $ownerId, title: $title }) {
        projectV2 { id number url }
      }
    }
  `;
  const data = ghGraphql(mutation, { ownerId, title });
  const p = data.createProjectV2.projectV2;
  return { number: p.number, id: p.id, owner, ownerType, url: p.url };
}

const RALPH_STATUS_OPTIONS = ['Pending', 'In Progress', 'Passed', 'Failed', 'Stalled'];

function createField({ projectId, name, dataType, singleSelectOptions }) {
  const query = `
    mutation($projectId: ID!, $name: String!, $dataType: ProjectV2CustomFieldType!, $options: [ProjectV2SingleSelectFieldOptionInput!]) {
      createProjectV2Field(input: { projectId: $projectId, name: $name, dataType: $dataType, singleSelectOptions: $options }) {
        projectV2Field {
          ... on ProjectV2Field { id }
          ... on ProjectV2SingleSelectField { id options { id name } }
        }
      }
    }
  `;
  const vars = { projectId, name, dataType };
  if (singleSelectOptions) {
    vars.options = JSON.stringify(singleSelectOptions.map(n => ({ name: n, color: 'GRAY', description: '' })));
  }
  return ghGraphql(query, vars).createProjectV2Field.projectV2Field;
}

function buildOptionsMap(options) {
  const map = {};
  for (const opt of options) map[opt.name] = opt.id;
  return map;
}

function createStandardFields({ projectId, categories }) {
  const uniqueCategories = Array.from(new Set(categories)).sort();

  const priority = createField({ projectId, name: 'Priority', dataType: 'NUMBER' });
  const category = createField({
    projectId,
    name: 'Category',
    dataType: 'SINGLE_SELECT',
    singleSelectOptions: uniqueCategories,
  });
  const iterationCount = createField({ projectId, name: 'Iteration Count', dataType: 'NUMBER' });
  const criteriaPassRate = createField({ projectId, name: 'Criteria Pass Rate', dataType: 'NUMBER' });
  const ralphStatus = createField({
    projectId,
    name: 'Ralph Status',
    dataType: 'SINGLE_SELECT',
    singleSelectOptions: RALPH_STATUS_OPTIONS,
  });

  return {
    priority: { id: priority.id, dataType: 'NUMBER' },
    category: { id: category.id, dataType: 'SINGLE_SELECT', options: buildOptionsMap(category.options || []) },
    iterationCount: { id: iterationCount.id, dataType: 'NUMBER' },
    criteriaPassRate: { id: criteriaPassRate.id, dataType: 'NUMBER' },
    ralphStatus: { id: ralphStatus.id, dataType: 'SINGLE_SELECT', options: buildOptionsMap(ralphStatus.options || []) },
  };
}

module.exports = { createProject, createStandardFields, RALPH_STATUS_OPTIONS };
