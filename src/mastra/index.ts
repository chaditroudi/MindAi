import { Mastra } from '@mastra/core/mastra';
import { supervisorAgent } from './agents/supervisor.js';
import { writerAgent } from './agents/writer.js';
import { chartPlannerAgent } from './agents/chart.js';
import { searchAgent } from './agents/search.js';
import { dashboardWorkflow } from './workflows/dashboard.js';
import { reportWorkflow } from './workflows/report.js';
import { generalQuestionWorkflow } from './workflows/general-question.js';
import { searchWorkflow } from './workflows/search.js';

export const mastra: Mastra = new Mastra({
  agents: {
    supervisorAgent,
    writerAgent,
    chartPlannerAgent,
    searchAgent,
  },
  workflows: {
    dashboardWorkflow,
    reportWorkflow,
    generalQuestionWorkflow,
    searchWorkflow,
  },
});
