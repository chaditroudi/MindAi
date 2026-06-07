import { Mastra } from '@mastra/core/mastra';
import { supervisorAgent } from './agents/supervisor.js';

export const mastra: Mastra = new Mastra({
  agents: { supervisorAgent },
});
