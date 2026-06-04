import type { DataStore } from '../types/index.js';

export const PRINCIPAL_SUPERVISOR_DATASTORES: DataStore[] = [
  {
    name: 'municipalities',
    collection: 'municipalities',
    fields: [
      {
        name: 'name',
        type: 'string',
        role: 'dimension',
        enumValues: ['Doha', 'Al Rayyan', 'Al Wakrah', 'Umm Salal', 'Al Khor'],
      },
      { name: 'id', type: 'string', role: 'id' },
    ],
  },
  {
    name: 'projects',
    collection: 'projects',
    fields: [
      { name: 'title', type: 'string', role: 'text' },
      {
        name: 'status',
        type: 'string',
        role: 'dimension',
        enumValues: ['in progress', 'completed', 'planned', 'on hold', 'cancelled'],
      },
      {
        name: 'muni',
        type: 'string',
        role: 'id',
        description: 'municipality reference id',
        referenceTo: 'municipalities.id',
      },
      {
        name: 'municipality',
        type: 'string',
        role: 'dimension',
        description: 'municipality name (joined from municipalities)',
        enumValues: ['Doha', 'Al Rayyan', 'Al Wakrah', 'Umm Salal', 'Al Khor'],
      },
    ],
    joins: [
      {
        from: 'municipalities',
        localField: 'muni',
        foreignField: 'id',
        as: 'municipality',
      },
    ],
  },
];

export const PRINCIPAL_SUPERVISOR_SCHEMA_INSTRUCTION = JSON.stringify([
  {
    collection: 'municipalities',
    fields: [
      { name: 'name', type: 'string' },
      { name: 'id', type: 'string' },
    ],
  },
  {
    collection: 'projects',
    fields: [
      { name: 'title', type: 'string' },
      { name: 'status', type: 'string' },
      { name: 'muni', type: 'string', desc: 'municipality reference id' },
    ],
  },
], null, 2);
