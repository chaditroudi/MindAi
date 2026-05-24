import { z } from 'zod';

export const pipelineStageSchema = z.record(z.unknown());

export const pipelineSchema = z.array(pipelineStageSchema);

export type PipelineStage = z.infer<typeof pipelineStageSchema>;
export type Pipeline = z.infer<typeof pipelineSchema>;
