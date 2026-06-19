export const ROLE_ENV_KEYS: Record<AgentRole, string> = {
  supervisor: 'GROQ_SUPERVISOR_MODEL',
  chart:      'GROQ_CHART_MODEL',
  writer:     'GROQ_WRITER_MODEL',
  memory:     'GROQ_MEMORY_MODEL',
};

export const ROLE_DEFAULTS: Record<AgentRole, string> = {
  supervisor: 'llama-3.3-70b-versatile',
  chart:      'llama-3.3-70b-versatile',
  writer:     'llama-3.3-70b-versatile',
  memory:     'llama-3.1-8b-instant',
};

export const TIMEOUT_ENV_KEYS: Record<AgentRole, string> = {
  supervisor: 'SUPERVISOR_TIMEOUT_MS',
  chart:      'CHART_TIMEOUT_MS',
  writer:     'WRITER_TIMEOUT_MS',
  memory:     'WRITER_TIMEOUT_MS',
};