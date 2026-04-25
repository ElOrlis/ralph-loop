'use strict';

jest.mock('./graphql');
const { ghGraphql, resolveOwnerId } = require('./graphql');
const { createProject, createStandardFields } = require('./projects');
const { addProjectItem, updateItemField, fetchIssueNodeId } = require('./projects');

beforeEach(() => {
  ghGraphql.mockReset();
  resolveOwnerId.mockReset();
});

describe('createProject', () => {
  test('resolves owner, mutates createProjectV2, returns project metadata', () => {
    resolveOwnerId.mockReturnValueOnce({ id: 'U_abc', type: 'user' });
    ghGraphql.mockReturnValueOnce({
      createProjectV2: {
        projectV2: {
          id: 'PVT_kwHOAAlL2c4AADYv',
          number: 12,
          url: 'https://github.com/users/paullovvik/projects/12',
        },
      },
    });

    const result = createProject({ owner: 'paullovvik', title: 'Auth PRD' });

    expect(resolveOwnerId).toHaveBeenCalledWith('paullovvik');
    expect(result).toEqual({
      number: 12,
      id: 'PVT_kwHOAAlL2c4AADYv',
      owner: 'paullovvik',
      ownerType: 'user',
      url: 'https://github.com/users/paullovvik/projects/12',
    });
    const [query, vars] = ghGraphql.mock.calls[0];
    expect(query).toMatch(/createProjectV2/);
    expect(vars).toEqual({ ownerId: 'U_abc', title: 'Auth PRD' });
  });

  test('propagates resolveOwnerId errors', () => {
    resolveOwnerId.mockImplementationOnce(() => { throw new Error('Could not resolve owner: ghost'); });
    expect(() => createProject({ owner: 'ghost', title: 't' })).toThrow(/ghost/);
  });
});

describe('createStandardFields', () => {
  test('creates 5 fields and captures single-select option IDs', () => {
    // priority (NUMBER)
    ghGraphql.mockReturnValueOnce({
      createProjectV2Field: { projectV2Field: { id: 'PVTF_priority' } },
    });
    // category (SINGLE_SELECT) with two categories
    ghGraphql.mockReturnValueOnce({
      createProjectV2Field: {
        projectV2Field: {
          id: 'PVTF_category',
          options: [
            { id: 'opt_be', name: 'Backend' },
            { id: 'opt_fe', name: 'Frontend' },
          ],
        },
      },
    });
    // iterationCount (NUMBER)
    ghGraphql.mockReturnValueOnce({
      createProjectV2Field: { projectV2Field: { id: 'PVTF_iter' } },
    });
    // criteriaPassRate (NUMBER)
    ghGraphql.mockReturnValueOnce({
      createProjectV2Field: { projectV2Field: { id: 'PVTF_rate' } },
    });
    // ralphStatus (SINGLE_SELECT) with 5 fixed options
    ghGraphql.mockReturnValueOnce({
      createProjectV2Field: {
        projectV2Field: {
          id: 'PVTF_status',
          options: [
            { id: 'opt_pending', name: 'Pending' },
            { id: 'opt_inprog', name: 'In Progress' },
            { id: 'opt_passed', name: 'Passed' },
            { id: 'opt_failed', name: 'Failed' },
            { id: 'opt_stalled', name: 'Stalled' },
          ],
        },
      },
    });

    const fieldIds = createStandardFields({
      projectId: 'PVT_xxx',
      categories: ['Backend', 'Frontend'],
    });

    expect(fieldIds.priority).toEqual({ id: 'PVTF_priority', dataType: 'NUMBER' });
    expect(fieldIds.category).toEqual({
      id: 'PVTF_category',
      dataType: 'SINGLE_SELECT',
      options: { Backend: 'opt_be', Frontend: 'opt_fe' },
    });
    expect(fieldIds.iterationCount).toEqual({ id: 'PVTF_iter', dataType: 'NUMBER' });
    expect(fieldIds.criteriaPassRate).toEqual({ id: 'PVTF_rate', dataType: 'NUMBER' });
    expect(fieldIds.ralphStatus.dataType).toBe('SINGLE_SELECT');
    expect(fieldIds.ralphStatus.options.Stalled).toBe('opt_stalled');
    expect(ghGraphql).toHaveBeenCalledTimes(5);
  });

  test('dedupes repeated categories', () => {
    ghGraphql.mockReturnValueOnce({ createProjectV2Field: { projectV2Field: { id: 'p1' } } });
    ghGraphql.mockReturnValueOnce({
      createProjectV2Field: {
        projectV2Field: { id: 'c1', options: [{ id: 'o1', name: 'X' }] },
      },
    });
    ghGraphql.mockReturnValueOnce({ createProjectV2Field: { projectV2Field: { id: 'i1' } } });
    ghGraphql.mockReturnValueOnce({ createProjectV2Field: { projectV2Field: { id: 'r1' } } });
    ghGraphql.mockReturnValueOnce({
      createProjectV2Field: {
        projectV2Field: {
          id: 's1',
          options: [
            { id: 'sp', name: 'Pending' },
            { id: 'si', name: 'In Progress' },
            { id: 'spa', name: 'Passed' },
            { id: 'sf', name: 'Failed' },
            { id: 'sst', name: 'Stalled' },
          ],
        },
      },
    });

    const fieldIds = createStandardFields({ projectId: 'pid', categories: ['X', 'X', 'X'] });
    expect(Object.keys(fieldIds.category.options)).toEqual(['X']);
  });
});

describe('fetchIssueNodeId', () => {
  test('calls gh api and returns the node_id', () => {
    ghGraphql.mockReturnValueOnce({
      repository: { issue: { id: 'I_kwDO_xyz' } },
    });
    const id = fetchIssueNodeId({ repo: 'paullovvik/myrepo', issueNumber: 42 });
    expect(id).toBe('I_kwDO_xyz');
    expect(ghGraphql.mock.calls[0][1]).toEqual({ owner: 'paullovvik', name: 'myrepo', number: 42 });
  });
});

describe('addProjectItem', () => {
  test('adds an issue node to the project', () => {
    ghGraphql.mockReturnValueOnce({
      addProjectV2ItemById: { item: { id: 'PVTI_xxx' } },
    });
    const id = addProjectItem({ projectId: 'PVT_yyy', contentId: 'I_kwDO_xyz' });
    expect(id).toBe('PVTI_xxx');
  });
});

const { fetchProjectFieldState, fetchItemFieldValue } = require('./projects');

describe('fetchProjectFieldState', () => {
  test('returns a name->field map the caller can cross-check against cached IDs', () => {
    ghGraphql.mockReturnValueOnce({
      node: {
        fields: {
          nodes: [
            { id: 'PVTF_priority', name: 'Priority', dataType: 'NUMBER' },
            { id: 'PVTF_category', name: 'Category', dataType: 'SINGLE_SELECT', options: [
              { id: 'opt_be', name: 'Backend' },
            ]},
          ],
        },
      },
    });
    const state = fetchProjectFieldState({ projectId: 'PVT_xxx' });
    expect(state.Priority).toEqual({ id: 'PVTF_priority', dataType: 'NUMBER' });
    expect(state.Category).toEqual({
      id: 'PVTF_category',
      dataType: 'SINGLE_SELECT',
      options: { Backend: 'opt_be' },
    });
  });
});

describe('fetchItemFieldValue', () => {
  test('returns current board value for conflict detection (NUMBER)', () => {
    ghGraphql.mockReturnValueOnce({
      node: {
        fieldValues: {
          nodes: [{ field: { id: 'PVTF_rate' }, number: 0.66 }],
        },
      },
    });
    const v = fetchItemFieldValue({ itemId: 'PVTI_xxx', fieldId: 'PVTF_rate' });
    expect(v).toBe(0.66);
  });

  test('returns current board value for SINGLE_SELECT', () => {
    ghGraphql.mockReturnValueOnce({
      node: {
        fieldValues: {
          nodes: [{ field: { id: 'PVTF_status' }, name: 'In Progress' }],
        },
      },
    });
    const v = fetchItemFieldValue({ itemId: 'PVTI_xxx', fieldId: 'PVTF_status' });
    expect(v).toBe('In Progress');
  });

  test('returns null when the field is unset', () => {
    ghGraphql.mockReturnValueOnce({
      node: { fieldValues: { nodes: [] } },
    });
    expect(fetchItemFieldValue({ itemId: 'PVTI_xxx', fieldId: 'PVTF_x' })).toBeNull();
  });
});

describe('updateItemField', () => {
  test('updates a NUMBER field', () => {
    ghGraphql.mockReturnValueOnce({
      updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_xxx' } },
    });
    updateItemField({
      projectId: 'PVT_yyy',
      itemId: 'PVTI_xxx',
      field: { id: 'PVTF_priority', dataType: 'NUMBER' },
      value: 3,
    });
    const [query, vars] = ghGraphql.mock.calls[0];
    expect(query).toMatch(/updateProjectV2ItemFieldValue/);
    expect(query).toMatch(/number: \$value/);
    expect(vars.value).toBe(3);
  });

  test('updates a SINGLE_SELECT field using option ID lookup', () => {
    ghGraphql.mockReturnValueOnce({
      updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_xxx' } },
    });
    updateItemField({
      projectId: 'PVT_yyy',
      itemId: 'PVTI_xxx',
      field: {
        id: 'PVTF_status',
        dataType: 'SINGLE_SELECT',
        options: { Pending: 'opt_p', Passed: 'opt_pa' },
      },
      value: 'Passed',
    });
    const [query, vars] = ghGraphql.mock.calls[0];
    expect(query).toMatch(/singleSelectOptionId: \$optionId/);
    expect(vars.optionId).toBe('opt_pa');
  });

  test('throws on unknown single-select option', () => {
    expect(() => updateItemField({
      projectId: 'PVT_yyy',
      itemId: 'PVTI_xxx',
      field: { id: 'PVTF_status', dataType: 'SINGLE_SELECT', options: { Pending: 'opt_p' } },
      value: 'NotAnOption',
    })).toThrow(/option "NotAnOption"/);
  });
});

describe('RALPH_STATUS_OPTIONS', () => {
  test('RALPH_STATUS_OPTIONS includes Blocked as of Phase 6', () => {
    const { RALPH_STATUS_OPTIONS } = require('./projects');
    expect(RALPH_STATUS_OPTIONS).toEqual(
      expect.arrayContaining(['Pending', 'In Progress', 'Passed', 'Failed', 'Stalled', 'Blocked'])
    );
    expect(RALPH_STATUS_OPTIONS.length).toBe(6);
  });
});
