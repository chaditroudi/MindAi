import { Mastra } from '@mastra/core/mastra';
import { supervisorAgent } from './agents/supervisor.js';
import { writerAgent } from './agents/writer.js';
import { chartPlannerAgent } from './agents/chart.js';

export const mastra: Mastra = new Mastra({
  agents: {
    supervisorAgent,
    writerAgent,
    chartPlannerAgent,
  },
});
