import type { DataSource } from '../types/index.js';

export const PRINCIPAL_SUPERVISOR_SOURCES: DataSource[] = [
  {
    name: 'municipalities',
    collection: 'municipalities',
    fields: [
      { name: 'name', type: 'string', role: 'dimension' },
      { name: 'id', type: 'string', role: 'id' },
    ],
  },
  {
    name: 'projects',
    collection: 'projects',
    fields: [
      { name: 'title', type: 'string', role: 'text' },
      { name: 'status', type: 'string', role: 'dimension' },
      {
        name: 'muni',
        type: 'string',
        role: 'id',
        description: 'municipality reference id',
        referenceTo: 'municipalities.id',
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

