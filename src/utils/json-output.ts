export function parseJsonOutput(text: string): unknown {
  const trimmed    = text.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const extracted  = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const objMatch   = extracted.match(/\{[\s\S]*\}/);
  return JSON.parse(objMatch ? objMatch[0] : extracted);
}
