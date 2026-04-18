'use strict';

jest.mock('./graphql');
const { ghGraphql, resolveOwnerId } = require('./graphql');
const { createProject } = require('./projects');

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
