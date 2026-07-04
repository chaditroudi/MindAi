import { readFileSync } from 'node:fs';
import * as path from 'node:path';



export function skillFile(...segments: string[]): string {
  return path.resolve(__dirname, '..', '..', '..', 'skills', ...segments);
}


export function readMarkdownSection(filePath: string, heading: string): string {
  const content = readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
  const lines = content.split('\n');
  const target = heading.trim().toLowerCase();

  let start = -1;
  let level = 0; // how many '#' characters the matched heading had

  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i].trim());
    if (!match) continue;
    if (match[2].trim().toLowerCase() !== target) continue;
    start = i + 1; // content begins on the NEXT line, not the heading itself
    level = match[1].length;
    break;
  }

  if (start === -1) {
    throw new Error(`Markdown section "${heading}" not found in ${filePath}`);
  }

  const collected: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i].trim());
    if (match && match[1].length <= level) break;
    collected.push(lines[i]);
  }

  return collected.join('\n').trim();
}


export function readJsonSection<T>(filePath: string, heading: string): T {
  const section = readMarkdownSection(filePath, heading);
  const match = /```(?:json)?\s*([\s\S]*?)```/.exec(section);
  if (!match?.[1])
    throw new Error(`No JSON block in "${heading}" section of ${filePath}`);
  return JSON.parse(match[1].trim()) as T;
}

export function interpolateTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(
    /\{\{[A-Z0-9_]+\}\}/g,
    (match) => values[match] ?? match,
  );
}
