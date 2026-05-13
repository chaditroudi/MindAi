import { Mastra } from '@mastra/core/mastra';
import { supervisorAgent } from './agents/supervisor.js';
import { searchAgent } from './agents/search.js';
import { writerAgent } from './agents/writer.js';
import { dashboardWorkflow } from './workflows/dashboard.js';
import { reportWorkflow } from './workflows/report.js';
import { generalQuestionWorkflow } from './workflows/general-question.js';

export const mastra: Mastra = new Mastra({
  agents: {
    supervisorAgent,
    searchAgent,
    writerAgent,
  },
  workflows: {
    dashboardWorkflow,
    reportWorkflow,
    generalQuestionWorkflow,
  },
});
