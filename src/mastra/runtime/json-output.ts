import { z } from 'zod';

export function parseJsonOutput<TSchema extends z.ZodTypeAny>(
  text: string | undefined,
  schema: TSchema,
): z.output<TSchema> {
  return schema.parse(parseJsonObject(text));
}

export function parseJsonObject(text: string | undefined): Record<string, unknown> {
  const raw = text?.trim() ?? '';
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() ?? raw;
  const json = extractLastJsonObject(candidate);
  if (!json) {
    throw new Error(`No JSON object found in model response: ${candidate.slice(0, 200)}`);
  }
  const value = JSON.parse(json);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Model response JSON is not an object');
  }
  return value as Record<string, unknown>;
}

function extractLastJsonObject(text: string) {
  const objects: string[] = [];
  let start: number | undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start !== undefined) {
        objects.push(text.slice(start, i + 1));
        start = undefined;
      }
    }
  }

  return objects.at(-1);
}
