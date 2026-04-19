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

function fetchIssueNodeId({ repo, issueNumber }) {
  const [owner, name] = repo.split('/');
  const query = `
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        issue(number: $number) { id }
      }
    }
  `;
  const data = ghGraphql(query, { owner, name, number: issueNumber });
  if (!data.repository || !data.repository.issue) {
    throw new Error(`Could not resolve issue ${repo}#${issueNumber}`);
  }
  return data.repository.issue.id;
}

function addProjectItem({ projectId, contentId }) {
  const query = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }
  `;
  const data = ghGraphql(query, { projectId, contentId });
  return data.addProjectV2ItemById.item.id;
}

function updateItemField({ projectId, itemId, field, value }) {
  if (field.dataType === 'NUMBER') {
    const query = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: Float!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
          value: { number: $value }
        }) { projectV2Item { id } }
      }
    `;
    ghGraphql(query, { projectId, itemId, fieldId: field.id, value: Number(value) });
    return;
  }
  if (field.dataType === 'SINGLE_SELECT') {
    const optionId = field.options && field.options[value];
    if (!optionId) {
      throw new Error(`Unknown single-select option "${value}" on field ${field.id}. Known: ${Object.keys(field.options || {}).join(', ')}`);
    }
    const query = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
          value: { singleSelectOptionId: $optionId }
        }) { projectV2Item { id } }
      }
    `;
    ghGraphql(query, { projectId, itemId, fieldId: field.id, optionId });
    return;
  }
  throw new Error(`Unsupported field dataType: ${field.dataType}`);
}

function fetchProjectFieldState({ projectId }) {
  const query = `
    query($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          fields(first: 50) {
            nodes {
              ... on ProjectV2Field { id name dataType }
              ... on ProjectV2SingleSelectField { id name dataType options { id name } }
            }
          }
        }
      }
    }
  `;
  const data = ghGraphql(query, { projectId });
  const state = {};
  for (const f of data.node.fields.nodes) {
    if (!f || !f.name) continue;
    const entry = { id: f.id, dataType: f.dataType };
    if (f.dataType === 'SINGLE_SELECT' && Array.isArray(f.options)) {
      entry.options = buildOptionsMap(f.options);
    }
    state[f.name] = entry;
  }
  return state;
}

function fetchItemFieldValue({ itemId, fieldId }) {
  const query = `
    query($itemId: ID!) {
      node(id: $itemId) {
        ... on ProjectV2Item {
          fieldValues(first: 50) {
            nodes {
              ... on ProjectV2ItemFieldNumberValue { field { ... on ProjectV2FieldCommon { id } } number }
              ... on ProjectV2ItemFieldSingleSelectValue { field { ... on ProjectV2FieldCommon { id } } name }
            }
          }
        }
      }
    }
  `;
  const data = ghGraphql(query, { itemId });
  if (!data.node || !data.node.fieldValues) return null;
  for (const v of data.node.fieldValues.nodes) {
    if (!v || !v.field || v.field.id !== fieldId) continue;
    if ('number' in v) return v.number;
    if ('name' in v) return v.name;
  }
  return null;
}

module.exports = {
  createProject,
  createStandardFields,
  fetchIssueNodeId,
  addProjectItem,
  updateItemField,
  fetchProjectFieldState,
  fetchItemFieldValue,
  RALPH_STATUS_OPTIONS,
};
