import { createOpenAI } from '@ai-sdk/openai';

type AgentRole = 'supervisor' | 'writer' | 'chart' | 'search';

const apiKey = process.env.GROQ_API_KEY;
if (!apiKey) throw new Error('GROQ_API_KEY is not set');

const client = createOpenAI({
  baseURL:       'https://api.groq.com/openai/v1',
  apiKey,
  compatibility: 'compatible',
});

export function resolveModel(role: AgentRole) {
  const model = process.env[`GROQ_${role.toUpperCase()}_MODEL`]?.trim()
    ?? process.env.GROQ_MODEL?.trim()
    ?? 'llama-3.3-70b-versatile';
  return client(model);
}
