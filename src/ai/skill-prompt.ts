import { readFileSync } from 'node:fs';

export function readMarkdownSection(fileUrl: URL, heading: string): string {
  const content = readFileSync(fileUrl, 'utf-8').replace(/\r\n/g, '\n');
  const lines = content.split('\n');
  const target = heading.trim().toLowerCase();

  let start = -1;
  let level = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i].trim());
    if (!match) continue;
    if (match[2].trim().toLowerCase() !== target) continue;
    start = i + 1;
    level = match[1].length;
    break;
  }

  if (start === -1) {
    throw new Error(`Markdown section "${heading}" not found in ${fileUrl.pathname}`);
  }

  const collected: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i].trim());
    if (match && match[1].length <= level) break;
    collected.push(lines[i]);
  }

  return collected.join('\n').trim();
}

export function readJsonSection<T>(fileUrl: URL, heading: string): T {
  const section = readMarkdownSection(fileUrl, heading);
  const match = /```(?:json)?\s*([\s\S]*?)```/.exec(section);
  if (!match?.[1]) throw new Error(`No JSON block in "${heading}" section of ${fileUrl.pathname}`);
  return JSON.parse(match[1].trim()) as T;
}

export function interpolateTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{[A-Z0-9_]+\}\}/g, match => values[match] ?? match);
}
