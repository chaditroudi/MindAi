import type { ZodSchema } from 'zod';

export function parseJsonOutput<T>(text: string, schema: ZodSchema<T>): T {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const extracted = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const objMatch = extracted.match(/\{[\s\S]*\}/);
  return schema.parse(JSON.parse(objMatch ? objMatch[0] : extracted));
}
