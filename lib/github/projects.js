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

module.exports = { createProject };
