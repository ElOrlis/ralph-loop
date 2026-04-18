'use strict';

jest.mock('./graphql');
const { ghGraphql, resolveOwnerId } = require('./graphql');
const { createProject, createStandardFields } = require('./projects');

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
