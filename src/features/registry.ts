import type { CoreMessage } from 'ai';
import { executeDashboard } from './dashboard.js';
import { executeReport } from './report.js';
import { executeInquiry } from './inquiry.js';

export type FeatureHandler = (prompt: string, context: CoreMessage[], apiKey?: string) => Promise<unknown>;

export const featureRegistry: Record<string, FeatureHandler> = {
  dashboard: executeDashboard,
  report:    executeReport,
  inquiry:   executeInquiry,
};
