/// <reference types="node" />
import 'dotenv/config';
import { getMongo, closeMongo } from '../src/db/mongo.client.js';

const municipalities = [
  { id: 'MUN-001', name: 'Greenfield',  region: 'North',   population: 142_000, area: 285, budget: 48.5  },
  { id: 'MUN-002', name: 'Silverstone', region: 'North',   population: 89_400,  area: 190, budget: 31.2  },
  { id: 'MUN-003', name: 'Lakewood',    region: 'East',    population: 213_600, area: 410, budget: 72.1  },
  { id: 'MUN-004', name: 'Ironbridge',  region: 'East',    population: 67_200,  area: 155, budget: 22.8  },
  { id: 'MUN-005', name: 'Sunvalley',   region: 'South',   population: 310_000, area: 520, budget: 105.4 },
  { id: 'MUN-006', name: 'Maplecrest',  region: 'South',   population: 58_000,  area: 130, budget: 19.6  },
  { id: 'MUN-007', name: 'Westport',    region: 'West',    population: 178_500, area: 340, budget: 60.3  },
  { id: 'MUN-008', name: 'Clearwater',  region: 'West',    population: 95_700,  area: 200, budget: 32.9  },
  { id: 'MUN-009', name: 'Stonehaven',  region: 'Central', population: 430_000, area: 680, budget: 148.7 },
  { id: 'MUN-010', name: 'Pinehurst',   region: 'Central', population: 52_300,  area: 110, budget: 17.4  },
  { id: 'MUN-011', name: 'Riverton',    region: 'North',   population: 125_000, area: 260, budget: 42.0  },
  { id: 'MUN-012', name: 'Coldbrook',   region: 'East',    population: 38_800,  area: 88,  budget: 12.9  },
  { id: 'MUN-013', name: 'Elmbridge',   region: 'South',   population: 247_000, area: 475, budget: 83.6  },
  { id: 'MUN-014', name: 'Highgate',    region: 'West',    population: 73_100,  area: 162, budget: 24.5  },
  { id: 'MUN-015', name: 'Meadowbrook', region: 'Central', population: 160_000, area: 305, budget: 54.2  },
  { id: 'MUN-016', name: 'Ashford',     region: 'North',   population: 44_500,  area: 98,  budget: 14.8  },
  { id: 'MUN-017', name: 'Crestview',   region: 'East',    population: 188_000, area: 360, budget: 63.7  },
  { id: 'MUN-018', name: 'Fairview',    region: 'South',   population: 115_000, area: 235, budget: 38.9  },
  { id: 'MUN-019', name: 'Brookside',   region: 'West',    population: 290_000, area: 550, budget: 98.2  },
  { id: 'MUN-020', name: 'Northgate',   region: 'Central', population: 79_600,  area: 175, budget: 26.8  },
];

const projects = [
  // Greenfield – MUN-001
  { title: 'Central Park Renovation',        status: 'completed',   muni: 'MUN-001', category: 'environment',    budget: 3.2,  startYear: 2021, duration: 18, priority: 'medium' },
  { title: 'North Ring Road Extension',      status: 'in_progress', muni: 'MUN-001', category: 'transport',      budget: 12.5, startYear: 2023, duration: 36, priority: 'high'   },
  { title: 'Digital Schools Programme',      status: 'completed',   muni: 'MUN-001', category: 'education',      budget: 2.1,  startYear: 2022, duration: 12, priority: 'high'   },

  // Silverstone – MUN-002
  { title: 'Water Treatment Upgrade',        status: 'in_progress', muni: 'MUN-002', category: 'infrastructure', budget: 8.7,  startYear: 2023, duration: 24, priority: 'high'   },
  { title: 'Community Sports Centre',        status: 'planning',    muni: 'MUN-002', category: 'culture',        budget: 4.5,  startYear: 2025, duration: 20, priority: 'medium' },

  // Lakewood – MUN-003
  { title: 'Lakefront Boardwalk',            status: 'completed',   muni: 'MUN-003', category: 'environment',    budget: 5.8,  startYear: 2020, duration: 16, priority: 'medium' },
  { title: 'Metro Line 3 Expansion',         status: 'in_progress', muni: 'MUN-003', category: 'transport',      budget: 45.0, startYear: 2022, duration: 60, priority: 'high'   },
  { title: 'New General Hospital Wing',      status: 'completed',   muni: 'MUN-003', category: 'health',         budget: 22.3, startYear: 2019, duration: 30, priority: 'high'   },
  { title: 'Solar Street Lighting',          status: 'in_progress', muni: 'MUN-003', category: 'infrastructure', budget: 1.8,  startYear: 2024, duration: 10, priority: 'low'    },

  // Ironbridge – MUN-004
  { title: 'Bridge Structural Repair',       status: 'completed',   muni: 'MUN-004', category: 'infrastructure', budget: 6.4,  startYear: 2021, duration: 14, priority: 'high'   },
  { title: 'Youth Training Centre',          status: 'on_hold',     muni: 'MUN-004', category: 'education',      budget: 3.1,  startYear: 2023, duration: 18, priority: 'medium' },

  // Sunvalley – MUN-005
  { title: 'Smart Traffic Management',       status: 'in_progress', muni: 'MUN-005', category: 'transport',      budget: 9.2,  startYear: 2023, duration: 18, priority: 'high'   },
  { title: 'Green Corridor Phase 1',         status: 'completed',   muni: 'MUN-005', category: 'environment',    budget: 7.6,  startYear: 2021, duration: 22, priority: 'high'   },
  { title: 'Green Corridor Phase 2',         status: 'in_progress', muni: 'MUN-005', category: 'environment',    budget: 8.1,  startYear: 2023, duration: 20, priority: 'medium' },
  { title: 'Regional Health Hub',            status: 'planning',    muni: 'MUN-005', category: 'health',         budget: 35.0, startYear: 2025, duration: 48, priority: 'high'   },
  { title: 'Innovation Business Park',       status: 'in_progress', muni: 'MUN-005', category: 'infrastructure', budget: 28.5, startYear: 2022, duration: 42, priority: 'medium' },

  // Maplecrest – MUN-006
  { title: 'Library Digital Hub',            status: 'completed',   muni: 'MUN-006', category: 'education',      budget: 1.4,  startYear: 2022, duration: 8,  priority: 'low'    },
  { title: 'Flood Defence Works',            status: 'completed',   muni: 'MUN-006', category: 'infrastructure', budget: 4.9,  startYear: 2020, duration: 24, priority: 'high'   },

  // Westport – MUN-007
  { title: 'Harbour Redevelopment',          status: 'in_progress', muni: 'MUN-007', category: 'infrastructure', budget: 18.3, startYear: 2022, duration: 36, priority: 'high'   },
  { title: 'Cycle Network West',             status: 'completed',   muni: 'MUN-007', category: 'transport',      budget: 3.7,  startYear: 2021, duration: 15, priority: 'medium' },
  { title: 'Beachfront Cultural Quarter',    status: 'planning',    muni: 'MUN-007', category: 'culture',        budget: 11.2, startYear: 2025, duration: 30, priority: 'medium' },

  // Clearwater – MUN-008
  { title: 'Wastewater Plant Modernisation', status: 'in_progress', muni: 'MUN-008', category: 'infrastructure', budget: 14.6, startYear: 2023, duration: 28, priority: 'high'   },
  { title: 'Public Health Campaign',         status: 'completed',   muni: 'MUN-008', category: 'health',         budget: 0.8,  startYear: 2022, duration: 6,  priority: 'medium' },

  // Stonehaven – MUN-009
  { title: 'Underground Rail Link',          status: 'in_progress', muni: 'MUN-009', category: 'transport',      budget: 88.0, startYear: 2021, duration: 72, priority: 'high'   },
  { title: 'University Campus Expansion',    status: 'completed',   muni: 'MUN-009', category: 'education',      budget: 41.5, startYear: 2019, duration: 36, priority: 'high'   },
  { title: 'City Centre Regeneration',       status: 'in_progress', muni: 'MUN-009', category: 'culture',        budget: 32.0, startYear: 2022, duration: 48, priority: 'high'   },
  { title: 'Air Quality Monitoring Grid',    status: 'completed',   muni: 'MUN-009', category: 'environment',    budget: 2.4,  startYear: 2021, duration: 10, priority: 'medium' },
  { title: "New Children's Hospital",        status: 'planning',    muni: 'MUN-009', category: 'health',         budget: 75.0, startYear: 2025, duration: 60, priority: 'high'   },

  // Pinehurst – MUN-010
  { title: 'Rural Road Resurfacing',         status: 'completed',   muni: 'MUN-010', category: 'transport',      budget: 2.2,  startYear: 2022, duration: 8,  priority: 'medium' },
  { title: 'Community Health Clinic',        status: 'in_progress', muni: 'MUN-010', category: 'health',         budget: 3.5,  startYear: 2024, duration: 16, priority: 'high'   },

  // Riverton – MUN-011
  { title: 'River Bank Restoration',         status: 'completed',   muni: 'MUN-011', category: 'environment',    budget: 4.1,  startYear: 2021, duration: 20, priority: 'medium' },
  { title: 'Secondary School Rebuild',       status: 'in_progress', muni: 'MUN-011', category: 'education',      budget: 16.8, startYear: 2023, duration: 24, priority: 'high'   },

  // Coldbrook – MUN-012
  { title: 'Snow Management Depot',          status: 'completed',   muni: 'MUN-012', category: 'infrastructure', budget: 1.9,  startYear: 2020, duration: 12, priority: 'medium' },
  { title: 'Village Hall Restoration',       status: 'on_hold',     muni: 'MUN-012', category: 'culture',        budget: 0.9,  startYear: 2023, duration: 10, priority: 'low'    },

  // Elmbridge – MUN-013
  { title: 'Southern Bypass Road',           status: 'in_progress', muni: 'MUN-013', category: 'transport',      budget: 31.0, startYear: 2022, duration: 42, priority: 'high'   },
  { title: 'Outdoor Sports Complex',         status: 'completed',   muni: 'MUN-013', category: 'culture',        budget: 8.9,  startYear: 2020, duration: 18, priority: 'medium' },
  { title: 'Tree Planting Initiative',       status: 'completed',   muni: 'MUN-013', category: 'environment',    budget: 0.6,  startYear: 2023, duration: 6,  priority: 'low'    },

  // Highgate – MUN-014
  { title: 'Hillside Erosion Control',       status: 'completed',   muni: 'MUN-014', category: 'environment',    budget: 3.3,  startYear: 2021, duration: 14, priority: 'high'   },
  { title: 'Telecoms Broadband Rollout',     status: 'in_progress', muni: 'MUN-014', category: 'infrastructure', budget: 5.7,  startYear: 2023, duration: 18, priority: 'medium' },

  // Meadowbrook – MUN-015
  { title: 'Central Market Renovation',      status: 'completed',   muni: 'MUN-015', category: 'culture',        budget: 6.2,  startYear: 2020, duration: 20, priority: 'medium' },
  { title: 'Public Transit Electrification', status: 'in_progress', muni: 'MUN-015', category: 'transport',      budget: 22.0, startYear: 2023, duration: 36, priority: 'high'   },
  { title: 'Primary Care Expansion',         status: 'planning',    muni: 'MUN-015', category: 'health',         budget: 9.4,  startYear: 2025, duration: 24, priority: 'medium' },

  // Ashford – MUN-016
  { title: 'Rural Broadband Extension',      status: 'cancelled',   muni: 'MUN-016', category: 'infrastructure', budget: 2.8,  startYear: 2022, duration: 12, priority: 'medium' },
  { title: 'Footpath Accessibility Upgrade', status: 'completed',   muni: 'MUN-016', category: 'transport',      budget: 0.7,  startYear: 2023, duration: 6,  priority: 'low'    },

  // Crestview – MUN-017
  { title: 'Stadium District Redevelopment', status: 'in_progress', muni: 'MUN-017', category: 'culture',        budget: 24.5, startYear: 2022, duration: 40, priority: 'medium' },
  { title: 'Drinking Water Quality Plan',    status: 'completed',   muni: 'MUN-017', category: 'health',         budget: 5.1,  startYear: 2021, duration: 18, priority: 'high'   },
  { title: 'Industrial Zone Road Works',     status: 'in_progress', muni: 'MUN-017', category: 'transport',      budget: 13.6, startYear: 2024, duration: 20, priority: 'high'   },

  // Fairview – MUN-018
  { title: 'Heritage District Preservation', status: 'completed',   muni: 'MUN-018', category: 'culture',        budget: 7.3,  startYear: 2020, duration: 24, priority: 'medium' },
  { title: 'Solar Energy Initiative',        status: 'in_progress', muni: 'MUN-018', category: 'environment',    budget: 6.9,  startYear: 2023, duration: 18, priority: 'medium' },

  // Brookside – MUN-019
  { title: 'Rapid Transit Corridor',         status: 'in_progress', muni: 'MUN-019', category: 'transport',      budget: 56.0, startYear: 2021, duration: 60, priority: 'high'   },
  { title: 'Biomedical Research Centre',     status: 'planning',    muni: 'MUN-019', category: 'health',         budget: 42.0, startYear: 2025, duration: 48, priority: 'high'   },
  { title: 'Urban Green Spaces Network',     status: 'in_progress', muni: 'MUN-019', category: 'environment',    budget: 10.3, startYear: 2023, duration: 24, priority: 'medium' },

  // Northgate – MUN-020
  { title: 'District Heating System',        status: 'in_progress', muni: 'MUN-020', category: 'infrastructure', budget: 11.8, startYear: 2023, duration: 30, priority: 'high'   },
  { title: 'Arts & Culture Festival Fund',   status: 'completed',   muni: 'MUN-020', category: 'culture',        budget: 0.5,  startYear: 2023, duration: 3,  priority: 'low'    },
];

const sources = [
  {
    name:        'projects',
    collection:  'projects',
    description: 'Municipal infrastructure and service projects with status, budget, category, and timeline.',
    fields: [
      { name: 'title',     type: 'string',  description: 'Project name' },
      { name: 'status',    type: 'enum',    description: 'Current status — values: completed, in_progress, planning, on_hold, cancelled' },
      { name: 'muni',      type: 'string',  description: 'Municipality ID — references municipalities.id', referenceTo: 'municipalities' },
      { name: 'category',  type: 'enum',    description: 'Project sector — values: environment, transport, education, infrastructure, culture, health' },
      { name: 'budget',    type: 'number',  description: 'Budget in millions', role: 'measure' },
      { name: 'startYear', type: 'integer', description: 'Year the project started', role: 'temporal' },
      { name: 'duration',  type: 'integer', description: 'Duration in months', role: 'measure' },
      { name: 'priority',  type: 'enum',    description: 'Priority level — values: high, medium, low' },
    ],
  },
  {
    name:        'municipalities',
    collection:  'municipalities',
    description: 'Municipality reference data with population, area, and annual budget.',
    fields: [
      { name: 'id',         type: 'string',  description: 'Unique municipality ID (e.g. MUN-001)', role: 'id' },
      { name: 'name',       type: 'string',  description: 'Municipality name' },
      { name: 'region',     type: 'enum',    description: 'Geographic region — values: North, South, East, West, Central' },
      { name: 'population', type: 'integer', description: 'Resident population', role: 'measure' },
      { name: 'area',       type: 'number',  description: 'Area in km²', role: 'measure' },
      { name: 'budget',     type: 'number',  description: 'Annual municipal budget in millions', role: 'measure' },
    ],
  },
];

async function seed() {
  const { db } = await getMongo();

  await db.collection('municipalities').drop().catch(() => {});
  await db.collection('municipalities').insertMany(municipalities);
  console.log(`municipalities: ${municipalities.length} documents`);

  await db.collection('projects').drop().catch(() => {});
  await db.collection('projects').insertMany(projects);
  console.log(`projects: ${projects.length} documents`);

  await db.collection('sources').drop().catch(() => {});
  await db.collection('sources').insertMany(sources);
  console.log(`sources: ${sources.length} documents`);

  // Clear stale cached results so the planner re-runs with fresh schema knowledge
  const deleted = await db.collection('prompt_cache').deleteMany({});
  console.log(`prompt_cache: cleared ${deleted.deletedCount} stale entries`);

  await closeMongo();
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
