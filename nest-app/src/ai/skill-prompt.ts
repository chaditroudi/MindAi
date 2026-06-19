// ── PURPOSE ───────────────────────────────────────────────────────────────────
// This file provides utility functions for reading system prompts and config
// from the Markdown files inside the skills/ folder.
//
// WHY MARKDOWN FILES: system prompts are long, multi-line texts that are hard
// to maintain inside TypeScript string literals. Storing them in .md files lets
// you edit prompts without touching code, and sections are cleanly separated by
// headings (## Runtime Prompt, ## Chart Config, etc.).
//
// USAGE PATTERN: called ONCE at module startup (not per request) to load prompts
// into memory. Example in ai/writer.ts:
//   const INQUIRY_INSTRUCTIONS = readMarkdownSection(skillFile('inquiry','SKILL.md'), 'Runtime Prompt');
//
// USED BY: ai/chart.ts, ai/writer.ts, ai/memory-skill.ts, session/agent.ts
// ─────────────────────────────────────────────────────────────────────────────

// readFileSync → synchronous file read (fine here because it only runs at startup)
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

// ── skillFile() ───────────────────────────────────────────────────────────────
// Builds an absolute path to a file inside the skills/ folder.
//
// __dirname here is nest-app/src/ai/ so we go up 3 levels to reach the project root,
// then into skills/.
//
// Example:
//   skillFile('chart', 'SKILL.md')
//   → C:\...\MindAi-main\skills\chart\SKILL.md
//
// The rest parameter (...segments) lets you pass any number of path parts:
//   skillFile('inquiry', 'SKILL.md')  → skills/inquiry/SKILL.md
//   skillFile('memory',  'SKILL.md')  → skills/memory/SKILL.md
export function skillFile(...segments: string[]): string {
  return path.resolve(__dirname, '..', '..', '..', 'skills', ...segments);
}

// ── readMarkdownSection() ─────────────────────────────────────────────────────
// Extracts the text content under a specific heading in a Markdown file.
// Stops collecting text when it hits the next heading of equal or higher level.
//
// Example — given this SKILL.md:
//   ## Runtime Prompt
//   You are a helpful analyst...
//   ## Chart Config
//   ```json { ... } ```
//
//   readMarkdownSection(file, 'Runtime Prompt')
//   → "You are a helpful analyst..."
//
// @param filePath - absolute path to the .md file (use skillFile() to build it)
// @param heading  - the heading text to find (case-insensitive)
export function readMarkdownSection(filePath: string, heading: string): string {
  // Read the whole file and normalize line endings (Windows uses \r\n, we want \n)
  const content = readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
  const lines = content.split('\n');
  const target = heading.trim().toLowerCase(); // normalize for case-insensitive match

  let start = -1; // line index where the heading's content begins (line after the heading)
  let level = 0;  // how many # characters the heading had (## = 2, ### = 3, etc.)

  // Scan every line looking for the target heading
  for (let i = 0; i < lines.length; i += 1) {
    // Regex matches Markdown headings: "## My Heading" → groups: ["##", "My Heading"]
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i].trim());
    if (!match) continue;                                      // not a heading line
    if (match[2].trim().toLowerCase() !== target) continue;   // wrong heading

    start = i + 1;           // content starts on the line AFTER the heading
    level = match[1].length; // e.g. ## has level 2
    break;
  }

  // If the heading was never found, throw a clear error so developers know immediately
  if (start === -1) {
    throw new Error(`Markdown section "${heading}" not found in ${filePath}`);
  }

  // Collect all lines until we hit another heading of equal or higher level
  const collected: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.*)$/.exec(lines[i].trim());
    // Stop when we find a heading that "closes" this section
    // e.g. if our section was ##, stop at any ## or # heading
    if (match && match[1].length <= level) break;
    collected.push(lines[i]);
  }

  // Join all collected lines back into a single string and trim surrounding whitespace
  return collected.join('\n').trim();
}

// ── readJsonSection() ─────────────────────────────────────────────────────────
// Reads a Markdown section (via readMarkdownSection) and parses the first
// ```json ... ``` code block inside it.
//
// Used by ai/chart.ts to load chart type definitions at startup:
//   const config = readJsonSection<SkillConfig>(skillFile('chart','SKILL.md'), 'Chart Config');
//
// @param filePath - absolute path to the .md file
// @param heading  - the heading containing the JSON block
// @returns        - the parsed JSON object, typed as T
export function readJsonSection<T>(filePath: string, heading: string): T {
  // First get the raw text of the section
  const section = readMarkdownSection(filePath, heading);

  // Regex extracts content between ```json ... ``` or ``` ... ``` fences
  // ([\s\S]*?) → matches any characters including newlines, non-greedy
  const match = /```(?:json)?\s*([\s\S]*?)```/.exec(section);

  if (!match?.[1]) throw new Error(`No JSON block in "${heading}" section of ${filePath}`);

  // Parse and cast — TypeScript trusts us that the JSON matches type T
  return JSON.parse(match[1].trim()) as T;
}

// ── interpolateTemplate() ─────────────────────────────────────────────────────
// Replaces {{VARIABLE}} placeholders in a template string with real values.
//
// Example:
//   interpolateTemplate("Hello {{USER_NAME}}", { "{{USER_NAME}}": "Alice" })
//   → "Hello Alice"
//
// The regex /\{\{[A-Z0-9_]+\}\}/g matches uppercase placeholder names like
// {{SOURCE_NAME}}, {{FIELD_LIST}}, {{INTENT}}.
// If a placeholder has no matching value in the map, it is left unchanged.
export function interpolateTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{[A-Z0-9_]+\}\}/g, match => values[match] ?? match);
}
